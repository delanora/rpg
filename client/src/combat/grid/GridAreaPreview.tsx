import {
  PREVIEW_SHAPES,
  previewDirectional,
  previewAngle,
  previewPolygon,
  type PreviewShape,
  type AreaPreviewRequest,
} from './areaPreviewGeometry';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { SpatialPosition } from '../../types';
import { formatSceneMeters } from '../../sceneUnits';
import { feetToScenePixel, sceneToScreen, type GridCamera } from './gridCamera';

const RADII_FEET = [5, 10, 15, 20, 30, 40, 60] as const;
type Marker = {
  center: SpatialPosition;
  radiusFeet: number;
  shape: PreviewShape;
  widthFeet: number;
  heightFeet: number;
  angle: number;
};
interface Props {
  request?: AreaPreviewRequest | null;
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
  request,
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
  const [shape, setShape] = useState<PreviewShape>('sphere');
  const [lineWidth, setLineWidth] = useState(5);
  const [height, setHeight] = useState(20);
  const [angle, setAngle] = useState(0);
  const [aiming, setAiming] = useState(false);
  const directional = previewDirectional(shape);
  const radialId = useRef<number | null>(null);
  useEffect(() => {
    if (!request || disabled || radialId.current === request.id) return;
    radialId.current = request.id;
    setShape(request.shape);
    setCenter(request.origin);
    setRadiusFeet(10);
    setLineWidth(5);
    setHeight(20);
    setAngle(0);
    setPicked(!previewDirectional(request.shape));
    setAiming(previewDirectional(request.shape));
    setEditing(true);
  }, [request, disabled]);
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
    setShape(saved?.shape ?? 'sphere');
    setLineWidth(saved?.widthFeet ?? 5);
    setHeight(saved?.heightFeet ?? 20);
    setAngle(saved?.angle ?? 0);
    setAiming(false);
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
    editing && !disabled
      ? center
        ? {
            center,
            radiusFeet,
            shape,
            widthFeet: lineWidth,
            heightFeet: height,
            angle,
          }
        : null
      : saved;
  const projected = marker
    ? sceneToScreen(camera, feetToScenePixel(marker.center, geometry))
    : null;

  // O acesso inicial fica no radial; controles só existem com uma prévia.
  if (!saved && (!editing || disabled)) return null;

  return (
    <>
      {projected && marker ? (
        <svg className="grid-area-shape" aria-hidden="true">
          <g
            transform={`translate(${projected.x} ${projected.y}) rotate(${(marker.angle * 180) / Math.PI}) scale(${(geometry.pixelsPerCell / geometry.cellSizeFeet) * camera.zoom})`}
          >
            {previewPolygon(
              marker.shape,
              marker.radiusFeet,
              marker.widthFeet,
            ) ? (
              <polygon
                className={editing ? 'is-draft' : ''}
                points={previewPolygon(
                  marker.shape,
                  marker.radiusFeet,
                  marker.widthFeet,
                )!}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <circle
                className={editing ? 'is-draft' : ''}
                cx={0}
                cy={0}
                r={marker.radiusFeet}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
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
            const next = position(event);
            if (aiming && center && next)
              setAngle(previewAngle(center, next, angle));
            else if (!picked && !aiming) setCenter(next);
          }}
          onPointerLeave={() => {
            if (!picked && !aiming) setCenter(null);
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
              if (aiming && center) {
                setAngle(previewAngle(center, next, angle));
                setAiming(false);
                setPicked(true);
              } else {
                setCenter(next);
                setPicked(!directional);
                setAiming(directional);
              }
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
        aria-label="Prévia de áreas"
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
                  ? 'Ajustar prévia de área'
                  : 'Prévia visual local de uma área'
              }
            >
              {saved
                ? `Área · ${PREVIEW_SHAPES.find((item) => item.kind === saved.shape)?.label}`
                : 'Áreas'}
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
              Forma{' '}
              <select
                aria-label="Forma da área"
                value={shape}
                onChange={(event) => {
                  const next = event.target.value as PreviewShape;
                  setShape(next);
                  setAiming(previewDirectional(next) && !!center);
                  setPicked(!!center && !previewDirectional(next));
                }}
              >
                {PREVIEW_SHAPES.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {shape === 'sphere' || shape === 'cylinder'
                ? 'Raio'
                : shape === 'cube'
                  ? 'Aresta'
                  : 'Comprimento'}{' '}
              <select
                aria-label="Dimensão da área"
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
            {shape === 'line' || shape === 'cylinder' ? (
              <label>
                {shape === 'line' ? 'Largura' : 'Altura'}
                <select
                  aria-label={
                    shape === 'line' ? 'Largura da linha' : 'Altura do cilindro'
                  }
                  value={shape === 'line' ? lineWidth : height}
                  onChange={(event) =>
                    shape === 'line'
                      ? setLineWidth(Number(event.target.value))
                      : setHeight(Number(event.target.value))
                  }
                >
                  {RADII_FEET.map((feet) => (
                    <option key={feet} value={feet}>
                      {formatSceneMeters(feet)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              className="btn btn-small"
              type="button"
              disabled={!center || !picked}
              onClick={() => {
                if (!center || !picked || disabled) return;
                setSaved({
                  center,
                  radiusFeet,
                  shape,
                  widthFeet: lineWidth,
                  heightFeet: height,
                  angle,
                });
                cancel();
              }}
            >
              Confirmar
            </button>
            <button className="btn btn-small" type="button" onClick={cancel}>
              Cancelar
            </button>
            <span className="grid-area-instruction" role="status">
              {aiming
                ? 'Aponte a direção e clique para fixar · Esc cancela'
                : picked
                  ? 'Clique para ajustar · Esc cancela'
                  : 'Clique no mapa para definir a origem · Esc cancela'}
              {shape === 'cylinder'
                ? ` · Altura ${formatSceneMeters(height)} (vista superior)`
                : ''}
            </span>
          </>
        )}
      </div>
    </>
  );
}
