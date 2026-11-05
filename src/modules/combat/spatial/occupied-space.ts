import { effectiveSizeOf, footprintOf } from './spatial-size.js';
import type {
  OccupiedSpace,
  SpatialPosition2D,
  SpatialSceneConfig,
  SpatialSize,
} from './spatial.types.js';

/**
 * Espaço ocupado DERIVADO: posição (âncora top-left) + tamanho efetivo.
 *
 * Nada de min/max persistidos — persistir só a posição evita divergência entre
 * a âncora e o retângulo. `position = null` significa NÃO COLOCADO (nunca 0,0).
 */
export function occupiedSpaceOf(
  position: SpatialPosition2D | null | undefined,
  size: SpatialSize,
): OccupiedSpace | null {
  if (!position) return null;
  const footprint = footprintOf(effectiveSizeOf(size));
  return {
    minXFeet: position.xFeet,
    minYFeet: position.yFeet,
    maxXFeet: position.xFeet + footprint.widthFeet,
    maxYFeet: position.yFeet + footprint.heightFeet,
    widthFeet: footprint.widthFeet,
    heightFeet: footprint.heightFeet,
  };
}

/**
 * O espaço ocupado cabe inteiro nos limites da cena? Bordas EXATAS no limite
 * são válidas (um Medium em x=95 numa cena de 100 pés termina em 100).
 */
export function spaceWithinScene(space: OccupiedSpace, scene: SpatialSceneConfig): boolean {
  return (
    space.minXFeet >= 0 &&
    space.minYFeet >= 0 &&
    space.maxXFeet <= scene.widthFeet &&
    space.maxYFeet <= scene.heightFeet
  );
}

/**
 * Sobreposição de espaços ocupados. Apenas TOCAR a borda NÃO é sobreposição
 * (comparação estrita em todos os eixos).
 *
 * Ajudante puro da fundação: NENHUMA regra de movimento/colisão o consome ainda
 * — collision/squeeze/path cost pertencem à 6.6L.3, e o Mestre precisa montar
 * o cenário livremente nesta fase.
 */
export function occupiedSpacesOverlap(a: OccupiedSpace, b: OccupiedSpace): boolean {
  return (
    a.minXFeet < b.maxXFeet &&
    b.minXFeet < a.maxXFeet &&
    a.minYFeet < b.maxYFeet &&
    b.minYFeet < a.maxYFeet
  );
}

/**
 * Posição persistida (JSONB) validada na LEITURA. JSON inválido/ilegível vira
 * `null` (unplaced) — nunca crash e nunca 0,0 inventado.
 */
export function parseStoredPosition(raw: unknown): SpatialPosition2D | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { xFeet?: unknown; yFeet?: unknown };
  if (typeof value.xFeet !== 'number' || typeof value.yFeet !== 'number') return null;
  if (!Number.isFinite(value.xFeet) || !Number.isFinite(value.yFeet)) return null;
  if (value.xFeet < 0 || value.yFeet < 0) return null;
  return { xFeet: value.xFeet, yFeet: value.yFeet };
}

/** Serialização canônica (ordem estável) para snapshots/logs. */
export function canonicalPosition(position: SpatialPosition2D | null): SpatialPosition2D | null {
  return position ? { xFeet: position.xFeet, yFeet: position.yFeet } : null;
}
