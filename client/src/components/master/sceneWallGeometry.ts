import type { SpatialPosition } from '../../types';
import type { SceneWallShape } from '../../sceneWallsApi';

const preciso = (value: number) => Math.round(value * 100) / 100;

/** Coordenadas do SVG são as da cena; zoom e scroll já estão no retângulo DOM. */
export function wallPointerPosition(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  scene: { widthFeet: number; heightFeet: number },
  snapFeet: number,
): SpatialPosition | null {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(client.x + client.y)) return null;
  const snap = (value: number, max: number) => preciso(Math.max(0, Math.min(max,
    snapFeet > 0 ? Math.round(value / snapFeet) * snapFeet : value)));
  return {
    xFeet: snap((client.x - rect.left) / rect.width * scene.widthFeet, scene.widthFeet),
    yFeet: snap((client.y - rect.top) / rect.height * scene.heightFeet, scene.heightFeet),
  };
}

/** Arrastar uma parede preserva comprimento e direção, mesmo junto à borda. */
export function translateWall(
  wall: SceneWallShape, delta: SpatialPosition, scene: { widthFeet: number; heightFeet: number },
): SceneWallShape {
  const dx = Math.max(-Math.min(wall.start.xFeet, wall.end.xFeet), Math.min(
    delta.xFeet, scene.widthFeet - Math.max(wall.start.xFeet, wall.end.xFeet)));
  const dy = Math.max(-Math.min(wall.start.yFeet, wall.end.yFeet), Math.min(
    delta.yFeet, scene.heightFeet - Math.max(wall.start.yFeet, wall.end.yFeet)));
  return { ...wall,
    start: { xFeet: preciso(wall.start.xFeet + dx), yFeet: preciso(wall.start.yFeet + dy) },
    end: { xFeet: preciso(wall.end.xFeet + dx), yFeet: preciso(wall.end.yFeet + dy) },
  };
}

/** Feedback local; a mesma intenção ainda precisa passar pela validação HTTP. */
export function wallDraftError(wall: SceneWallShape, scene: { widthFeet: number; heightFeet: number }): string | null {
  for (const point of [wall.start, wall.end]) {
    if (!Number.isFinite(point.xFeet + point.yFeet) || point.xFeet < 0 || point.yFeet < 0 ||
      point.xFeet > scene.widthFeet || point.yFeet > scene.heightFeet) return 'Os extremos precisam ficar dentro do mapa.';
  }
  if (wall.start.xFeet === wall.end.xFeet && wall.start.yFeet === wall.end.yFeet)
    return 'Escolha dois pontos diferentes para a parede.';
  return null;
}
