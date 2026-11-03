import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { isHumanoidEntity } from '../shared/creature-types.js';
import { loadEntity } from '../mechanical/mechanical.service.js';
import { applyEffectConditions, saveMechanicalState } from './effect-conditions.js';
import { appendEffectLog, endEffectsForConcentration, publishEffects, type EffectActor } from './effects.service.js';
import { toEffectDto, type EffectDto } from './effects.dto.js';
import {
  HOLD_PERSON_CONDITIONS,
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_LABEL,
  HOLD_PERSON_SAVE_ABILITY,
  HOLD_PERSON_SPELL_ID,
} from './definitions/hold-person.js';
import {
  definitionLabel,
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
  type PendingEffectSaveResult,
} from './pending-effect-saves.js';
import type { PendingEffectSave } from '@prisma/client';
import type { ApplyHoldPersonInput } from './effects.schema.js';

/**
 * FASE 6.5H — HOLD PERSON (Imobilizar Pessoa), SEGUNDO efeito real.
 *
 * Prova de arquitetura Effect → Condition:
 *
 *   aplicação MASTER-only → PendingEffectSave persistente
 *   → Salvaguarda de SABEDORIA pelo pipeline real (servidor rola e calcula)
 *   → sucesso: nada é criado
 *   → falha: UM grupo + UMA EffectInstance (conditions: ['paralyzed'])
 *            + Concentração do caster ligada ao grupo
 *   → Paralyzed entra no motor de Conditions existente
 *   → fim da Concentração encerra o grupo e remove o Paralyzed daquela fonte.
 *
 * O que esta fase NÃO faz (intencional): Ação, slot, componentes, alcance,
 * preparação, duração de 1 minuto, save repetido no fim do turno, upcasting,
 * múltiplos alvos e conjuração por PLAYER.
 */

export interface HoldPersonResult {
  pending: PendingEffectSaveDto;
  replayed: boolean;
}

export interface HoldPersonResolution {
  pending: PendingEffectSaveDto;
  success: boolean;
  replayed: boolean;
  target: MechanicalEntity | null;
  caster: MechanicalEntity | null;
  effect: EffectDto | null;
  /** Alvos cujas visões derivadas mudaram (publicar depois do commit). */
  affectedTargets: MechanicalEntity[];
  label: string;
  dc: number;
}

function fingerprintOf(actor: EffectActor, input: ApplyHoldPersonInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        type: 'hold-person-apply',
        actor: actor.userId,
        caster: input.caster,
        target: input.target,
        dc: input.dc,
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

/**
 * APLICAÇÃO CONTROLADA (Mestre) — cria a PENDÊNCIA de salvaguarda.
 *
 * Todo o detalhe mecânico vem do SERVIDOR: `definitionId`, atributo Sabedoria e
 * a Condition Paralyzed. O cliente não escolhe atributo, resultado nem
 * Condition. A CD é informada pelo Mestre nesta prova (fallback explícito —
 * ver `HOLD_PERSON_EFFECT_DEFINITION.dcSource`).
 *
 * Validar TUDO antes de gravar: alvo inexistente ou não humanoide não gera
 * pendência "meio criada".
 */
export async function applyHoldPerson(
  actor: EffectActor,
  input: ApplyHoldPersonInput,
): Promise<HoldPersonResult> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre aplica o Hold Person de prova.', 403);
  }

  const fingerprint = fingerprintOf(actor, input);
  const replay = (operation: { fingerprint: string; snapshot: unknown }): HoldPersonResult => {
    if (operation.fingerprint !== fingerprint) replayError();
    return { ...(operation.snapshot as HoldPersonResult), replayed: true };
  };

  const existing = await prisma.pendingEffectSave.findUnique({
    where: { operationId: input.operationId },
  });
  if (existing) return { pending: toPendingEffectSaveDto(existing), replayed: true };

  let pending: PendingEffectSave;
  try {
    pending = await prisma.$transaction(async (db) => {
      const prior = await db.pendingEffectSave.findUnique({
        where: { operationId: input.operationId },
      });
      if (prior) return prior;

      // `loadEntity` canonicaliza: combatente de PERSONAGEM vira a FICHA e
      // criatura/NPC em combate usa a INSTÂNCIA (dois Goblins não compartilham).
      const caster = await loadEntity(input.caster, db);
      const target = await loadEntity(input.target, db);

      // Regra de alvo ANTES de pedir save: criatura não humanoide é rejeitada.
      if (!(await isHumanoidEntity(target.entity, db))) {
        throw new HttpError(
          'Imobilizar Pessoa só afeta humanoides.',
          409,
          'HOLD_PERSON_TARGET_NOT_HUMANOID',
        );
      }

      return db.pendingEffectSave.create({
        data: {
          definitionId: HOLD_PERSON_DEFINITION_ID,
          casterEntityKind: caster.entity.kind,
          casterEntityId: caster.entity.id,
          casterLabel: caster.name,
          targetEntityKind: target.entity.kind,
          targetEntityId: target.entity.id,
          // Fixados no SERVIDOR — o cliente nunca os envia.
          ability: HOLD_PERSON_SAVE_ABILITY,
          dc: input.dc,
          visibility: 'public',
          status: 'pending',
          operationId: input.operationId,
          fingerprint,
          createdBy: actor.userId,
        },
      });
    });
  } catch (error) {
    // Corrida de dois retries simultâneos: o perdedor devolve a MESMA pendência.
    const previous = await prisma.pendingEffectSave.findUnique({
      where: { operationId: input.operationId },
    });
    if (previous) return { pending: toPendingEffectSaveDto(previous), replayed: true };
    throw error;
  }

  // Publica a solicitação: Mestres e o dono do alvo (filtro no servidor).
  // `publishEffects` também reemite as visões derivadas (ficha/combate) para o
  // DTO do estado mecânico levar a pendência sem refresh manual. Nenhum estado
  // mecânico mudou ainda: Paralyzed só nasce na FALHA.
  const targetEntity: MechanicalEntity = {
    kind: pending.targetEntityKind as MechanicalEntity['kind'],
    id: pending.targetEntityId,
  };
  await publishPendingEffectSaves([targetEntity]);
  await publishEffects([targetEntity]);
  return { pending: toPendingEffectSaveDto(pending), replayed: false };
}

/** GET de pendências de um alvo, com privacidade aplicada no SERVIDOR. */
export async function listPendingEffectSaves(
  actor: EffectActor,
  target: MechanicalEntity,
): Promise<PendingEffectSaveDto[]> {
  const loaded = await loadEntity(target);
  if (actor.role !== 'MASTER') {
    if (loaded.entity.kind !== 'character' || loaded.ownerUserId !== actor.userId) {
      throw new HttpError('Você só pode consultar as pendências do seu personagem.', 403);
    }
  }
  const rows = await prisma.pendingEffectSave.findMany({
    where: {
      targetEntityKind: loaded.entity.kind,
      targetEntityId: loaded.entity.id,
      status: 'pending',
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows
    .filter((row) => actor.role === 'MASTER' || row.visibility === 'public')
    .map(toPendingEffectSaveDto);
}

/** Cancela uma pendência antes do save (ferramenta administrativa). */
export async function cancelPendingEffectSave(
  actor: EffectActor,
  pendingId: string,
): Promise<PendingEffectSaveDto> {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o Mestre cancela a aplicação pendente.', 403);
  }
  const row = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);

  // Guarda de status: cancelar duas vezes é o mesmo estado (primeira data vale).
  await prisma.pendingEffectSave.updateMany({
    where: { id: pendingId, status: 'pending' },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  const fresh = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
  await publishPendingEffectSaves([
    { kind: fresh.targetEntityKind as MechanicalEntity['kind'], id: fresh.targetEntityId },
  ]);
  return toPendingEffectSaveDto(fresh);
}

export interface PendingEffectSaveForRoll {
  pending: PendingEffectSaveDto;
  /** Alvo CANÔNICO (personagem em combate → ficha). */
  targetEntity: MechanicalEntity;
}

/**
 * Carrega a pendência para a ROLAGEM do save.
 *
 * A autoridade de alvo/atributo/CD é a linha persistida; o cliente só informa
 * o id da pendência. Jogador só resolve a pendência do próprio personagem;
 * a de NPC/criatura é rolada pelo Mestre.
 */
export async function loadPendingEffectSaveForRoll(
  actor: EffectActor,
  pendingId: string,
): Promise<PendingEffectSaveForRoll> {
  const row = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (row.status !== 'pending') {
    throw new HttpError('Esta salvaguarda não está mais pendente.', 409, 'CONFLICT');
  }
  const target = await loadEntity({
    kind: row.targetEntityKind as MechanicalEntity['kind'],
    id: row.targetEntityId,
  });
  if (actor.role !== 'MASTER') {
    if (target.entity.kind !== 'character' || target.ownerUserId !== actor.userId) {
      throw new HttpError('Você só pode rolar a salvaguarda do seu personagem.', 403);
    }
  }
  return { pending: toPendingEffectSaveDto(row), targetEntity: target.entity };
}

function replayedResolution(row: PendingEffectSave): HoldPersonResolution {
  return {
    pending: toPendingEffectSaveDto(row),
    success: row.result === 'success',
    replayed: true,
    target: { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId },
    caster: { kind: row.casterEntityKind as MechanicalEntity['kind'], id: row.casterEntityId },
    effect: null,
    affectedTargets: [],
    label: definitionLabel(row.definitionId),
    dc: row.dc,
  };
}

/**
 * RESOLVE a pendência com o TOTAL já rolado pelo pipeline de salvaguarda.
 *
 * O total vem do SERVIDOR (nunca do cliente). A transição
 * `pending → resolved` é guardada por status: dois requests concorrentes
 * produzem UMA consequência, e a segunda chamada devolve o snapshot sem
 * recriar Effect/Condition/Concentração.
 *
 * Na FALHA, Effect + Concentração + Condition nascem na MESMA transação.
 * Auto-incapacitação (caster == alvo Paralyzed) termina o grupo recém-criado
 * pelo lifecycle existente — sem recursão infinita e sem Paralyzed órfão.
 */
export async function resolvePendingEffectSave(
  pendingId: string,
  total: number,
  actorName = 'Sistema',
): Promise<HoldPersonResolution> {
  const initial = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!initial) throw new HttpError('Aplicação pendente não encontrada.', 404);
  // Retry de uma resolução já feita: NUNCA duplica efeito.
  if (initial.status !== 'pending') return replayedResolution(initial);

  const success = total >= initial.dc;

  try {
    return await prisma.$transaction(async (db) => {
      const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
      if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
      if (row.status !== 'pending') return replayedResolution(row);

      // Carrega as entidades ANTES de consumir a pendência: se alguma foi
      // removida estruturalmente, o catch abaixo cancela em vez de criar órfão.
      const caster = await loadEntity(
        { kind: row.casterEntityKind as MechanicalEntity['kind'], id: row.casterEntityId },
        db,
      );
      const target = await loadEntity(
        { kind: row.targetEntityKind as MechanicalEntity['kind'], id: row.targetEntityId },
        db,
      );

      // Transição ATÔMICA: só UM request ganha a resolução.
      const claimed = await db.pendingEffectSave.updateMany({
        where: { id: pendingId, status: 'pending' },
        data: {
          status: 'resolved',
          result: success ? 'success' : 'failure',
          resolvedAt: new Date(),
        },
      });
      if (!claimed.count) {
        const later = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
        return replayedResolution(later);
      }

      if (success) {
        // SUCESSO: nenhum Effect, nenhuma Condition, nenhuma Concentração nova.
        const fresh = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
        return {
          pending: toPendingEffectSaveDto(fresh),
          success: true,
          replayed: false,
          target: target.entity,
          caster: caster.entity,
          effect: null,
          affectedTargets: [],
          label: definitionLabel(row.definitionId),
          dc: row.dc,
        } satisfies HoldPersonResolution;
      }

      const groupId = randomUUID();
      const effectRow = await db.effectInstance.create({
        data: {
          groupId,
          definitionId: HOLD_PERSON_DEFINITION_ID,
          label: HOLD_PERSON_LABEL,
          sourceType: 'spell',
          sourceId: HOLD_PERSON_SPELL_ID,
          sourceEntityKind: caster.entity.kind,
          sourceEntityId: caster.entity.id,
          sourceLabel: caster.name,
          // Hold Person não tem modificador numérico: sua consequência é a
          // Condition do PHB, resolvida pelo motor existente.
          modifiers: [] as unknown as Prisma.InputJsonValue,
          conditions: HOLD_PERSON_CONDITIONS as unknown as Prisma.InputJsonValue,
          targetEntityKind: target.entity.kind,
          targetEntityId: target.entity.id,
          visibility: 'public',
          status: 'active',
          createdBy: row.createdBy ?? null,
        },
      });

      // CONCENTRAÇÃO pelo MESMO motor: uma por caster. A anterior termina (e o
      // grupo dela é desmontado) dentro desta transação.
      const state = caster.state;
      if (state.concentration) {
        await endEffectsForConcentration(state.concentration, db, {
          entity: caster.entity,
          state,
        });
      }
      state.concentration = {
        id: randomUUID(),
        label: HOLD_PERSON_LABEL,
        sourceType: 'effect',
        sourceId: groupId,
        visibility: 'public',
        startedAt: new Date().toISOString(),
        ...(row.createdBy ? { startedBy: row.createdBy } : {}),
      };
      state.pendingConcentrationSaves = [];
      await saveMechanicalState(caster, state, db);

      // Effect → Condition (6.5C): Paralyzed real, com sourceType 'effect' e
      // sourceId = effect.id. A Queda/Incapacitação derivadas continuam sendo
      // responsabilidade do motor de Conditions.
      const applied = await applyEffectConditions(effectRow, target.entity, db);
      const affectedTargets: MechanicalEntity[] = [];
      if (applied.endedConcentration) {
        // Auto-incapacitação (caster == alvo) ou alvo que já concentrava:
        // desmonta o grupo, removendo o Paralyzed daquela fonte.
        affectedTargets.push(
          ...(await endEffectsForConcentration(applied.endedConcentration, db)),
        );
      }

      await db.pendingEffectSave.update({
        where: { id: pendingId },
        data: { groupId, effectId: effectRow.id },
      });
      const freshPending = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
      const freshEffect = await db.effectInstance.findUniqueOrThrow({ where: { id: effectRow.id } });

      return {
        pending: toPendingEffectSaveDto(freshPending),
        success: false,
        replayed: false,
        target: target.entity,
        caster: caster.entity,
        effect: toEffectDto(freshEffect),
        affectedTargets: [
          target.entity,
          ...(caster.entity.kind === target.entity.kind && caster.entity.id === target.entity.id
            ? []
            : [caster.entity]),
          ...affectedTargets,
        ],
        label: definitionLabel(row.definitionId),
        dc: row.dc,
      } satisfies HoldPersonResolution;
    });
  } catch (error) {
    // Entidade removida no meio do caminho: a pendência é CANCELADA e nunca
    // vira efeito apontando para algo inexistente.
    if (error instanceof HttpError && error.status === 404) {
      await prisma.pendingEffectSave.updateMany({
        where: { id: pendingId, status: 'pending' },
        data: { status: 'cancelled', resolvedAt: new Date() },
      });
      throw new HttpError(
        'A entidade desta aplicação não existe mais; a salvaguarda foi cancelada.',
        409,
        'CONFLICT',
      );
    }
    throw error;
  }
}

/**
 * Publica o resultado: pendência removida, consequências (se houver) e as
 * visões derivadas. UMA linha de registro por aplicação.
 */
export async function publishHoldPersonResult(
  resolution: HoldPersonResolution,
  actorName: string,
): Promise<void> {
  if (resolution.replayed) return;
  const targets = resolution.affectedTargets.filter(
    (item, index, list) => list.findIndex((other) => other.kind === item.kind && other.id === item.id) === index,
  );
  if (targets.length > 0) {
    await publishEffects(targets);
    for (const target of targets) {
      await appendEffectLog(
        target,
        actorName,
        (name) =>
          resolution.success
            ? `${name} resistiu a ${resolution.label} (salvaguarda de Sabedoria).`
            : `${name} falhou na salvaguarda e ficou Paralisado — ${resolution.label}.`,
        false,
      );
    }
  }
  if (resolution.target) {
    await publishPendingEffectSaves([resolution.target]);
    // Mesmo sem mudança mecânica (SUCESSO), a ficha/combate são republicados
    // para a solicitação sumir sem refresh manual.
    await publishEffects([resolution.target]);
  }
}

/** Resultado tipado do save (a rolagem em si é do pipeline de dados). */
export type { PendingEffectSaveResult };
