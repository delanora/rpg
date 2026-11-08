import type { ItemDetails } from './item-details.js';

/**
 * ALCANCE DE ARMA a partir do dado ESTRUTURADO (PHB 2014).
 *
 * O catálogo do projeto guarda alcance de arma em METROS (`rangeNormal`/
 * `rangeLong`) com a convenção 1,5 m = 5 pés — a MESMA do grid. Converter metro
 * → pé é conversão de unidade, não regra nova: 6 m → 20 pés, 45 m → 150 pés.
 *
 * O alcance é SEMPRE derivado de propriedades estruturadas, nunca do nome da
 * arma: `reach` é uma propriedade, não "glaive/halberd/lance".
 */

/** Metro → pé (1,5 m = 5 pés). */
export function metersToFeet(meters: number): number {
  return Math.round((meters / 1.5) * 5 * 100) / 100;
}

/** Reach padrão de criatura/arma no PHB 2014. */
export const BASELINE_MELEE_REACH_FEET = 5;

/** A propriedade Reach acrescenta 5 pés ao reach (PHB 2014). */
export const REACH_PROPERTY_BONUS_FEET = 5;

export type WeaponRangeKind = 'melee' | 'ranged';

/** Alcance que um ataque de arma declara (corpo a corpo OU à distância). */
export interface WeaponRange {
  kind: WeaponRangeKind;
  reachFeet: number | null;
  normalRangeFeet: number | null;
  longRangeFeet: number | null;
}

/**
 * Alcance derivado da ARMA. Sem `rangeNormal/rangeLong` estruturados para um
 * ataque à distância, devolve `null` — e o ataque fica UNKNOWN (assistido) em
 * vez de receber um número inventado.
 */
export function weaponRangeOf(
  details: ItemDetails | null | undefined,
  kind: WeaponRangeKind,
): WeaponRange | null {
  const properties = details?.properties ?? [];
  if (kind === 'ranged') {
    if (typeof details?.rangeNormal !== 'number' || typeof details.rangeLong !== 'number') {
      return null;
    }
    const normal = metersToFeet(details.rangeNormal);
    const long = metersToFeet(details.rangeLong);
    if (!(long >= normal)) return null;
    return { kind: 'ranged', reachFeet: null, normalRangeFeet: normal, longRangeFeet: long };
  }
  // Alcance de arremesso nunca amplia o alcance corpo a corpo.
  const legacyReach = !properties.includes('thrown') && typeof details?.rangeNormal === 'number' && details.rangeNormal > 0
    ? metersToFeet(details.rangeNormal) : null;
  const reach = details?.meleeReachFeet ?? (legacyReach !== null
    ? Math.max(legacyReach, BASELINE_MELEE_REACH_FEET)
    : BASELINE_MELEE_REACH_FEET + (properties.includes('reach') ? REACH_PROPERTY_BONUS_FEET : 0));
  return { kind: 'melee', reachFeet: reach, normalRangeFeet: null, longRangeFeet: null };
}
