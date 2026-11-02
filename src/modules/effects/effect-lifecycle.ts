import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  mechanicalStateOf,
  type ConditionInstance,
  type MechanicalEntity,
} from '../shared/conditions.js';
import { removeEffectConditions, type EffectConditionTarget } from './effect-conditions.js';
import { parseEffectConditions } from './effect-modifiers.js';
import type { EffectEndReason } from './effects.schema.js';

/**
 * FASE 6.5D — LIFECYCLE CENTRAL DE ENCERRAMENTO.
 *
 * Um Effect ATIVO pode produzir consequências mecânicas; um Effect ENCERRADO
 * não pode produzir nenhuma. Este módulo é a ÚNICA porta que desmonta uma
 * instância, para que `endEffect` (uma) e `endEffectGroup` (lote) nunca tenham
 * implementações divergentes.
 *
 * O que NFase 6.5D desmonta hoje:
 *  • MODIFICADORES: nada a fazer — o resolver só consulta `status = 'active'`,
 *    então o efeito deixa de participar da derivação no mesmo instante em que a
 *    linha vira `ended`. Nunca se apaga o JSON, nunca se escreve na ficha.
 *  • CONDITIONS: remove apenas as `ConditionInstance` com
 *    `sourceType = 'effect'` + `sourceId` DESTA instância. Fonte manual, outro
 *    Effect e as derivadas protegidas (`hp-zero`) ficam naturalmente intactas.
 *
 * Regras que o lifecycle garante:
 *  • identidade é `sourceType + sourceId` — nunca `label`/`group`/nome;
 *  • transição ACTIVE → ENDED é guardada por status (retry/concorrência não
 *    reescrevem `endedAt`/`endReason` e não duplicam cleanup);
 *  • `endReason` é histórico/auditoria, NÃO muda a limpeza;
 *  • ordenação determinística: encerra o status primeiro, depois limpa.
 */

/** Linha mínima que o lifecycle precisa para desmontar uma instância. */
interface LifecycleRow {
  id: string;
  targetEntityKind: string;
  targetEntityId: string;
  conditions: unknown;
}

export interface EndedEffect {
  id: string;
  target: MechanicalEntity;
}

function targetOf(row: { targetEntityKind: string; targetEntityId: string }): MechanicalEntity {
  return {
    kind: row.targetEntityKind as MechanicalEntity['kind'],
    id: row.targetEntityId,
  };
}

function toCleanupItem(row: LifecycleRow) {
  return { id: row.id, target: targetOf(row), conditions: row.conditions };
}

/** Remove alvos repetidos preservando a ordem de encerramento. */
export function uniqueTargets(ended: readonly EndedEffect[]): MechanicalEntity[] {
  const seen = new Set<string>();
  const targets: MechanicalEntity[] = [];
  for (const item of ended) {
    const key = `${item.target.kind}:${item.target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(item.target);
  }
  return targets;
}

/**
 * PIPELINE ÚNICO de encerramento.
 *
 * 1. Lê as instâncias ATIVAS que casam com o filtro;
 * 2. faz a transição ACTIVE → ENDED com guarda de status (`endedAt`/`endReason`
 *    da primeira transição prevalecem);
 * 3. remove as Conditions daquelas instâncias, agrupadas por alvo;
 * 4. devolve o que foi encerrado (o chamador publica o realtime).
 *
 * `context` é o alvo já carregado pelo chamador dentro da própria transação
 * (Concentração/mutação): o cleanup edita o MESMO objeto de estado e quem
 * persiste continua sendo o chamador — sem corrida de versão.
 */
export async function endEffectInstances(
  where: Prisma.EffectInstanceWhereInput,
  reason: EffectEndReason,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  context?: EffectConditionTarget,
): Promise<EndedEffect[]> {
  const rows: LifecycleRow[] = await db.effectInstance.findMany({
    where: { ...where, status: 'active' },
    select: { id: true, targetEntityKind: true, targetEntityId: true, conditions: true },
  });
  if (rows.length === 0) return [];

  await db.effectInstance.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: 'active' },
    data: { status: 'ended', endedAt: new Date(), endReason: reason },
  });

  await removeEffectConditions(rows.map(toCleanupItem), db, context);

  return rows.map((row) => ({ id: row.id, target: targetOf(row) }));
}

/**
 * Chaves mecânicas de uma entidade que está sendo REMOVIDA do banco.
 *
 * Combatente de personagem é canonicalizado para a ficha (mesma fonte de
 * verdade do create/list). Criatura leva junto os combatentes que apontam para
 * ela: a instância do NPC deixa de representar a criatura removida.
 */
async function mechanicalKeysOf(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<MechanicalEntity[]> {
  const keys: MechanicalEntity[] = [{ kind: entity.kind, id: entity.id }];

  if (entity.kind === 'combatant') {
    const row = await db.combatant.findUnique({ where: { id: entity.id }, select: { characterId: true } });
    if (row?.characterId) keys.push({ kind: 'character', id: row.characterId });
  }

  if (entity.kind === 'creature') {
    const combatants = await db.combatant.findMany({
      where: { creatureId: entity.id },
      select: { id: true },
    });
    for (const combatant of combatants) keys.push({ kind: 'combatant', id: combatant.id });
  }

  return keys;
}

/**
 * Encerra os efeitos cujo ALVO estrutural deixou de existir (`target-removed`).
 * NÃO é morte: só roda quando a entidade é realmente apagada do banco.
 */
export async function endEffectsTargetingEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  reason: EffectEndReason = 'target-removed',
): Promise<MechanicalEntity[]> {
  const keys = await mechanicalKeysOf(entity, db);
  const ended = await endEffectInstances(
    { OR: keys.map((key) => ({ targetEntityKind: key.kind, targetEntityId: key.id })) },
    reason,
    db,
  );
  return uniqueTargets(ended);
}

/**
 * Encerra os efeitos cuja ORIGEM estrutural deixou de existir
 * (`source-removed`). Morrer NÃO encerra nada — isto é remoção do banco.
 */
export async function endEffectsSourcedByEntity(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  reason: EffectEndReason = 'source-removed',
): Promise<MechanicalEntity[]> {
  const keys = await mechanicalKeysOf(entity, db);
  const ended = await endEffectInstances(
    { OR: keys.map((key) => ({ sourceEntityKind: key.kind, sourceEntityId: key.id })) },
    reason,
    db,
  );
  return uniqueTargets(ended);
}

async function rawConditionsOf(
  target: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<ConditionInstance[] | null> {
  let state: unknown;
  if (target.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: target.id }, select: { mechanicalState: true } });
    state = row?.mechanicalState;
  } else if (target.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: target.id }, select: { mechanicalState: true } });
    state = row?.mechanicalState;
  } else {
    const row = await db.combatant.findUnique({ where: { id: target.id }, select: { mechanicalState: true } });
    state = row?.mechanicalState;
  }
  if (state === undefined || state === null) return null;
  return mechanicalStateOf(state).conditions;
}

/**
 * DIAGNÓSTICO (6.5D) — invariante de lifecycle.
 *
 * Devolve os efeitos ENCERRADOS que ainda têm `ConditionInstance` ativa com
 * `sourceType = 'effect'` + `sourceId` próprio. Esperado nesta fase: lista
 * vazia. É leitura pura (usada por smoke/asserts); NÃO repara nada em GET.
 */
export async function findEndedEffectsWithLiveConditions(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ effectId: string; target: MechanicalEntity; conditions: string[] }[]> {
  const ended = await db.effectInstance.findMany({
    where: { status: 'ended' },
    select: { id: true, targetEntityKind: true, targetEntityId: true, conditions: true },
  });

  const byTarget = new Map<string, { target: MechanicalEntity; effects: LifecycleRow[] }>();
  for (const row of ended) {
    if (parseEffectConditions(row.conditions).length === 0) continue;
    const target = targetOf(row);
    const key = `${target.kind}:${target.id}`;
    const entry = byTarget.get(key) ?? { target, effects: [] };
    entry.effects.push(row);
    byTarget.set(key, entry);
  }

  const orphans: { effectId: string; target: MechanicalEntity; conditions: string[] }[] = [];
  for (const { target, effects } of byTarget.values()) {
    const conditions = await rawConditionsOf(target, db);
    if (!conditions) continue; // entidade já removida: não há estado a vazar
    for (const effect of effects) {
      const live = conditions.filter(
        (instance) => instance.sourceType === 'effect' && instance.sourceId === effect.id,
      );
      if (live.length === 0) continue;
      orphans.push({
        effectId: effect.id,
        target,
        conditions: live.map((instance) => instance.condition),
      });
    }
  }
  return orphans;
}
