export {
  elevationCellSchema,
  elevationCellsSchema,
  type ElevationCell,
} from './elevation.schema.js';
import type { ElevationCell } from './elevation.schema.js';
import type {
  SpatialPosition2D,
  SpatialSceneConfig,
  SpatialSize,
} from './spatial.types.js';
import { occupiedSpaceOf } from './occupied-space.js';

export function elevationCellsWithinScene(
  cells: readonly Pick<ElevationCell, 'xFeet' | 'yFeet'>[],
  scene: Pick<SpatialSceneConfig, 'widthFeet' | 'heightFeet'>,
): boolean {
  return cells.every(
    (cell) =>
      cell.xFeet + 5 <= scene.widthFeet && cell.yFeet + 5 <= scene.heightFeet,
  );
}

/** Footprint sobre níveis distintos exige arbitragem, inclusive criaturas grandes. */
export function surfaceElevation(
  scene: SpatialSceneConfig,
  position: SpatialPosition2D,
  size: SpatialSize,
): number | null {
  const space = occupiedSpaceOf(position, size);
  if (!space) return null;
  const values = new Map(
    (scene.elevationCells ?? []).map((cell) => [
      `${cell.xFeet}:${cell.yFeet}`,
      cell.elevationFeet,
    ]),
  );
  const levels = new Set<number>();
  for (
    let y = Math.floor(space.minYFeet / 5) * 5;
    y < space.maxYFeet - 1e-6;
    y += 5
  ) {
    for (
      let x = Math.floor(space.minXFeet / 5) * 5;
      x < space.maxXFeet - 1e-6;
      x += 5
    )
      levels.add(values.get(`${x}:${y}`) ?? 0);
  }
  return levels.size === 1 ? [...levels][0] : null;
}

export function elevationDecisionRequired(
  scene: SpatialSceneConfig,
  position: SpatialPosition2D | null,
  size: SpatialSize,
  path: readonly SpatialPosition2D[],
  elevationFeet?: number | null,
): boolean {
  if (!position || path.length === 0) return false;
  let previous = surfaceElevation(scene, position, size);
  if (
    previous === null ||
    (elevationFeet != null && Math.abs(elevationFeet - previous) > 1e-6)
  )
    return true;
  for (const next of path) {
    const level = surfaceElevation(scene, next, size);
    if (level === null || Math.abs(level - previous) > 1e-6) return true;
    previous = level;
  }
  return false;
}

/** Movimento horizontal não derruba um token cuja elevação foi ajustada manualmente. */
export function elevationAfterMovement(
  scene: SpatialSceneConfig,
  origin: SpatialPosition2D | null,
  destination: SpatialPosition2D,
  size: SpatialSize,
  explicit?: number | null,
): number | null {
  const initial = origin ? surfaceElevation(scene, origin, size) : null;
  if (
    explicit != null &&
    (initial === null || Math.abs(explicit - initial) > 1e-6)
  )
    return explicit;
  return surfaceElevation(scene, destination, size) ?? explicit ?? null;
}
