import { occupiedSpaceOf, occupiedSpacesOverlap } from './occupied-space.js';
import {
  GRID_CELL_SIZE_FEET,
  type OccupiedSpace,
  type SpatialPosition2D,
  type SpatialSceneConfig,
  type SpatialSize,
} from './spatial.types.js';

/**
 * FASE 6.6L.2 — DISTÂNCIA ESPACIAL (D&D 5e PHB 2014, grid 5 pés).
 *
 * Esta é a PRIMEIRA resposta autoritativa de "quanto A está longe de B" do
 * projeto. Ela é PURA (sem banco, sem HTTP, sem nome de magia/arma) para poder
 * ser consumida por ataques, magias, leitura de UI e pelas fases futuras
 * (movimento, Opportunity Attack, AoE) sem reimplementar a conta.
 *
 * DECISÕES MECÂNICAS (aprovadas pelo responsável do projeto):
 *
 *  • PHB 2014 "Playing on a Grid": cada quadrado = 5 pés e a distância de um
 *    quadrado para outro é `max(|dx|, |dy|)` — horizontal 5, vertical 5 e
 *    diagonal adjacente também 5. NUNCA distância euclidiana (`sqrt`).
 *  • A distância é entre ESPAÇOS OCUPADOS, nunca centro→centro e nunca
 *    top-left→top-left ignorando o tamanho: usa-se o quadrado ocupado mais
 *    PRÓXIMO de cada footprint.
 *  • Small+ tem âncora alinhada a 5 pés; TINY preserva 2,5 × 2,5 pés e pode
 *    produzir distâncias em incrementos de 2,5 pés (adjudicação explícita do
 *    projeto para a lacuna da regra de grid no caso Minúsculo). Tiny NÃO vira
 *    Small/1 quadrado.
 *
 * INALTERADO aqui: movimento/pathfinding/colisão (6.6L.3), linha de visão,
 * cobertura geométrica, membership de área e regras de proximidade de Prone.
 */

/** Identidade auditável do algoritmo no snapshot (mudar a regra muda isto). */
export const SPATIAL_DISTANCE_ALGORITHM = 'phb-grid-footprint-v1';

/** Incremento de 2,5 pés do caso Tiny — deliberado e documentado. */
export const TINY_GRID_STEP_FEET = 2.5;

/** Motivos de NÃO ter distância (nunca um número inventado). */
export type SpatialDistanceReason =
  | 'assisted-mode'
  | 'source-unplaced'
  | 'target-unplaced'
  | 'source-not-canonical'
  | 'target-not-canonical'
  | 'source-not-in-combat'
  | 'target-not-in-combat';

/**
 * Resultado discriminado da distância.
 *
 * `not-assessed` (combate assistido) é diferente de `unknown` (falta um fato
 * espacial numa cena grid-2d): nenhum dos dois é 0 pé, `Infinity` ou falha.
 */
export type SpatialDistanceEvaluation =
  | {
      status: 'known';
      distanceFeet: number;
      provenance: 'grid-2d';
      algorithm: typeof SPATIAL_DISTANCE_ALGORITHM;
    }
  | { status: 'unknown'; reason: SpatialDistanceReason }
  | { status: 'not-assessed'; reason: SpatialDistanceReason };

/** Passo de alinhamento canônico do placement por tamanho. */
export function alignmentStepFeet(size: SpatialSize): number {
  return size === 'tiny' ? TINY_GRID_STEP_FEET : GRID_CELL_SIZE_FEET;
}

/** Arredonda ruído de ponto flutuante sem mudar a escala. */
function precise(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A posição está alinhada à malha SUPORTADA para este tamanho?
 *
 * Small+ → múltiplos de 5 pés. Tiny → múltiplos de 2,5 pés. Um estado LEGADO
 * fora da malha não é arredondado silenciosamente: ele apenas deixa de ser
 * fonte de distância (`source|target-not-canonical`).
 */
export function isGridAligned(position: SpatialPosition2D, size: SpatialSize): boolean {
  const step = alignmentStepFeet(size);
  const aligned = (value: number) => {
    const remainder = Math.abs(value / step - Math.round(value / step));
    return remainder < 1e-9;
  };
  return aligned(position.xFeet) && aligned(position.yFeet);
}

/**
 * Âncoras lógicas dos quadrados ocupados (origem de cada quadrado na malha).
 *
 * Medium (0,0) → [(0,0)]; Large → 4 âncoras (2×2); Huge → 9 (3×3);
 * Gargantuan baseline → 16 (4×4). Tiny → UMA âncora na própria posição real,
 * porque seu footprint não é composto por quadrados de 5 pés.
 */
export function squareAnchorsOf(
  space: OccupiedSpace,
  size: SpatialSize,
): SpatialPosition2D[] {
  if (size === 'tiny') {
    return [{ xFeet: space.minXFeet, yFeet: space.minYFeet }];
  }
  const columns = Math.max(1, Math.round(space.widthFeet / GRID_CELL_SIZE_FEET));
  const rows = Math.max(1, Math.round(space.heightFeet / GRID_CELL_SIZE_FEET));
  const anchors: SpatialPosition2D[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      anchors.push({
        xFeet: space.minXFeet + column * GRID_CELL_SIZE_FEET,
        yFeet: space.minYFeet + row * GRID_CELL_SIZE_FEET,
      });
    }
  }
  return anchors;
}

/** Distância PHB-grid entre DUAS âncoras: `max(|dx|, |dy|)` (nunca euclidiana). */
export function anchorDistanceFeet(a: SpatialPosition2D, b: SpatialPosition2D): number {
  return precise(Math.max(Math.abs(a.xFeet - b.xFeet), Math.abs(a.yFeet - b.yFeet)));
}

export interface SpatialBody {
  position: SpatialPosition2D | null | undefined;
  size: SpatialSize;
}

/**
 * Distância entre dois corpos espaciais (posição + tamanho).
 *
 *  • overlap REAL dos retângulos → 0 pés (tocar a borda NÃO é overlap);
 *  • caso contrário, a MENOR distância entre um quadrado ocupado de A e um de B;
 *  • `null` quando algum corpo não está colocado.
 *
 * A função é simétrica por construção (o mínimo entre pares de âncoras não
 * depende da ordem).
 */
export function bodyDistanceFeet(a: SpatialBody, b: SpatialBody): number | null {
  const spaceA = occupiedSpaceOf(a.position, a.size);
  const spaceB = occupiedSpaceOf(b.position, b.size);
  if (!spaceA || !spaceB) return null;
  if (occupiedSpacesOverlap(spaceA, spaceB)) return 0;

  const anchorsA = squareAnchorsOf(spaceA, a.size);
  const anchorsB = squareAnchorsOf(spaceB, b.size);
  let best = Number.POSITIVE_INFINITY;
  for (const anchorA of anchorsA) {
    for (const anchorB of anchorsB) {
      const distance = anchorDistanceFeet(anchorA, anchorB);
      if (distance < best) best = distance;
    }
  }
  return precise(best);
}

/**
 * Avaliação completa: modo da cena, colocação e alinhamento canônico entram
 * ANTES de qualquer número. Dado inválido/legado NUNCA é arredondado para a
 * malha — vira `unknown` com motivo auditável (o Mestre reposiciona).
 */
export function evaluateSpatialDistance(
  scene: SpatialSceneConfig,
  source: SpatialBody,
  target: SpatialBody,
): SpatialDistanceEvaluation {
  if (scene.mode !== 'grid-2d') {
    return { status: 'not-assessed', reason: 'assisted-mode' };
  }
  if (!source.position) return { status: 'unknown', reason: 'source-unplaced' };
  if (!target.position) return { status: 'unknown', reason: 'target-unplaced' };
  if (!isGridAligned(source.position, source.size)) {
    return { status: 'unknown', reason: 'source-not-canonical' };
  }
  if (!isGridAligned(target.position, target.size)) {
    return { status: 'unknown', reason: 'target-not-canonical' };
  }
  const distanceFeet = bodyDistanceFeet(source, target);
  if (distanceFeet === null) return { status: 'unknown', reason: 'source-unplaced' };
  return {
    status: 'known',
    distanceFeet,
    provenance: 'grid-2d',
    algorithm: SPATIAL_DISTANCE_ALGORITHM,
  };
}

/** Forma SANITIZADA para snapshot/DTO: nunca coordenadas, nunca `Infinity`. */
export function spatialDistanceSnapshot(evaluation: SpatialDistanceEvaluation): {
  status: SpatialDistanceEvaluation['status'];
  distanceFeet: number | null;
  provenance: 'grid-2d' | null;
  algorithm: string | null;
  reason: string | null;
} {
  if (evaluation.status !== 'known') {
    return {
      status: evaluation.status,
      distanceFeet: null,
      provenance: null,
      algorithm: null,
      reason: evaluation.reason,
    };
  }
  return {
    status: 'known',
    distanceFeet: evaluation.distanceFeet,
    provenance: evaluation.provenance,
    algorithm: evaluation.algorithm,
    reason: null,
  };
}
