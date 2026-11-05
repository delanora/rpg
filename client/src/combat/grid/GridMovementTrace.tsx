import type { Point2D } from './gridCamera';
import { polylineMidpoint } from './movementPath';
import { formatMeters } from './distanceFormat';
import type { MovementPreviewState } from './MovementHud';

/**
 * FASE 6.6M.3.1.1 — TRAÇO do movimento (polyline + label no MEIO do caminho).
 *
 * APRESENTAÇÃO PURA, desenhada em coordenadas de TELA: reutiliza exatamente o
 * token visual da régua (`.grid-ruler-line` / `.grid-ruler-label`), porque
 * movimento e medição são a MESMA linguagem de linha. Geometricamente são
 * diferentes — a régua é um segmento entre dois extremos, o movimento segue o
 * caminho desenhado pelo gesto.
 *
 * O texto vem do PREVIEW do servidor (metros na apresentação, pés no domínio).
 * O custo só aparece como informação secundária quando difere da distância
 * (terreno difícil, arrastar-se); o saldo autoritativo continua na barra.
 */
export interface GridMovementTraceProps {
  points: Point2D[];
  /** Distância do SERVIDOR, em pés (a label imprime metros). */
  distanceInFeet: number | null;
  /** Custo do SERVIDOR, em pés (só aparece quando difere da distância). */
  costInFeet: number | null;
  state: MovementPreviewState;
}

export function GridMovementTrace({
  points,
  distanceInFeet,
  costInFeet,
  state,
}: GridMovementTraceProps) {
  if (points.length < 2) return null;
  const middle = polylineMidpoint(points);
  const label =
    state === 'loading' ? 'Calculando…' : distanceInFeet === null ? '—' : formatMeters(distanceInFeet);
  const cost =
    costInFeet !== null &&
    distanceInFeet !== null &&
    Math.abs(costInFeet - distanceInFeet) > 1e-9
      ? formatMeters(costInFeet)
      : null;

  return (
    <div className="grid-ruler grid-movement-trace" aria-hidden="true">
      <svg className="grid-ruler-layer">
        <polyline
          className="grid-ruler-line grid-movement-trace-line"
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        />
        <circle className="grid-ruler-end" cx={points[0].x} cy={points[0].y} r={3.5} />
        <circle
          className="grid-ruler-end"
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={3.5}
        />
      </svg>
      <span
        className={`grid-ruler-label grid-movement-trace-label${
          state === 'loading' ? ' is-loading' : ''
        }`}
        style={{ left: `${middle.x}px`, top: `${middle.y}px` }}
      >
        {label}
        {cost ? <span className="grid-movement-trace-cost"> · Custo: {cost}</span> : null}
      </span>
    </div>
  );
}
