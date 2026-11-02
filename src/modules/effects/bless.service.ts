import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { loadEntity } from '../mechanical/mechanical.service.js';
import { saveMechanicalState } from './effect-conditions.js';
import { appendEffectLog, endEffectsForConcentration, publishEffects } from './effects.service.js';
import {
  BLESS_DEFINITION_ID,
  BLESS_LABEL,
  BLESS_SPELL_ID,
  blessModifiers,
} from './definitions/bless.js';
import { toEffectDto, type EffectDto } from './effects.dto.js';
import type { ApplyBlessInput } from './effects.schema.js';

/**
 * FASE 6.5G — APLICAÇÃO CONTROLADA DE BLESS.
 *
 * Ferramenta de PROVA da Generic Effect Engine, exclusiva do Mestre. NÃO é a
 * Spell Execution Engine: não consome Ação nem slot, não valida alcance,
 * componentes, preparação ou disponibilidade. O cliente manda apenas o caster e
 * até três alvos — tudo o mais é resolvido no servidor.
 *
 * A aplicação é uma operação de domínio (nunca HTTP interno):
 *  • 1 grupo de efeitos + 1 EffectInstance por alvo;
 *  • modificadores genéricos (`+1d4` opcional em ataque/save) vindos da
 *    definição de Bless;
 *  • concentração do caster ligada ao grupo (`sourceType: 'effect'`,
 *    `sourceId = groupId`), substituindo a anterior pelo MESMO motor;
 *  • tudo na MESMA transação: alvo inválido/duplicado não deixa aplicação
 *    parcial nem concentração órfã.
 */

export interface BlessActor {
  userId: string;
  username: string;
  role: 'MASTER' | 'PLAYER';
}

export interface BlessResult {
  groupId: string;
  effects: EffectDto[];
  replayed: boolean;
}

function fingerprintOf(actor: BlessActor, input: ApplyBlessInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        type: 'bless-apply',
        actor: actor.userId,
        caster: input.caster,
        targets: input.targets,
      }),
    )
    .digest('hex');
}

function replayError(): never {
  throw new HttpError(
    'operationId reutilizado com outro payload/autor.',
    409,
    'IDEMPOTENCY_KEY_REUSED',
  );
}

export async function applyBless(actor: BlessActor, input: ApplyBlessInput): Promise<BlessResult> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre aplica o Bless de prova.', 403);
  }

  const fingerprint = fingerprintOf(actor, input);
  const replay = (operation: { fingerprint: string; snapshot: unknown }): BlessResult => {
    if (operation.fingerprint !== fingerprint) replayError();
    return { ...(operation.snapshot as Omit<BlessResult, 'replayed'>), replayed: true };
  };

  const existing = await prisma.effectOperation.findUnique({
    where: { operationId: input.operationId },
  });
  if (existing) return replay(existing);

  let result: BlessResult & { casterEntity: import('../shared/conditions.js').MechanicalEntity };
  try {
    result = await prisma.$transaction(async (db) => {
      const prior = await db.effectOperation.findUnique({
        where: { operationId: input.operationId },
      });
      if (prior) return { ...replay(prior), casterEntity: input.caster };

      // Caster e alvos são resolvidos/canonicalizados pelo SERVIDOR: id
      // inexistente vira 404 e combatente de personagem vira a ficha.
      const caster = await loadEntity(input.caster, db);
      const targets: Awaited<ReturnType<typeof loadEntity>>[] = [];
      const seen = new Set<string>();
      for (const target of input.targets) {
        const loaded = await loadEntity(target, db);
        const key = `${loaded.entity.kind}:${loaded.entity.id}`;
        if (seen.has(key)) {
          throw new HttpError(
            'Bless não pode repetir o mesmo alvo na mesma aplicação.',
            400,
            'VALIDATION_ERROR',
          );
        }
        seen.add(key);
        targets.push(loaded);
      }

      const groupId = randomUUID();
      const modifiers = blessModifiers();
      const created = [];
      for (const target of targets) {
        created.push(
          await db.effectInstance.create({
            data: {
              groupId,
              definitionId: BLESS_DEFINITION_ID,
              label: BLESS_LABEL,
              sourceType: 'spell',
              sourceId: BLESS_SPELL_ID,
              sourceEntityKind: caster.entity.kind,
              sourceEntityId: caster.entity.id,
              sourceLabel: caster.name,
              modifiers: modifiers as unknown as Prisma.InputJsonValue,
              conditions: [] as unknown as Prisma.InputJsonValue,
              targetEntityKind: target.entity.kind,
              targetEntityId: target.entity.id,
              visibility: 'public',
              status: 'active',
              createdBy: actor.userId,
            },
          }),
        );
      }

      // CONCENTRAÇÃO pelo MESMO motor existente: uma por caster. A anterior
      // termina (e o grupo dela é desmontado) dentro desta transação; o grupo
      // novo passa a ser o atual. Nada de segundo estado de concentração.
      const state = caster.state;
      if (state.concentration) {
        await endEffectsForConcentration(state.concentration, db, {
          entity: caster.entity,
          state,
        });
      }
      state.concentration = {
        id: randomUUID(),
        label: BLESS_LABEL,
        sourceType: 'effect',
        sourceId: groupId,
        visibility: 'public',
        startedAt: new Date().toISOString(),
        startedBy: actor.userId,
      };
      state.pendingConcentrationSaves = [];
      await saveMechanicalState(caster, state, db);

      const effects = created.map(toEffectDto);
      await db.effectOperation.create({
        data: {
          operationId: input.operationId,
          kind: 'bless',
          fingerprint,
          snapshot: { groupId, effects } as unknown as Prisma.InputJsonValue,
        },
      });
      return { groupId, effects, replayed: false, casterEntity: caster.entity };
    });
  } catch (error) {
    // Corrida de dois retries simultâneos: o perdedor devolve o snapshot.
    const previous = await prisma.effectOperation.findUnique({
      where: { operationId: input.operationId },
    });
    if (previous) return replay(previous);
    throw error;
  }

  // Publica os alvos + o caster (concentração/CA/deslocamento derivados). A
  // falha de realtime nunca desfaz a aplicação já commitada.
  await publishEffects([
    ...result.effects.map((effect) => effect.targetEntity),
    result.casterEntity,
  ]);
  // UMA linha por instância (nunca uma por modificador).
  for (const effect of result.effects) {
    await appendEffectLog(
      effect.targetEntity,
      actor.username,
      (name) => `${actor.username} aplicou ${BLESS_LABEL} em ${name}.`,
      false,
    );
  }
  return { groupId: result.groupId, effects: result.effects, replayed: false };
}
