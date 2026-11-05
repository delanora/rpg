import type { SpatialDistanceEvaluation } from './spatial-distance.js';

/**
 * FASE 6.6L.2 — ALCANCE (RANGE) A PARTIR DA DISTÂNCIA.
 *
 * Uma única estrutura para arma e magia: `evaluateRange` traduz
 * `distância + alcance declarado` em `in-range | long-range | out-of-range |
 * unknown`. Nada aqui conhece nome de arma/magia nem rola dado.
 *
 * PHB 2014:
 *  • Corpo a corpo: reach da criatura/arma (baseline 5 pés; a propriedade
 *    `reach` soma 5).
 *  • À distância: dois valores — NORMAL e LONGO. Até o normal, ataque normal;
 *    acima do normal até o longo, DESVANTAGEM; acima do longo, impossível.
 *  • Fronteiras são INCLUSIVAS (`distância == alcance` passa).
 */

export type RangeBand = 'normal' | 'long' | 'out';

export type RangeEvaluationStatus = 'in-range' | 'long-range' | 'out-of-range' | 'unknown';

export interface RangeEvaluation {
  status: RangeEvaluationStatus;
  /** Distância conhecida em pé (`null` quando o fato espacial não existe). */
  distanceFeet: number | null;
  /** Faixa em que a distância caiu (`null` em `unknown`). */
  band: RangeBand | null;
  /** Alcance usado: reach (corpo a corpo) ou normal/longo (à distância). */
  reachFeet: number | null;
  normalRangeFeet: number | null;
  longRangeFeet: number | null;
  provenance: 'grid-2d' | null;
  algorithm: string | null;
  reason: string | null;
}

export interface RangeInput {
  distance: SpatialDistanceEvaluation;
  reachFeet?: number | null;
  normalRangeFeet?: number | null;
  longRangeFeet?: number | null;
}

function unknownRange(distance: SpatialDistanceEvaluation, reason: string): RangeEvaluation {
  return {
    status: 'unknown',
    distanceFeet: null,
    band: null,
    reachFeet: null,
    normalRangeFeet: null,
    longRangeFeet: null,
    provenance: null,
    algorithm: null,
    reason,
  };
}

/**
 * Avalia o alcance. `unknown` NUNCA vira falha: sem fato espacial o fluxo
 * assistido (Mestre/confirmação) continua valendo, exatamente como antes.
 */
export function evaluateRange(input: RangeInput): RangeEvaluation {
  const { distance, reachFeet, normalRangeFeet, longRangeFeet } = input;
  if (distance.status !== 'known') {
    return unknownRange(distance, distance.reason);
  }
  const distanceFeet = distance.distanceFeet;
  const base = {
    distanceFeet,
    provenance: distance.provenance,
    algorithm: distance.algorithm,
    reason: null,
  };

  // Corpo a corpo: reach é inclusivo e vem do footprint mais próximo.
  if (typeof reachFeet === 'number') {
    const inReach = distanceFeet <= reachFeet;
    return {
      ...base,
      status: inReach ? 'in-range' : 'out-of-range',
      band: inReach ? 'normal' : 'out',
      reachFeet,
      normalRangeFeet: null,
      longRangeFeet: null,
    };
  }

  // Alcance ÚNICO (sem faixa longa): é um limite inclusivo, não "sem alcance".
  if (typeof normalRangeFeet === 'number' && typeof longRangeFeet !== 'number') {
    const inside = distanceFeet <= normalRangeFeet;
    return {
      ...base,
      status: inside ? 'in-range' : 'out-of-range',
      band: inside ? 'normal' : 'out',
      reachFeet: null,
      normalRangeFeet,
      longRangeFeet: null,
    };
  }

  if (typeof normalRangeFeet === 'number' && typeof longRangeFeet === 'number') {
    if (distanceFeet <= normalRangeFeet) {
      return {
        ...base,
        status: 'in-range',
        band: 'normal',
        reachFeet: null,
        normalRangeFeet,
        longRangeFeet,
      };
    }
    if (distanceFeet <= longRangeFeet) {
      return {
        ...base,
        status: 'long-range',
        band: 'long',
        reachFeet: null,
        normalRangeFeet,
        longRangeFeet,
      };
    }
    return {
      ...base,
      status: 'out-of-range',
      band: 'out',
      reachFeet: null,
      normalRangeFeet,
      longRangeFeet,
    };
  }

  // Sem alcance declarado não existe limite a impor (nunca inventamos um).
  return unknownRange(distance, 'range-not-declared');
}

/**
 * Alcance de ARMA vive em `shared/weapon-range` (camada pura reutilizada pela
 * derivação de ataques da ficha). Reexportado aqui para que o consumidor de
 * alcance tenha um único ponto de entrada.
 */
export {
  BASELINE_MELEE_REACH_FEET,
  REACH_PROPERTY_BONUS_FEET,
  metersToFeet,
  weaponRangeOf,
  type WeaponRange,
  type WeaponRangeKind,
} from '../../shared/weapon-range.js';
