import { occupiedSpaceOf } from './occupied-space.js';
import { SPATIAL_GEOMETRY_EPSILON_FEET } from './spatial-geometry.js';
import type { SpatialObstacleShape } from './spatial-obstacle.js';
import type { SpatialPosition2D, SpatialSize } from './spatial.types.js';

const EPSILON = SPATIAL_GEOMETRY_EPSILON_FEET;
const cross = (a: SpatialPosition2D, b: SpatialPosition2D, c: SpatialPosition2D) =>
  (b.xFeet - a.xFeet) * (c.yFeet - a.yFeet) - (b.yFeet - a.yFeet) * (c.xFeet - a.xFeet);

/** Envoltória convexa dos cantos inicial/final: footprint arrastado, sem lacunas. */
function sweptFootprint(from: SpatialPosition2D, to: SpatialPosition2D, size: SpatialSize): SpatialPosition2D[] {
  const corners = [from, to].flatMap(position => {
    const space = occupiedSpaceOf(position, size)!;
    return [
      { xFeet: space.minXFeet, yFeet: space.minYFeet },
      { xFeet: space.maxXFeet, yFeet: space.minYFeet },
      { xFeet: space.maxXFeet, yFeet: space.maxYFeet },
      { xFeet: space.minXFeet, yFeet: space.maxYFeet },
    ];
  }).sort((a, b) => a.xFeet - b.xFeet || a.yFeet - b.yFeet);
  const points = corners.filter((p, i) => i === 0 || p.xFeet !== corners[i - 1].xFeet || p.yFeet !== corners[i - 1].yFeet);
  const half = (list: SpatialPosition2D[]) => {
    const hull: SpatialPosition2D[] = [];
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

/**
 * Segmento possui algum trecho no INTERIOR do polígono? Recorte por semiplanos
 * com distância em pés. Só tocar a borda é permitido: encostar, afastar-se e
 * andar paralelo não podem prender tokens adjacentes à parede.
 */
function entersInterior(wall: SpatialObstacleShape, polygon: SpatialPosition2D[]): boolean {
  let low = 0, high = 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.xFeet - a.xFeet, b.yFeet - a.yFeet);
    const start = cross(a, b, wall.start) / length;
    const change = cross(a, b, wall.end) / length - start;
    if (Math.abs(change) <= EPSILON) {
      if (start <= EPSILON) return false;
    } else if (change > 0) low = Math.max(low, (EPSILON - start) / change);
    else high = Math.min(high, (EPSILON - start) / change);
    if (low >= high) return false;
  }
  return low < high;
}

/** Parede sólida bloqueia o percurso do footprint inteiro, inclusive Large+ e diagonais. */
export function movementBlockedByWalls(
  from: SpatialPosition2D, to: SpatialPosition2D, size: SpatialSize,
  obstacles: readonly SpatialObstacleShape[],
): boolean {
  if (from.xFeet === to.xFeet && from.yFeet === to.yFeet) return false;
  const walls = obstacles.filter(wall => wall.blocksMovement);
  if (walls.length === 0) return false;
  const sweep = sweptFootprint(from, to, size);
  return walls.some(wall => entersInterior(wall, sweep));
}
