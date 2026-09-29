import { AMMO_TYPES } from './types';
import type { AmmoType, Attack, InventoryItem } from './types';

/**
 * Regras de MUNIÇÃO de arma à distância (espelha
 * `src/modules/shared/ammo.ts`).
 *
 * - Um ataque pode apontar para uma arma do inventário (`inventoryItemId`).
 * - A arma só "vale" se estiver EQUIPADA numa das mãos (`hand1`/`hand2`).
 * - Arma equipada com a propriedade `ammunition` exige (e consome) o
 *   `ammoType` dela, de uma pilha da categoria 'Munição'.
 */

/** Slots do set que contam como arma equipada. */
export const WEAPON_SLOTS: readonly string[] = ['hand1', 'hand2'];

/** Armas que podem ser vinculadas a um ataque. */
export function isWeaponItem(item: InventoryItem): boolean {
  return item.category === 'Arma' || item.category === 'Cajado';
}

export function isWeaponEquipped(item: InventoryItem | null | undefined): boolean {
  return Boolean(item && item.slot !== null && WEAPON_SLOTS.includes(item.slot));
}

/** Armas equipadas numa das mãos (candidatas a vínculo com um ataque). */
export function equippedWeapons(inventory: readonly InventoryItem[]): InventoryItem[] {
  return inventory.filter((item) => isWeaponItem(item) && isWeaponEquipped(item));
}

export function weaponOf(
  attack: Attack,
  inventory: readonly InventoryItem[],
): InventoryItem | null {
  if (!attack.inventoryItemId) return null;
  return inventory.find((item) => item.id === attack.inventoryItemId) ?? null;
}

/**
 * O ataque pode ser exibido/usado? Sem vínculo, sempre. Com vínculo, só quando
 * a arma apontada está equipada numa das mãos.
 */
export function attackIsAvailable(attack: Attack, inventory: readonly InventoryItem[]): boolean {
  if (!attack.inventoryItemId) return true;
  return isWeaponEquipped(weaponOf(attack, inventory));
}

/** Tipo de munição que a arma equipada exige (null = não exige / não equipada). */
export function requiredAmmoType(
  weapon: InventoryItem | null | undefined,
): AmmoType | null {
  if (!weapon || !isWeaponEquipped(weapon)) return null;
  if (!(weapon.details.properties ?? []).includes('ammunition')) return null;
  return weapon.details.ammoType ?? null;
}

/** Ataques que devem aparecer na ficha/combate com o inventário informado. */
export function availableAttacks(
  attacks: readonly Attack[],
  inventory: readonly InventoryItem[],
): Attack[] {
  return attacks.filter((attack) => attackIsAvailable(attack, inventory));
}

/** Pilhas de munição compatíveis (categoria 'Munição', mesmo tipo, com saldo). */
export function ammoStacks(
  inventory: readonly InventoryItem[],
  ammoType: AmmoType,
): InventoryItem[] {
  return inventory.filter(
    (item) =>
      item.quantity > 0 && item.category === 'Munição' && item.details.ammoType === ammoType,
  );
}

export function ammoStackTotal(stacks: readonly InventoryItem[]): number {
  return stacks.reduce((sum, item) => sum + item.quantity, 0);
}

/** Labels das pilhas para o seletor (ex.: "Flecha (12)"). */
export function ammoStackLabel(item: InventoryItem): string {
  return `${item.name} (${item.quantity})`;
}

/** Tipos de munição aceitos (reexportado para conveniência da UI). */
export { AMMO_TYPES };
