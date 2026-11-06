import type { CSSProperties } from 'react';
import type { SpatialPosition, SpatialSize } from '../../types';
import { SIZE_FOOTPRINT_FEET, spatialRectToScenePixels, tokenArtSize } from './gridMath';

/**
 * FASE 6.6M.3 — GHOST do movimento.
 *
 * Tudo aqui é APRESENTAÇÃO: o fantasma é o footprint pretendido desenhado em
 * PIXELS DE CENA (acompanha a câmera). Não há medida, custo nem regra nesta
 * camada — o trajeto válido/caro é o que o servidor devolveu no preview.
 *
 * O TOKEN REAL não se move durante o draft: o ghost é translúcido, decorativo
 * (`aria-hidden`) e nunca vira fonte de estado — a posição autoritativa
 * continua sendo a do DTO. A LINHA do trajeto vive em `GridMovementTrace`
 * (coordenadas de TELA), compartilhando o traço da régua.
 */
export interface MovementOverlayGhost {
  position: SpatialPosition;
  size: SpatialSize;
  imageRef: string | null;
}

export interface GridMovementOverlayProps {
  ghost: MovementOverlayGhost | null;
  cellSizeFeet: number;
  pixelsPerCell: number;
}

function boxOf(
  position: SpatialPosition,
  size: SpatialSize,
  cellSizeFeet: number,
  pixelsPerCell: number,
): { left: number; top: number; width: number; height: number } {
  const footprint = SIZE_FOOTPRINT_FEET[size];
  // MESMA projeção do token real: o ghost é livre, mas o tamanho é o footprint.
  return spatialRectToScenePixels(
    {
      xFeet: position.xFeet,
      yFeet: position.yFeet,
      widthFeet: footprint.widthFeet,
      heightFeet: footprint.heightFeet,
    },
    cellSizeFeet,
    pixelsPerCell,
  );
}

export function GridMovementOverlay({
  ghost,
  cellSizeFeet,
  pixelsPerCell,
}: GridMovementOverlayProps) {
  if (!ghost) return null;
  const box = boxOf(ghost.position, ghost.size, cellSizeFeet, pixelsPerCell);

  return (
    <div
      className="grid-movement-ghost"
      aria-hidden="true"
      style={
        {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          // Mesmo círculo inscrito do token real: nada de inset só no ghost.
          '--grid-token-art': `${tokenArtSize(box)}px`,
        } as CSSProperties
      }
    >
      <span className="grid-movement-ghost-art">
        {ghost.imageRef ? <img src={ghost.imageRef} alt="" loading="lazy" /> : <span>?</span>}
      </span>
    </div>
  );
}
