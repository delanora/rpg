import type { SpatialPosition } from '../../types';

/**
 * FASE 6.6M.3.1 — CÂMERA do grid (pan + zoom).
 *
 * CLIENT-ONLY e PURA. Nada aqui vai ao banco, ao DTO ou a uma requisição:
 * `panX`, `panY` e `zoom` são pixels de TELA. Eles nunca alteram `xFeet`/`yFeet`,
 * `position`, footprint, distância, ocupação ou qualquer número mecânico — quem
 * converte pés↔pixels e vice-versa é `screenToFeet`/`sceneToScreen`, usados por
 * TODAS as ferramentas (placement, movimento, régua).
 *
 * Convenção: o plano da cena é desenhado em px de cena (`pixelsPerCell`) e a
 * câmera aplica `translate(panX, panY) scale(zoom)` com origem no canto
 * superior esquerdo. `screenToScene` remove a câmera; `sceneToScreen` a aplica.
 */
export interface GridCamera {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export const IDENTITY_CAMERA: GridCamera = { panX: 0, panY: 0, zoom: 1 };

/** Limites de zoom: só conforto visual, nunca escala mecânica. */
export const MIN_CAMERA_ZOOM = 0.35;
export const MAX_CAMERA_ZOOM = 3;

/** Margem confortável do "Enquadrar cena". */
export const CAMERA_FIT_MARGIN_PX = 28;

/** Quanto da cena pode sair do viewport antes do clamp (px visíveis). */
export const CAMERA_PAN_KEEP_PX = 96;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom));
}

/**
 * Câmera PRESERVADA ainda utilizável.
 *
 * Depois de desligar e religar o grid a câmera local é mantida (mesmo combate,
 * mesma cena), mas estado corrompido — `NaN`, zoom fora dos limites, zero —
 * NUNCA é herdado: quem chama decide reenquadrar em vez de desenhar lixo.
 */
export function cameraIsUsable(camera: GridCamera): boolean {
  return (
    Number.isFinite(camera.panX) &&
    Number.isFinite(camera.panY) &&
    Number.isFinite(camera.zoom) &&
    camera.zoom >= MIN_CAMERA_ZOOM &&
    camera.zoom <= MAX_CAMERA_ZOOM
  );
}

/** Coordenada de TELA (relativa ao viewport) → coordenada de CENA (px). */
export function screenToScene(camera: GridCamera, point: Point2D): Point2D {
  return {
    x: (point.x - camera.panX) / camera.zoom,
    y: (point.y - camera.panY) / camera.zoom,
  };
}

/** Coordenada de CENA (px) → coordenada de TELA (relativa ao viewport). */
export function sceneToScreen(camera: GridCamera, point: Point2D): Point2D {
  return {
    x: point.x * camera.zoom + camera.panX,
    y: point.y * camera.zoom + camera.panY,
  };
}

/**
 * Pés por pixel de CENA. A câmera NÃO entra aqui: o zoom é aplicado depois,
 * sobre pixels, então a conversão de ponteiro sempre passa por `screenToScene`
 * primeiro (nunca usa pixel de tela como coordenada mecânica).
 */
export function feetPerScenePixel(pixelsPerCell: number, cellSizeFeet: number): number {
  if (pixelsPerCell <= 0) return 0;
  return cellSizeFeet / pixelsPerCell;
}

/** Ponto de TELA → posição em PÉS (usado por placement, movimento e régua). */
export function screenToFeet(
  camera: GridCamera,
  point: Point2D,
  geometry: { pixelsPerCell: number; cellSizeFeet: number },
): SpatialPosition {
  const scene = screenToScene(camera, point);
  const factor = feetPerScenePixel(geometry.pixelsPerCell, geometry.cellSizeFeet);
  return { xFeet: scene.x * factor, yFeet: scene.y * factor };
}

/** Pés → pixels de CENA (desenho). */
export function feetToScenePixel(
  feet: SpatialPosition,
  geometry: { pixelsPerCell: number; cellSizeFeet: number },
): Point2D {
  if (geometry.cellSizeFeet <= 0) return { x: 0, y: 0 };
  return {
    x: (feet.xFeet / geometry.cellSizeFeet) * geometry.pixelsPerCell,
    y: (feet.yFeet / geometry.cellSizeFeet) * geometry.pixelsPerCell,
  };
}

export function panBy(camera: GridCamera, dx: number, dy: number): GridCamera {
  return { panX: camera.panX + dx, panY: camera.panY + dy, zoom: camera.zoom };
}

/**
 * Zoom mantendo o ponto SOB O CURSOR no mesmo lugar visual — o requisito de
 * "zoom toward cursor". Sem âncora explícita o chamador passa o centro do
 * viewport (botões +/−).
 */
export function zoomAt(camera: GridCamera, factor: number, anchor: Point2D): GridCamera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const ratio = zoom / camera.zoom;
  return {
    panX: anchor.x - (anchor.x - camera.panX) * ratio,
    panY: anchor.y - (anchor.y - camera.panY) * ratio,
    zoom,
  };
}

/** Centraliza a câmera num ponto da cena, preservando o zoom. */
export function centerCamera(camera: GridCamera, scenePoint: Point2D, viewport: Size2D): GridCamera {
  return {
    panX: viewport.width / 2 - scenePoint.x * camera.zoom,
    panY: viewport.height / 2 - scenePoint.y * camera.zoom,
    zoom: camera.zoom,
  };
}

/**
 * Enquadramento da cena inteira: zoom que caiba com margem (nunca amplia além
 * de 100%) e centralização. Não altera as dimensões mecânicas da cena.
 */
export function fitCamera(input: {
  scene: Size2D;
  viewport: Size2D;
  margin?: number;
}): GridCamera {
  const margin = input.margin ?? CAMERA_FIT_MARGIN_PX;
  const usableWidth = Math.max(1, input.viewport.width - margin * 2);
  const usableHeight = Math.max(1, input.viewport.height - margin * 2);
  const sceneWidth = Math.max(1, input.scene.width);
  const sceneHeight = Math.max(1, input.scene.height);
  const zoom = clampZoom(Math.min(1, usableWidth / sceneWidth, usableHeight / sceneHeight));
  return centerCamera(
    { panX: 0, panY: 0, zoom },
    { x: sceneWidth / 2, y: sceneHeight / 2 },
    input.viewport,
  );
}

/**
 * PAN BOUNDS: o usuário pode sair da cena, mas nunca "perder" o mapa — ao menos
 * `keep` px da cena continuam dentro do viewport em cada eixo.
 */
export function clampCamera(
  camera: GridCamera,
  scene: Size2D,
  viewport: Size2D,
  keep: number = CAMERA_PAN_KEEP_PX,
): GridCamera {
  const sceneWidth = Math.max(0, scene.width * camera.zoom);
  const sceneHeight = Math.max(0, scene.height * camera.zoom);
  const keepX = Math.min(keep, sceneWidth || keep);
  const keepY = Math.min(keep, sceneHeight || keep);
  const lowX = Math.min(keepX - sceneWidth, viewport.width - keepX);
  const highX = Math.max(keepX - sceneWidth, viewport.width - keepX);
  const lowY = Math.min(keepY - sceneHeight, viewport.height - keepY);
  const highY = Math.max(keepY - sceneHeight, viewport.height - keepY);
  return {
    panX: Math.min(highX, Math.max(lowX, camera.panX)),
    panY: Math.min(highY, Math.max(lowY, camera.panY)),
    zoom: clampZoom(camera.zoom),
  };
}

/** Percentual exibido na toolbar (arredondado para inteiro). */
export function cameraPercent(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100);
}

/** Velocidade do auto-pan (px/frame) conforme a distância até a borda. */
export function edgePanSpeed(
  pointer: number,
  start: number,
  end: number,
  edge: number,
  maxSpeed: number,
): number {
  if (edge <= 0) return 0;
  if (pointer < start + edge) {
    const depth = Math.min(1, Math.max(0, (start + edge - pointer) / edge));
    return maxSpeed * depth;
  }
  if (pointer > end - edge) {
    const depth = Math.min(1, Math.max(0, (pointer - (end - edge)) / edge));
    return -maxSpeed * depth;
  }
  return 0;
}
