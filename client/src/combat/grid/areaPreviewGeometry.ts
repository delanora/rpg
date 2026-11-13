import type { CreatureAbility } from '../../types';
import type { AreaShapeKind } from '../../../../src/modules/spells/execution/area-targeting';
import type { SpatialPosition } from '../../types';

/** Desenho local, usando os nomes do contrato existente. Não decide atingidos. */
export type PreviewShape = AreaShapeKind;
export const PREVIEW_SHAPES: {
  kind: PreviewShape;
  label: string;
  symbol: string;
}[] = [
  { kind: 'sphere', label: 'Esfera', symbol: '○' },
  { kind: 'cone', label: 'Cone', symbol: '△' },
  { kind: 'line', label: 'Linha', symbol: '▰' },
  { kind: 'cube', label: 'Cubo', symbol: '□' },
  { kind: 'cylinder', label: 'Cilindro', symbol: '◎' },
];
export function previewDirectional(shape: PreviewShape): boolean {
  // A face de origem do cubo gira apenas como conveniência de apresentação.
  return shape === 'cone' || shape === 'line' || shape === 'cube';
}
export function previewAngle(
  origin: SpatialPosition,
  point: SpatialPosition,
  previous: number,
): number {
  const dx = point.xFeet - origin.xFeet,
    dy = point.yFeet - origin.yFeet;
  return Math.hypot(dx, dy) < 0.01 ? previous : Math.atan2(dy, dx);
}
/** Coordenadas relativas à origem em pés. O cone tem largura igual ao
 * comprimento na base; cubo usa o centro de uma face como origem visual. */
export function previewPolygon(
  shape: PreviewShape,
  length: number,
  width: number,
): string | null {
  if (shape === 'cone')
    return `0,0 ${length},${-length / 2} ${length},${length / 2}`;
  if (shape === 'cube') width = length;
  if (shape === 'line' || shape === 'cube')
    return `0,${-width / 2} ${length},${-width / 2} ${length},${width / 2} 0,${width / 2}`;
  return null;
}
export type AreaPreviewRequest = {
  ability?: {windowId?:string;combatantId:string;definition:CreatureAbility};
  id: number;
  shape: PreviewShape;
  origin: SpatialPosition;
};
