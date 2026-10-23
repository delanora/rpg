import { z } from 'zod';
import type { ItemDetails } from './item-details.js';
import { isConsumableItem } from './item-details.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import type { EconomyKind } from './action-economy.js';

/**
 * USO DE ITEM EM COMBATE — regra única (PHB 2014).
 *
 * O custo padrão é 1 AÇÃO. A função existe para que uma feature/item futuro
 * possa declarar outro custo SEM espalhar `'action'` pelo código; hoje nenhum
 * item carrega essa metadata e todos os consumíveis custam uma Ação.
 *
 * Nada aqui aplica efeito: a resolução (cura, dano, etc.) continua no motor do
 * servidor. Itens sem efeito modelado são "resolução pelo Mestre".
 */
export function itemUseEconomy(_details: ItemDetails): EconomyKind {
  return 'action';
}

/** Cura estruturada de uma poção de cura (automática). */
export function healingSpecOf(details: ItemDetails): { count: number; sides: number; bonus: number } | null {
  if (details.potionCategory !== 'healing' || !details.healingDice) return null;
  return details.healingDice;
}

/** Só entram no seletor itens realmente usáveis e com saldo. */
export function usableCombatItems(inventory: readonly InventoryItemDto[]): InventoryItemDto[] {
  return inventory.filter(
    (item) => item.quantity > 0 && isConsumableItem(item.category, item.details),
  );
}

/** Contrato do seletor compacto de "Usar Item". */
export interface CombatUsableItemDto {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  quantity: number;
  requiresAttunement: boolean;
  /** O servidor aplica o efeito (hoje só a cura estruturada). */
  automated: boolean;
  /** Efeito ainda não modelado: o uso é registrado e o Mestre resolve. */
  manual: boolean;
  healing: { count: number; sides: number; bonus: number } | null;
  /** Rolagem de efeito cadastrada (informativa; NÃO aplica nada). */
  effectRoll: string | null;
  /** Pode ser administrado em outro alvo (o servidor valida). */
  targetable: boolean;
}

export const combatUsableItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  imageUrl: z.string(),
  quantity: z.number().int().nonnegative(),
  requiresAttunement: z.boolean(),
  automated: z.boolean(),
  manual: z.boolean(),
  healing: z
    .object({ count: z.number().int(), sides: z.number().int(), bonus: z.number().int() })
    .nullable(),
  effectRoll: z.string().nullable(),
  targetable: z.boolean(),
});
