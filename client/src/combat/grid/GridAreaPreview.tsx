import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { SpatialPosition } from '../../types';
import { formatSceneMeters } from '../../sceneUnits';
import { feetToScenePixel, sceneToScreen, type GridCamera } from './gridCamera';

const RADII_FEET = [5, 10, 15, 20, 30, 40, 60] as const;
type Marker = { center: SpatialPosition; radiusFeet: number };
interface Props {
  camera: GridCamera;
  geometry: { cellSizeFeet: number; pixelsPerCell: number };
  widthFeet: number;
  heightFeet: number;
  positionAt: (clientX: number, clientY: number) => SpatialPosition | null;
  disabled: boolean;
  panning: boolean;
  pinging: boolean;
}

/** Modelo local de apresentação. Não consulta entidades, não calcula atingidos
 * e não chama APIs de movimento, conjuração ou economia. */
export function GridAreaPreview({
  camera,
  geometry,
  widthFeet,
  heightFeet,
  positionAt,
  disabled,
  panning,
  pinging,
}: Props) {
  const [saved, setSaved] = useState<Marker | null>(null);
  const [editing, setEditing] = useState(false);
  const [center, setCenter] = useState<SpatialPosition | null>(null);
  const [radiusFeet, setRadiusFeet] = useState(10);
  const [picked, setPicked] = useState(false);
  const panClick = useRef(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function cancel() {
    setEditing(false);
    setCenter(null);
    returnFocus.current = true;
  }
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      toggle.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (disabled) {
      setEditing(false);
      setCenter(null);
    }
  }, [disabled]);
  useEffect(() => {
    if (!editing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [editing]);

  function start() {
    if (disabled) return;
    setCenter(saved?.center ?? null);
    setRadiusFeet(saved?.radiusFeet ?? 10);
    setPicked(Boolean(saved));
    setEditing(true);
  }
  function position(event: MouseEvent | PointerEvent): SpatialPosition | null {
    const point = positionAt(event.clientX, event.clientY);
    return point &&
      Number.isFinite(point.xFeet) &&
      Number.isFinite(point.yFeet) &&
      point.xFeet >= 0 &&
      point.yFeet >= 0 &&
      point.xFeet <= widthFeet &&
      point.yFeet <= heightFeet
      ? point
      : null;
  }
  const marker =
    editing && !disabled ? (center ? { center, radiusFeet } : null) : saved;
  const projected = marker
    ? sceneToScreen(camera, feetToScenePixel(marker.center, geometry))
    : null;
  const radius = marker
    ? feetToScenePixel({ xFeet: marker.radiusFeet, yFeet: 0 }, geometry).x *
      camera.zoom
    : 0;

  return (
    <>
      {projected && marker ? (
        <svg className="grid-area-shape" aria-hidden="true">
          <circle
            className={editing ? 'is-draft' : ''}
            cx={projected.x}
            cy={projected.y}
            r={radius}
          />
          <path
            d={`M${projected.x - 5},${projected.y}h10 M${projected.x},${projected.y - 5}v10`}
          />
        </svg>
      ) : null}
      {editing && !disabled && !pinging ? (
        <div
          className={`grid-area-capture${panning ? ' is-pan' : ''}`}
          role="presentation"
          onPointerDown={(event) => {
            panClick.current = panning || event.button !== 0;
            down.current = { x: event.clientX, y: event.clientY };
            if (!panClick.current) event.stopPropagation();
          }}
          onPointerMove={(event) => {
            if (!panning && event.buttons === 0) panClick.current = false;
            if (panning || panClick.current) return;
            event.stopPropagation();
            if (!picked) setCenter(position(event));
          }}
          onPointerLeave={() => {
            if (!picked) setCenter(null);
          }}
          onPointerUp={(event) => {
            if (!panClick.current) event.stopPropagation();
          }}
          onPointerCancel={() => {
            panClick.current = true;
            down.current = null;
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (panClick.current || panning || event.altKey || disabled) return;
            // Um arrasto sobre o modelo não vira uma escolha involuntária.
            if (
              down.current &&
              Math.hypot(
                event.clientX - down.current.x,
                event.clientY - down.current.y,
              ) > 5
            )
              return;
            const next = position(event);
            if (next) {
              setCenter(next);
              setPicked(true);
            }
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ) : null}
      <div
        className="grid-area-controls"
        role="group"
        aria-label="Prévia de área circular"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {!editing || disabled ? (
          <>
            <button
              ref={toggle}
              className="btn btn-small"
              type="button"
              disabled={disabled}
              onClick={start}
              title={
                saved
                  ? 'Ajustar prévia circular'
                  : 'Prévia visual local de uma área circular'
              }
            >
              {saved
                ? `Área · raio ${formatSceneMeters(saved.radiusFeet)}`
                : 'Área circular'}
            </button>
            {saved ? (
              <button
                type="button"
                className="btn btn-small"
                aria-label="Remover prévia de área"
                onClick={() => setSaved(null)}
              >
                ×
              </button>
            ) : null}
          </>
        ) : (
          <>
            <label>
              Raio{' '}
              <select
                value={radiusFeet}
                onChange={(event) => setRadiusFeet(Number(event.target.value))}
              >
                {RADII_FEET.map((feet) => (
                  <option key={feet} value={feet}>
                    {formatSceneMeters(feet)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-small"
              type="button"
              disabled={!center || !picked}
              onClick={() => {
                if (!center || !picked || disabled) return;
                setSaved({ center, radiusFeet });
                cancel();
              }}
            >
              Confirmar
            </button>
            <button className="btn btn-small" type="button" onClick={cancel}>
              Cancelar
            </button>
            <span className="grid-area-instruction" role="status">
              {picked
                ? 'Clique para ajustar · Esc cancela'
                : 'Clique no mapa para posicionar · Esc cancela'}
            </span>
          </>
        )}
      </div>
    </>
  );
}
