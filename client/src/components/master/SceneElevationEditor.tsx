import { Icon } from '../Icon';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../../api';
import type { ElevationCell, Scene, ScenePatch } from '../../types';
import { newId } from '../../utils';
import { feetToMeters, metersToElevationFeet } from '../../sceneUnits';

interface Props {
  cursorPalette?: boolean;
  eraseMode?: boolean;
  heightValue?: string;
  onHeightChange?: (value: string) => void;
  embedded?: boolean;
  sharedZoom?: number;
  onSessionChange?: (locked: boolean) => void;
  scene: Scene;
  disabled: boolean;
  onSave: (
    patch: ScenePatch,
    version: number,
    operationId: string,
  ) => Promise<Scene>;
  renderCanvas: (overlay: ReactNode, zoom: number) => ReactNode;
}

/** O pincel só rascunha células. Altura, versão e persistência são validadas no servidor. */
export function SceneElevationEditor({
  scene,
  disabled,
  onSave,
  renderCanvas,
  embedded = false,
  sharedZoom,
  onSessionChange,
  cursorPalette = false,
  eraseMode = false,
  heightValue,
  onHeightChange,
}: Props) {
  const [selection, setSelection] = useState<
    Map<string, { xFeet: number; yFeet: number }>
  >(new Map());
  const [localHeight, setLocalHeight] = useState('0');
  const height = heightValue ?? localHeight;
  const setHeight = (value: string) => {
    setLocalHeight(value);
    onHeightChange?.(value);
  };
  const [painting, setPainting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const stroke = useRef<{
    pointerId: number;
    version: number;
    last: { xFeet: number; yFeet: number } | null;
  } | null>(null);
  const draftVersion = useRef(scene.version);
  const pending = useRef<{
    patch: ScenePatch;
    version: number;
    id: string;
  } | null>(null);
  const writing = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const config = scene.spatialConfig;
  const stale = selection.size > 0 && draftVersion.current !== scene.version;
  const editable =
    !disabled && !busy && !uncertain && config.mode === 'grid-2d';

  useEffect(() => {
    onSessionChange?.(selection.size > 0 || busy || uncertain);
  }, [selection.size, busy, uncertain, onSessionChange]);

  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * config.widthFeet;
    const y = ((event.clientY - rect.top) / rect.height) * config.heightFeet;
    if (x < 0 || y < 0 || x >= config.widthFeet || y >= config.heightFeet)
      return null;
    const result = {
      xFeet: Math.floor(x / 5) * 5,
      yFeet: Math.floor(y / 5) * 5,
    };
    return result.xFeet + 5 <= config.widthFeet &&
      result.yFeet + 5 <= config.heightFeet
      ? result
      : null;
  }
  function paint(event: PointerEvent<SVGSVGElement>) {
    const current = stroke.current;
    const end = point(event);
    if (!current || !end) return;
    const start = current.last ?? end;
    // Interpolação visual evita buracos quando o ponteiro cruza várias casas por evento.
    const count =
      Math.max(
        Math.abs(end.xFeet - start.xFeet),
        Math.abs(end.yFeet - start.yFeet),
      ) / 5;
    setSelection((previous) => {
      const next = new Map(previous);
      for (let i = 0; i <= count; i++) {
        const t = count ? i / count : 0;
        const cell = {
          xFeet:
            Math.round((start.xFeet + (end.xFeet - start.xFeet) * t) / 5) * 5,
          yFeet:
            Math.round((start.yFeet + (end.yFeet - start.yFeet) * t) / 5) * 5,
        };
        if (
          !eraseMode ||
          config.elevationCells?.some(
            (saved) => saved.xFeet === cell.xFeet && saved.yFeet === cell.yFeet,
          )
        )
          next.set(`${cell.xFeet}:${cell.yFeet}`, cell);
      }
      return next;
    });
    current.last = end;
  }
  function cancel() {
    if (busy || uncertain) return;
    stroke.current = null;
    setPainting(false);
    setSelection(new Map());
    setEditing(false);
    setError(null);
  }
  async function save(erase = false) {
    if (
      writing.current ||
      disabled ||
      (stale && !pending.current) ||
      (selection.size === 0 && !pending.current)
    )
      return;
    const value = Number(height.replace(',', '.'));
    if (
      !erase &&
      (!height.trim() || !Number.isFinite(value) || Math.abs(value) > 3000)
    ) {
      setError('Informe uma elevação entre −3000 e 3000 metros.');
      return;
    }
    const cells = new Map(
      (config.elevationCells ?? []).map((cell) => [
        `${cell.xFeet}:${cell.yFeet}`,
        cell,
      ]),
    );
    for (const [key, cell] of selection) {
      if (erase || value === 0) cells.delete(key);
      else
        cells.set(key, {
          ...cell,
          elevationFeet: metersToElevationFeet(value),
        });
    }
    const intention = pending.current ?? {
      patch: {
        spatialConfig: {
          ...config,
          elevationCells: [...cells.values()].sort(
            (a, b) => a.yFeet - b.yFeet || a.xFeet - b.xFeet,
          ),
        },
      },
      version: draftVersion.current,
      id: newId(),
    };
    // `cellSizeFeet` é derivado, nunca enviado na intenção.
    if (intention.patch.spatialConfig)
      delete (intention.patch.spatialConfig as { cellSizeFeet?: number })
        .cellSizeFeet;
    pending.current = intention;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(intention.patch, intention.version, intention.id);
      pending.current = null;
      setUncertain(false);
      setSelection(new Map());
      setEditing(false);
    } catch (cause) {
      const rejected =
        cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
      if (rejected) pending.current = null;
      setUncertain(!rejected);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a elevação.',
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const cells = config.elevationCells ?? [];
  const cursorForm = cursorPalette ? (
    <form
      className="scene-height-cursor"
      aria-label="Definir elevação"
      hidden={painting}
      onSubmit={(event) => {
        event.preventDefault();
        void save(eraseMode);
      }}
    >
      {eraseMode ? (
        <p className="scene-eraser-hint">
          Borracha de elevações · arraste sobre os quadrados para restaurar o
          chão.
        </p>
      ) : (
        <label>
          <span className="scene-height-heading">
            Altura{' '}
            <output>
              {Number(height.replace(',', '.')).toLocaleString('pt-BR')} m
            </output>
          </span>
          <span className="scene-height-range">
            <input
              autoFocus
              data-scene-save-on-space
              aria-label="Elevação do terreno em metros"
              type="range"
              min={-100}
              max={100}
              step={0.25}
              aria-valuetext={`${Number(height.replace(',', '.')).toLocaleString('pt-BR')} metros`}
              value={height}
              disabled={disabled || busy || uncertain || stale}
              onChange={(event) => setHeight(event.target.value)}
            />
          </span>
          <span className="scene-height-scale" aria-hidden="true">
            <span>−100 m</span>
            <span>0</span>
            <span>+100 m</span>
          </span>
        </label>
      )}
      {selection.size > 0 ? (
        <>
          <button
            type="submit"
            data-scene-save-draft
            aria-label={uncertain ? 'Repetir envio' : 'Confirmar'}
            title={
              uncertain
                ? 'Tentar novamente'
                : eraseMode
                  ? 'Confirmar remoção (Espaço)'
                  : 'Salvar altura (Espaço)'
            }
            disabled={disabled || busy || (stale && !uncertain)}
          >
            <Icon name="check" size={15} />
          </button>
          <button
            type="button"
            aria-label="Apagar"
            title="Restaurar chão nos quadrados pintados"
            disabled={!editable || stale}
            onClick={() => void save(true)}
          >
            <Icon name="trash" size={14} />
          </button>
          <button
            type="button"
            data-scene-cancel-draft
            aria-label="Cancelar"
            title="Cancelar pintura (Esc)"
            disabled={busy || uncertain}
            onClick={cancel}
          >
            <Icon name="x" size={14} />
          </button>
        </>
      ) : null}
      {error ? (
        <span className="scene-height-error" role="alert">
          {error}
        </span>
      ) : null}
      {stale && !uncertain ? (
        <span className="scene-height-error" role="alert">
          A cena mudou. Cancele e pinte novamente.
        </span>
      ) : null}
    </form>
  ) : null;
  const overlay = (
    <svg
      ref={svg}
      className={`scene-walls-overlay scene-elevation-overlay${eraseMode ? ' scene-overlay--erase' : ''}`}
      viewBox={`0 0 ${config.widthFeet} ${config.heightFeet}`}
      preserveAspectRatio="none"
      role="group"
      aria-label="Pincel de elevação"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
      onPointerDown={(event) => {
        if (!editable || (editing && selection.size > 0) || event.button !== 0)
          return;
        event.preventDefault();
        setPainting(true);
        draftVersion.current = scene.version;
        stroke.current = {
          pointerId: event.pointerId,
          version: scene.version,
          last: null,
        };
        setSelection(new Map());
        setError(null);
        svg.current?.setPointerCapture?.(event.pointerId);
        paint(event);
      }}
      onPointerMove={(event) => {
        if (stroke.current?.pointerId === event.pointerId) {
          paint(event);
        }
      }}
      onPointerUp={(event) => {
        if (stroke.current?.pointerId !== event.pointerId) return;
        stroke.current = null;
        setPainting(false);
        svg.current?.releasePointerCapture?.(event.pointerId);
        setEditing(true);
        const p = point(event);
        const existing =
          p && cells.find((c) => c.xFeet === p.xFeet && c.yFeet === p.yFeet);
        if (!cursorPalette)
          setHeight(
            String(feetToMeters(existing ? existing.elevationFeet : 0)),
          );
      }}
      onPointerCancel={() => {
        setPainting(false);
        stroke.current = null;
        cancel();
      }}
      onLostPointerCapture={() => {
        setPainting(false);
        if (stroke.current) {
          stroke.current = null;
          setEditing(true);
        }
      }}
    >
      <SceneElevationCells cells={cells} />
      {[...selection.entries()].map(([key, cell]) => (
        <rect
          key={key}
          x={cell.xFeet}
          y={cell.yFeet}
          width={5}
          height={5}
          className="scene-elevation-selected"
        />
      ))}
    </svg>
  );
  return (
    <div
      className="scene-elevation-editor"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      {!embedded ? (
        <div className="scene-background-actions">
          <span>Pinte o grid e solte para definir a elevação.</span>
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            aria-label="Diminuir zoom da elevação"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
            aria-label="Aumentar zoom da elevação"
          >
            +
          </button>
        </div>
      ) : null}
      <div className="scene-elevation-map">
        {renderCanvas(overlay, sharedZoom ?? zoom)}
        {cursorForm}
        {!cursorPalette && editing && selection.size > 0 ? (
          <form
            className="scene-elevation-popover"
            aria-label="Definir elevação"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              Elevação (m)
              <input
                autoFocus
                data-scene-save-on-space
                aria-label="Elevação do terreno em metros"
                type="text"
                inputMode="decimal"
                value={height}
                disabled={busy || uncertain || stale}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
            <span className="section-note">
              {selection.size} quadrado(s) · nível zero da cena
            </span>
            <div className="scene-background-actions">
              <button
                data-scene-save-draft
                className="btn btn-primary btn-small"
                disabled={disabled || busy || (stale && !uncertain)}
              >
                {uncertain ? 'Repetir envio' : 'Confirmar'}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={!editable || stale}
                onClick={() => void save(true)}
              >
                Apagar
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || uncertain}
                data-scene-cancel-draft
                onClick={cancel}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </div>
      {stale && !cursorPalette ? (
        <p role="alert">A cena mudou. Cancele a seleção e pinte novamente.</p>
      ) : null}
      {error && !cursorPalette ? <p role="alert">{error}</p> : null}
      <p className="scene-hint">
        Use valores negativos para fossos. Zero restaura o chão. O pincel define
        superfícies; subir e descer depende da decisão do Mestre no combate.
      </p>
    </div>
  );
}
export function SceneElevationCells({ cells }: { cells: ElevationCell[] }) {
  return (
    <>
      {cells.map((cell) => (
        <ElevationSquare key={`${cell.xFeet}:${cell.yFeet}`} cell={cell} />
      ))}
    </>
  );
}
function ElevationSquare({ cell }: { cell: ElevationCell }) {
  return (
    <g
      className={`scene-elevation-cell ${cell.elevationFeet < 0 ? 'scene-elevation-cell--low' : ''}`}
    >
      <rect x={cell.xFeet} y={cell.yFeet} width={5} height={5} />
      <text x={cell.xFeet + 2.5} y={cell.yFeet + 3} textAnchor="middle">
        {feetToMeters(cell.elevationFeet).toLocaleString('pt-BR')} m
      </text>
    </g>
  );
}
