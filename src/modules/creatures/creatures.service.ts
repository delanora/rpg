import { effectiveExhaustionLevel, effectiveMaxHp } from '../shared/conditions.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { assertLocalitiesExist } from '../localities/localities.service.js';
import { toCreatureDto, type CreatureDto, type CreatureWithLocalities } from './creatures.dto.js';
import type { CreateCreatureInput, UpdateCreatureInput } from './creatures.schema.js';

/** Campos escalares copiados diretamente do PATCH para o banco. */
const SCALAR_KEYS = [
  'name',
  'kind',
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
  'imageUrl',
] as const;

/** Toda leitura inclui as localidades vinculadas (usadas no editor e nos cards). */
const withLocalities = { localities: { select: { id: true, name: true } } } as const;

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
  const creatures = await prisma.creature.findMany({
    orderBy: { name: 'asc' },
    include: withLocalities,
  });
  return creatures.map(toCreatureDto);
}

export async function findCreature(id: string): Promise<CreatureWithLocalities> {
  const creature = await prisma.creature.findUnique({ where: { id }, include: withLocalities });
  if (!creature) throw new HttpError('Criatura não encontrada.', 404);
  return creature;
}

export async function getCreature(id: string): Promise<CreatureDto> {
  return toCreatureDto(await findCreature(id));
}

export async function createCreature(input: CreateCreatureInput): Promise<CreatureDto> {
  await assertLocalitiesExist(input.localityIds);

  const hpMax = input.hpMax ?? 10;

  const creature = await prisma.creature.create({
    data: {
      name: input.name ?? 'Nova criatura',
      kind: input.kind ?? 'CREATURE',
      type: input.type ?? '',
      challengeRating: input.challengeRating ?? '',
      hpMax,
      hpCurrent: hpMax,
      armorClass: input.armorClass ?? 10,
      attacks: [] as Prisma.InputJsonValue,
      resistances: [] as Prisma.InputJsonValue,
      immunities: [] as Prisma.InputJsonValue,
      vulnerabilities: [] as Prisma.InputJsonValue,
      localities: { connect: input.localityIds.map((id) => ({ id })) },
    },
    include: withLocalities,
  });

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_CREATED, { creature: dto });
  return dto;
}

export async function updateCreature(
  id: string,
  patch: UpdateCreatureInput,
): Promise<CreatureDto> {
  const current = await findCreature(id);

  const data: Record<string, unknown> = { version: { increment: 1 } };

  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }

  if (patch.attacks !== undefined) data.attacks = patch.attacks;
  if (patch.resistances !== undefined) data.resistances = patch.resistances;
  if (patch.immunities !== undefined) data.immunities = patch.immunities;
  if (patch.vulnerabilities !== undefined) data.vulnerabilities = patch.vulnerabilities;

  if (patch.localityIds !== undefined) {
    await assertLocalitiesExist(patch.localityIds);
    data.localities = { set: patch.localityIds.map((localityId) => ({ id: localityId })) };
  }

  // A Exaustão 4+ só limita o PV se a REGRA da mesa estiver ligada (o nível
  // salvo continua intacto e volta a valer ao religar).
  if (effectiveExhaustionLevel(current.mechanicalState) >= 4) data.hpCurrent = Math.min((data.hpCurrent as number | undefined) ?? current.hpCurrent, effectiveMaxHp((data.hpMax as number | undefined) ?? current.hpMax, current.mechanicalState));
  let creature;
  try {
    creature = await prisma.creature.update({
    where: { id, version: current.version },
    data: data as Prisma.CreatureUpdateInput,
    include: withLocalities,
  });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') throw new HttpError('Criatura mudou. Atualize e tente novamente.', 409, 'CONFLICT');
    throw error;
  }


  // Ícone trocado sai do disco (o antigo não é mais referenciado).
  if (patch.imageUrl !== undefined && patch.imageUrl !== current.imageUrl && current.imageUrl) {
    await deleteUploadedImage(current.imageUrl);
  }

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_UPDATED, { creature: dto, changes: patch });
  return dto;
}

export async function deleteCreature(id: string): Promise<void> {
  const current = await findCreature(id);
  await prisma.creature.delete({ where: { id } });
  if (current.imageUrl) await deleteUploadedImage(current.imageUrl);
  broadcast(ServerEvents.CREATURE_DELETED, { creatureId: id });
}
