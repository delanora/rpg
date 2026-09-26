import { z } from 'zod';
import { attackSchema } from '../shared/attacks.js';
import { MAX_CLASSES, getClassDefinition } from '../shared/classes.js';
import { itemDetailsSchema } from '../shared/item-details.js';
import {
  ABILITY_KEYS,
  ABILITY_SCORE_MAX,
  ABILITY_SCORE_MIN,
  FEATURE_SOURCES,
  LEVEL_MAX,
  LEVEL_MIN,
  type AbilityKey,
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

/**
 * Entrada de classe enviada pela ficha.
 *
 * O **nível nunca vem por aqui**: ele só muda pelo fluxo de Level Up, então o
 * campo é aceito (para o cliente mandar a lista inteira) mas ignorado ao salvar.
 */
export const classEntryInputSchema = z.object({
  classKey: classKeySchema.refine((value) => value !== '', 'Escolha uma classe.'),
  subclass: shortText(120).default(''),
  level: z.number().int().min(LEVEL_MIN).max(LEVEL_MAX).optional(),
});

/** Lista de classes do personagem (multiclasse). */
export const classEntriesInputSchema = z.array(classEntryInputSchema).max(MAX_CLASSES);

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
  /** Categoria do item no catálogo ('' quando avulso). */
  category: shortText(40).default(''),
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: itemDetailsSchema.default({}),
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
  /** Primeira classe (a ficha nasce no nível 1 dela). */
  classKey: classKeySchema.optional(),
});

/**
 * Level Up: escolha da classe (subir nela ou multiclassar), de como ganhar PV
 * e, quando o nível da classe concede, do Aumento de Atributo ou do Talento.
 * O dado de vida é rolado no SERVIDOR — o cliente só escolhe "rolar" ou "média".
 */
export const levelUpSchema = z.object({
  /** Classe que sobe de nível (existente, ou nova no multiclasse). */
  classKey: z.string().trim().min(1, 'Escolha uma classe.').max(40),
  /** Subclasse, quando o novo nível da classe libera a escolha. */
  subclass: shortText(120).default(''),
  hp: z.enum(['roll', 'average']),
  /** Aumento de Atributo: +2 em um atributo ou +1 em dois diferentes. */
  abilityIncreases: z
    .array(
      z.object({
        ability: z.enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]]),
        amount: z.number().int().min(1).max(2),
      }),
    )
    .max(2)
    .default([]),
  /** Talento escolhido (registro textual; sem efeito mecânico automatizado). */
  feat: z
    .object({
      name: z.string().trim().min(1, 'O talento precisa de um nome.').max(120),
      description: shortText(4000).default(''),
    })
    .nullable()
    .default(null),
});

export type LevelUpInput = z.infer<typeof levelUpSchema>;

// --- Atualização parcial (edição inline) ------------------------------------

export const updateCharacterSchema = z
  .object({
    // Identidade
    name: z.string().trim().min(1, 'O nome não pode ficar vazio.').max(120),
    race: shortText(60),
    /** Classes do personagem — ver o tratamento em characters.service.ts. */
    classes: classEntriesInputSchema,
    /**
     * O nível do personagem é SEMPRE derivado das classes (soma delas).
     * Aceito aqui apenas para o servidor recusar com uma mensagem clara, em
     * vez de um erro genérico de validação.
     */
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
