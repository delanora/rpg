import { occupiedSpaceOf } from './occupied-space.js';
import type { TerrainCell } from './terrain.schema.js';
import type { SpatialPosition2D, SpatialSize } from './spatial.types.js';

/** Terreno ambiental consultado pelo motor; ausência de pintura mantém chão normal. */
export type MovementTerrainStatus = 'normal' | 'difficult' | 'unknown';

export interface MovementTerrainProvider {
  /** Status do terreno na posição (âncora do footprint), para um tamanho. */
  difficultAt(
    position: SpatialPosition2D,
    size: SpatialSize,
  ): MovementTerrainStatus;
}

/** Compatibilidade para cenas legadas e fixtures sem camada ambiental. */
export const walkingMovementTerrain: MovementTerrainProvider = {
  difficultAt: () => 'normal',
};

/** Qualquer sobreposição positiva do footprint com um quadrado pintado custa terreno difícil; tocar apenas a borda não custa. */
export function sceneMovementTerrain(
  cells: readonly TerrainCell[] = [],
): MovementTerrainProvider {
  return {
    difficultAt(position, size) {
      const footprint = occupiedSpaceOf(position, size);
      if (!footprint) return 'normal';
      return cells.some(
        (cell) =>
          cell.xFeet < footprint.maxXFeet &&
          cell.xFeet + 5 > footprint.minXFeet &&
          cell.yFeet < footprint.maxYFeet &&
          cell.yFeet + 5 > footprint.minYFeet,
      )
        ? 'difficult'
        : 'normal';
    },
  };
}
