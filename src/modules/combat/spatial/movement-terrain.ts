import type { SpatialPosition2D, SpatialSize } from './spatial.types.js';

/**
 * FRONTEIRA DE TERRENO AMBIENTAL (Fase 6.6L.3).
 *
 * O PHB 2014 define difficult terrain ambiental (lama, floresta densa,
 * entulho...), mas o projeto AINDA NÃO tem camada de mapa/terreno. Este
 * contrato existe para que o motor de movimento pergunte por terreno desde já,
 * sem que o projeto invente geometria que não possui.
 *
 * `unknown` NUNCA bloqueia nem acrescenta custo: ausência de camada de terreno
 * não pode virar terreno difícil. O provider de produção devolve `normal`.
 */

export type MovementTerrainStatus = 'normal' | 'difficult' | 'unknown';

export interface MovementTerrainProvider {
  /** Status do terreno na posição (âncora do footprint), para um tamanho. */
  difficultAt(position: SpatialPosition2D, size: SpatialSize): MovementTerrainStatus;
}

/**
 * Provider de produção: SEM terreno ambiental desenhado.
 *
 * Limitação declarada: `environmental` em `difficultTerrainSources` só pode
 * aparecer quando uma camada de terreno for implementada (fase futura).
 */
export const walkingMovementTerrain: MovementTerrainProvider = {
  difficultAt: () => 'normal',
};
