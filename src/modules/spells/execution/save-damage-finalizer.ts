import type { Prisma } from '@prisma/client';
import { HttpError } from '../../../lib/http-error.js';
import { rollDie } from '../../shared/dice.js';
import { scaledDice } from '../../shared/spells/cantrip-scaling.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import { resolveDamage } from '../../combat/damage-resolution.js';
import { damageTargetOf } from '../../combat/damage-target.js';
import { applyDamageConsequences } from '../../death/death.service.js';
import { noteDamageConcentration } from '../../concentration/concentration.service.js';
import { applySaveDamageOutcome, type SaveDamageShare } from './save-damage-outcome.js';
import { cantripScalingLevelOf } from './cantrip-scaling.service.js';
import { buildSaveDamageTargetSnapshot, saveResultOf } from './save-result-snapshot.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import {
  parseSpellResolutionSnapshot,
  type SaveDamageCastSnapshot,
  type SaveDamageTargetResult,
} from './spell-resolution-snapshot.js';

/**
 * FASE 6.6J.2 — FINALIZAÇÃO `save-damage` MULTI-ALVO.
 *
 * PHB 2014: quando uma magia causa dano a VÁRIOS alvos AO MESMO TEMPO, o dano é
 * rolado UMA ÚNICA VEZ para todos. O modelo separa duas identidades:
 *
 *  • DAMAGE ROLL — compartilhado pelo cast (`spell-cast:<castId>:damage-roll:0`);
 *  • DAMAGE EVENT — individual por alvo (`spell-cast:<castId>:target:<kind>:<id>:damage`),
 *    usado por HP, morte e Concentração.
 *
 * A BARREIRA é a mesma ideia do Hold Person (`save-effect`): enquanto existir
 * QUALQUER pendência inicial obrigatória `pending`, nada de dano acontece. Só o
 * último save dispara esta finalização, que roda sob o lock transacional do
 * cast — concorrência entre os dois últimos saves produz UM roll e UMA
 * finalização.
 *
 * Esse módulo NÃO conhece nome de magia: lê `outcome`/`damage.components` da
 * definição e usa o núcleo de dano por alvo. `resolveDamage` continua sem saber
 * o que é salvaguarda.
 */

/** Identidade do roll compartilhado (índice prepara múltiplos rolls futuros). */
export function sharedDamageRollIdOf(castId: string, index = 0): string {
  return `spell-cast:${castId}:damage-roll:${index}`;
}

/** Identidade do EVENTO de dano de UM alvo (nunca compartilhada). */
export function targetDamageEventIdOf(castId: string, target: MechanicalEntity): string {
  return `spell-cast:${castId}:target:${target.kind}:${target.id}:damage`;
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

function keyOf(entity: MechanicalEntity): string {
  return `${entity.kind}:${entity.id}`;
}

export interface SaveDamageFinalization {
  /** `false` enquanto algum save inicial obrigatório continua pendente. */
  completed: boolean;
  /** `true` quando o cast já estava finalizado (retry/replay). */
  replayed: boolean;
  castId: string;
  snapshot: SaveDamageCastSnapshot | null;
  targets: SaveDamageTargetResult[];
  publications: string[];
  deathTargets: MechanicalEntity[];
  concentrationChanged: boolean;
  affectedEffects: MechanicalEntity[];
}

function emptyResult(castId: string, completed: boolean): SaveDamageFinalization {
  return {
    completed,
    replayed: false,
    castId,
    snapshot: null,
    targets: [],
    publications: [],
    deathTargets: [],
    concentrationChanged: false,
    affectedEffects: [],
  };
}

function resultsFromSnapshot(snapshot: SaveDamageCastSnapshot | null) {
  return snapshot?.targets ?? [];
}

/**
 * Finaliza a conjuração `save-damage` quando a barreira está satisfeita.
 *
 * DEVE ser chamada dentro de uma transação que já segurou a pendência (quando
 * veio de um save) — a ordem de locks é pendência → cast, consistente com o
 * Hold Person, que só segura o cast.
 */
export async function finalizeSaveDamageCast(
  castId: string,
  db: Prisma.TransactionClient,
  options: { roll?: (sides: number) => number } = {},
): Promise<SaveDamageFinalization> {
  const roll = options.roll ?? rollDie;
  // Lock TRANSACIONAL do cast: última barreira contra duas finalizações.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${castId}))`;

  const cast = await db.spellCast.findUnique({ where: { id: castId } });
  if (!cast) return emptyResult(castId, true);

  const stored = parseSpellResolutionSnapshot(cast.resolutionSnapshot);
  const storedSnapshot = stored?.kind === 'save-damage' ? stored : null;
  if (cast.status !== 'resolving') {
    return {
      ...emptyResult(castId, true),
      replayed: true,
      snapshot: storedSnapshot,
      targets: resultsFromSnapshot(storedSnapshot),
    };
  }

  const pendings = await db.pendingEffectSave.findMany({
    where: { spellCastId: castId, phase: 'initial' },
    orderBy: { createdAt: 'asc' },
  });
  // BARREIRA: nenhum dano antes de TODOS os saves iniciais serem terminais.
  if (pendings.some((row) => row.status === 'pending')) {
    return emptyResult(castId, false);
  }

  const execution = spellExecutionDefinition(cast.spellId);
  const resolution = execution?.resolution;
  if (!execution || resolution?.kind !== 'save-damage') {
    throw new HttpError(
      'A conjuração finalizada não possui uma definição de dano compatível.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }

  // Ordem CANÔNICA do alvo: a do targeting snapshot, nunca a ordem de cliques.
  const targetRefs: MechanicalEntity[] = Array.isArray(cast.targets)
    ? (cast.targets as unknown as { kind: string; id: string }[]).map((item) =>
        entityOf(item.kind, item.id),
      )
    : [];
  // Um alvo repetido no payload canônico é a MESMA entidade: nunca dois eventos
  // de dano para a mesma criatura (defesa em profundidade da dedupe do VALIDATE).
  const seenTargetKeys = new Set<string>();
  const canonicalRefs = targetRefs.filter((target) => {
    const key = keyOf(target);
    if (seenTargetKeys.has(key)) return false;
    seenTargetKeys.add(key);
    return true;
  });
  const pendingByKey = new Map<string, (typeof pendings)[number]>();
  for (const row of pendings) {
    const key = `${row.targetEntityKind}:${row.targetEntityId}`;
    if (!pendingByKey.has(key)) pendingByKey.set(key, row);
  }

  const caster = await loadEntity(
    entityOf(cast.casterEntityKind, cast.casterEntityId),
    db,
  ).catch(() => null);

  // Alvos válidos + resultado do save de cada um (a pendência é a autoridade).
  const planned = canonicalRefs.map((target) => {
    const pending = pendingByKey.get(keyOf(target)) ?? null;
    const success = pending?.result === 'success';
    const valid = pending !== null && pending.status === 'resolved' && pending.result !== null;
    return {
      target,
      pending,
      saved: pending ? saveResultOf(pending) : null,
      valid,
      success,
      share: (pending?.result === 'success'
        ? resolution.outcome.success
        : resolution.outcome.failure) as SaveDamageShare,
    };
  });
  // Deduplica a ORDEM canônica sem duplicar o mesmo alvo (mesma criatura duas
  // vezes no payload nunca vira dois eventos de dano).
  const seen = new Set<string>();
  const validTargets = planned.filter((item) => {
    if (!item.valid) return false;
    const key = keyOf(item.target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const needsDamage = validTargets.some((item) => item.share !== 'none');
  const scalingLevel = caster ? (await cantripScalingLevelOf(caster, db)).level : 1;

  // ROLL COMPARTILHADO: cada componente é rolado UMA vez para TODOS os alvos.
  const damageRoll = needsDamage
    ? (() => {
        const components = resolution.damage.components.map((component) => {
          const dice = scaledDice(component.dice, component.scaling, scalingLevel);
          const count = Math.max(0, dice.count);
          const rolls = Array.from({ length: count }, () => roll(dice.sides));
          const raw = Math.max(0, rolls.reduce((sum, value) => sum + value, 0));
          return { type: component.type, count, sides: dice.sides, rolls, raw };
        });
        return {
          id: sharedDamageRollIdOf(castId),
          index: 0,
          components,
          rawDamage: components.reduce((sum, component) => sum + component.raw, 0),
        };
      })()
    : null;

  const publications = new Set<string>();
  const deathTargets: MechanicalEntity[] = [];
  const affectedEffects: MechanicalEntity[] = [];
  let concentrationChanged = false;
  const results: SaveDamageTargetResult[] = [];

  for (const item of planned) {
    const eventId = targetDamageEventIdOf(castId, item.target);
    if (!item.valid || !damageRoll) {
      results.push({
        target: { kind: item.target.kind, id: item.target.id },
        pendingSaveId: item.pending?.id ?? null,
        save: item.pending
          ? {
              success: item.success,
              total: item.saved?.total ?? 0,
              dc: item.pending.dc,
            }
          : null,
        status: item.valid ? 'no-damage' : 'unavailable',
        components: [],
        rawDamage: 0,
        damageAfterSave: 0,
        finalDamage: 0,
        eventId,
        hpBefore: null,
        hpAfter: null,
        concentration: false,
      });
      continue;
    }

    const adjusted = applySaveDamageOutcome(
      damageRoll.components.map((component) => ({
        type: component.type,
        rawAmount: component.raw,
      })),
      item.share,
    );
    const rawDamage = damageRoll.components.reduce((sum, component) => sum + component.raw, 0);
    const damageAfterSave = adjusted.reduce((sum, component) => sum + component.rawAmount, 0);

    if (damageAfterSave === 0) {
      results.push({
        target: { kind: item.target.kind, id: item.target.id },
        pendingSaveId: item.pending?.id ?? null,
        save: {
          success: item.success,
          total: item.saved?.total ?? 0,
          dc: item.pending?.dc ?? 0,
        },
        status: 'no-damage',
        components: adjusted.map((component) => ({
          type: component.type,
          raw: damageRoll.components.find((row) => row.type === component.type)?.raw ?? 0,
          afterSave: component.rawAmount,
          applied: 0,
          modifier: null,
        })),
        rawDamage,
        damageAfterSave,
        finalDamage: 0,
        eventId,
        hpBefore: null,
        hpAfter: null,
        concentration: false,
      });
      continue;
    }

    // Alvo removido ESTRUTURALMENTE entre o COMMIT e a finalização: registra
    // `unavailable`, sem dano e sem travar os demais (custos não voltam).
    let loaded: Awaited<ReturnType<typeof loadEntity>>;
    try {
      loaded = await loadEntity(item.target, db);
    } catch {
      results.push({
        target: { kind: item.target.kind, id: item.target.id },
        pendingSaveId: item.pending?.id ?? null,
        save: {
          success: item.success,
          total: item.saved?.total ?? 0,
          dc: item.pending?.dc ?? 0,
        },
        status: 'unavailable',
        components: [],
        rawDamage,
        damageAfterSave,
        finalDamage: 0,
        eventId,
        hpBefore: null,
        hpAfter: null,
        concentration: false,
      });
      continue;
    }

    const damage = await resolveDamage(db, {
      eventId,
      source: { kind: 'spell', spellCastId: cast.id, label: execution.spellId },
      target: await damageTargetOf(db, loaded.entity),
      components: adjusted.map((component) => ({
        type: component.type,
        rawAmount: component.rawAmount,
      })),
      publications,
    });

    let concentration = false;
    if (damage.finalDamage > 0 && damage.hpAfter !== null) {
      // Ciclo de morte: só personagem (criatura solta não abre Death Saves).
      if (loaded.entity.kind !== 'creature') {
        const consequence = await applyDamageConsequences(
          loaded.entity,
          {
            damage: damage.finalDamage,
            hpBefore: damage.hpBefore ?? 0,
            hpTempBefore: damage.hpTempBefore,
            critical: false,
            sourceName: caster?.name ?? 'Magia',
          },
          db,
          caster?.name ?? 'Magia',
        );
        if (consequence.changed) deathTargets.push(loaded.entity);
      }
      const noted = await noteDamageConcentration(loaded.entity, damage.finalDamage, db, {
        eventId,
        sourceName: caster?.name ?? 'Magia',
      });
      concentration = noted.changed;
      concentrationChanged = concentrationChanged || noted.changed;
      affectedEffects.push(...noted.endedEffectTargets);
    }

    results.push({
      target: { kind: loaded.entity.kind, id: loaded.entity.id },
      pendingSaveId: item.pending?.id ?? null,
      save: {
        success: item.success,
        total: item.saved?.total ?? 0,
        dc: item.pending?.dc ?? 0,
      },
      status: 'applied',
      components: adjusted.map((component, index) => ({
        type: component.type,
        raw: damageRoll.components[index]?.raw ?? component.rawAmount,
        afterSave: component.rawAmount,
        applied: damage.components[index]?.applied ?? 0,
        modifier: damage.components[index]?.modifier ?? null,
      })),
      rawDamage,
      damageAfterSave,
      finalDamage: damage.finalDamage,
      eventId,
      hpBefore: damage.hpBefore,
      hpAfter: damage.hpAfter,
      concentration,
    });
  }

  const dealt = results.some((result) => result.finalDamage > 0);
  const damageType = [...new Set((damageRoll?.components ?? []).map((item) => item.type))].join(' + ');
  const snapshot: SaveDamageCastSnapshot = {
    kind: 'save-damage',
    castId,
    eventId: damageRoll?.id ?? sharedDamageRollIdOf(castId),
    outcome: { success: resolution.outcome.success, failure: resolution.outcome.failure },
    damageType,
    damageRoll: damageRoll
      ? {
          id: damageRoll.id,
          index: damageRoll.index,
          components: damageRoll.components,
          rawDamage: damageRoll.rawDamage,
        }
      : null,
    targets: results,
    // Motivo auditável só quando NADA foi aplicado (imunidade, sucesso `none`,
    // alvos removidos). Custos do COMMIT nunca são devolvidos.
    noEffectReason: dealt
      ? null
      : results.every((result) => result.status === 'unavailable')
        ? 'no-valid-target'
        : 'no-damage',
    at: new Date().toISOString(),
  };

  // Snapshot POR PENDÊNCIA: visão derivada do alvo, REFERENCIANDO o roll
  // compartilhado por id/índice. Os dados rolados existem uma única vez (no
  // snapshot do cast), nunca uma cópia por alvo.
  for (const result of results) {
    if (!result.pendingSaveId || !result.save) continue;
    await db.pendingEffectSave.update({
      where: { id: result.pendingSaveId },
      data: {
        resolutionSnapshot: buildSaveDamageTargetSnapshot({
          ability: (pendings.find((row) => row.id === result.pendingSaveId)?.ability ?? 'dexterity') as string,
          dc: result.save.dc,
          total: result.save.total,
          success: result.save.success,
          eventId: result.eventId,
          damageRollId: damageRoll?.id ?? null,
          damageRollIndex: damageRoll?.index ?? null,
          damageType,
          scalingLevel,
          rawDamage: result.rawDamage,
          damageAfterSave: result.damageAfterSave,
          finalDamage: result.finalDamage,
          outcome: { success: resolution.outcome.success, failure: resolution.outcome.failure },
          components: result.components.map((component, index) => ({
            type: component.type,
            count: damageRoll?.components[index]?.count ?? 0,
            sides: damageRoll?.components[index]?.sides ?? 0,
            raw: component.raw,
            afterSave: component.afterSave,
            applied: component.applied,
            modifier: component.modifier,
          })),
          target: result.target,
          casterName: caster?.name ?? 'Sistema',
        }) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  await db.spellCast.update({
    where: { id: castId },
    data: {
      status: 'resolved',
      outcome: dealt ? 'effect' : 'no-effect',
      resolvedAt: new Date(),
      resolutionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  const { settleOpportunitySpell } = await import('../../combat/spatial/opportunity-attack.service.js');
  await settleOpportunitySpell(db, castId);

  return {
    completed: true,
    replayed: false,
    castId,
    snapshot,
    targets: results,
    publications: [...publications],
    deathTargets,
    concentrationChanged,
    affectedEffects,
  };
}
