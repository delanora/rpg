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
  SKILL_KEYS,
  type AbilityKey,
} from '../shared/dnd5e.js';
import {
  CREATION_FIRST_STEP,
  CREATION_LAST_STEP,
  CREATION_ROLL_DICE,
} from '../shared/creation.js';

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

/**
 * Slots de equipamento do personagem (estilo Tibia). Cada slot comporta um
 * item por vez; equipar em um slot ocupado devolve o item anterior à mochila.
 */
export const INVENTORY_SLOTS = [
  'helmet',
  'necklace',
  'chest',
  'ring1',
  'ring2',
  'hand1',
  'hand2',
  'legs',
  'boots',
] as const;

export type InventorySlot = (typeof INVENTORY_SLOTS)[number];

export const inventorySlotSchema = z.enum(INVENTORY_SLOTS);

export const inventoryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'O item precisa de um nome.').max(120),
  description: shortText(2000).default(''),
  quantity: nonNegativeInt.default(1),
  weight: z.number().min(0).max(100000).default(0),
  /**
   * Slot em que o item está equipado (`null` = está na mochila). Nenhuma
   * restrição de categoria: qualquer item cabe em qualquer slot.
   */
  slot: inventorySlotSchema.nullable().default(null),
  /**
   * Posição do item na grade da mochila (`null` quando equipado em um slot ou
   * ainda sem posição definida).
   */
  backpackX: z.number().int().min(0).nullable().default(null),
  backpackY: z.number().int().min(0).nullable().default(null),
  /** Sprite do item (`/uploads/items/...`); vazio quando o item é avulso. */
  imageUrl: shortText(500).default(''),
  /** Id do item no catálogo do mestre, quando o item veio de lá. */
  itemId: shortText(60).default(''),
  /** Categoria do item no catálogo ('' quando avulso). */
  category: shortText(40).default(''),
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: itemDetailsSchema.default({}),
});

/** Lista de itens do inventário (limite de itens da mochila). */
export const inventoryListSchema = z.array(inventoryItemSchema).max(300);

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

export type SpellsStateInput = z.infer<typeof spellsStateSchema>;

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

/**
 * Move ou equipa um item do inventário (arrastar e soltar na ficha).
 *
 * - `targetSlot` definido equipa o item naquele slot.
 * - `targetBackpackX/Y` move o item para a grade da mochila.
 * Se o destino já tiver um item, os dois trocam de posição.
 */
export const moveInventoryItemSchema = z.object({
  /** Id do item dentro do array `inventory` da ficha (não é o id do catálogo). */
  itemInventoryId: z.string().min(1, 'Informe o item.'),
  targetSlot: inventorySlotSchema.nullable().optional(),
  targetBackpackX: z.number().int().min(0).nullable().optional(),
  targetBackpackY: z.number().int().min(0).nullable().optional(),
});

export type MoveInventoryItemInput = z.infer<typeof moveInventoryItemSchema>;

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
    /**
     * CA manual (override do mestre). A CA da ficha é CALCULADA a partir da
     * armadura equipada, dos atributos e da Defesa sem Armadura da classe;
     * `null` volta ao automático. O jogador nunca grava aqui.
     */
    armorClassOverride: z.number().int().min(0).max(99).nullable(),
    initiativeBonus: z.number().int().min(-30).max(30),
    speed: z.number().int().min(0).max(999),

    // Coleções
    skills: skillsStateSchema,
    saves: savesStateSchema,
    inventory: inventoryListSchema,
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

// --- Assistente de criação --------------------------------------------------
//
// O assistente salva o progresso PASSO A PASSO: cada requisição traz o passo
// concluído e só os campos daquele passo. O rascunho vive no próprio registro
// do personagem (`creationDraft`) e as escolhas que já são campos da ficha
// (nome, raça, antecedente, classe, atributos, perícias) são gravadas pelos
// mesmos caminhos da ficha — ver creation.service.ts.

/** Chave canônica de perícia (as 18 do livro básico). */
const skillKeySchema = z
  .string()
  .trim()
  .refine((value) => SKILL_KEYS.includes(value), 'Perícia desconhecida.');

/**
 * Uma rolagem de 4d6 do passo de atributos. Os valores vêm do SERVIDOR (o
 * dado é rolado em `POST /api/characters/me/creation/roll`) e voltam junto do
 * rascunho; aqui só são validados.
 */
export const creationRollSchema = z.object({
  dice: z.array(z.number().int().min(1).max(6)).length(CREATION_ROLL_DICE),
  /** Índice do dado descartado (o menor dos quatro). */
  dropped: z.number().int().min(0).max(CREATION_ROLL_DICE - 1),
});

/** Atributos BASE do passo 6 (antes dos bônus raciais). */
const creationAbilitiesSchema = z.record(
  z.enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]]),
  z.number().int().min(1).max(ABILITY_SCORE_MAX),
);

/** Pedido de rolagem de atributo (`restart` começa a lista de seis de novo). */
export const creationRollRequestSchema = z.object({
  restart: z.boolean().optional(),
});

export const creationStepSchema = z.object({
  /** Número do passo que acabou de ser concluído (1 a 9). */
  step: z.number().int().min(CREATION_FIRST_STEP).max(CREATION_LAST_STEP),
  /** Passo 1: como o personagem está sendo montado. */
  mode: z.enum(['new', 'existing']).optional(),
  /** Passo 2: identidade. */
  name: z.string().trim().min(1, 'O nome não pode ficar vazio.').max(120).optional(),
  alignment: shortText(60).optional(),
  avatarUrl: shortText(500).optional(),
  /** Passos 3 e 4: raça e antecedente (o passo 4 ainda é texto livre). */
  race: shortText(60).optional(),
  background: shortText(120).optional(),
  /**
   * Passo 3: atributos escolhidos para os `+1` da raça (Meio-Elfo escolhe dois).
   * Os atributos fora do `raceChoicePool` da raça são recusados no serviço.
   */
  abilityChoices: z
    .array(z.enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]]))
    .max(2)
    .optional(),
  /** Passo 5: classe inicial. */
  classKey: classKeySchema.optional(),
  /**
   * Passo 5: subclasse, quando a classe já a exige no nível 1 (Clérigo,
   * Feiticeiro e Bruxo escolhem Domínio/Origem/Patrono logo na primeira classe).
   */
  subclass: shortText(120).optional(),
  /** Passo 6: valores-base dos seis atributos. */
  baseAbilities: creationAbilitiesSchema.optional(),
  /** Passo 7: perícias com proficiência escolhidas na classe. */
  skills: z.array(skillKeySchema).max(18).optional(),
});

export type CreationStepInput = z.infer<typeof creationStepSchema>;
export type CreationRollRequestInput = z.infer<typeof creationRollRequestSchema>;
