import { areaUnknownDecisionSchema } from '../../spells/execution/spell-cast.schema.js';
import { z } from 'zod';
import {
  areaShapeSchema,
  type AreaShapeDefinition,
} from '../../spells/execution/area-targeting.js';
import { occupiedSpaceOf } from './occupied-space.js';
import type { SpatialBody } from './spatial-distance.js';
import type { SpatialSceneConfig } from './spatial.types.js';

const coordinate = z.number().finite().min(-100_000).max(100_000);
/** Intenção livre do Mestre para consulta; execuções usam dimensões do cadastro. */
export const gridAreaQuerySchema = z
  .object({
    casterCombatantId: z.string().min(1).optional(),
    decisions: z.array(areaUnknownDecisionSchema).max(1000).optional(),
    shape: areaShapeSchema,
    origin: z
      .object({
        xFeet: coordinate,
        yFeet: coordinate,
        elevationFeet: coordinate.optional(),
      })
      .strict(),
    angle: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2)
      .default(0),
    /** Compatibilidade de payloads anteriores; a convenção de elevação ignora este campo. */
    lineHeightFeet: z.number().finite().positive().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = (value.decisions ?? []).map((item) => item.targetKey);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Decisão repetida para o mesmo alvo.',
      });
  });
export type GridAreaQuery = z.infer<typeof gridAreaQuerySchema>;
export type AreaMembership = {
  result: 'pass' | 'fail' | 'unknown';
  reason: string | null;
};
type Point = { x: number; y: number };
const EPS = 1e-8;
function clip(poly: Point[], value: (p: Point) => number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      va = value(a),
      vb = value(b);
    if (va >= -EPS) out.push(a);
    if ((va > EPS && vb < -EPS) || (va < -EPS && vb > EPS)) {
      const ratio = va / (va - vb);
      out.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
    }
  }
  return out;
}
function area(poly: Point[]) {
  return (
    Math.abs(
      poly.reduce((sum, p, i) => {
        const q = poly[(i + 1) % poly.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}
function polygonFor(shape: AreaShapeDefinition, points: Point[]): Point[] {
  if (shape.kind === 'sphere' || shape.kind === 'cylinder') return points;
  const length = shape.kind === 'cube' ? shape.sizeFeet : shape.lengthFeet;
  let poly = clip(
    clip(points, (p) => p.x),
    (p) => length - p.x,
  );
  if (shape.kind === 'cone')
    return clip(
      clip(poly, (p) => p.x / 2 - p.y),
      (p) => p.x / 2 + p.y,
    );
  const half = (shape.kind === 'cube' ? shape.sizeFeet : shape.widthFeet) / 2;
  return clip(
    clip(poly, (p) => half - p.y),
    (p) => half + p.y,
  );
}
/** Sobreposição horizontal dos footprints; a elevação é decidida separadamente. */
export function areaMembership(
  query: GridAreaQuery,
  scene: SpatialSceneConfig,
  body: SpatialBody | null,
): AreaMembership {
  const answer = (
    result: AreaMembership['result'],
    reason: string | null = null,
  ): AreaMembership => ({ result, reason: result === 'pass' ? null : reason });
  if (scene.mode !== 'grid-2d') return answer('unknown', 'assisted-mode');
  const footprint = body && occupiedSpaceOf(body.position, body.size);
  if (!footprint) return answer('unknown', 'target-unplaced');
  const { shape, origin } = query;
  const closestX = Math.max(
    footprint.minXFeet,
    Math.min(origin.xFeet, footprint.maxXFeet),
  );
  const closestY = Math.max(
    footprint.minYFeet,
    Math.min(origin.yFeet, footprint.maxYFeet),
  );
  const planarDistance =
    (closestX - origin.xFeet) ** 2 + (closestY - origin.yFeet) ** 2;
  const c = Math.cos(query.angle),
    s = Math.sin(query.angle);
  const points = [
    { x: footprint.minXFeet, y: footprint.minYFeet },
    { x: footprint.maxXFeet, y: footprint.minYFeet },
    { x: footprint.maxXFeet, y: footprint.maxYFeet },
    { x: footprint.minXFeet, y: footprint.maxYFeet },
  ].map((p) => ({
    x: (p.x - origin.xFeet) * c + (p.y - origin.yFeet) * s,
    y: -(p.x - origin.xFeet) * s + (p.y - origin.yFeet) * c,
  }));
  const polygon = polygonFor(shape, points);
  if (shape.kind === 'sphere' || shape.kind === 'cylinder') {
    if (planarDistance >= shape.radiusFeet ** 2 - EPS)
      return answer('fail', 'outside-area');
  } else if (polygon.length < 3 || area(polygon) <= EPS)
    return answer('fail', 'outside-area');
  return answer('pass');
}
