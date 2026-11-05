import type { SpatialDistanceReading } from '../../types';
import type { GridUnit } from './GridToken';
import { distanceLabel } from './distanceFormat';
import { occupiedSpacePixels } from './gridMath';

export type MeasureRequestState = 'idle' | 'loading' | 'success' | 'error';

/**
 * FASE 6.6M.2 — LINHA DE MEDIÇÃO.
 *
 * A linha é DECORAÇÃO VISUAL: extremidades no CENTRO do footprint, só para
 * desenhar. Ela NÃO mede, NÃO é régua e NÃO é fonte da distância — o número
 * exibido vem de `GET /api/combat/:id/spatial/distance`.
 *
 * Sem source E target colocados não existe linha: unplaced nunca ganha uma
 * linha enganosa vinda da bandeja "Fora do mapa". O CSS mantém
 * `pointer-events: none`, então os cliques continuam nos tokens.
 */
export interface GridMeasureOverlayProps {
  source: GridUnit | null;
  target: GridUnit | null;
  cellSizeFeet: number;
  pixelsPerCell: number;
}

function footprintCenter(
  unit: GridUnit,
  cellSizeFeet: number,
  pixelsPerCell: number,
): { x: number; y: number } | null {
  const space = unit.spatial?.occupiedSpace;
  if (!space) return null;
  const box = occupiedSpacePixels(space, cellSizeFeet, pixelsPerCell);
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export function GridMeasureOverlay({
  source,
  target,
  cellSizeFeet,
  pixelsPerCell,
}: GridMeasureOverlayProps) {
  const from = source ? footprintCenter(source, cellSizeFeet, pixelsPerCell) : null;
  const to = target ? footprintCenter(target, cellSizeFeet, pixelsPerCell) : null;
  if (!from || !to) return null;

  return (
    <svg className="grid-measure-layer" aria-hidden="true">
      <line className="grid-measure-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      <circle className="grid-measure-end" cx={to.x} cy={to.y} r={3} />
    </svg>
  );
}

export interface GridMeasurementPanelProps {
  sourceName: string | null;
  targetName: string | null;
  distance: SpatialDistanceReading | null;
  state: MeasureRequestState;
  onClear: () => void;
  onRetry: () => void;
}

/**
 * PAINEL compacto da medição (nunca um modal). O texto é o RESULTADO do
 * servidor: `unknown`/`not-assessed` mostram o motivo público em vez de um
 * número inventado, e falha de rede não mantém valor velho como atual.
 */
export function GridMeasurementPanel({
  sourceName,
  targetName,
  distance,
  state,
  onClear,
  onRetry,
}: GridMeasurementPanelProps) {
  const message =
    state === 'error'
      ? 'Não foi possível consultar a distância.'
      : state === 'loading'
        ? 'Consultando distância…'
        : !sourceName
          ? 'Selecione a origem.'
          : !targetName
            ? 'Selecione o alvo.'
            : distanceLabel(distance);

  return (
    <section className="grid-measure-panel" aria-label="Medição de distância">
      <div className="grid-measure-head">
        <span className="grid-measure-title">Medição</span>
        <button type="button" className="btn btn-small" onClick={onClear}>
          Limpar
        </button>
      </div>
      <p className="grid-measure-route">
        <span className="grid-measure-name">{sourceName ?? 'Origem'}</span>
        <span aria-hidden="true"> → </span>
        <span className="grid-measure-name">{targetName ?? 'Alvo'}</span>
      </p>
      <p className="grid-measure-value" role="status" aria-live="polite">
        {message}
      </p>
      {state === 'error' ? (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Tentar novamente
        </button>
      ) : null}
      <p className="grid-measure-hint">Distância calculada pelo servidor.</p>
    </section>
  );
}
