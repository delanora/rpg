import {
  useId,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
  type MouseEvent,
  type DragEvent,
} from 'react';
import type { Scene, SpatialSize } from '../types';
import { SIZE_FOOTPRINT_FEET } from './grid/gridMath';
export interface PreparationToken {
  key: string;
  name: string;
  image: string;
  size: SpatialSize;
  position: { xFeet: number; yFeet: number } | null;
}
/** Prévia de montagem, sem consumir movimento ou criar um combate antecipadamente. */
export function PreparationBoard({
  scene,
  tokens,
  onPlace,
  scenePicker,
}: {
  scenePicker?: ReactNode;
  scene: Scene;
  tokens: PreparationToken[];
  onPlace: (
    key: string,
    position: { xFeet: number; yFeet: number } | null,
  ) => void;
}) {
  const [selected, setSelected] = useState('');
  const pattern = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ width: 900, height: 600 });
  const [zoom, setZoom] = useState(1);
  const zoomCenter = useRef<{ x: number; y: number } | null>(null);
  const config = scene.spatialConfig;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      if (node.clientWidth && node.clientHeight)
        setViewSize({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [config.mode]);
  const scale =
    Math.min(
      Math.max(1, viewSize.width - 16) / config.widthFeet,
      Math.max(1, viewSize.height - 16) / config.heightFeet,
    ) * zoom;
  const mapWidth = config.widthFeet * scale,
    mapHeight = config.heightFeet * scale;
  useLayoutEffect(() => {
    const node = viewport.current,
      center = zoomCenter.current;
    if (!node || !center) return;
    node.scrollLeft = Math.max(
      0,
      Math.min(
        mapWidth - viewSize.width,
        center.x * mapWidth - viewSize.width / 2,
      ),
    );
    node.scrollTop = Math.max(
      0,
      Math.min(
        mapHeight - viewSize.height,
        center.y * mapHeight - viewSize.height / 2,
      ),
    );
    zoomCenter.current = null;
  }, [mapWidth, mapHeight, viewSize]);
  function changeZoom(next: number) {
    const node = viewport.current;
    zoomCenter.current = {
      x:
        ((node?.scrollLeft ?? 0) +
          viewSize.width / 2 -
          Math.max(0, (viewSize.width - mapWidth) / 2)) /
        mapWidth,
      y:
        ((node?.scrollTop ?? 0) +
          viewSize.height / 2 -
          Math.max(0, (viewSize.height - mapHeight) / 2)) /
        mapHeight,
    };
    setZoom(Math.max(1, Math.min(4, next)));
  }
  if (config.mode !== 'grid-2d')
    return (
      <p className="section-note">
        Cena assistida: não exige posições no grid.
      </p>
    );
  function place(
    event: MouseEvent<SVGSVGElement> | DragEvent<SVGSVGElement>,
    key = selected,
  ) {
    if (!key) return;
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const feet = point.matrixTransform(matrix.inverse());
    const token = tokens.find((t) => t.key === key);
    if (!token) return;
    const step = token.size === 'tiny' ? 2.5 : 5;
    onPlace(key, {
      xFeet: Math.floor(feet.x / step) * step,
      yFeet: Math.floor(feet.y / step) * step,
    });
  }
  return (
    <div className="preparation-board">
      <aside className="preparation-board-sidebar">
        {scenePicker ? (
          <div className="preparation-scene-picker">{scenePicker}</div>
        ) : null}
        <div
          className="preparation-token-tray"
          aria-label="Tokens para posicionar"
        >
          {tokens.map((t) => (
            <div key={t.key} className="preparation-tray-row">
              <button
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', t.key)}
                aria-pressed={selected === t.key}
                onClick={() => setSelected(t.key)}
              >
                {t.name}
                <small>{t.position ? 'Posicionado' : 'Sem posição'}</small>
              </button>
              {t.position ? (
                <button
                  type="button"
                  aria-label={`Retirar posição de ${t.name}`}
                  onClick={() => onPlace(t.key, null)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </aside>
      <div className="preparation-map-panel">
        <div className="preparation-map-toolbar">
          <strong>{scene.name}</strong>
          <div
            className="preparation-map-zoom"
            role="group"
            aria-label="Zoom do posicionamento"
          >
            <button
              type="button"
              className="btn btn-small"
              aria-label="Diminuir zoom do mapa"
              disabled={zoom <= 1}
              onClick={() => changeZoom(zoom - 0.25)}
            >
              −
            </button>
            <output aria-label="Zoom do mapa">{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              className="btn btn-small"
              aria-label="Aumentar zoom do mapa"
              disabled={zoom >= 4}
              onClick={() => changeZoom(zoom + 0.25)}
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                zoomCenter.current = { x: 0.5, y: 0.5 };
                setZoom(1);
                if (viewport.current) {
                  viewport.current.scrollLeft = 0;
                  viewport.current.scrollTop = 0;
                }
              }}
            >
              Enquadrar
            </button>
          </div>
        </div>
        <div
          ref={viewport}
          className="preparation-map-viewport"
          tabIndex={0}
          aria-label="Área navegável do mapa"
        >
          <div
            className="preparation-map-canvas"
            style={{
              width: Math.max(viewSize.width, mapWidth),
              height: Math.max(viewSize.height, mapHeight),
            }}
          >
            <svg
              className="preparation-map"
              width={mapWidth}
              height={mapHeight}
              viewBox={`0 0 ${config.widthFeet} ${config.heightFeet}`}
              role="img"
              aria-label="Posicionamento do encontro"
              onClick={(e) => place(e)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                place(e, e.dataTransfer.getData('text/plain'));
              }}
            >
              <defs>
                <pattern
                  id={pattern}
                  width={5}
                  height={5}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 5 0 L 0 0 0 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={0.08}
                  />
                </pattern>
              </defs>
              {scene.backgroundImageUrl ? (
                <image
                  href={scene.backgroundImageUrl}
                  width={config.widthFeet}
                  height={config.heightFeet}
                  preserveAspectRatio="none"
                />
              ) : null}
              <rect
                width={config.widthFeet}
                height={config.heightFeet}
                fill={`url(#${pattern})`}
              />
              {scene.obstacles.map((w) => (
                <polyline
                  key={w.id}
                  points={`${w.start.xFeet},${w.start.yFeet} ${w.end.xFeet},${w.end.yFeet}`}
                  fill="none"
                  stroke="var(--gold)"
                  strokeWidth={0.4}
                />
              ))}
              {tokens
                .filter((t) => t.position)
                .map((t) => {
                  const p = t.position!,
                    size = SIZE_FOOTPRINT_FEET[t.size].widthFeet;
                  return (
                    <g
                      key={t.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(t.key);
                      }}
                    >
                      <rect
                        x={p.xFeet}
                        y={p.yFeet}
                        width={size}
                        height={size}
                        rx={0.5}
                        fill="var(--surface)"
                        stroke={
                          selected === t.key
                            ? 'var(--gold)'
                            : 'var(--ink-faint)'
                        }
                        strokeWidth={0.3}
                      />
                      {t.image ? (
                        <image
                          href={t.image}
                          x={p.xFeet + 0.25}
                          y={p.yFeet + 0.25}
                          width={size - 0.5}
                          height={size - 0.5}
                        />
                      ) : (
                        <text
                          x={p.xFeet + size / 2}
                          y={p.yFeet + size / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={Math.min(size / 2, 3)}
                          fill="var(--gold)"
                        >
                          {t.name.slice(0, 2)}
                        </text>
                      )}
                      <title>{t.name}</title>
                    </g>
                  );
                })}
            </svg>
          </div>
        </div>
        <p className="section-note">
          Selecione um token e clique no mapa, ou arraste da lista. Com zoom,
          use as barras de rolagem para navegar.
        </p>
      </div>
    </div>
  );
}
