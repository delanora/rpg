import { z } from 'zod';

/**
 * FASE 6.6L.1 — FUNDAÇÃO ESPACIAL (D&D 5e PHB 2014).
 *
 * Esta é a PRIMEIRA verdade espacial persistente do projeto. Ela responde
 * "onde este combatente está e qual espaço ocupa" — e NADA além disso:
 * distância, alcance, movimento, colisão, linha de visão, cobertura geométrica
 * e área geométrica continuam UNKNOWN/assistidos (6.6L.2/L.3).
 *
 * Unidade canônica: PÉS. O domínio nunca conhece pixels, zoom ou tamanho de
 * célula de renderização — a futura UI converte pés → pixels (6.6M.1).
 */

/** Tamanhos mecânicos do PHB 2014 (nunca colapsar Small em Medium). */
export const SPATIAL_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type SpatialSize = (typeof SPATIAL_SIZES)[number];

/** Rótulos usados no banco/cadastro do Mestre (mesma grafia de `Race.size`). */
export const CREATURE_SIZE_LABELS = [
  'Tiny',
  'Small',
  'Medium',
  'Large',
  'Huge',
  'Gargantuan',
] as const;
export type CreatureSizeLabel = (typeof CREATURE_SIZE_LABELS)[number];

/**
 * Modo espacial do combate/cena.
 *
 * - `assisted` (PADRÃO, inclusive para combates legados): nenhuma engine passa a
 *   confiar em posição — Cover/área/distância seguem como hoje.
 * - `grid-2d`: as posições passam a ser fonte espacial autoritativa para os
 *   providers FUTUROS. Ativar é ação explícita do MASTER e NÃO apaga posições
 *   ao voltar para `assisted`.
 */
export const SPATIAL_MODES = ['assisted', 'grid-2d'] as const;
export type SpatialMode = (typeof SPATIAL_MODES)[number];

/** Grid base desta fase: 5 pés por célula, sem hex/isométrico. */
export const GRID_CELL_SIZE_FEET = 5;

export const DEFAULT_SCENE_WIDTH_FEET = 100;
export const DEFAULT_SCENE_HEIGHT_FEET = 100;

/**
 * Posição 2D em PÉS.
 *
 * CONVENÇÃO CENTRAL: `position` NÃO é o centro visual do token — é a ÂNCORA do
 * espaço ocupado, o canto mínimo (top-left lógico): `x` cresce para a direita,
 * `y` cresce para baixo. O `occupiedSpace` é derivado daqui + tamanho efetivo.
 */
export interface SpatialPosition2D {
  xFeet: number;
  yFeet: number;
}

/** Retângulo ocupado, DERIVADO (nunca persistido). Bordas inclusivas. */
export interface OccupiedSpace {
  minXFeet: number;
  minYFeet: number;
  maxXFeet: number;
  maxYFeet: number;
  widthFeet: number;
  heightFeet: number;
}

/** Configuração espacial da cena, persistida em `Combat.spatialConfig`. */
export interface SpatialSceneConfig {
  mode: SpatialMode;
  widthFeet: number;
  heightFeet: number;
  cellSizeFeet: typeof GRID_CELL_SIZE_FEET;
}

/**
 * Validação da posição (§71): finita, não negativa, sem campos extras.
 * `NaN`/`Infinity` falham em `finite()`; o cliente nunca manda `occupiedSpace`.
 */
export const spatialPositionSchema = z
  .object({
    xFeet: z.number().finite().nonnegative().max(100_000),
    yFeet: z.number().finite().nonnegative().max(100_000),
  })
  .strict();

/** Configuração persistida — sempre lida por Zod, nunca por `as`. */
export const spatialSceneConfigSchema = z
  .object({
    mode: z.enum(SPATIAL_MODES),
    widthFeet: z.number().finite().positive().max(100_000),
    heightFeet: z.number().finite().positive().max(100_000),
    cellSizeFeet: z.literal(GRID_CELL_SIZE_FEET),
  })
  .strict();

/** Cena padrão (também usada por combates criados antes desta fase). */
export function defaultSpatialScene(): SpatialSceneConfig {
  return {
    mode: 'assisted',
    widthFeet: DEFAULT_SCENE_WIDTH_FEET,
    heightFeet: DEFAULT_SCENE_HEIGHT_FEET,
    cellSizeFeet: GRID_CELL_SIZE_FEET,
  };
}

/**
 * Config espacial do combate: JSON inválido/ausente cai no padrão `assisted`.
 * Nunca lança — um combate antigo NÃO pode quebrar por não ter estado espacial.
 */
export function spatialSceneOf(raw: unknown): SpatialSceneConfig {
  const parsed = spatialSceneConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultSpatialScene();
}
