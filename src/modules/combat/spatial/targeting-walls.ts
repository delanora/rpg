import type { SpatialBody } from './spatial-distance.js';
import { occupiedSpaceOf, spaceWithinScene } from './occupied-space.js';
import { classifySegmentIntersection, SPATIAL_GEOMETRY_EPSILON_FEET as EPSILON,
  type Segment2D } from './spatial-geometry.js';
import type { SpatialObstacleShape } from './spatial-obstacle.js';
import type { OccupiedSpace, SpatialPosition2D as Point, SpatialSceneConfig } from './spatial.types.js';

export interface WallPathEvaluation {
  result: 'pass' | 'fail' | 'unknown';
  reason: 'clear' | 'wall' | 'unavailable' | 'partial-or-corner';
}

function corners(space: OccupiedSpace): Point[] {
  return [
    { xFeet: space.minXFeet, yFeet: space.minYFeet }, { xFeet: space.maxXFeet, yFeet: space.minYFeet },
    { xFeet: space.maxXFeet, yFeet: space.maxYFeet }, { xFeet: space.minXFeet, yFeet: space.maxYFeet },
  ];
}

/** Distância orientada à reta, em pés; a tolerância continua na unidade canônica. */
function side(point: Point, line: Segment2D): number {
  const dx = line.end.xFeet - line.start.xFeet, dy = line.end.yFeet - line.start.yFeet;
  const length = Math.hypot(dx, dy);
  return length <= EPSILON ? 0 :
    (dx * (point.yFeet - line.start.yFeet) - dy * (point.xFeet - line.start.xFeet)) / length;
}

/** Fecho convexo dos dois footprints: contém todos os trajetos retos possíveis entre eles. */
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.xFeet - b.xFeet || a.yFeet - b.yFeet)
    .filter((point, i, all) => i === 0 || Math.hypot(point.xFeet - all[i - 1]!.xFeet,
      point.yFeet - all[i - 1]!.yFeet) > EPSILON);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const point of list) {
      while (out.length >= 2 && side(point, { start: out[out.length - 2]!, end: out[out.length - 1]! }) <= EPSILON) out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function intersectsCorridor(line: Segment2D, polygon: Point[]): boolean {
  const edges = polygon.map((point, i) => ({ start: point, end: polygon[(i + 1) % polygon.length]! }));
  const inside = (point: Point) => edges.every(edge => side(point, edge) >= -EPSILON);
  return inside(line.start) || inside(line.end) ||
    edges.some(edge => classifySegmentIntersection(line, edge) !== 'none');
}

/** Junta somente segmentos colineares contíguos; nenhuma fresta real é fechada. */
export function mergeTargetingWalls(walls: readonly SpatialObstacleShape[]): Segment2D[] {
  const groups: { line: Segment2D; dx: number; dy: number; intervals: [number, number][] }[] = [];
  for (const wall of walls) {
    if (!(wall.blocksTargeting ?? wall.blocksMovement)) continue;
    const length = Math.hypot(wall.end.xFeet - wall.start.xFeet, wall.end.yFeet - wall.start.yFeet);
    if (length <= EPSILON) continue;
    let group = groups.find(item => Math.abs(side(wall.start, item.line)) <= EPSILON &&
      Math.abs(side(wall.end, item.line)) <= EPSILON);
    if (!group) {
      group = { line: wall, dx: (wall.end.xFeet - wall.start.xFeet) / length,
        dy: (wall.end.yFeet - wall.start.yFeet) / length, intervals: [] };
      groups.push(group);
    }
    const project = (point: Point) => (point.xFeet - group!.line.start.xFeet) * group!.dx +
      (point.yFeet - group!.line.start.yFeet) * group!.dy;
    const a = project(wall.start), b = project(wall.end);
    group.intervals.push([Math.min(a, b), Math.max(a, b)]);
  }
  return groups.flatMap(group => {
    const merged: [number, number][] = [];
    for (const interval of group.intervals.sort((a, b) => a[0] - b[0])) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1] + EPSILON) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push([...interval]);
    }
    const point = (distance: number): Point => ({ xFeet: group.line.start.xFeet + group.dx * distance,
      yFeet: group.line.start.yFeet + group.dy * distance });
    return merged.map(([a, b]) => ({ start: point(a), end: point(b) }));
  });
}

/**
 * Primeira adjudicação espacial do Obsyrium: paredes 2D cadastradas, sem inferir
 * altura pela arte ou usar um raio entre centros como prova de cobertura total.
 * Bloqueio só é conhecido quando uma barreira contínua separa TODOS os pontos
 * dos footprints e cobre a seção inteira do corredor. Casos parciais são assistidos.
 */
export function evaluateWallPath(scene: SpatialSceneConfig, source: SpatialBody | null,
  target: SpatialBody | null, walls: readonly SpatialObstacleShape[] | null | undefined): WallPathEvaluation {
  const unknown: WallPathEvaluation = { result: 'unknown', reason: 'unavailable' };
  if (scene.mode !== 'grid-2d' || !source?.position || !target?.position || !walls) return unknown;
  const from = occupiedSpaceOf(source.position, source.size), to = occupiedSpaceOf(target.position, target.size);
  if (!from || !to) return unknown;
  if (!spaceWithinScene(from, scene) || !spaceWithinScene(to, scene)) return unknown;
  if (source === target) return { result: 'pass', reason: 'clear' };
  if (walls.some(wall => (wall.blocksTargeting ?? wall.blocksMovement) &&
    (![wall.start.xFeet, wall.start.yFeet, wall.end.xFeet, wall.end.yFeet].every(Number.isFinite) ||
      Math.hypot(wall.end.xFeet - wall.start.xFeet, wall.end.yFeet - wall.start.yFeet) <= EPSILON))) return unknown;

  const a = corners(from), b = corners(to), corridor = hull([...a, ...b]);
  let partial = false;
  for (const line of mergeTargetingWalls(walls)) {
    if (!intersectsCorridor(line, corridor)) continue;
    partial = true;
    const sidesA = a.map(point => side(point, line)), sidesB = b.map(point => side(point, line));
    // Footprint encostado/atravessado por parede fica para o Mestre nesta etapa.
    const separated = (sidesA.every(value => value > EPSILON) && sidesB.every(value => value < -EPSILON)) ||
      (sidesA.every(value => value < -EPSILON) && sidesB.every(value => value > EPSILON));
    if (!separated) continue;
    const length = Math.hypot(line.end.xFeet - line.start.xFeet, line.end.yFeet - line.start.yFeet);
    const dx = (line.end.xFeet - line.start.xFeet) / length, dy = (line.end.yFeet - line.start.yFeet) / length;
    const project = (point: Point) => (point.xFeet - line.start.xFeet) * dx + (point.yFeet - line.start.yFeet) * dy;
    const intersections: number[] = [];
    for (let i = 0; i < corridor.length; i++) {
      const start = corridor[i]!, end = corridor[(i + 1) % corridor.length]!;
      const sa = side(start, line), sb = side(end, line);
      if (Math.abs(sa) <= EPSILON) intersections.push(project(start));
      if ((sa > EPSILON && sb < -EPSILON) || (sa < -EPSILON && sb > EPSILON)) {
        const ratio = sa / (sa - sb);
        intersections.push(project({ xFeet: start.xFeet + ratio * (end.xFeet - start.xFeet),
          yFeet: start.yFeet + ratio * (end.yFeet - start.yFeet) }));
      }
    }
    if (intersections.length >= 2 && Math.min(...intersections) >= -EPSILON &&
      Math.max(...intersections) <= length + EPSILON) return { result: 'fail', reason: 'wall' };
  }
  return partial ? { result: 'unknown', reason: 'partial-or-corner' } : { result: 'pass', reason: 'clear' };
}
