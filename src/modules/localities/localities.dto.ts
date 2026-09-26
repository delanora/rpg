import type { Locality } from '@prisma/client';
import { z } from 'zod';
import { parseJson } from '../shared/json.js';
import { localityImageSchema, type LocalityImage } from './localities.schema.js';

/** Localidade enviada ao painel do mestre. */
export interface LocalityDto {
  id: string;
  name: string;
  description: string;
  images: LocalityImage[];
  /** Quantas criaturas/NPCs estão vinculadas a esta localidade. */
  creatureCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Versão enxuta usada dentro de criaturas/NPCs e do combate. */
export interface LocalitySummaryDto {
  id: string;
  name: string;
}

const imageListSchema = z.array(localityImageSchema);

type LocalityWithCount = Locality & { _count?: { creatures: number } };

/** Lê a lista de imagens de uma localidade (JSONB tolerante a dados antigos). */
export function parseLocalityImages(locality: Pick<Locality, 'images'>): LocalityImage[] {
  return parseJson<LocalityImage[]>(imageListSchema, locality.images, []);
}

export function toLocalityDto(locality: LocalityWithCount): LocalityDto {
  return {
    id: locality.id,
    name: locality.name,
    description: locality.description,
    images: parseLocalityImages(locality),
    creatureCount: locality._count?.creatures ?? 0,
    version: locality.version,
    createdAt: locality.createdAt.toISOString(),
    updatedAt: locality.updatedAt.toISOString(),
  };
}

export function toLocalitySummary(locality: { id: string; name: string }): LocalitySummaryDto {
  return { id: locality.id, name: locality.name };
}
