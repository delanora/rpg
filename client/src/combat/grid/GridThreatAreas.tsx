import type { MovementReactionReading } from '../../types';
import { spatialRectToScenePixels } from './gridMath';

/** Só projeta o contorno calculado pelo servidor; não detecta alcance ou hostilidade. */
export function GridThreatAreas({ areas, cellSizeFeet, pixelsPerCell }: {
  areas: MovementReactionReading['threatAreas']; cellSizeFeet: number; pixelsPerCell: number;
}) {
  return <>{(areas ?? []).map(area => {
    const box = spatialRectToScenePixels({ xFeet: area.minXFeet - area.reachFeet,
      yFeet: area.minYFeet - area.reachFeet, widthFeet: area.widthFeet + 2 * area.reachFeet,
      heightFeet: area.heightFeet + 2 * area.reachFeet }, cellSizeFeet, pixelsPerCell);
    return <div key={`${area.minXFeet}:${area.minYFeet}:${area.widthFeet}:${area.heightFeet}:${area.reachFeet}`} className="grid-threat-area" aria-hidden="true"
      style={{left: box.left, top: box.top, width: box.width, height: box.height}} />;
  })}</>;
}
