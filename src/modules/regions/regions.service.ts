import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { parseJson } from '../shared/json.js';
import { imageListSchema, type ImageRef } from '../shared/images.js';
import { parseRegionImages, toRegionDto, type RegionDto } from './regions.dto.js';
import type { CreateRegionInput, UpdateRegionInput } from './regions.schema.js';

/**
 * Regiões são conteúdo de preparação do mestre: nunca vão para os jogadores,
 * então todos os eventos são publicados apenas na sala dos mestres.
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toMasters(event, payload);
  } catch (error) {
    console.error('[regions] falha ao publicar evento em tempo real:', error);
  }
}

const withCount = { _count: { select: { localities: true } } } as const;

export async function listRegions(): Promise<RegionDto[]> {
  const regions = await prisma.region.findMany({ orderBy: { name: 'asc' }, include: withCount });
  return regions.map(toRegionDto);
}

async function findRegion(id: string) {
  const region = await prisma.region.findUnique({ where: { id }, include: withCount });
  if (!region) throw new HttpError('Região não encontrada.', 404);
  return region;
}

export async function getRegion(id: string): Promise<RegionDto> {
  return toRegionDto(await findRegion(id));
}

export async function createRegion(input: CreateRegionInput): Promise<RegionDto> {
  const region = await prisma.region.create({
    data: {
      name: input.name,
      description: input.description ?? '',
      notes: input.notes ?? '',
      images: (input.images ?? []) as unknown as Prisma.InputJsonValue,
    },
    include: withCount,
  });

  const dto = toRegionDto(region);
  broadcast(ServerEvents.REGION_CREATED, { region: dto });
  return dto;
}

export async function updateRegion(id: string, patch: UpdateRegionInput): Promise<RegionDto> {
  const current = await findRegion(id);

  const data: Prisma.RegionUpdateInput = { version: { increment: 1 } };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.images !== undefined) {
    data.images = patch.images as unknown as Prisma.InputJsonValue;
  }

  const region = await prisma.region.update({ where: { id }, data, include: withCount });

  // Imagens retiradas da lista saem do disco.
  if (patch.images !== undefined) {
    const kept = new Set(patch.images.map((image) => image.url));
    await Promise.all(
      parseRegionImages(current)
        .filter((image) => !kept.has(image.url))
        .map((image) => deleteUploadedImage(image.url)),
    );
  }

  const dto = toRegionDto(region);
  broadcast(ServerEvents.REGION_UPDATED, { region: dto, changes: patch });
  return dto;
}

/**
 * Apaga a região e, em cascata, as localidades dentro dela (é o que o mestre
 * espera ao remover um agrupamento inteiro). Os arquivos de imagem da região
 * e das localidades também saem do disco.
 */
export async function deleteRegion(id: string): Promise<void> {
  const current = await findRegion(id);

  const localities = await prisma.locality.findMany({
    where: { regionId: id },
    select: { images: true },
  });

  await prisma.region.delete({ where: { id } });

  await Promise.all([
    ...parseRegionImages(current).map((image) => deleteUploadedImage(image.url)),
    ...localities.flatMap((locality) =>
      parseJson<ImageRef[]>(imageListSchema, locality.images, []).map((image) =>
        deleteUploadedImage(image.url),
      ),
    ),
  ]);

  broadcast(ServerEvents.REGION_DELETED, { regionId: id });
}

/**
 * Republica uma região com os números atualizados (ex.: a contagem de
 * localidades mudou porque o mestre criou/apagou/moveu uma delas).
 */
export async function publishRegionUpdate(regionId: string): Promise<void> {
  const region = await prisma.region.findUnique({ where: { id: regionId }, include: withCount });
  if (!region) return;

  const dto = toRegionDto(region);
  broadcast(ServerEvents.REGION_UPDATED, { region: dto, changes: { localityCount: dto.localityCount } });
}
