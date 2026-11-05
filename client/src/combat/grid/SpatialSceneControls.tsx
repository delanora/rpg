import { useState } from 'react';
import { DEFAULT_SCENE_FEET } from './gridMath';

export interface SpatialSceneControlsProps {
  mode: 'assisted' | 'grid-2d';
  widthFeet: number;
  heightFeet: number;
  isMaster: boolean;
  busy?: boolean;
  onActivate: (widthFeet: number, heightFeet: number) => void;
  onResize: (widthFeet: number, heightFeet: number) => void;
  onAssisted: () => void;
}

/**
 * Controles MÍNIMOS da cena — não é editor de mapa.
 *
 * `assisted` → só o Mestre vê "Ativar grid" (dimensões em PÉS; célula fixa 5).
 * `grid-2d` → o Mestre pode ajustar as dimensões (o servidor recusa reduzir a
 * cena com unidade fora e NADA é movido automaticamente). O PLAYER apenas lê.
 */
export function SpatialSceneControls({
  mode,
  widthFeet,
  heightFeet,
  isMaster,
  busy = false,
  onActivate,
  onResize,
  onAssisted,
}: SpatialSceneControlsProps) {
  const [width, setWidth] = useState(String(widthFeet || DEFAULT_SCENE_FEET));
  const [height, setHeight] = useState(String(heightFeet || DEFAULT_SCENE_FEET));

  const parse = (value: string, fallback: number): number => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  if (!isMaster) {
    return (
      <p className="grid-scene-readonly">
        {mode === 'grid-2d'
          ? `Cena em grade — ${widthFeet} × ${heightFeet} pés (${widthFeet / 5} × ${heightFeet / 5} quadrados).`
          : 'Cena assistida — a mesa ainda não usa grade espacial.'}
      </p>
    );
  }

  if (mode === 'assisted') {
    return (
      <div className="grid-scene-controls">
        <div className="grid-scene-fields">
          <label>
            Largura (pés)
            <input
              type="number"
              min={5}
              max={100000}
              step={5}
              value={width}
              disabled={busy}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <label>
            Altura (pés)
            <input
              type="number"
              min={5}
              max={100000}
              step={5}
              value={height}
              disabled={busy}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy}
            onClick={() =>
              onActivate(
                parse(width, DEFAULT_SCENE_FEET),
                parse(height, DEFAULT_SCENE_FEET),
              )
            }
          >
            Ativar grid
          </button>
        </div>
        <p className="grid-scene-hint">
          Cada quadrado representa 5 pés. O modo assistido continua sem geometria
          autoritativa.
        </p>
      </div>
    );
  }

  return (
    <div className="grid-scene-controls">
      <span className="grid-scene-badge">
        Grade {widthFeet} × {heightFeet} pés · {widthFeet / 5} × {heightFeet / 5} quadrados
      </span>
      <details className="grid-scene-details">
        <summary>Ajustar cena</summary>
        <div className="grid-scene-fields">
          <label>
            Largura (pés)
            <input
              type="number"
              min={5}
              max={100000}
              step={5}
              value={width}
              disabled={busy}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <label>
            Altura (pés)
            <input
              type="number"
              min={5}
              max={100000}
              step={5}
              value={height}
              disabled={busy}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() =>
              onResize(
                parse(width, widthFeet),
                parse(height, heightFeet),
              )
            }
          >
            Redimensionar
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={onAssisted}
          >
            Voltar ao assistido
          </button>
        </div>
        <p className="grid-scene-hint">
          Reduzir a cena com alguém fora dos limites é recusado; nada é movido
          automaticamente.
        </p>
      </details>
    </div>
  );
}
