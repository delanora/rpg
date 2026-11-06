import type { Scene, SpatialObstacle } from '@prisma/client';
import { obstacleDtoOf, type SpatialObstacleDto } from '../combat/spatial/spatial-obstacle.js';
import { spatialSceneOf, type SpatialSceneConfig } from '../combat/spatial/spatial.types.js';

/**
 * FASE 6.6L.4.1.1 — DTO da CENA ESPACIAL.
 *
 * A cena é a representação espacial jogável de uma LOCALIDADE: dona da
 * configuração estrutural (PÉS) e das paredes. O combate apenas REFERENCIA uma
 * cena — por isso o read model do combate projeta estes mesmos dados sem
 * inventar join no cliente.
 */

/** Forma persistida que o DTO precisa (com as paredes já carregadas). */
export type SceneSource = Scene & { obstacles?: SpatialObstacle[] };

export interface SceneDto {
  id: string;
  localityId: string;
  name: string;
  /**
   * Configuração estrutural em PÉS. Cena sem `spatialConfig` no banco é
   * válida: cai na cena padrão ASSISTIDA (mesma leitura de `spatialSceneOf`).
   */
  spatialConfig: SpatialSceneConfig;
  /**
   * Imagem de fundo OPCIONAL. `null` é um estado válido (cena sem arte) e a
   * imagem NUNCA é fonte mecânica — grid, paredes e movimento independem dela.
   */
  backgroundImageUrl: string | null;
  /** Paredes da cena, na ordem de criação. */
  obstacles: SpatialObstacleDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toSceneDto(scene: SceneSource): SceneDto {
  return {
    id: scene.id,
    localityId: scene.localityId,
    name: scene.name,
    spatialConfig: spatialSceneOf(scene.spatialConfig),
    backgroundImageUrl: scene.backgroundImageUrl ?? null,
    obstacles: (scene.obstacles ?? []).map(obstacleDtoOf),
    version: scene.version,
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
  };
}
