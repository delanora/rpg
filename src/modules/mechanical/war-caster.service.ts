import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { hasWarCaster } from '../shared/war-caster.js';

export async function entityHasWarCaster(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({
      where: { id: entity.id },
      select: { features: true },
    });
    return hasWarCaster(row?.features);
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({
      where: { id: entity.id },
      select: { abilities: true },
    });
    return hasWarCaster([], row?.abilities);
  }
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    select: { characterId: true, creatureId: true },
  });
  return row?.characterId
    ? entityHasWarCaster({ kind: 'character', id: row.characterId }, db)
    : row?.creatureId
      ? entityHasWarCaster({ kind: 'creature', id: row.creatureId }, db)
      : false;
}
