import { feetToMeters } from '../../sceneUnits';
import type { ElevationCell, SpatialPosition } from '../../types';
/** Overlay da superfície, no mesmo espaço transformado do mapa e dos tokens. */
export function GridElevations({
  cells,
  terrain,
  pixelsPerCell,
  widthFeet,
  heightFeet,
  path,
}: {
  cells?: ElevationCell[];
  terrain?: SpatialPosition[];
  pixelsPerCell: number;
  widthFeet: number;
  heightFeet: number;
  path?: SpatialPosition[];
}) {
  if (!cells?.length && !path?.length && !terrain?.length) return null;
  return (
    <svg
      className="grid-elevations"
      aria-hidden="true"
      viewBox={`0 0 ${widthFeet} ${heightFeet}`}
      preserveAspectRatio="none"
      style={{
        width: (widthFeet / 5) * pixelsPerCell,
        height: (heightFeet / 5) * pixelsPerCell,
      }}
    >
      {(terrain ?? []).map((cell) => (
        <g
          className="grid-terrain-cell"
          key={`terrain:${cell.xFeet}:${cell.yFeet}`}
        >
          <rect x={cell.xFeet} y={cell.yFeet} width={5} height={5} />
          <path
            d={`M${cell.xFeet + 0.7} ${cell.yFeet + 3.8}l1.1-1.6 1 1 1.4-2`}
          />
        </g>
      ))}
      {(cells ?? []).map((cell) => (
        <g
          key={`${cell.xFeet}:${cell.yFeet}`}
          className={cell.elevationFeet < 0 ? 'is-low' : ''}
        >
          <rect x={cell.xFeet} y={cell.yFeet} width={5} height={5} />
          <text x={cell.xFeet + 2.5} y={cell.yFeet + 3} textAnchor="middle">
            {feetToMeters(cell.elevationFeet).toLocaleString('pt-BR')} m
          </text>
        </g>
      ))}
      {path?.length ? (
        <polyline
          className="grid-elevation-request-path"
          points={path
            .map((p) => `${p.xFeet + 2.5},${p.yFeet + 2.5}`)
            .join(' ')}
        />
      ) : null}
    </svg>
  );
}
