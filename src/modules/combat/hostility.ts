import type { Prisma } from '@prisma/client';
import type { CombatSourced, CombatantSourced } from './combat.dto.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import {
  movementRelationOf,
  normalizeSideKey,
} from './spatial/spatial-movement.js';

export function combatantsAreHostile(
  a: CombatantSourced,
  b: CombatantSourced,
): boolean {
  return (
    movementRelationOf(
      normalizeSideKey(a.sideKey),
      normalizeSideKey(b.sideKey),
      a.hostileToIds?.includes(b.id) || b.hostileToIds?.includes(a.id),
    ) === 'hostile'
  );
}

/** Pergunta ao Mestre após ataque válido, independentemente de acerto. */
export async function queueAttackHostility(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  attacker: CombatantSourced,
  target: CombatantSourced,
  attackName: string,
  eventId: string,
): Promise<boolean> {
  if (combatantsAreHostile(attacker, target)) return false;
  for (const npc of [attacker, target]) {
    if (npc.kind !== 'NPC' || normalizeSideKey(npc.sideKey) !== 'neutral')
      continue;
    const pending = await db.combatHostilityPrompt.findFirst({
      where: {
        combatId: combat.id,
        status: 'pending',
        OR: [
          { attackerId: attacker.id, targetId: target.id },
          { attackerId: target.id, targetId: attacker.id },
        ],
      },
    });
    if (pending) return false;
    await db.combatHostilityPrompt.create({
      data: {
        combatId: combat.id,
        npcId: npc.id,
        attackerId: attacker.id,
        targetId: target.id,
        attackName,
        eventId,
      },
    });
    return true;
  }
  return false;
}

/** Ataques mágicos compartilham a fila; não confundir salvaguarda com ataque. */
export async function queueSpellAttackHostility(
  db: Prisma.TransactionClient,
  combatId: string | null,
  caster: MechanicalEntity,
  target: MechanicalEntity,
  attackName: string,
  eventId: string,
): Promise<void> {
  if (!combatId) return;
  const ids = [caster, target];
  const potentialNpc = await db.combatant.count({
    where: {
      combatId,
      kind: 'NPC',
      sideKey: 'neutral',
      OR: ids.map((entity) =>
        entity.kind === 'combatant'
          ? { id: entity.id }
          : entity.kind === 'character'
            ? { characterId: entity.id }
            : { creatureId: entity.id },
      ),
    },
  });
  if (!potentialNpc) return;
  // Serializa com decisões, turno e ataques de arma antes de ler as relações.
  const active = await db.combat.updateMany({
    where: { id: combatId, status: 'ACTIVE' },
    data: { version: { increment: 1 } },
  });
  if (!active.count) return;
  const { loadCombatById } = await import('./combat-load.js');
  const combat = await loadCombatById(combatId, db);
  const matches = (entity: MechanicalEntity) =>
    combat.combatants.filter((unit) =>
      entity.kind === 'combatant'
        ? unit.id === entity.id
        : entity.kind === 'character'
          ? unit.characterId === entity.id
          : unit.creatureId === entity.id,
    );
  const from = matches(caster),
    to = matches(target);
  if (from.length === 1 && to.length === 1 && from[0].id !== to[0].id)
    await queueAttackHostility(db, combat, from[0], to[0], attackName, eventId);
}

/** Uma edição explícita de lado substitui relações particulares anteriores. */
export async function clearSpecificHostility(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  id: string,
): Promise<void> {
  for (const unit of combat.combatants) {
    if (unit.id === id || unit.hostileToIds?.includes(id))
      await db.combatant.update({
        where: { id: unit.id },
        data: {
          hostileToIds:
            unit.id === id
              ? []
              : unit.hostileToIds!.filter((peer) => peer !== id),
        },
      });
  }
  await db.combatHostilityPrompt.updateMany({
    where: {
      combatId: combat.id,
      status: 'pending',
      OR: [{ npcId: id }, { attackerId: id }, { targetId: id }],
    },
    data: { status: 'cancelled' },
  });
}
