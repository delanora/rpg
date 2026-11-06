import {
  classifySegmentIntersection,
  segmentLengthFeet,
  SPATIAL_GEOMETRY_EPSILON_FEET,
  type Segment2D,
} from './spatial-geometry.js';
import type { SpatialPosition2D, SpatialSceneConfig } from './spatial.types.js';

/**
 * FASE 6.6L.4.1 — OBSTÁCULOS ESPACIAIS (paredes).
 *
 * PRIMITIVE da cena: um segmento 2D de espessura zero, com endpoints em PÉS e
 * DUAS flags INDEPENDENTES:
 *
 *  • `blocksMovement` — superfície sólida (parede, barreira invisível);
 *  • `blocksSight`    — obstrui a visão (parede, cortina estrutural futura).
 *
 * Não existe `kind` além de `wall` nesta fase: portas, janelas, paredes
 * secretas e one-way walls ficam para depois, reutilizando ESTA fundação.
 *
 * Este módulo é o DTO/forma do domínio. A matemática de segmento mora em
 * `spatial-geometry.ts` (pura) e a escrita em `spatial-obstacle.service.ts`
 * (Prisma/HTTP) — nada de geometria espalhada em controller/componente.
 */

/** Códigos canônicos do primitive (nunca rótulos traduzidos). */
export const SPATIAL_OBSTACLE_KINDS = ['wall'] as const;
export type SpatialObstacleKind = (typeof SPATIAL_OBSTACLE_KINDS)[number];

/**
 * Forma PERSISTIDA que o domínio precisa (estrutural, sem importar o Prisma
 * Client): `SpatialObstacle` da tabela `spatial_obstacles`.
 */
export interface SpatialObstacleSource {
  id: string;
  kind: string;
  startXFeet: number;
  startYFeet: number;
  endXFeet: number;
  endYFeet: number;
  blocksMovement: boolean;
  blocksSight: boolean;
}

/**
 * PROJEÇÃO pública de uma parede.
 *
 * Só o necessário para desenhar/consultar a cena: identidade, endpoints em pés,
 * flags e comprimento derivado. Nada de pixels, câmera, autor ou timestamps de
 * auditoria — se um dia existirem paredes secretas, isso será decidido em outro
 * lugar (hoje TODA parede é normal/visível).
 */
export interface SpatialObstacleDto {
  id: string;
  kind: SpatialObstacleKind;
  start: SpatialPosition2D;
  end: SpatialPosition2D;
  lengthFeet: number;
  blocksMovement: boolean;
  blocksSight: boolean;
}

/** Entrada já validada de uma parede (o que o serviço grava/valida). */
export interface SpatialObstacleShape {
  start: SpatialPosition2D;
  end: SpatialPosition2D;
  blocksMovement: boolean;
  blocksSight: boolean;
}

/** Arredonda ruído de ponto flutuante sem mudar a escala (2,5 pés estável). */
function precise(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Segmento geométrico da linha persistida. */
export function obstacleSegmentOf(source: SpatialObstacleSource): Segment2D {
  return {
    start: { xFeet: source.startXFeet, yFeet: source.startYFeet },
    end: { xFeet: source.endXFeet, yFeet: source.endYFeet },
  };
}

/** Linha persistida → DTO público. `kind` desconhecido cai em `wall` (leitura). */
export function obstacleDtoOf(source: SpatialObstacleSource): SpatialObstacleDto {
  const segment = obstacleSegmentOf(source);
  return {
    id: source.id,
    kind: (SPATIAL_OBSTACLE_KINDS as readonly string[]).includes(source.kind)
      ? (source.kind as SpatialObstacleKind)
      : 'wall',
    start: segment.start,
    end: segment.end,
    lengthFeet: precise(segmentLengthFeet(segment)),
    blocksMovement: source.blocksMovement,
    blocksSight: source.blocksSight,
  };
}

/**
 * Os DOIS endpoints cabem na cena? Bordas EXATAS são válidas (uma parede no
 * limite x = largura continua dentro da cena). O segmento pode ser diagonal.
 */
export function obstacleWithinScene(segment: Segment2D, scene: SpatialSceneConfig): boolean {
  const inside = (point: SpatialPosition2D) =>
    point.xFeet >= 0 &&
    point.xFeet <= scene.widthFeet &&
    point.yFeet >= 0 &&
    point.yFeet <= scene.heightFeet;
  return inside(segment.start) && inside(segment.end);
}

/**
 * PROVIDER geométrico para o MOVIMENTO futuro.
 *
 * Responde "este trecho retilíneo atravessa alguma parede sólida?" usando a
 * classificação de segmentos (cross/touch/overlap contam: encostar já bloqueia).
 * Trecho de comprimento zero nunca é bloqueado — não houve deslocamento.
 *
 * DELIBERADAMENTE NÃO INTEGRADO ao Movement Engine nesta fase: a colisão por
 * footprint arrastado (Large/Huge ocupam várias células, com regras de canto)
 * ainda não tem semântica fechada. Bloquear pelo centro do token seria pior do
 * que não bloquear — ver o relatório da 6.6L.4.1.
 */
export function movementSegmentBlocked(
  from: SpatialPosition2D,
  to: SpatialPosition2D,
  obstacles: readonly SpatialObstacleSource[],
): boolean {
  return segmentBlockedByFlag(from, to, obstacles, 'blocksMovement');
}

/**
 * PROVIDER geométrico para linha de visão futura (mesma mecânica, flag
 * `blocksSight`). Também NÃO integrado: LoS completa pertence a outra fase.
 */
export function sightSegmentBlocked(
  from: SpatialPosition2D,
  to: SpatialPosition2D,
  obstacles: readonly SpatialObstacleSource[],
): boolean {
  return segmentBlockedByFlag(from, to, obstacles, 'blocksSight');
}

function segmentBlockedByFlag(
  from: SpatialPosition2D,
  to: SpatialPosition2D,
  obstacles: readonly SpatialObstacleSource[],
  flag: 'blocksMovement' | 'blocksSight',
): boolean {
  const segment: Segment2D = { start: from, end: to };
  if (segmentLengthFeet(segment) <= SPATIAL_GEOMETRY_EPSILON_FEET) return false;
  return obstacles.some(
    (obstacle) =>
      obstacle[flag] && classifySegmentIntersection(segment, obstacleSegmentOf(obstacle)) !== 'none',
  );
}
