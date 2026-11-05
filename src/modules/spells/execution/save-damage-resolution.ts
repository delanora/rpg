import { z } from 'zod';
import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { rollDice } from '../../shared/dice.js';
import { parseJson } from '../../shared/json.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import { resolveDamage } from '../../combat/damage-resolution.js';
import { damageTargetOf } from '../../combat/damage-target.js';
import {
  applyDamageConsequences,
  publishDeathUpdated,
} from '../../death/death.service.js';
import { noteDamageConcentration } from '../../concentration/concentration.service.js';
import { publishCharacter } from '../../combat/combat.service.js';
import { publishEffects } from '../../effects/effects.service.js';
import {
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from '../../effects/pending-effect-saves.js';
import { scaledDice } from '../../shared/spells/cantrip-scaling.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import { cantripScalingLevelOf } from './cantrip-scaling.service.js';

/**
 * FASE 6.6I.2 — RESOLUÇÃO DE `save-damage` (prova: Chama Sagrada).
 *
 * O save já foi rolado pelo pipeline de dados; aqui o SERVIDOR rola o dano
 * (nunca o cliente), aplica as defesas pelo núcleo compartilhado, compõe morte e
 * Concentração e grava um SNAPSHOT tipado na própria pendência.
 *
 * Invariantes:
 *  • o claim `pending → resolved` e o dano acontecem na MESMA transação;
 *  • o `eventId` é DETERMINÍSTICO (`spell-save:<pendingId>:damage`), então
 *    retry e Concentração usam a mesma identidade — nunca um UUID por tentativa;
 *  • retry (pendência já resolvida) devolve o snapshot salvo, sem rolar de novo;
 *  • nenhum EffectInstance é criado: a magia é instantânea;
 *  • o SpellCast só fecha quando não resta pendência pendente.
 */

const resolvedComponentSchema = z.object({
  type: z.string().nullable(),
  raw: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  modifier: z
    .enum(['immunity', 'resistance', 'vulnerability', 'resistance-vulnerability'])
    .nullable(),
});

const saveDamageSnapshotSchema = z.object({
  kind: z.literal('save-damage'),
  eventId: z.string(),
  ability: z.string(),
  dc: z.number().int(),
  total: z.number().int(),
  success: z.boolean(),
  damageType: z.string(),
  scalingLevel: z.number().int(),
  dice: z.object({
    count: z.number().int().nonnegative(),
    sides: z.number().int().nonnegative(),
    rolls: z.array(z.number().int()),
  }),
  rawDamage: z.number().int().nonnegative(),
  finalDamage: z.number().int().nonnegative(),
  components: z.array(resolvedComponentSchema),
  target: z.object({ kind: z.string(), id: z.string() }),
  casterName: z.string(),
  at: z.string(),
});

export type SaveDamageSnapshot = z.infer<typeof saveDamageSnapshotSchema>;

export interface SaveDamageResolution {
  pending: PendingEffectSaveDto;
  success: boolean;
  replayed: boolean;
  label: string;
  dc: number;
  target: MechanicalEntity;
  castId: string | null;
  /** `null` em sucesso (nenhum dano foi rolado). */
  snapshot: SaveDamageSnapshot | null;
  publications: string[];
  deathTargets: MechanicalEntity[];
  concentrationChanged: boolean;
  affectedEffects: MechanicalEntity[];
}

function eventIdOf(pendingId: string): string {
  return `spell-save:${pendingId}:damage`;
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

function snapshotOf(row: PendingEffectSave): SaveDamageSnapshot | null {
  const parsed = parseJson(saveDamageSnapshotSchema, row.resolutionSnapshot, null as never);
  return parsed ?? null;
}

function replayedResolution(row: PendingEffectSave): SaveDamageResolution {
  const snapshot = snapshotOf(row);
  return {
    pending: toPendingEffectSaveDto(row),
    success: row.result === 'success',
    replayed: true,
    label: '',
    dc: row.dc,
    target: entityOf(row.targetEntityKind, row.targetEntityId),
    castId: row.spellCastId ?? null,
    snapshot,
    publications: [],
    deathTargets: [],
    concentrationChanged: false,
    affectedEffects: [],
  };
}

/**
 * Resolve a pendência com o TOTAL do save já rolado.
 *
 * `total` vem do pipeline de dados (server-authoritative); a CD e o atributo
 * vêm da própria pendência. A rolagem de dano acontece UMA vez, dentro do claim.
 */
export async function resolveSaveDamagePending(
  pendingId: string,
  total: number,
  actorName = 'Sistema',
): Promise<SaveDamageResolution> {
  const initial = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!initial) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (initial.status !== 'pending') return replayedResolution(initial);

  const success = total >= initial.dc;

  return prisma.$transaction(async (db) => {
    // Serializa a resolução da MESMA pendência entre processos/abas.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pendingId}))`;

    const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
    if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
    if (row.status !== 'pending') return replayedResolution(row);

    const cast = row.spellCastId
      ? await db.spellCast.findUnique({ where: { id: row.spellCastId } })
      : null;
    const execution = cast ? spellExecutionDefinition(cast.spellId) : null;
    const resolution = execution?.resolution;
    if (!cast || !execution || resolution?.kind !== 'save-damage') {
      throw new HttpError(
        'Esta salvaguarda não pertence a uma magia de dano executável.',
        409,
        'SPELL_EXECUTION_NOT_IMPLEMENTED',
      );
    }

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

    const caster = await loadEntity(
      entityOf(row.casterEntityKind, row.casterEntityId),
      db,
    );
    const target = await loadEntity(
      entityOf(row.targetEntityKind, row.targetEntityId),
      db,
    );
    const scaling = await cantripScalingLevelOf(caster, db);
    const dice = scaledDice(resolution.damage.dice, resolution.damage.scaling, scaling.level);
    if (dice.count < 1) {
      throw new HttpError(
        'O escalonamento deste truque não produz dados de dano.',
        409,
        'SPELL_EXECUTION_NOT_IMPLEMENTED',
      );
    }

    const eventId = eventIdOf(pendingId);
    const publications = new Set<string>();
    const deathTargets: MechanicalEntity[] = [];
    const affectedEffects: MechanicalEntity[] = [];
    let concentrationChanged = false;
    let rolls: number[] = [];
    let rawDamage = 0;
    let finalDamage = 0;
    let components: SaveDamageSnapshot['components'] = [];

    if (!success) {
      const rolled = rollDice(`${dice.count}d${dice.sides}`);
      if (!rolled) {
        throw new HttpError('Não foi possível rolar o dano desta magia.', 500);
      }
      rolls = rolled.rolls;
      rawDamage = rolled.total;
      const damage = await resolveDamage(db, {
        eventId,
        source: {
          kind: 'spell',
          spellCastId: cast.id,
          label: execution.spellId,
        },
        target: await damageTargetOf(db, target.entity),
        components: [{ type: resolution.damage.type, rawAmount: rolled.total }],
        publications,
      });
      finalDamage = damage.finalDamage;
      components = damage.components.map((component) => ({
        type: component.type,
        raw: component.rawAmount,
        applied: component.applied,
        modifier: component.modifier,
      }));

      if (finalDamage > 0 && damage.hpAfter !== null) {
        // O ciclo de morte de CRIATURA pertence à INSTÂNCIA de combate (o
        // bestiário não é alvo de morte). Criatura SOLTA recebe o dano no
        // registro, mas não abre Testes contra a Morte — a regra existente
        // continua sendo a única fonte de verdade e não é duplicada aqui.
        if (target.entity.kind !== 'creature') {
          const consequence = await applyDamageConsequences(
            target.entity,
            {
              damage: finalDamage,
              hpBefore: damage.hpBefore ?? 0,
              hpTempBefore: damage.hpTempBefore,
              critical: false,
              sourceName: caster.name,
            },
            db,
            caster.name,
          );
          if (consequence.changed) deathTargets.push(target.entity);
        }

        // PHB 2014: dano final > 0 → UM teste de Constituição por EVENTO. A
        // identidade é o MESMO `eventId` do dano, então retry não duplica.
        const concentration = await noteDamageConcentration(target.entity, finalDamage, db, {
          eventId,
          sourceName: caster.name,
        });
        concentrationChanged = concentration.changed;
        affectedEffects.push(...concentration.endedEffectTargets);
      }
    }

    const snapshot: SaveDamageSnapshot = {
      kind: 'save-damage',
      eventId,
      ability: row.ability,
      dc: row.dc,
      total,
      success,
      damageType: resolution.damage.type,
      scalingLevel: scaling.level,
      dice: { count: dice.count, sides: dice.sides, rolls },
      rawDamage,
      finalDamage,
      components,
      target: { kind: target.entity.kind, id: target.entity.id },
      casterName: caster.name,
      at: new Date().toISOString(),
    };

    const fresh = await db.pendingEffectSave.update({
      where: { id: pendingId },
      data: { resolutionSnapshot: snapshot as unknown as Prisma.InputJsonValue },
    });

    // Fecha o cast quando NENHUMA pendência dele continua aberta. Save-damage
    // aplica por alvo (não tem barreira de efeito): o dano já está persistido.
    const remaining = await db.pendingEffectSave.count({
      where: { spellCastId: cast.id, status: 'pending' },
    });
    if (remaining === 0) {
      const failures = await db.pendingEffectSave.count({
        where: { spellCastId: cast.id, result: 'failure' },
      });
      await db.spellCast.updateMany({
        where: { id: cast.id, status: 'resolving' },
        data: {
          status: 'resolved',
          outcome: failures > 0 ? 'effect' : 'no-effect',
          resolvedAt: new Date(),
        },
      });
    }

    return {
      pending: toPendingEffectSaveDto(fresh),
      success,
      replayed: false,
      label: toPendingEffectSaveDto(fresh).label,
      dc: row.dc,
      target: target.entity,
      castId: cast.id,
      snapshot,
      publications: [...publications],
      deathTargets,
      concentrationChanged,
      affectedEffects,
    } satisfies SaveDamageResolution;
  });
}

/**
 * Publica depois do commit: ficha, morte, Concentração, Effects e o card
 * (a pendência deixou de existir). Nenhuma publicação acontece na transação.
 */
export async function publishSaveDamageResult(
  result: SaveDamageResolution,
): Promise<void> {
  if (result.replayed) {
    await publishPendingEffectSaves([result.target]);
    return;
  }
  for (const id of result.publications) await publishCharacter(id);
  for (const entity of result.deathTargets) await publishDeathUpdated(entity);
  if (result.concentrationChanged && result.target.kind === 'character') {
    await publishCharacter(result.target.id);
  }
  if (result.affectedEffects.length > 0) {
    await publishEffects([result.target, ...result.affectedEffects]);
  }
  await publishPendingEffectSaves([result.target]);
  void result.castId;
}
