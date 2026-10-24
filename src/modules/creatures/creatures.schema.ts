import { z } from 'zod';
import { attackSchema, damageTypeListSchema } from '../shared/attacks.js';
import { ABILITY_SCORE_MAX, ABILITY_SCORE_MIN } from '../shared/dnd5e.js';
import { inventorySlotSchema } from '../characters/characters.schema.js';
import { itemDetailsSchema } from '../shared/item-details.js';
import { coinDeltaSchema } from '../shared/coins.js';

const abilityScore = z
  .number()
  .int()
  .min(ABILITY_SCORE_MIN)
  .max(ABILITY_SCORE_MAX);

/** Um NPC usa os mesmos campos de uma criatura, mas é uma entidade narrativa. */
export const creatureKindSchema = z.enum(['CREATURE', 'NPC']);

/** Vínculo com uma ou mais localidades (ver módulo `localities`). */
const localityIdsSchema = z
  .array(z.string().min(1))
  .min(1, 'Escolha ao menos uma localidade.')
  .max(50);

/** Todos os campos editáveis da criatura. */
const creatureFields = z.object({
  name: z.string().trim().min(1, 'A criatura precisa de um nome.').max(120),
  kind: creatureKindSchema,
  type: z.string().trim().max(60),
  challengeRating: z.string().trim().max(20),

  strength: abilityScore,
  dexterity: abilityScore,
  constitution: abilityScore,
  intelligence: abilityScore,
  wisdom: abilityScore,
  charisma: abilityScore,

  hpCurrent: z.number().int().min(-999).max(9999),
  hpMax: z.number().int().min(0).max(9999),
  armorClass: z.number().int().min(0).max(99),
  speed: z.number().int().min(0).max(999),

  attacks: z.array(attackSchema).max(100),
  resistances: damageTypeListSchema,
  immunities: damageTypeListSchema,
  vulnerabilities: damageTypeListSchema,
  description: z.string().max(20000),
  /** Ícone/retrato da criatura/NPC (`/uploads/creatures/...`). */
  imageUrl: z.string().trim().max(500),
});

/** Na criação só se informa o essencial; o resto vem dos padrões. */
export const createCreatureSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: creatureKindSchema.optional(),
  type: z.string().trim().max(60).optional(),
  challengeRating: z.string().trim().max(20).optional(),
  hpMax: z.number().int().min(0).max(9999).optional(),
  armorClass: z.number().int().min(0).max(99).optional(),
  localityIds: localityIdsSchema,
});

/** Edição inline: aceita qualquer subconjunto de campos. */
export const updateCreatureSchema = creatureFields.partial().extend({
  localityIds: localityIdsSchema.optional(),
});

export type CreateCreatureInput = z.infer<typeof createCreatureSchema>;
export type UpdateCreatureInput = z.infer<typeof updateCreatureSchema>;

/* -------------------------------------------------------------------------- */
/* Inventário e moedas do NPC (master-only, versionados)                       */
/* -------------------------------------------------------------------------- */

/**
 * Adicionar item ao inventário do NPC. `itemId` copia o snapshot do catálogo;
 * sem ele, o item é avulso e exige ao menos o nome. `expectedVersion` é a
 * trava de concorrência do cadastro do NPC.
 */
export const npcAddItemSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    itemId: z.string().min(1).max(60).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().trim().max(40).optional(),
    quantity: z.number().int().min(1).max(1_000_000).default(1),
    details: itemDetailsSchema.optional(),
    requiresAttunement: z.boolean().optional(),
  })
  .refine((input) => Boolean(input.itemId || input.name), {
    message: 'Informe o item do catálogo ou o nome do item.',
  });

/** Mover/equipar um item (mesma semântica da ficha: troca se o slot estiver ocupado). */
export const npcMoveItemSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  itemInventoryId: z.string().min(1),
  targetSlot: inventorySlotSchema.nullable(),
});

/** Remover unidades (a entrada some quando a quantidade chega a 0). */
export const npcRemoveItemSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  itemInventoryId: z.string().min(1),
  quantity: z.number().int().min(1).max(1_000_000).default(1),
});

/**
 * Usar (consumir) UMA unidade de um consumível do NPC FORA do combate.
 *
 * Em combate a autoridade é o motor de combate (turno + Ação) — esta rota é
 * recusada, para não virar um atalho da economia de turno.
 */
export const npcUseItemSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  itemInventoryId: z.string().min(1),
});

/** Sintonizar/dessintonizar UM item (limite de 3 em `shared/attunement.ts`). */
export const npcAttuneSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  itemInventoryId: z.string().min(1),
  attuned: z.boolean(),
});

/** Moedas do NPC: o Mestre dá (positivo) ou retira (negativo), como na ficha. */
export const npcCoinsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  delta: coinDeltaSchema,
});

export type NpcAddItemInput = z.infer<typeof npcAddItemSchema>;
export type NpcMoveItemInput = z.infer<typeof npcMoveItemSchema>;
export type NpcRemoveItemInput = z.infer<typeof npcRemoveItemSchema>;
export type NpcUseItemInput = z.infer<typeof npcUseItemSchema>;
export type NpcAttuneInput = z.infer<typeof npcAttuneSchema>;
export type NpcCoinsInput = z.infer<typeof npcCoinsSchema>;
