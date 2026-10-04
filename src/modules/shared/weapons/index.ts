import { WEAPONS } from './catalog.js';
import type { WeaponCategory } from '../item-details.js';
import type { CanonicalWeapon } from './types.js';

export * from './types.js';
export { WEAPONS } from './catalog.js';

/**
 * Catálogo canônico de armas do PHB 2014 — ver `catalog.ts` para a lista fechada.
 *
 * As funções abaixo são a única porta de entrada: nada aqui concede proficiência
 * nem rola dado; só resolvem id, categoria e a lista completa.
 */
const WEAPON_BY_ID: ReadonlyMap<string, CanonicalWeapon> = new Map(
  WEAPONS.map((weapon) => [weapon.id, weapon]),
);

/** Busca uma arma pelo id estável (ex.: "battleaxe"). */
export function getWeapon(id: string): CanonicalWeapon | undefined {
  return WEAPON_BY_ID.get(id.trim());
}

/** Armas de uma categoria (simples/marcial), na ordem do catálogo. */
export function weaponsByCategory(category: WeaponCategory): CanonicalWeapon[] {
  return WEAPONS.filter((weapon) => weapon.category === category);
}

/** Todas as armas, na ordem do catálogo (cópia — não muta o registro). */
export function allWeapons(): CanonicalWeapon[] {
  return [...WEAPONS];
}
