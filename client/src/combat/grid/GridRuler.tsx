import type { CSSProperties } from 'react';
import type { SpatialDistanceReading } from '../../types';
import { Icon } from '../../components/Icon';
import { formatMeters } from './distanceFormat';
import type { Point2D } from './gridCamera';
import { rulerLabelText, rulerMidpoint, type RulerRequestState } from './gridRuler';

/**
 * FASE 6.6M.3.1.2 — AFFORDANCE de Measure-to-Move.
 *
 * `loading`/`executing` são estados de operação; `ready` é a única que oferece
 * Space. `invalid` explica por que aquele trajeto medido não pode virar
 * Movement — sem oferecer executável.
 */
export type RulerMoveState = 'loading' | 'ready' | 'invalid' | 'executing';

export interface GridRulerMove {
  state: RulerMoveState;
  /** Motivo curto e SANITIZADO (bloqueio, saldo, alinhamento...). */
  message: string | null;
  /** Custo do SERVIDOR em pés — só aparece quando difere da distância. */
  costFeet: number | null;
}

/**
 * FASE 6.6M.3.1 — RÉGUA do grid (linha + marcadores + label NO MEIO).
 *
 * APRESENTAÇÃO PURA, desenhada em coordenadas de TELA (a câmera só transforma).
 * A régua não mede: o texto vem de `POST /spatial/measure`; aqui só existe
 * desenho. A label permanece HORIZONTAL mesmo em linha diagonal, e a linha é
 * tracejada/fina em bronze claro — legível sem competir com o mapa.
 *
 * 6.6M.3.1.2: quando a régua fixada pode virar Movement, a MESMA label ganha
 * ícone de deslocamento + keycap `Space`. O badge vive FORA do desenho
 * `aria-hidden`, porque prometer movimento é informação, não ornamento.
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
  /** Affordance de Measure-to-Move (null = régua puramente de consulta). */
  move?: GridRulerMove | null;
}

const MOVE_ARIA = 'Pressione Espaço para mover até o destino medido.';

export function GridRuler({
  from,
  to,
  fromLabel,
  toLabel,
  distance,
  state,
  locked,
  move = null,
}: GridRulerProps) {
  const middle = rulerMidpoint(from, to);
  const text = rulerLabelText(distance, state);
  const labelStyle: CSSProperties = {
    left: `${middle.x}px`,
    top: `${middle.y}px`,
  };
  const measured = distance?.status === 'known' ? distance.distanceFeet : null;
  const cost =
    move?.costFeet !== null && move?.costFeet !== undefined
      ? measured === null || Math.abs(move.costFeet - measured) > 1e-9
        ? move.costFeet
        : null
      : null;

  return (
    <>
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

      {move ? (
        <div
          className={`grid-measure-move is-${move.state}${cost !== null ? ' has-cost' : ''}`}
          style={{ left: `${middle.x}px`, top: `${middle.y}px` }}
          role="status"
          aria-live="polite"
        >
          {move.state === 'ready' ? (
            <span className="grid-measure-move-action" aria-label={MOVE_ARIA} title={MOVE_ARIA}>
              <Icon name="boots" size={14} className="grid-measure-move-icon" />
              <kbd className="grid-keycap">Space</kbd>
            </span>
          ) : move.state === 'executing' ? (
            <span className="grid-measure-move-busy" aria-label="Executando o movimento medido.">
              Executando…
            </span>
          ) : move.state === 'loading' ? (
            <span className="grid-measure-move-busy" aria-label="Calculando o trajeto medido.">
              Calculando…
            </span>
          ) : (
            <span className="grid-measure-move-message">
              {move.message ?? 'Este trajeto não pode ser percorrido.'}
            </span>
          )}
          {cost !== null ? (
            <span className="grid-measure-move-cost">Custo: {formatMeters(cost)}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
