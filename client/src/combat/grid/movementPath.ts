import type { SpatialPosition, SpatialSize } from '../../types';
import type { Point2D } from './gridCamera';
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
 * determinística (passos contíguos alinhados): serve apenas para reconstruir as
 * células atravessadas pelo gesto. Não existe A*, Dijkstra, rota alternativa,
 * desvio de criatura nem "menor caminho".
 *
 * 6.6M.3.1.1 — A POSIÇÃO ATUAL É IMPLÍCITA: o servidor percorre o `path` a
 * partir da posição autoritativa do combatente (`cursor = mover.position`).
 * Por isso `path[0]` NUNCA repete a origem e cada passo seguinte avança no
 * máximo UM passo por eixo. Era essa a causa do preview "Distância 0 m / Custo
 * 0 m / trajeto inválido": o primeiro anchor do ponteiro entrava direto em
 * `path[0]`, caracterizando teleporte (`MOVEMENT_STEP_NOT_CONTIGUOUS`).
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

/** Coordenada canônica em pés, sem ruído de ponto flutuante (49.9999 → 50). */
function roundFeet(value: number): number {
  return Math.round(value * 100) / 100;
}

function samePosition(a: SpatialPosition, b: SpatialPosition): boolean {
  return a.xFeet === b.xFeet && a.yFeet === b.yFeet;
}

/**
 * Âncoras CONTÍGUAS entre dois anchors (passo por passo, no máximo 1 por eixo).
 *
 * Rasterização inteira: converte o deslocamento em unidades de passo e usa a
 * interpolação de Bresenham, que produz exatamente `max(|sx|,|sy|)` passos —
 * cada um avançando 0 ou 1 passo em cada eixo, nunca teleporte, nunca
 * duplicata e sempre terminando no anchor apontado. Não consulta obstáculos e
 * não escolhe rota: se o caminho direto atravessa uma criatura, é o SERVIDOR
 * quem recusa.
 */
export function contiguousAnchors(
  from: SpatialPosition,
  to: SpatialPosition,
  step: number,
): SpatialPosition[] {
  if (step <= 0) return [];
  const stepsX = Math.round((to.xFeet - from.xFeet) / step);
  const stepsY = Math.round((to.yFeet - from.yFeet) / step);
  const count = Math.max(Math.abs(stepsX), Math.abs(stepsY));
  const out: SpatialPosition[] = [];
  for (let index = 1; index <= count; index += 1) {
    out.push({
      xFeet: roundFeet(from.xFeet + Math.round((stepsX * index) / count) * step),
      yFeet: roundFeet(from.yFeet + Math.round((stepsY * index) / count) * step),
    });
  }
  return out;
}

/**
 * Acrescenta um anchor ao trajeto pretendido.
 *
 * • `start` é a posição AUTORITATIVA do combatente e NÃO entra no path: o
 *   primeiro anchor é preenchido a partir dela (contiguidade desde a origem);
 * • mesma posição do último → devolve o MESMO array (nenhum re-render);
 * • volta para um anchor já presente → TRUNCA o trajeto até ele (desfazer
 *   natural do gesto, sem "cobrar ida e volta"); voltar à origem zera o path;
 * • salto do ponteiro (fast pointer) → preenche o segmento com passos
 *   contíguos.
 */
export function appendAnchor(
  path: readonly SpatialPosition[],
  anchor: SpatialPosition,
  step: number,
  start: SpatialPosition,
): SpatialPosition[] {
  const last = path.length > 0 ? path[path.length - 1] : start;
  if (samePosition(last, anchor)) return path as SpatialPosition[];
  const revisited = path.findIndex((item) => samePosition(item, anchor));
  if (revisited >= 0) return path.slice(0, revisited + 1);
  // Voltou para a origem: o trajeto pendente deixa de existir.
  if (samePosition(start, anchor)) return [];
  return [...path, ...contiguousAnchors(last, anchor, step)];
}

/**
 * Meio do COMPRIMENTO da polyline (não a média dos endpoints): numa curva a
 * label fica sobre o traço. Geometria de TELA, sem significado mecânico.
 */
export function polylineMidpoint(points: readonly Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { x: points[0].x, y: points[0].y };
  let remaining = total / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const ratio = lengths[index] === 0 ? 0 : remaining / lengths[index];
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= lengths[index];
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}
