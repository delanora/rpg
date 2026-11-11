import type { CombatDto } from '../../types';
import { GridAreaShape } from './GridAreaShape';
import { useAreaVisuals } from './areaVisual';
import type { GridCamera } from './gridCamera';
/** O público só recebe o desenho, sem controles nem lista de atingidos. */
export function GridSharedAreas({combat,camera,geometry}:{combat:Pick<CombatDto,'id'|'status'> & {combatants:{id:string;spatial:unknown}[]};camera:GridCamera;geometry:{cellSizeFeet:number;pixelsPerCell:number}}) {
  const previews=useAreaVisuals(combat.id);
  if(combat.status!=='ACTIVE')return null;
  return <>{previews.map(preview=>{
    const area=preview.area;
    if(!area || !combat.combatants.some(c=>c.id===area.combatantId&&c.spatial))return null;
    const shape=area.shape;
    return <GridAreaShape key={preview.previewId} camera={camera} geometry={geometry} damageType={area.damageType}
      marker={{center:area.origin,angle:area.angle,shape:shape.kind,widthFeet:shape.kind==='line'?shape.widthFeet:5,
        radiusFeet:'radiusFeet' in shape?shape.radiusFeet:'sizeFeet' in shape?shape.sizeFeet:shape.lengthFeet}}/>;
  })}</>;
}
