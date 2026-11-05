import type { SpatialDistanceReading, SpatialRangeReading } from '../../types';

/**
 * FASE 6.6M.2 — FORMATAÇÃO das leituras de distância/alcance.
 *
 * Este módulo é APRESENTAÇÃO PURA: recebe a resposta do servidor e devolve
 * texto em PT-BR. Não soma, não compara, não converte faixa. Um `2,5` do Tiny
 * continua `2,5` — arredondar para `5` seria inventar regra.
 */

const FEET = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** "0 pés" · "2,5 pés" · "60 pés" — sempre do valor do servidor. */
export function formatFeet(feet: number): string {
  return `${FEET.format(feet)} pés`;
}

/**
 * Motivo PÚBLICO do `unknown`. Nada de coordenada, distância ou nome de
 * entidade oculta: o servidor já sanitiza, e a UI só traduz o motivo.
 */
export function distanceReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'source-unplaced':
    case 'target-unplaced':
      return 'Fora do mapa';
    case 'source-not-canonical':
    case 'target-not-canonical':
      return 'Posição fora da grade';
    case 'source-not-in-combat':
    case 'target-not-in-combat':
      return 'Fora do combate';
    case 'assisted-mode':
      return 'Distância não avaliada';
    default:
      return 'Distância desconhecida';
  }
}

/**
 * Texto da distância. `known` mostra o número; `unknown`/`not-assessed` mostram
 * o motivo — NUNCA um `0` fabricado.
 */
export function distanceLabel(reading: SpatialDistanceReading | null): string {
  if (!reading) return 'Distância não avaliada';
  if (reading.status === 'known' && reading.distanceFeet !== null) {
    return formatFeet(reading.distanceFeet);
  }
  return distanceReasonLabel(reading.reason);
}

/**
 * Rótulo da faixa de alcance DECIDIDA pelo servidor. Long range mostra a
 * desvantagem porque ela também é regra do servidor — o cliente não a deduz.
 */
export function rangeStatusLabel(range: SpatialRangeReading): string {
  switch (range.status) {
    case 'in-range':
      return 'Dentro do alcance';
    case 'long-range':
      return 'Longo alcance — Desvantagem';
    case 'out-of-range':
      return 'Fora do alcance';
    default:
      return 'Alcance desconhecido';
  }
}

/** Faixa + distância conhecida (ex.: "Longo alcance — Desvantagem · 200 pés"). */
export function rangeSummary(range: SpatialRangeReading | null): string | null {
  if (!range) return null;
  const label = rangeStatusLabel(range);
  return range.distanceFeet === null ? label : `${label} · ${formatFeet(range.distanceFeet)}`;
}
