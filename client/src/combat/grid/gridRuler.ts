import type { SpatialDistanceReading, SpatialMeasureEndpoint } from '../../types';
import { distanceReasonLabel, formatMeters } from './distanceFormat';
import type { Point2D } from './gridCamera';

/**
 * FASE 6.6M.3.1 — RÉGUA (geometria e rótulo, tudo PURO).
 *
 * A régua NÃO mede: ela desenha entre dois extremos e exibe o valor que o
 * servidor devolveu em `POST /spatial/measure`. Aqui só existe geometria de
 * TELA (ponto médio, chave de endpoint) e o texto da label — nenhuma distância
 * é calculada no cliente.
 */
export type RulerRequestState = 'idle' | 'loading' | 'success' | 'error';

/** Meio do segmento — a label fica sempre aqui, na horizontal. */
export function rulerMidpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Identidade ESTÁVEL do extremo: ponto alinhado ou combatente. */
export function rulerEndpointKey(endpoint: SpatialMeasureEndpoint): string {
  return endpoint.kind === 'point'
    ? `point:${endpoint.position.xFeet}:${endpoint.position.yFeet}`
    : `combatant:${endpoint.combatantId}`;
}

/** Um extremo do mesmo tipo e valor do outro? (nunca medir contra si mesmo) */
export function rulerSameEndpoint(
  a: SpatialMeasureEndpoint | null,
  b: SpatialMeasureEndpoint | null,
): boolean {
  if (!a || !b) return false;
  return rulerEndpointKey(a) === rulerEndpointKey(b);
}

/**
 * Texto da label no MEIO da linha. `unknown`/`not-assessed` mostram o motivo
 * público — nunca um número velho ou fabricado.
 */
export function rulerLabelText(
  distance: SpatialDistanceReading | null,
  state: RulerRequestState,
): string {
  if (state === 'loading') return 'Calculando…';
  if (state === 'error') return '—';
  if (!distance) return '—';
  if (distance.status === 'known' && distance.distanceFeet !== null) {
    return formatMeters(distance.distanceFeet);
  }
  return distanceReasonLabel(distance.reason);
}
