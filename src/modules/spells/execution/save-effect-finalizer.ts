import { randomUUID } from 'node:crypto';
import type { EffectInstance, Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { deriveConditionEffects, type MechanicalEntity } from '../../shared/conditions.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import { applyEffectConditions, saveMechanicalState } from '../../effects/effect-conditions.js';
import { endEffectsForConcentration } from '../../effects/effects.service.js';
import { findEffectDefinition } from '../../effects/definitions/registry.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';

/**
 * FASE 6.6E — RESOLUTION BARRIER de conjurações `save-effect`.
 *
 * Uma magia `save-effect` multi-alvo é UM evento de mesa: TODOS os saves
 * iniciais pertencem à mesma conjuração. Por isso nenhum Effect nasce antes de
 * o último alvo resolver — caso contrário a metade que já rolou pareceria uma
 * magia diferente da metade que ainda está "sendo conjurada".
 *
 * Fluxo:
 *   COMMIT → N PendingEffectSaves → cada alvo rola o seu save
 *   → quando TODAS estão resolvidas → este finalizer roda UMA vez:
 *       • zero falhas   → SpellCast `resolved`/`no-effect` (sem Effect/Concentração)
 *       • ≥1 falha      → UM Effect Group com uma instância por falha,
 *                         Paralyzed via `conditions` da Effect Definition e
 *                         UMA Concentração ligada ao grupo.
 *
 * Concorrência: os dois últimos saves podem chegar juntos. O lock é
 * TRANSACIONAL do Postgres (`pg_advisory_xact_lock`), nunca um mutex de
 * processo; a transição `status: 'resolving'` do SpellCast é a barreira final.
 */

export interface SaveEffectFinalization {
  /** `true` quando a conjuração já não tem pendências (ou já estava fechada). */
  completed: boolean;
  effectGroupId: string | null;
  effects: EffectInstance[];
  /** Alvos que FALHARAM (receberam efeito). */
  failedTargets: MechanicalEntity[];
  /** Tudo que mudou de visão e precisa ser republicado. */
  affectedTargets: MechanicalEntity[];
  /** Todos os alvos da conjuração (as pendências deles mudaram). */
  castTargets: MechanicalEntity[];
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

/**
 * REGRA GENÉRICA do motor: caster Incapacitado ou a 0 PV não mantém
 * concentração. Roda depois da criação do grupo para que o estado final seja
 * consistente sem inventar placeholder de concentração.
 */
async function enforceCasterConcentration(
  caster: MechanicalEntity,
  db: Prisma.TransactionClient,
): Promise<MechanicalEntity[]> {
  const fresh = await loadEntity(caster, db);
  const state = fresh.state;
  if (!state.concentration) return [];
  if (!deriveConditionEffects(state).incapacitated && fresh.hpCurrent > 0) return [];

  const ended = await endEffectsForConcentration(state.concentration, db, {
    entity: fresh.entity,
    state,
  });
  state.concentration = null;
  state.pendingConcentrationSaves = [];
  await saveMechanicalState(fresh, state, db);
  return ended;
}

async function closeCast(
  db: Prisma.TransactionClient,
  spellCastId: string,
  outcome: 'effect' | 'no-effect',
  effectGroupId?: string,
): Promise<void> {
  await db.spellCast.updateMany({
    where: { id: spellCastId, status: 'resolving' },
    data: {
      status: 'resolved',
      outcome,
      ...(effectGroupId ? { effectGroupId } : {}),
      resolvedAt: new Date(),
    },
  });
  const { settleOpportunitySpell } = await import('../../combat/spatial/opportunity-attack.service.js');
  await settleOpportunitySpell(db, spellCastId);
}

async function existingFinalization(
  db: Prisma.TransactionClient,
  spellCastId: string,
  effectGroupId: string | null,
): Promise<SaveEffectFinalization> {
  const effects = effectGroupId
    ? await db.effectInstance.findMany({ where: { groupId: effectGroupId } })
    : [];
  return {
    completed: true,
    effectGroupId,
    effects,
    failedTargets: effects.map((row) => entityOf(row.targetEntityKind, row.targetEntityId)),
    affectedTargets: [],
    castTargets: [],
  };
}

/**
 * Tenta finalizar a conjuração. Devolve `completed: false` enquanto houver
 * QUALQUER pendência `pending` — nunca finaliza cedo.
 */
export async function tryFinalizeSaveEffectCast(
  spellCastId: string,
  db: Prisma.TransactionClient,
): Promise<SaveEffectFinalization> {
  // Serializa finalizers do MESMO cast dentro desta transação. Transacional e
  // compartilhado entre processos (nada de estado em memória).
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spellCastId}))`;

  const cast = await db.spellCast.findUnique({ where: { id: spellCastId } });
  if (!cast) return existingFinalization(db, spellCastId, null);
  if (cast.status !== 'resolving') {
    return existingFinalization(db, spellCastId, cast.effectGroupId ?? null);
  }

  const pendings = await db.pendingEffectSave.findMany({
    where: { spellCastId },
    orderBy: { createdAt: 'asc' },
  });
  const castTargets = pendings.map((row) => entityOf(row.targetEntityKind, row.targetEntityId));
  if (pendings.some((row) => row.status === 'pending')) {
    return {
      completed: false,
      effectGroupId: null,
      effects: [],
      failedTargets: [],
      affectedTargets: [],
      castTargets,
    };
  }

  const failures = pendings.filter((row) => row.result === 'failure');
  if (failures.length === 0) {
    await closeCast(db, cast.id, 'no-effect');
    return {
      completed: true,
      effectGroupId: null,
      effects: [],
      failedTargets: [],
      affectedTargets: [],
      castTargets,
    };
  }

  const execution = spellExecutionDefinition(cast.spellId);
  const resolution = execution?.resolution;
  if (!execution || resolution?.kind !== 'save-effect') {
    throw new HttpError(
      'A conjuração finalizada não possui uma definição de resolução compatível.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }
  const effect = findEffectDefinition(resolution.effectDefinitionId);
  if (!effect) {
    throw new HttpError(
      'A execução referencia uma definição de efeito inexistente.',
      409,
      'SPELL_EXECUTION_NOT_IMPLEMENTED',
    );
  }

  const groupId = randomUUID();
  const effects: EffectInstance[] = [];
  const affectedTargets: MechanicalEntity[] = [];
  for (const failure of failures) {
    const target = await loadEntity(
      entityOf(failure.targetEntityKind, failure.targetEntityId),
      db,
    );
    const row = await db.effectInstance.create({
      data: {
        groupId,
        definitionId: effect.definitionId,
        label: effect.label,
        sourceType: 'spell',
        sourceId: cast.spellId,
        sourceEntityKind: cast.casterEntityKind,
        sourceEntityId: cast.casterEntityId,
        sourceLabel: cast.casterLabel ?? null,
        modifiers: effect.modifiers() as unknown as Prisma.InputJsonValue,
        conditions: effect.conditions() as unknown as Prisma.InputJsonValue,
        // 6.6H: o Effect nasce DEPOIS da barreira, mas herda o relógio do
        // COMMIT — nunca ganha "mais 1 minuto" por causa da UI assíncrona.
        ...(cast.durationSnapshot
          ? { durationSnapshot: cast.durationSnapshot as Prisma.InputJsonValue }
          : {}),
        turnTriggers: effect.turnTriggers() as unknown as Prisma.InputJsonValue,
        targetEntityKind: target.entity.kind,
        targetEntityId: target.entity.id,
        visibility: 'public',
        status: 'active',
        createdBy: cast.createdBy ?? null,
      },
    });
    effects.push(row);
    affectedTargets.push(target.entity);
    // Conditions do efeito entram pelo motor existente (6.5C).
    const applied = await applyEffectConditions(row, target.entity, db);
    if (applied.endedConcentration) {
      affectedTargets.push(...(await endEffectsForConcentration(applied.endedConcentration, db)));
    }
    await db.pendingEffectSave.update({
      where: { id: failure.id },
      data: { groupId, effectId: row.id },
    });
  }

  if (execution.requiresConcentration) {
    const caster = await loadEntity(
      entityOf(cast.casterEntityKind, cast.casterEntityId),
      db,
    );
    const state = caster.state;
    // Defensivo: o COMMIT já encerrou a concentração anterior; uma concentração
    // manual aberta durante a espera é substituída pela nova.
    if (state.concentration) {
      affectedTargets.push(...(await endEffectsForConcentration(state.concentration, db, {
        entity: caster.entity,
        state,
      })));
    }
    state.concentration = {
      id: randomUUID(),
      label: effect.label,
      sourceType: 'effect',
      sourceId: groupId,
      visibility: 'public',
      startedAt: new Date().toISOString(),
      ...(cast.createdBy ? { startedBy: cast.createdBy } : {}),
    };
    state.pendingConcentrationSaves = [];
    await saveMechanicalState(caster, state, db);
    // Caster incapacitado/0 PV enquanto os saves estavam pendentes: o lifecycle
    // encerra a concentração recém-criada e, com ela, o grupo.
    affectedTargets.push(...(await enforceCasterConcentration(caster.entity, db)));
    affectedTargets.push(caster.entity);
  }

  await closeCast(db, cast.id, 'effect', groupId);

  return {
    completed: true,
    effectGroupId: groupId,
    effects,
    failedTargets: failures.map((row) => entityOf(row.targetEntityKind, row.targetEntityId)),
    affectedTargets,
    castTargets,
  };
}

/** Wrapper para uso fora de uma transação já aberta. */
export async function finalizeSaveEffectCast(
  spellCastId: string,
): Promise<SaveEffectFinalization> {
  return prisma.$transaction((db) => tryFinalizeSaveEffectCast(spellCastId, db));
}
