import type { SpatialPosition, SpatialSize } from '../../types';
import { SIZE_FOOTPRINT_FEET, snapFeet, snapStepFeet } from './gridMath';

/**
 * FASE 6.6M.3 — CONSTRUÇÃO VISUAL DO TRAJETO (sem regra de jogo).
 *
 * O React NÃO é o Movement Engine. Este arquivo só reconstrói, a partir do
 * gesto, a sequência de ÂNCORAS pretendidas (posições em pés no contrato da
 * 6.6L.3). Nada aqui calcula distância, custo, difficult terrain, crawling,
 * ocupação, saldo ou risco de Reação — quem decide é o servidor.
 *
 * O preenchimento entre duas amostras do ponteiro é RASTERIZAÇÃO DE GRID
 * determinística (interpolação linear alinhada ao passo): serve apenas para
 * reconstruir as células atravessadas pelo gesto. Não existe A*, Dijkstra,
 * rota alternativa, desvio de criatura nem "menor caminho".
 */

/** Passo do anchor: 2,5 pés (Tiny) ou 5 pés (Small+). Apenas input visual. */
export function anchorStepFeet(size: SpatialSize): number {
  return snapStepFeet(size);
}

export interface PointerAnchorInput {
  /** Coordenada do ponteiro em pés, JÁ descontado o ponto de pega. */
  xFeet: number;
  yFeet: number;
  size: SpatialSize;
  scene: { widthFeet: number; heightFeet: number };
}

/**
 * Ponteiro (pés) → ÂNCORA alinhada ao passo do tamanho.
 *
 * A âncora é o canto mínimo do footprint (convenção da 6.6L.1), não o centro
 * visual do token. O limite da cena considera o footprint só para o desenho —
 * legalidade de destino continua sendo do servidor.
 */
export function pointerAnchor({ xFeet, yFeet, size, scene }: PointerAnchorInput): SpatialPosition {
  const footprint = SIZE_FOOTPRINT_FEET[size];
  const step = anchorStepFeet(size);
  return {
    xFeet: clampAxis(snapFeet(xFeet, size), step, scene.widthFeet, footprint.widthFeet),
    yFeet: clampAxis(snapFeet(yFeet, size), step, scene.heightFeet, footprint.heightFeet),
  };
}

function clampAxis(value: number, step: number, sceneFeet: number, footprintFeet: number): number {
  const max = Math.max(0, Math.round((sceneFeet - footprintFeet) / step) * step);
  return Math.min(Math.max(0, value), max);
}

function roundStep(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/**
 * Âncoras intermediárias entre dois anchors ao longo do SEGMENTO DIRETO.
 *
 * Rasterização de grid: `max(|dx|,|dy|) / passo` amostras, cada uma alinhada ao
 * passo. Não consulta obstáculos e não escolhe rota — se o caminho direto
 * atravessa uma criatura, é o SERVIDOR quem recusa.
 */
export function interpolateAnchors(
  from: SpatialPosition,
  to: SpatialPosition,
  step: number,
): SpatialPosition[] {
  const dx = to.xFeet - from.xFeet;
  const dy = to.yFeet - from.yFeet;
  const steps = Math.max(
    Math.abs(Math.round(dx / step)),
    Math.abs(Math.round(dy / step)),
  );
  if (steps <= 1) return [{ xFeet: to.xFeet, yFeet: to.yFeet }];
  const out: SpatialPosition[] = [];
  for (let index = 1; index <= steps; index += 1) {
    out.push({
      xFeet: roundStep(from.xFeet + (dx * index) / steps, step),
      yFeet: roundStep(from.yFeet + (dy * index) / steps, step),
    });
  }
  // O último anchor é EXATAMENTE o apontado (sem ruído de ponto flutuante).
  out[out.length - 1] = { xFeet: to.xFeet, yFeet: to.yFeet };
  return out;
}

/**
 * Acrescenta um anchor ao trajeto pretendido.
 *
 * • volta para um anchor já presente → TRUNCA o trajeto até ele (desfazer
 *   natural do gesto, sem "cobrar ida e volta");
 * • mesma posição do último → devolve o MESMO array (nenhum re-render);
 * • salto do ponteiro → preenche o segmento direto (contiguidade visual).
 */
export function appendAnchor(
  path: readonly SpatialPosition[],
  anchor: SpatialPosition,
  step: number,
): SpatialPosition[] {
  const last = path[path.length - 1] ?? null;
  if (last && last.xFeet === anchor.xFeet && last.yFeet === anchor.yFeet) {
    return path as SpatialPosition[];
  }
  const revisited = path.findIndex(
    (item) => item.xFeet === anchor.xFeet && item.yFeet === anchor.yFeet,
  );
  if (revisited >= 0) return path.slice(0, revisited + 1);
  const appended = last ? interpolateAnchors(last, anchor, step) : [{ xFeet: anchor.xFeet, yFeet: anchor.yFeet }];
  return [...path, ...appended];
}
