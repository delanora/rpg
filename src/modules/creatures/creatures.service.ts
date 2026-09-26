import type { Creature, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toCreatureDto, type CreatureDto } from './creatures.dto.js';
import type { CreateCreatureInput, UpdateCreatureInput } from './creatures.schema.js';

/** Campos escalares copiados diretamente do PATCH para o banco. */
const SCALAR_KEYS = [
  'name',
  'type',
  'challengeRating',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'hpCurrent',
  'hpMax',
  'armorClass',
  'speed',
  'description',
] as const;

/**
 * Publica no painel dos mestres. Só os mestres recebem eventos de criaturas:
 * as criaturas ficam ocultas dos jogadores até entrarem no combate (Etapa 4).
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toMasters(event, payload);
  } catch (error) {
    console.error('[creatures] falha ao publicar evento em tempo real:', error);
  }
}

export async function listCreatures(): Promise<CreatureDto[]> {
  const creatures = await prisma.creature.findMany({ orderBy: { name: 'asc' } });
  return creatures.map(toCreatureDto);
}

export async function findCreature(id: string): Promise<Creature> {
  const creature = await prisma.creature.findUnique({ where: { id } });
  if (!creature) throw new HttpError('Criatura não encontrada.', 404);
  return creature;
}

export async function getCreature(id: string): Promise<CreatureDto> {
  return toCreatureDto(await findCreature(id));
}

export async function createCreature(input: CreateCreatureInput): Promise<CreatureDto> {
  const hpMax = input.hpMax ?? 10;

  const creature = await prisma.creature.create({
    data: {
      name: input.name ?? 'Nova criatura',
      type: input.type ?? '',
      challengeRating: input.challengeRating ?? '',
      hpMax,
      hpCurrent: hpMax,
      armorClass: input.armorClass ?? 10,
      attacks: [] as Prisma.InputJsonValue,
      resistances: [] as Prisma.InputJsonValue,
      immunities: [] as Prisma.InputJsonValue,
    },
  });

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_CREATED, { creature: dto });
  return dto;
}

export async function updateCreature(
  id: string,
  patch: UpdateCreatureInput,
): Promise<CreatureDto> {
  await findCreature(id);

  const data: Record<string, unknown> = { version: { increment: 1 } };

  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }

  if (patch.attacks !== undefined) data.attacks = patch.attacks;
  if (patch.resistances !== undefined) data.resistances = patch.resistances;
  if (patch.immunities !== undefined) data.immunities = patch.immunities;

  const creature = await prisma.creature.update({
    where: { id },
    data: data as Prisma.CreatureUpdateInput,
  });

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_UPDATED, { creature: dto, changes: patch });
  return dto;
}

export async function deleteCreature(id: string): Promise<void> {
  await findCreature(id);
  await prisma.creature.delete({ where: { id } });
  broadcast(ServerEvents.CREATURE_DELETED, { creatureId: id });
}
