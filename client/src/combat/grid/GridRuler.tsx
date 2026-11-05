import type { CSSProperties } from 'react';
import type { SpatialDistanceReading } from '../../types';
import type { Point2D } from './gridCamera';
import { rulerLabelText, rulerMidpoint, type RulerRequestState } from './gridRuler';

/**
 * FASE 6.6M.3.1 — RÉGUA do grid (linha + marcadores + label NO MEIO).
 *
 * APRESENTAÇÃO PURA, desenhada em coordenadas de TELA (a câmera só transforma).
 * A régua não mede: o texto vem de `POST /spatial/measure`; aqui só existe
 * desenho. A label permanece HORIZONTAL mesmo em linha diagonal, e a linha é
 * tracejada/fina em bronze claro — legível sem competir com o mapa.
 */
export interface GridRulerProps {
  from: Point2D;
  to: Point2D;
  /** Nome do extremo (nunca identidade oculta: o servidor já filtra). */
  fromLabel: string;
  toLabel: string;
  distance: SpatialDistanceReading | null;
  state: RulerRequestState;
  locked: boolean;
}

export function GridRuler({
  from,
  to,
  fromLabel,
  toLabel,
  distance,
  state,
  locked,
}: GridRulerProps) {
  const middle = rulerMidpoint(from, to);
  const text = rulerLabelText(distance, state);
  const labelStyle: CSSProperties = {
    left: `${middle.x}px`,
    top: `${middle.y}px`,
  };

  return (
    <div className={`grid-ruler${locked ? ' is-locked' : ''}`} aria-hidden="true">
      <svg className="grid-ruler-layer">
        <line className="grid-ruler-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        <circle className="grid-ruler-end" cx={from.x} cy={from.y} r={3.5} />
        <circle className="grid-ruler-end" cx={to.x} cy={to.y} r={3.5} />
      </svg>
      <span
        className={`grid-ruler-label${state === 'loading' ? ' is-loading' : ''}`}
        style={labelStyle}
      >
        {fromLabel} → {toLabel} · {text}
      </span>
    </div>
  );
}
