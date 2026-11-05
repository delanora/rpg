import { z } from 'zod';
import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { rollDie } from '../../shared/dice.js';
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
import {
  applySaveDamageOutcome,
  type SaveDamageShare,
} from './save-damage-outcome.js';

/**
 * FASE 6.6I.2 + 6.6J.1 — RESOLUÇÃO DE `save-damage`.
 *
 * O save já foi rolado pelo pipeline de dados; aqui o SERVIDOR rola o dano
 * (nunca o cliente) e aplica a ORDEM do PHB 2014:
 *
 *   1. rola o dano BRUTO de cada componente (uma vez por resolução);
 *   2. aplica a consequência do desfecho do save — `none`/`half`/`full`,
 *      POR COMPONENTE e com `floor` na metade (6.6J.1);
 *   3. entrega os componentes já ajustados ao núcleo de dano, que aplica
 *      resistência/imunidade/vulnerabilidade por tipo;
 *   4. usa o dano FINAL para PV, morte e Concentração.
 *
 * O núcleo `resolveDamage` NUNCA conhece salvaguarda — ele recebe valores já
 * ajustados. Sucesso com meia-dano NÃO é "sem efeito": só vira `no-effect`
 * quando o dano final é zero (imunidade/resistência total).
 *
 * Invariantes preservadas:
 *  • o claim `pending → resolved` e o dano acontecem na MESMA transação;
 *  • `eventId` DETERMINÍSTICO (`spell-save:<pendingId>:damage`) — retry e
 *    Concentração usam a mesma identidade, nunca um UUID por tentativa;
 *  • retry devolve o snapshot salvo, sem rolar de novo nem reaplicar PV;
 *  • nenhum EffectInstance é criado: a magia é instantânea;
 *  • o SpellCast só fecha quando NENHUMA pendência dele segue aberta.
 */

const modifierSchema = z
  .enum(['immunity', 'resistance', 'vulnerability', 'resistance-vulnerability'])
  .nullable();

const resolvedComponentSchema = z.object({
  type: z.string().nullable(),
  /** Quantidade de dados rolada no componente (auditoria). */
  count: z.number().int().nonnegative().optional(),
  sides: z.number().int().nonnegative().optional(),
  rolls: z.array(z.number().int()).optional(),
  /** Dano bruto do componente (depois do escalonamento, antes do save). */
  raw: z.number().int().nonnegative(),
  /** Dano DEPOIS do save e ANTES das defesas (6.6J.1). */
  afterSave: z.number().int().nonnegative().optional(),
  applied: z.number().int().nonnegative(),
  modifier: modifierSchema.optional(),
});

const saveDamageSnapshotSchema = z.object({
  kind: z.literal('save-damage'),
  eventId: z.string(),
  ability: z.string(),
  dc: z.number().int(),
  total: z.number().int(),
  success: z.boolean(),
  /** Consequência declarada pela magia (`none`/`half`/`full`). */
  outcome: z
    .object({
      success: z.string(),
      failure: z.string(),
    })
    .optional(),
  damageType: z.string(),
  scalingLevel: z.number().int(),
  /** LEGADO (snapshot de uma única parcela): primeiro componente. */
  dice: z
    .object({
      count: z.number().int().nonnegative(),
      sides: z.number().int().nonnegative(),
      rolls: z.array(z.number().int()),
    })
    .optional(),
  rawDamage: z.number().int().nonnegative(),
  /** Soma depois da consequência do save (antes das defesas). */
  damageAfterSave: z.number().int().nonnegative().optional(),
  finalDamage: z.number().int().nonnegative(),
  components: z.array(resolvedComponentSchema).optional(),
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
  /** `null` em replay sem snapshot legível. */
  snapshot: SaveDamageSnapshot | null;
  publications: string[];
  deathTargets: MechanicalEntity[];
  concentrationChanged: boolean;
  affectedEffects: MechanicalEntity[];
}

/** Fonte de aleatoriedade injetável (testes determinísticos). */
export interface SaveDamageResolveOptions {
  roll?: (sides: number) => number;
}

function eventIdOf(pendingId: string): string {
  return `spell-save:${pendingId}:damage`;
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

function snapshotOf(row: { resolutionSnapshot: unknown }): SaveDamageSnapshot | null {
  return parseJson(saveDamageSnapshotSchema, row.resolutionSnapshot, null as never) ?? null;
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
 * `total` vem do pipeline de dados (server-authoritative); atributo e CD vêm da
 * própria pendência. A rolagem de dano acontece UMA vez, dentro do claim, e o
 * desfecho aplicado vem da DEFINIÇÃO (`outcome.success`/`outcome.failure`).
 */
export async function resolveSaveDamagePending(
  pendingId: string,
  total: number,
  actorName = 'Sistema',
  options: SaveDamageResolveOptions = {},
): Promise<SaveDamageResolution> {
  const roll = options.roll ?? rollDie;
  const initial = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!initial) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (initial.status !== 'pending') return replayedResolution(initial);

  return prisma.$transaction(async (db) => {
    // Serializa a resolução da MESMA pendência entre processos/abas: duas
    // resoluções concorrentes não rolam dano nem aplicam PV duas vezes.
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

    const success = total >= row.dc;
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
    const share: SaveDamageShare = success
      ? resolution.outcome.success
      : resolution.outcome.failure;

    // 1) Dano bruto, UM componente por vez (o tipo nunca é agregado).
    const rolled = resolution.damage.components.map((component) => {
      const dice = scaledDice(component.dice, component.scaling, scaling.level);
      const count = Math.max(0, dice.count);
      const rolls = Array.from({ length: count }, () => roll(dice.sides));
      const rawAmount = Math.max(0, rolls.reduce((sum, value) => sum + value, 0));
      return { type: component.type, count, sides: dice.sides, rolls, rawAmount };
    });
    // 2) Consequência do save, por componente e com floor.
    const adjusted = applySaveDamageOutcome(rolled, share);

    const eventId = eventIdOf(pendingId);
    const publications = new Set<string>();
    const deathTargets: MechanicalEntity[] = [];
    const affectedEffects: MechanicalEntity[] = [];
    let concentrationChanged = false;

    const rawDamage = rolled.reduce((sum, component) => sum + component.rawAmount, 0);
    const damageAfterSave = adjusted.reduce((sum, component) => sum + component.rawAmount, 0);
    let finalDamage = 0;
    let components: NonNullable<SaveDamageSnapshot['components']> = adjusted.map(
      (component, index) => ({
        type: component.type,
        count: component.count,
        sides: component.sides,
        rolls: component.rolls,
        // `rolled` guarda o bruto (antes do save); `adjusted` guarda a metade.
        raw: rolled[index]?.rawAmount ?? component.rawAmount,
        afterSave: component.rawAmount,
        applied: 0,
        modifier: null,
      }),
    );

    // 3) Defesas por tipo + PV, no núcleo compartilhado. Nenhum dano final
    // significa nenhuma escrita de PV (imunidade/resistência total).
    if (damageAfterSave > 0) {
      const damage = await resolveDamage(db, {
        eventId,
        source: {
          kind: 'spell',
          spellCastId: cast.id,
          label: execution.spellId,
        },
        target: await damageTargetOf(db, target.entity),
        components: adjusted.map((component) => ({
          type: component.type,
          rawAmount: component.rawAmount,
        })),
        publications,
      });
      finalDamage = damage.finalDamage;
      components = adjusted.map((component, index) => ({
        type: component.type,
        count: component.count,
        sides: component.sides,
        rolls: component.rolls,
        raw: rolled[index]?.rawAmount ?? component.rawAmount,
        afterSave: component.rawAmount,
        applied: damage.components[index]?.applied ?? 0,
        modifier: damage.components[index]?.modifier ?? null,
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

        // PHB 2014: dano FINAL > 0 → UM teste de Constituição por EVENTO, com
        // CD derivada do dano FINAL (depois do save e das defesas).
        const concentration = await noteDamageConcentration(target.entity, finalDamage, db, {
          eventId,
          sourceName: caster.name,
        });
        concentrationChanged = concentration.changed;
        affectedEffects.push(...concentration.endedEffectTargets);
      }
    }

    const damageType = [...new Set(rolled.map((component) => component.type))].join(' + ');
    const first = rolled[0];
    const snapshot: SaveDamageSnapshot = {
      kind: 'save-damage',
      eventId,
      ability: row.ability,
      dc: row.dc,
      total,
      success,
      outcome: {
        success: resolution.outcome.success,
        failure: resolution.outcome.failure,
      },
      damageType,
      scalingLevel: scaling.level,
      ...(first
        ? {
            dice: {
              count: first.count,
              sides: first.sides,
              rolls: first.rolls,
            },
          }
        : {}),
      rawDamage,
      damageAfterSave,
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

    // Fecha o cast quando NENHUMA pendência dele continua aberta. O desfecho do
    // cast vem do DANO FINAL realmente aplicado (6.6J.1): meia-dano no sucesso
    // ainda é `effect`; imunidade total é `no-effect`.
    const remaining = await db.pendingEffectSave.findMany({
      where: { spellCastId: cast.id },
      select: { status: true, resolutionSnapshot: true },
    });
    if (!remaining.some((other) => other.status === 'pending')) {
      const dealt = remaining.some((other) => (snapshotOf(other)?.finalDamage ?? 0) > 0);
      await db.spellCast.updateMany({
        where: { id: cast.id, status: 'resolving' },
        data: {
          status: 'resolved',
          outcome: dealt ? 'effect' : 'no-effect',
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
