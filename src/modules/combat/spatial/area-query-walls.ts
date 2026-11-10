import type { SpatialBody } from './spatial-distance.js';
import { occupiedSpaceOf } from './occupied-space.js';
import type { SpatialObstacleShape } from './spatial-obstacle.js';
/** Testa raios até cantos/centro do footprint; interposição 2D não inventa altura de parede. */
export function wallTouchesAreaRay(
  origin: { xFeet: number; yFeet: number },
  body: SpatialBody,
  walls: readonly SpatialObstacleShape[],
): boolean {
  const box = occupiedSpaceOf(body.position, body.size);
  if (!box) return false;
  const targets = [
    [box.minXFeet, box.minYFeet],
    [box.maxXFeet, box.minYFeet],
    [box.maxXFeet, box.maxYFeet],
    [box.minXFeet, box.maxYFeet],
    [(box.minXFeet + box.maxXFeet) / 2, (box.minYFeet + box.maxYFeet) / 2],
  ];
  return walls.some((wall) => {
    if (
      (wall.coverLevel ??
        ((wall.blocksTargeting ?? wall.blocksMovement) ? 'total' : 'none')) !==
      'total'
    )
      return false;
    const bx = wall.end.xFeet - wall.start.xFeet,
      by = wall.end.yFeet - wall.start.yFeet;
    return targets.some(([x, y]) => {
      const ax = x - origin.xFeet,
        ay = y - origin.yFeet,
        den = ax * by - ay * bx;
      if (Math.abs(den) < 1e-8) return false;
      const cx = wall.start.xFeet - origin.xFeet,
        cy = wall.start.yFeet - origin.yFeet;
      const t = (cx * by - cy * bx) / den,
        u = (cx * ay - cy * ax) / den;
      return t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1;
    });
  });
}
