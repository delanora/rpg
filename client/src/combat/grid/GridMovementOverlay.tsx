import type { CSSProperties } from 'react';
import type { SpatialPosition, SpatialSize } from '../../types';
import { SIZE_FOOTPRINT_FEET, feetToPx } from './gridMath';

/**
 * FASE 6.6M.3 — OVERLAY do movimento (trajeto + ghost).
 *
 * Tudo aqui é APRESENTAÇÃO: a linha e o ghost são desenhados em PIXELS a
 * partir das âncoras pretendidas. Não há medida, custo nem regra nesta camada —
 * o trajeto válido/caro é o que o servidor devolveu no preview.
 *
 * O TOKEN REAL não se move durante o draft: o ghost é translúcido, decorativo
 * (`aria-hidden`) e nunca vira fonte de estado — a posição autoritativa
 * continua sendo a do DTO.
 */
export interface MovementOverlayGhost {
  position: SpatialPosition;
  size: SpatialSize;
  imageRef: string | null;
}

export interface GridMovementOverlayProps {
  path: readonly SpatialPosition[];
  ghost: MovementOverlayGhost | null;
  cellSizeFeet: number;
  pixelsPerCell: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxOf(
  position: SpatialPosition,
  size: SpatialSize,
  cellSizeFeet: number,
  pixelsPerCell: number,
): Box {
  const footprint = SIZE_FOOTPRINT_FEET[size];
  return {
    left: feetToPx(position.xFeet, cellSizeFeet, pixelsPerCell),
    top: feetToPx(position.yFeet, cellSizeFeet, pixelsPerCell),
    width: feetToPx(footprint.widthFeet, cellSizeFeet, pixelsPerCell),
    height: feetToPx(footprint.heightFeet, cellSizeFeet, pixelsPerCell),
  };
}

function centerOf(box: Box): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export function GridMovementOverlay({
  path,
  ghost,
  cellSizeFeet,
  pixelsPerCell,
}: GridMovementOverlayProps) {
  if (!ghost && path.length === 0) return null;
  const ghostBox = ghost ? boxOf(ghost.position, ghost.size, cellSizeFeet, pixelsPerCell) : null;
  const points = path.map((anchor) =>
    centerOf(boxOf(anchor, ghost?.size ?? 'medium', cellSizeFeet, pixelsPerCell)),
  );

  return (
    <>
      {points.length > 0 ? (
        <svg className="grid-movement-layer" aria-hidden="true">
          <polyline
            className="grid-movement-path"
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          />
          {points.map((point, index) => (
            <circle
              // Âncoras são posições do gesture; a ordem é a identidade aqui.
              key={`${point.x}-${point.y}-${index}`}
              className="grid-movement-point"
              cx={point.x}
              cy={point.y}
              r={2.5}
            />
          ))}
        </svg>
      ) : null}

      {ghost && ghostBox ? (
        <div
          className="grid-movement-ghost"
          aria-hidden="true"
          style={
            {
              left: `${ghostBox.left}px`,
              top: `${ghostBox.top}px`,
              width: `${ghostBox.width}px`,
              height: `${ghostBox.height}px`,
              '--grid-token-art': `${Math.max(10, Math.min(ghostBox.width, ghostBox.height) - 6)}px`,
            } as CSSProperties
          }
        >
          <span className="grid-movement-ghost-art">
            {ghost.imageRef ? <img src={ghost.imageRef} alt="" loading="lazy" /> : <span>?</span>}
          </span>
        </div>
      ) : null}
    </>
  );
}
