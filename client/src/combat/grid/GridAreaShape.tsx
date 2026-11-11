import type { CSSProperties } from 'react';
import { damageTypeSlug } from '../../damage';
import type { SpatialPosition } from '../../types';
import { feetToScenePixel, sceneToScreen, type GridCamera } from './gridCamera';
import { previewPolygon, type PreviewShape } from './areaPreviewGeometry';

export interface AreaVisualMarker {
  center: SpatialPosition;
  radiusFeet: number;
  widthFeet: number;
  shape: PreviewShape;
  angle: number;
}
/** A mesma geometria local e compartilhada; câmera muda só a projeção visual. */
export function GridAreaShape({marker,camera,geometry,damageType,draft=false}:{
  marker:AreaVisualMarker; camera:GridCamera;
  geometry:{cellSizeFeet:number;pixelsPerCell:number}; damageType?:string; draft?:boolean;
}) {
  const point=sceneToScreen(camera,feetToScenePixel(marker.center,geometry));
  const polygon=previewPolygon(marker.shape,marker.radiusFeet,marker.widthFeet);
  const style={'--area-accent':damageType?`var(--damage-${damageTypeSlug(damageType)})`:'var(--gold-bright)'} as CSSProperties;
  return <svg className="grid-area-shape" data-damage-family={damageTypeSlug(damageType)} aria-hidden="true" style={style}>
    <g transform={`translate(${point.x} ${point.y}) rotate(${marker.angle*180/Math.PI}) scale(${geometry.pixelsPerCell/geometry.cellSizeFeet*camera.zoom})`}>
      {polygon?<polygon className={draft?'is-draft':''} points={polygon} vectorEffect="non-scaling-stroke"/>:
        <circle className={draft?'is-draft':''} cx={0} cy={0} r={marker.radiusFeet} vectorEffect="non-scaling-stroke"/>}
    </g>
    <path d={`M${point.x-5},${point.y}h10 M${point.x},${point.y-5}v10`}/>
  </svg>;
}
