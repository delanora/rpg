import type { SpatialPosition, SpatialSize } from '../../types';
import type { Point2D } from './gridCamera';
import { snapStepFeet } from './gridMath';

/**
 * FASE 6.6M.3 — CONSTRUÇÃO DO TRAJETO (sem regra de jogo).
 *
 * O React NÃO é o Movement Engine. Este arquivo reconstrói, a partir de
 * ORIGEM + DESTINO, a sequência de ÂNCORAS que o servidor espera (contrato da
 * 6.6L.3). Nada aqui calcula distância, custo, difficult terrain, crawling,
 * ocupação, saldo ou risco de Reação — quem decide é o servidor.
 *
 * 6.6M.3.1.3 — DIRECIONADO A DESTINO: o trajeto NÃO é o rastro do mouse. O
 * ponteiro escolhe uma célula; o caminho canônico é sempre a rasterização
 * DIRETA de origem→destino. Isso torna o custo independente da habilidade de
 * desenhar com o mouse e faz o gesto direto e o Measure-to-Move usarem
 * exatamente a mesma geometria. Sem A*, sem desvio de obstáculo, sem rota
 * alternativa: se o caminho direto estiver bloqueado, o servidor recusa.
 */

/** Passo do anchor: 2,5 pés (Tiny) ou 5 pés (Small+). Apenas input visual. */
export function anchorStepFeet(size: SpatialSize): number {
  return snapStepFeet(size);
}

/** Coordenada canônica em pés, sem ruído de ponto flutuante (49.9999 → 50). */
function roundFeet(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Âncoras CONTÍGUAS entre dois anchors (passo por passo, no máximo 1 por eixo).
 *
 * Rasterização inteira: converte o deslocamento em unidades de passo e usa a
 * interpolação de Bresenham, que produz exatamente `max(|sx|,|sy|)` passos —
 * cada um avançando 0 ou 1 passo em cada eixo, nunca teleporte, nunca
 * duplicata e sempre terminando no anchor apontado. O resultado depende SÓ dos
 * dois extremos: o mesmo destino gera o mesmo path, qualquer que tenha sido o
 * caminho do ponteiro.
 *
 * A posição atual é IMPLÍCITA: o servidor percorre o `path` a partir de
 * `mover.position`, então a origem nunca aparece em `path[0]`.
 *
 * Diagonal é uma única etapa por eixo (decisão espacial herdada de 6.6L.2/3);
 * nada de distância euclidiana nem custo extra por diagonal.
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
