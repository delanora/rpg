import { z } from 'zod';
import { attackSchema } from '../shared/attacks.js';
import { getClassDefinition } from '../shared/classes.js';
import {
  ABILITY_SCORE_MAX,
  ABILITY_SCORE_MIN,
  FEATURE_SOURCES,
  LEVEL_MAX,
  LEVEL_MIN,
} from '../shared/dnd5e.js';

/**
 * Schemas da ficha.
 *
 * Regra geral: as coleções (perícias, inventário, magias...) são substituídas
 * por inteiro quando enviadas — o cliente manda o estado completo daquela
 * seção. Isso evita merges profundos e mantém o PATCH previsível.
 */

const abilityScore = z
  .number()
  .int()
  .min(ABILITY_SCORE_MIN, `O valor mínimo de atributo é ${ABILITY_SCORE_MIN}.`)
  .max(ABILITY_SCORE_MAX, `O valor máximo de atributo é ${ABILITY_SCORE_MAX}.`);

const nonNegativeInt = z.number().int().min(0);
const shortText = (max: number) => z.string().trim().max(max);

/** Chave canônica de classe: vazia (sem classe) ou uma das 12 do registro. */
const classKeySchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => value === '' || getClassDefinition(value) !== null, 'Classe desconhecida.');

// --- Coleções ---------------------------------------------------------------

export const skillEntrySchema = z.object({
  proficient: z.boolean().default(false),
  expertise: z.boolean().default(false),
});

export const skillsStateSchema = z.record(z.string(), skillEntrySchema);

export const savesStateSchema = z.record(z.string(), z.boolean());

export const inventoryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: shortText(2000).default(''),
  quantity: nonNegativeInt.default(1),
  weight: z.number().min(0).max(100000).default(0),
  equipped: z.boolean().default(false),
  /** Sprite do item (`/uploads/items/...`); vazio quando o item é avulso. */
  imageUrl: shortText(500).default(''),
  /** Id do item no catálogo do mestre, quando o item veio de lá. */
  itemId: shortText(60).default(''),
});

export const spellSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'A magia precisa de um nome.').max(120),
  level: z.number().int().min(0).max(9),
  school: shortText(60).default(''),
  prepared: z.boolean().default(false),
  description: shortText(2000).default(''),
});

export const spellSlotSchema = z.object({
  max: nonNegativeInt.default(0),
  used: nonNegativeInt.default(0),
});

export const spellsStateSchema = z.object({
  list: z.array(spellSchema).max(300).default([]),
  slots: z.record(z.string(), spellSlotSchema).default({}),
});

// `attackSchema` vem de ../shared/attacks.ts — o formato é compartilhado com as criaturas.

export const featureSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'A característica precisa de um nome.').max(120),
  source: z.enum(FEATURE_SOURCES),
  description: shortText(4000).default(''),
});

/** Estado de runtime da classe: toggles ativos e usos gastos por recurso. */
export const classStateSchema = z.object({
  active: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  used: z.record(z.string(), z.number().int().min(0).max(99)).default({}),
});

// --- Criação ----------------------------------------------------------------

export const createCharacterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  race: shortText(60).optional(),
  className: shortText(60).optional(),
  classKey: classKeySchema.optional(),
  level: z.number().int().min(LEVEL_MIN).max(LEVEL_MAX).optional(),
});

// --- Atualização parcial (edição inline) ------------------------------------

export const updateCharacterSchema = z
  .object({
    // Identidade
    name: z.string().trim().min(1, 'O nome não pode ficar vazio.').max(120),
    race: shortText(60),
    className: shortText(60),
    classKey: classKeySchema,
    subclass: shortText(120),
    level: z.number().int().min(LEVEL_MIN).max(LEVEL_MAX),
    background: shortText(120),
    alignment: shortText(60),
    experience: nonNegativeInt.max(99_999_999),

    // Atributos
    strength: abilityScore,
    dexterity: abilityScore,
    constitution: abilityScore,
    intelligence: abilityScore,
    wisdom: abilityScore,
    charisma: abilityScore,

    // Vida e defesa
    hpCurrent: z.number().int().min(-999).max(9999),
    hpMax: z.number().int().min(0).max(9999),
    hpTemp: nonNegativeInt.max(9999),
    armorClass: z.number().int().min(0).max(99),
    initiativeBonus: z.number().int().min(-30).max(30),
    speed: z.number().int().min(0).max(999),

    // Coleções
    skills: skillsStateSchema,
    saves: savesStateSchema,
    inventory: z.array(inventoryItemSchema).max(300),
    spells: spellsStateSchema,
    attacks: z.array(attackSchema).max(100),
    features: z.array(featureSchema).max(200),
    classState: classStateSchema,

    // Vínculo com o catálogo de itens do mestre
    avatarUrl: shortText(500),

    // Texto livre
    notes: z.string().max(20000),
  })
  .partial();

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;
