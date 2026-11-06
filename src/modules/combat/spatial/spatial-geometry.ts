import type { OccupiedSpace, SpatialPosition2D } from './spatial.types.js';

/**
 * FASE 6.6L.4.1 — GEOMETRIA PURA DE SEGMENTOS (paredes/obstáculos lineares).
 *
 * O PHB 2014 estabelece que superfícies sólidas impedem passagem e podem
 * impedir visão, mas NÃO define representação computacional de parede,
 * algoritmo de interseção, espessura virtual nem snapping. Tudo abaixo é
 * ADJUDICAÇÃO DO PROJETO para VTT: segmento 2D de espessura geométrica ZERO,
 * com endpoints em PÉS.
 *
 * Regras desta camada:
 *  • PURA: sem Prisma, sem HTTP, sem React, sem pixels/câmera/zoom;
 *  • uma ÚNICA política de tolerância numérica (`SPATIAL_GEOMETRY_EPSILON_FEET`),
 *    em PÉS — nada de `===` frágil espalhado pelo domínio;
 *  • a classificação NÃO colapsa em boolean: `cross` (interiores se cruzam),
 *    `touch` (encostam em endpoint), `overlap` (colineares sobrepostos) e
 *    `none`. Movimento, LoS, cantos e Cover vão precisar dessa diferença;
 *  • diagonais são segmentos válidos como qualquer outro.
 *
 * NÃO implementado aqui (fases futuras): interseção de footprint arrastado,
 * corner rules, clipping, cobertura, pathfinding.
 */

/**
 * Tolerância única, em PÉS.
 *
 * 1e-6 pé (≈ 0,3 micrômetro) é MUITO menor que a menor unidade mecânica do
 * projeto (2,5 pés do Tiny), e bem maior que o ruído de `Math.hypot` em
 * coordenadas de cena (≤ 100.000 pés). Comparações de igualdade geométrica
 * usam ESTA constante, nunca `===`.
 */
export const SPATIAL_GEOMETRY_EPSILON_FEET = 1e-6;

/** Segmento 2D em pés (espessura zero). Uma parede é exatamente isto. */
export interface Segment2D {
  start: SpatialPosition2D;
  end: SpatialPosition2D;
}

/** Resultados possíveis de uma interseção entre dois segmentos. */
export const SEGMENT_INTERSECTIONS = ['none', 'cross', 'touch', 'overlap'] as const;
export type SegmentIntersection = (typeof SEGMENT_INTERSECTIONS)[number];

interface Vector2D {
  dx: number;
  dy: number;
}

const EPSILON = SPATIAL_GEOMETRY_EPSILON_FEET;

function vectorOf(segment: Segment2D): Vector2D {
  return {
    dx: segment.end.xFeet - segment.start.xFeet,
    dy: segment.end.yFeet - segment.start.yFeet,
  };
}

/** Produto vetorial 2D (positivo à esquerda, negativo à direita). */
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Comprimento Euclidiano em PÉS (2,5 pés é um valor válido, não arredondado). */
export function segmentLengthFeet(segment: Segment2D): number {
  const { dx, dy } = vectorOf(segment);
  return Math.hypot(dx, dy);
}

/** Segmento de comprimento zero (início = fim) — recusado no cadastro. */
export function isDegenerateSegment(segment: Segment2D): boolean {
  return segmentLengthFeet(segment) <= EPSILON;
}

/**
 * O ponto está SOBRE o segmento (inclusive nos endpoints)?
 *
 * Usado como base do caso degenerado: um segmento de comprimento zero é um
 * PONTO e só pode "encostar" no outro segmento, nunca cruzá-lo.
 */
export function pointOnSegment(point: SpatialPosition2D, segment: Segment2D): boolean {
  const { dx, dy } = vectorOf(segment);
  const length = Math.hypot(dx, dy);
  const offsetX = point.xFeet - segment.start.xFeet;
  const offsetY = point.yFeet - segment.start.yFeet;
  if (length <= EPSILON) {
    return Math.hypot(offsetX, offsetY) <= EPSILON;
  }
  // Distância perpendicular do ponto à RETA do segmento.
  if (Math.abs(cross(offsetX, offsetY, dx, dy)) / length > EPSILON) return false;
  // Projeção escalar precisa cair dentro do intervalo [0, comprimento].
  const projectionFeet = (offsetX * dx + offsetY * dy) / length;
  return projectionFeet >= -EPSILON && projectionFeet <= length + EPSILON;
}

/**
 * Classificação COMPLETA de duas retas finitas em pés.
 *
 *  • `none`    — nenhum ponto em comum;
 *  • `cross`   — os INTERIORES dos dois segmentos se cruzam num ponto (vale
 *                para ortogonal, diagonal e qualquer ângulo);
 *  • `touch`   — existe ponto em comum, mas ele é endpoint de pelo menos um
 *                dos segmentos (junção em "T", canto, endpoint compartilhado);
 *  • `overlap` — colineares com trecho comum de comprimento > epsilon.
 *
 * A função é SIMÉTRICA por construção (`classify(a, b) === classify(b, a)`):
 * no caso colinear o intervalo é medido em pés e no caso geral os parâmetros
 * `t`/`u` têm papéis equivalentes.
 */
export function classifySegmentIntersection(
  first: Segment2D,
  second: Segment2D,
): SegmentIntersection {
  const r = vectorOf(first);
  const s = vectorOf(second);
  const lengthA = Math.hypot(r.dx, r.dy);
  const lengthB = Math.hypot(s.dx, s.dy);

  // Segmento degenerado = PONTO (nunca `cross`, no máximo `touch`).
  if (lengthA <= EPSILON) return pointOnSegment(first.start, second) ? 'touch' : 'none';
  if (lengthB <= EPSILON) return pointOnSegment(second.start, first) ? 'touch' : 'none';

  const offset = {
    dx: second.start.xFeet - first.start.xFeet,
    dy: second.start.yFeet - first.start.yFeet,
  };
  const secondEndOffset = {
    dx: second.end.xFeet - first.start.xFeet,
    dy: second.end.yFeet - first.start.yFeet,
  };
  const collinear =
    Math.abs(cross(offset.dx, offset.dy, r.dx, r.dy)) / lengthA <= EPSILON &&
    Math.abs(cross(secondEndOffset.dx, secondEndOffset.dy, r.dx, r.dy)) / lengthA <= EPSILON;

  if (collinear) {
    // Projeção de cada endpoint do segundo sobre o PRIMEIRO (parâmetro 0..1).
    const projectionOf = (point: SpatialPosition2D) =>
      ((point.xFeet - first.start.xFeet) * r.dx + (point.yFeet - first.start.yFeet) * r.dy) /
      (lengthA * lengthA);
    const startT = projectionOf(second.start);
    const endT = projectionOf(second.end);
    const low = Math.max(0, Math.min(startT, endT));
    const high = Math.min(1, Math.max(startT, endT));
    const overlapFeet = (high - low) * lengthA;
    if (overlapFeet > EPSILON) return 'overlap';
    // Trecho de comprimento zero = um único ponto em comum.
    if (overlapFeet >= -EPSILON) return 'touch';
    return 'none';
  }

  const denominator = cross(r.dx, r.dy, s.dx, s.dy);
  // Paralelos NÃO colineares: nunca se encontram (ruído de seno do ângulo).
  if (Math.abs(denominator) <= EPSILON * lengthA * lengthB) return 'none';

  const t = cross(offset.dx, offset.dy, s.dx, s.dy) / denominator;
  const u = cross(offset.dx, offset.dy, r.dx, r.dy) / denominator;
  // Tolerância de PARÂMETRO derivada da mesma política em pés.
  const toleranceT = EPSILON / lengthA;
  const toleranceU = EPSILON / lengthB;
  if (t < -toleranceT || t > 1 + toleranceT || u < -toleranceU || u > 1 + toleranceU) {
    return 'none';
  }
  const interiorT = t > toleranceT && t < 1 - toleranceT;
  const interiorU = u > toleranceU && u < 1 - toleranceU;
  return interiorT && interiorU ? 'cross' : 'touch';
}

/** Atalho booleano — para quando a DIFERENÇA entre cross/touch/overlap não importa. */
export function segmentsIntersect(first: Segment2D, second: Segment2D): boolean {
  return classifySegmentIntersection(first, second) !== 'none';
}

/**
 * Representação CANÔNICA: endpoints ordenados por (x, y).
 *
 * `canonicalSegment(a→b)` é idêntico a `canonicalSegment(b→a)`, então a mesma
 * parede gravada em qualquer direção continua sendo o MESMO segmento para
 * comparação, snapshot, log e idempotência.
 */
export function canonicalSegment(segment: Segment2D): Segment2D {
  const { start, end } = segment;
  const startFirst =
    start.xFeet < end.xFeet || (start.xFeet === end.xFeet && start.yFeet <= end.yFeet);
  return startFirst
    ? { start: { xFeet: start.xFeet, yFeet: start.yFeet }, end: { xFeet: end.xFeet, yFeet: end.yFeet } }
    : { start: { xFeet: end.xFeet, yFeet: end.yFeet }, end: { xFeet: start.xFeet, yFeet: start.yFeet } };
}

/** Mesma geometria, independentemente da ordem dos endpoints. */
export function segmentsEquivalent(first: Segment2D, second: Segment2D): boolean {
  const a = canonicalSegment(first);
  const b = canonicalSegment(second);
  return (
    a.start.xFeet === b.start.xFeet &&
    a.start.yFeet === b.start.yFeet &&
    a.end.xFeet === b.end.xFeet &&
    a.end.yFeet === b.end.yFeet
  );
}

/**
 * O segmento atravessa/toca/está dentro do ESPAÇO OCUPADO de uma criatura?
 *
 * Existe para a futura colisão de FOOTPRINT (Large+ ocupa várias células: o
 * centro do token NÃO representa a criatura). NENHUM motor consome isto nesta
 * fase — é o primitive que a integração de movimento/LoS vai usar.
 */
export function segmentCrossesSpace(segment: Segment2D, space: OccupiedSpace): boolean {
  const inside = (point: SpatialPosition2D) =>
    point.xFeet >= space.minXFeet &&
    point.xFeet <= space.maxXFeet &&
    point.yFeet >= space.minYFeet &&
    point.yFeet <= space.maxYFeet;
  if (inside(segment.start) || inside(segment.end)) return true;
  const top: Segment2D = {
    start: { xFeet: space.minXFeet, yFeet: space.minYFeet },
    end: { xFeet: space.maxXFeet, yFeet: space.minYFeet },
  };
  const right: Segment2D = {
    start: { xFeet: space.maxXFeet, yFeet: space.minYFeet },
    end: { xFeet: space.maxXFeet, yFeet: space.maxYFeet },
  };
  const bottom: Segment2D = {
    start: { xFeet: space.minXFeet, yFeet: space.maxYFeet },
    end: { xFeet: space.maxXFeet, yFeet: space.maxYFeet },
  };
  const left: Segment2D = {
    start: { xFeet: space.minXFeet, yFeet: space.minYFeet },
    end: { xFeet: space.minXFeet, yFeet: space.maxYFeet },
  };
  return [top, right, bottom, left].some((edge) => segmentsIntersect(segment, edge));
}
