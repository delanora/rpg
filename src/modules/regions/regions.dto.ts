import type { Region } from '@prisma/client';
import { parseJson } from '../shared/json.js';
import { imageListSchema, type ImageRef } from '../shared/images.js';

/**
 * Região enviada ao painel do mestre: além dos dados próprios (descrição,
 * anotações e imagens), carrega quantas localidades ela agrupa. As criaturas e
 * NPCs nunca ficam aqui — pertencem às localidades.
 */
export interface RegionDto {
  id: string;
  name: string;
  description: string;
  notes: string;
  images: ImageRef[];
  /** Quantas localidades estão dentro desta região. */
  localityCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type RegionWithCount = Region & { _count?: { localities: number } };

/** Lê a lista de imagens de uma região (JSONB tolerante a dados antigos). */
export function parseRegionImages(region: Pick<Region, 'images'>): ImageRef[] {
  return parseJson<ImageRef[]>(imageListSchema, region.images, []);
}

export function toRegionDto(region: RegionWithCount): RegionDto {
  return {
    id: region.id,
    name: region.name,
    description: region.description,
    notes: region.notes,
    images: parseRegionImages(region),
    localityCount: region._count?.localities ?? 0,
    version: region.version,
    createdAt: region.createdAt.toISOString(),
    updatedAt: region.updatedAt.toISOString(),
  };
}
