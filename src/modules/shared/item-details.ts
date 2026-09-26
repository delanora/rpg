import { z } from 'zod';

/**
 * Atributos específicos de cada categoria de item e o preço em PO/PP/PC.
 *
 * Fica em `shared` porque é usado tanto pelo catálogo do mestre (módulo
 * `items`) quanto pelo inventário da ficha (módulo `characters`), que copia
 * esses atributos ao receber um item do catálogo.
 */

/** Categorias do catálogo central de itens. */
export const ITEM_CATEGORIES = [
  'Arma',
  'Armadura',
  'Escudo',
  'Poção',
  'Anel',
  'Cajado',
  'Item Geral',
  'Tesouro',
  'Outro',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * Atributos de item, todos opcionais. A categoria decide quais são usados
 * (ver `sanitizeItemDetails`), mas o formato é único para simplificar o JSONB.
 */
export const itemDetailsSchema = z.object({
  // Arma / Cajado
  damageCount: z.number().int().min(0).max(20).optional(),
  damageDie: z.number().int().min(0).max(100).optional(),
  damageType: z.string().trim().max(40).optional(),
  attackBonus: z.number().int().min(-30).max(30).optional(),
  /** Cajado também é foco de conjuração. */
  spellcastingFocus: z.boolean().optional(),
  // Armadura / Escudo
  armorClassBonus: z.number().int().min(-10).max(30).optional(),
  // Poção / Anel
  effectRoll: z.string().trim().max(60).optional(),
  duration: z.string().trim().max(120).optional(),
  attunement: z.boolean().optional(),
});

export type ItemDetails = z.infer<typeof itemDetailsSchema>;

/** Preço em peças de ouro (PO), prata (PP) e cobre (PC). */
export const itemPriceSchema = z.object({
  gold: z.number().int().min(0).max(9_999_999),
  silver: z.number().int().min(0).max(9_999_999),
  copper: z.number().int().min(0).max(9_999_999),
});

export type ItemPrice = z.infer<typeof itemPriceSchema>;

/** Campos usados por cada categoria; o resto é descartado ao salvar. */
const DETAIL_KEYS: Record<ItemCategory, (keyof ItemDetails)[]> = {
  Arma: ['damageCount', 'damageDie', 'damageType', 'attackBonus'],
  Cajado: ['damageCount', 'damageDie', 'damageType', 'attackBonus', 'spellcastingFocus'],
  Armadura: ['armorClassBonus'],
  Escudo: ['armorClassBonus'],
  Poção: ['effectRoll', 'duration'],
  Anel: ['effectRoll', 'attunement'],
  'Item Geral': [],
  Tesouro: [],
  Outro: [],
};

/** Normaliza os atributos: mantém só os campos que a categoria usa. */
export function sanitizeItemDetails(category: string, details: unknown): ItemDetails {
  const parsed = itemDetailsSchema.safeParse(details ?? {});
  if (!parsed.success) return {};

  const keys = DETAIL_KEYS[category as ItemCategory] ?? [];
  const result: ItemDetails = {};
  for (const key of keys) {
    const value = parsed.data[key];
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
