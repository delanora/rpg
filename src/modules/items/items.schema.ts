import { z } from 'zod';

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

export const itemCategorySchema = z.enum(ITEM_CATEGORIES);

/** Campos editáveis de um item do catálogo. */
const itemFields = z.object({
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: z.string().max(20000),
  weight: z.number().min(0).max(100000),
  category: itemCategorySchema,
  /** URL do sprite (`/uploads/items/...`); vazio = sem imagem. */
  imageUrl: z.string().trim().max(500),
});

/** Criação: só o nome é obrigatório. */
export const createItemSchema = z.object({
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: z.string().max(20000).optional(),
  weight: z.number().min(0).max(100000).optional(),
  category: itemCategorySchema.optional(),
  imageUrl: z.string().trim().max(500).optional(),
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
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
