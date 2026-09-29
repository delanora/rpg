import type { AmmoType } from './item-details.js';

/**
 * Regras de MUNIÇÃO de arma à distância.
 *
 * Um ataque pode apontar para uma arma do inventário (`inventoryItemId`). A
 * partir daí:
 * - a arma só "vale" se estiver EQUIPADA numa das mãos (`hand1`/`hand2`);
 * - a arma equipada que declara a propriedade `ammunition` exige (e consome) o
 *   `ammoType` que ela indica, de uma pilha da categoria 'Munição'.
 *
 * Fica em `shared` porque o combate (servidor) e a ficha (cliente espelha)
 * usam exatamente a mesma regra.
 */

/** Slots do set que contam como arma equipada. */
export const WEAPON_SLOTS = ['hand1', 'hand2'] as const;

/** Mínimo que um item de inventário precisa ter para entrar na conta. */
export interface InventoryLike {
  id: string;
  slot: string | null;
  category: string;
  quantity: number;
  details: {
    properties?: readonly string[];
    ammoType?: string;
    attackBonus?: number;
    damageBonus?: number;
  };
}

/** A arma está equipada numa das mãos? */
export function isWeaponEquipped(item: InventoryLike | null | undefined): boolean {
  return Boolean(item && item.slot !== null && (WEAPON_SLOTS as readonly string[]).includes(item.slot));
}

/**
 * Tipo de munição que a arma exige. `null` quando ela não está equipada ou não
 * tem a propriedade `ammunition` (armas à distância sem munição não consomem).
 */
export function requiredAmmoType(weapon: InventoryLike | null | undefined): AmmoType | null {
  if (!weapon || !isWeaponEquipped(weapon)) return null;
  if (!(weapon.details.properties ?? []).includes('ammunition')) return null;
  return (weapon.details.ammoType as AmmoType | undefined) ?? null;
}

/** Pilhas de munição compatíveis (categoria 'Munição', mesmo tipo, com saldo). */
export function ammoStacks(
  inventory: readonly InventoryLike[],
  ammoType: AmmoType,
): InventoryLike[] {
  return inventory.filter(
    (item) =>
      item.quantity > 0 && item.category === 'Munição' && item.details.ammoType === ammoType,
  );
}

export function ammoStackTotal(stacks: readonly InventoryLike[]): number {
  return stacks.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Escolhe a pilha padrão: a preferida quando informada e válida; senão a SEM
 * bônus mágico primeiro e, depois, a de menor bônus (economiza a munição
 * mágica sem querer).
 */
export function chooseAmmoStack(
  stacks: readonly InventoryLike[],
  preferredId?: string,
): InventoryLike | null {
  if (stacks.length === 0) return null;
  if (preferredId) {
    const preferred = stacks.find((item) => item.id === preferredId);
    if (preferred) return preferred;
  }
  const bonusOf = (item: InventoryLike) =>
    (item.details.attackBonus ?? 0) + (item.details.damageBonus ?? 0);
  return [...stacks].sort((a, b) => bonusOf(a) - bonusOf(b))[0];
}
