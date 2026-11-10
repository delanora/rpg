import type { SpatialObstacle } from '../../types';
/** Interseção visual do quadrado da borracha com um segmento, sem alterar geometria. */
export function wallTouchesPaintCell(
  wall: SpatialObstacle,
  cell: { xFeet: number; yFeet: number },
): boolean {
  const dx = wall.end.xFeet - wall.start.xFeet,
    dy = wall.end.yFeet - wall.start.yFeet;
  let first = 0,
    last = 1;
  for (const [p, q] of [
    [-dx, wall.start.xFeet - cell.xFeet],
    [dx, cell.xFeet + 5 - wall.start.xFeet],
    [-dy, wall.start.yFeet - cell.yFeet],
    [dy, cell.yFeet + 5 - wall.start.yFeet],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) first = Math.max(first, t);
    else last = Math.min(last, t);
    if (first > last) return false;
  }
  return true;
}
