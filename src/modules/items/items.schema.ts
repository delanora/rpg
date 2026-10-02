import { z } from 'zod';
import {
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  itemDetailsSchema,
  itemPriceSchema,
  sanitizeItemDetails,
} from '../shared/item-details.js';

export { ITEM_CATEGORIES };
export type { ItemCategory } from '../shared/item-details.js';

export const itemCategorySchema = z.enum(ITEM_CATEGORIES);

/** Atributos específicos da categoria (dano, CA, rolagem de efeito, etc.). */
export const itemDetailsInputSchema = itemDetailsSchema;

/** Preço em peças de ouro/prata/cobre. */
export const itemPriceInputSchema = itemPriceSchema;

/** Campos editáveis de um item do catálogo. */
const itemFields = z.object({
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: z.string().max(20000),
  weight: z.number().min(0).max(100000),
  category: itemCategorySchema,
  /** Raridade do PHB 2014; `null` = sem raridade classificada. */
  rarity: z.enum(ITEM_RARITIES).nullable(),
  /** O item exige sintonização (propriedade manual, independente da raridade). */
  requiresAttunement: z.boolean(),
  /** URL do sprite (`/uploads/items/...`); vazio = sem imagem. */
  imageUrl: z.string().trim().max(500),
  details: itemDetailsInputSchema,
  price: itemPriceInputSchema,
});

/** Criação: só o nome é obrigatório. */
export const createItemSchema = z.object({
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: z.string().max(20000).optional(),
  weight: z.number().min(0).max(100000).optional(),
  category: itemCategorySchema.optional(),
  rarity: z.enum(ITEM_RARITIES).nullable().optional(),
  requiresAttunement: z.boolean().optional(),
  imageUrl: z.string().trim().max(500).optional(),
  details: itemDetailsInputSchema.optional(),
  price: itemPriceInputSchema.partial().optional(),
});

/** Edição: aceita qualquer subconjunto de campos. */
export const updateItemSchema = itemFields.partial();

/**
 * Envio de um item do catálogo ao inventário de um jogador.
 * O mestre não tem limite de quantidade — nem por envio, nem cumulativo.
 */
export const sendItemSchema = z.object({
  characterId: z.string().min(1),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type SendItemInput = z.infer<typeof sendItemSchema>;

export { sanitizeItemDetails };
