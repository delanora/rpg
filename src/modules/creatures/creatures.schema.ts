import { z } from 'zod';
import { attackSchema, damageTypeListSchema } from '../shared/attacks.js';
import { ABILITY_SCORE_MAX, ABILITY_SCORE_MIN } from '../shared/dnd5e.js';

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
  description: z.string().max(20000),
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
