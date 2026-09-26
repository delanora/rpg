import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { publishRegionUpdate } from '../regions/regions.service.js';
import { parseLocalityImages, toLocalityDto, type LocalityDto } from './localities.dto.js';
import type { CreateLocalityInput, UpdateLocalityInput } from './localities.schema.js';

/**
 * Localidades são conteúdo de preparação do mestre: nunca vão para os
 * jogadores, então todos os eventos são publicados apenas na sala dos mestres.
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toMasters(event, payload);
  } catch (error) {
    console.error('[localities] falha ao publicar evento em tempo real:', error);
  }
}

const withCount = { _count: { select: { creatures: true } } } as const;

export async function listLocalities(): Promise<LocalityDto[]> {
  const localities = await prisma.locality.findMany({
    orderBy: { name: 'asc' },
    include: withCount,
  });
  return localities.map(toLocalityDto);
}

async function findLocality(id: string) {
  const locality = await prisma.locality.findUnique({ where: { id }, include: withCount });
  if (!locality) throw new HttpError('Localidade não encontrada.', 404);
  return locality;
}

export async function getLocality(id: string): Promise<LocalityDto> {
  return toLocalityDto(await findLocality(id));
}

async function assertRegionExists(regionId: string): Promise<void> {
  const region = await prisma.region.count({ where: { id: regionId } });
  if (region === 0) {
    throw new HttpError('A região escolhida não existe.', 400);
  }
}

export async function createLocality(input: CreateLocalityInput): Promise<LocalityDto> {
  await assertRegionExists(input.regionId);

  const locality = await prisma.locality.create({
    data: {
      name: input.name,
      description: input.description ?? '',
      images: (input.images ?? []) as unknown as Prisma.InputJsonValue,
      regionId: input.regionId,
    },
    include: withCount,
  });

  const dto = toLocalityDto(locality);
  broadcast(ServerEvents.LOCALITY_CREATED, { locality: dto });
  // A contagem de localidades da região mudou.
  await publishRegionUpdate(input.regionId);
  return dto;
}

export async function updateLocality(
  id: string,
  patch: UpdateLocalityInput,
): Promise<LocalityDto> {
  const current = await findLocality(id);

  const data: Prisma.LocalityUpdateInput = { version: { increment: 1 } };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.images !== undefined) {
    data.images = patch.images as unknown as Prisma.InputJsonValue;
  }
  if (patch.regionId !== undefined && patch.regionId !== current.regionId) {
    await assertRegionExists(patch.regionId);
    data.region = { connect: { id: patch.regionId } };
  }

  const locality = await prisma.locality.update({ where: { id }, data, include: withCount });

  // Imagens retiradas da lista saem do disco.
  if (patch.images !== undefined) {
    const kept = new Set(patch.images.map((image) => image.url));
    await Promise.all(
      parseLocalityImages(current)
        .filter((image) => !kept.has(image.url))
        .map((image) => deleteUploadedImage(image.url)),
    );
  }

  const dto = toLocalityDto(locality);
  broadcast(ServerEvents.LOCALITY_UPDATED, { locality: dto, changes: patch });

  // Trocou de região: as duas contagens precisam ser republicadas.
  if (patch.regionId !== undefined && patch.regionId !== current.regionId) {
    await publishRegionUpdate(current.regionId);
    await publishRegionUpdate(patch.regionId);
  }

  return dto;
}

export async function deleteLocality(id: string): Promise<void> {
  const current = await findLocality(id);

  await prisma.locality.delete({ where: { id } });

  await Promise.all(parseLocalityImages(current).map((image) => deleteUploadedImage(image.url)));

  broadcast(ServerEvents.LOCALITY_DELETED, { localityId: id });
  await publishRegionUpdate(current.regionId);
}

/** Confirma que todos os ids existem; usado ao vincular criaturas/NPCs. */
export async function assertLocalitiesExist(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;

  const found = await prisma.locality.count({ where: { id: { in: unique } } });
  if (found !== unique.length) {
    throw new HttpError('Uma das localidades escolhidas não existe.', 400);
  }
}
