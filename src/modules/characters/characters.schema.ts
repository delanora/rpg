import { z } from 'zod';
import { attackSchema, damageTypeListSchema } from '../shared/attacks.js';
import { coinsSchema, coinAmountSchema, coinDeltaSchema } from '../shared/coins.js';
import { MAX_CLASSES, effectiveSpellSlotUsed, getClassDefinition } from '../shared/classes.js';
import { getTool } from '../shared/tools.js';
import { ITEM_RARITIES, campSupplySchema, itemDetailsSchema } from '../shared/item-details.js';
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
 * Escolhas da raça do catálogo estruturado: `{ [id da escolha]: id da opção }`.
 * É fundação — nada preenche ainda; a leitura é tolerante a lixo no JSONB.
 */
export const raceChoicesSchema = z.record(z.string(), z.string());

/**
 * Proficiências de armadura, arma e ferramenta — texto exibido na ficha.
 *
 * Campo de CONSTRUÇÃO: como as demais coleções, o valor enviado substitui o
 * anterior por inteiro (quem manda é a seção inteira). Entra pelo Level Up
 * (multiclasse) e pelas mãos do mestre — ver characters.service.ts.
 */
export const proficienciesSchema = z.object({
  armor: z.array(shortText(120)).max(60).default([]),
  weapons: z.array(shortText(120)).max(60).default([]),
  tools: z.array(shortText(120)).max(60).default([]),
});

/** Id de ferramenta do catálogo do PHB 2014 (ex.: "thieves-tools"). */
const toolIdSchema = z
  .string()
  .trim()
  .refine((value) => getTool(value) !== undefined, 'Ferramenta desconhecida.');

/**
 * Proficiências SIMPLES em ferramentas, pelos ids do catálogo
 * (src/modules/shared/tools). Diferente de `proficiencies.tools` (texto livre),
 * aqui só entram ids estáveis — é o que o futuro concede/rola usará.
 *
 * Campo de CONSTRUÇÃO: como as demais coleções, o valor enviado substitui o
 * anterior por inteiro. Entra pelas mãos do mestre; nesta etapa NADA concede
 * ferramenta automaticamente por classe, raça ou antecedente.
 */
export const toolProficienciesSchema = z.array(toolIdSchema).max(60);

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
  'ammo',
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
  /** Raridade do item no catálogo (`null` = sem raridade classificada). */
  rarity: z.enum(ITEM_RARITIES).nullable().default(null),
  /** O item exige sintonização (propriedade manual do mestre). */
  requiresAttunement: z.boolean().default(false),
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: itemDetailsSchema.default({}),
  /**
   * RECURSO DE ACAMPAMENTO (mecânica opcional do Descanso Longo coletivo).
   * Espelha o item do catálogo; em pilhas avulsas nasce desligado. Ver
   * src/modules/shared/item-details.ts.
   */
  campSupply: campSupplySchema.default({ enabled: false, value: 0 }),
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
  /**
   * Chave da classe quando a magia veio do catálogo (Prompt 6.2); vazia nas
   * magias de texto livre. É o que permite agrupar e trocar as magias POR CLASSE.
   */
  classKey: shortText(40).default(''),
  /**
   * Magia DERIVADA de juramento (Prompt 6.3), não gravada: sempre preparada, fora
   * do limite e não removível. Nunca vai ao banco — só o DTO a marca assim.
   */
  oath: z.boolean().optional(),
  /**
   * Magia DERIVADA da RAÇA (Prompt 6.4), não gravada: sempre preparada, fora do
   * limite e conjurada sem espaço. Come só do DTO.
   */
  race: z.boolean().optional(),
  /** Atributo de conjuração da magia racial (independente da classe). */
  raceAbility: z
    .enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]])
    .optional(),
  /** CD da magia racial (8 + proficiência + mod. do atributo da raça). */
  raceSaveDC: z.number().int().optional(),
  /** Bônus de ataque da magia racial (proficiência + mod. do atributo da raça). */
  raceAttackBonus: z.number().int().optional(),
  /** Nível de ESPAÇO usado ao conjurar a magia racial (ex.: Repreensão Infernal = 2). */
  raceCastLevel: z.number().int().min(0).max(9).optional(),
  /**
   * Contador das magias raciais 1x/descanso longo (o reset automático NÃO existe
   * nesta fase — Categoria B do Prompt 6.4). Ausente nas magias à vontade.
   */
  raceUses: z
    .object({ max: z.number().int(), used: z.number().int() })
    .optional(),
});

/** Chave de nível de espaço de magia: 1 a 9 (não existe 0 nem 10+). */
export const spellSlotLevelSchema = z
  .string()
  .regex(/^[1-9]$/, 'Nível de espaço de magia inválido (use 1 a 9).');

/**
 * Magia de Pacto (Bruxo): a ÚNICA informação persistida é o USO. O total
 * (`max`) e o nível do espaço (`slotLevel`) são DERIVADOS do nível de Bruxo
 * (`pactMagicSlots`) e vivem só no `derived` do DTO — nunca no estado gravado.
 *
 * Fichas antigas (sem `pactMagic`) parseiam como `{ used: 0 }`.
 */
export const pactMagicStateSchema = z.object({
  used: nonNegativeInt.default(0),
});

/**
 * Estado de magias GRAVADO (formato ATUAL):
 *
 *   { list, slotsUsed: { "1": 2 }, pactMagic: { used: 1 } }
 *
 * SÓ O CONSUMO é persistido. A capacidade máxima é REGRA DERIVADA
 * (`derived.spellSlots` / `derived.pactSlots`) e NUNCA vai para o banco.
 *
 * O shape antigo (`slots[level] = { max, used }`) sobrevive apenas na LEITURA e
 * na ENTRADA, durante a janela de migração — ver `spellSlotsUsedFrom` e o
 * backfill em `src/scripts/migrate-spell-slots.ts`.
 */
export const spellsStateSchema = z.object({
  list: z.array(spellSchema).max(300).default([]),
  /** Uso por nível (chaves 1..9). Ausência de chave = 0 usados. */
  slotsUsed: z.record(z.string(), nonNegativeInt).default({}),
  pactMagic: pactMagicStateSchema.default({ used: 0 }),
});

export type SpellsStateInput = z.infer<typeof spellsStateSchema>;

/**
 * Shape ANTIGO de um espaço (`{ max, used }`), aceito SÓ na entrada de um PATCH
 * durante a janela de deploy: o serviço aproveita o `used` e DESCARTA o `max`.
 * Nada deste shape é persistido. Ver `characters.service.ts`.
 */
const legacySpellSlotSchema = z.object({
  max: nonNegativeInt.default(0),
  used: nonNegativeInt.default(0),
});

/**
 * PATCH de `spells`: igual ao estado gravado, mas com as chaves que precisam
 * distinguir AUSÊNCIA de valor:
 *
 * - `slotsUsed`/`pactMagic` são OPCIONAIS: omitir significa "não mexer" (o
 *   serviço preserva o uso gravado). Sem isso, um ajuste administrativo da
 *   ficha — editar a lista de magias, por exemplo — zeraria o uso e concederia
 *   uma recuperação de espaço que só o descanso longo faz.
 * - `slots` (shape antigo) é aceito e convertido apenas no `used`.
 * - As chaves de `slotsUsed` são validadas (1..9).
 */
export const spellsPatchSchema = spellsStateSchema.extend({
  slotsUsed: z.record(spellSlotLevelSchema, nonNegativeInt).optional(),
  pactMagic: pactMagicStateSchema.optional(),
  slots: z.record(z.string(), legacySpellSlotSchema).optional(),
});

export type SpellsPatchInput = z.infer<typeof spellsPatchSchema>;

/**
 * Uso dos espaços NORMAIS a partir do estado GRAVADO, já SANEADO contra o max
 * DERIVADO de cada nível:
 *
 *   used = min(max(0, gravado), derivado)
 *
 * Níveis fora de 1..9, níveis SEM espaço derivado (max 0) e usos zerados NÃO
 * entram — ausência de chave significa uso 0 (é o formato gravado:
 * `slotsUsed`).
 *
 * O shape ANTIGO (`slots[level] = { max, used }`) é aceito SÓ aqui, durante a
 * migração: o `max` é DESCARTADO (capacidade é regra derivada) e apenas o `used`
 * é aproveitado. Se as duas formas aparecerem, o `slotsUsed` explícito vence
 * nível a nível.
 */
export function spellSlotsUsedFrom(
  raw: unknown,
  maxByLevel: Record<string, number>,
): Record<string, number> {
  const source = (raw ?? {}) as { slotsUsed?: unknown; slots?: unknown };
  const used: Record<string, number> = {};
  const explicit = new Set<string>();

  const take = (level: string, value: unknown): void => {
    if (!/^[1-9]$/.test(level)) return;
    if (typeof value !== 'number' || !Number.isInteger(value)) return;
    const max = maxByLevel[level] ?? 0;
    if (max <= 0) return;
    const clamped = effectiveSpellSlotUsed(value, max);
    if (clamped > 0) used[level] = clamped;
  };

  if (source.slotsUsed && typeof source.slotsUsed === 'object') {
    for (const [level, value] of Object.entries(source.slotsUsed as Record<string, unknown>)) {
      if (!/^[1-9]$/.test(level)) continue;
      explicit.add(level);
      take(level, value);
    }
  }
  if (source.slots && typeof source.slots === 'object') {
    for (const [level, slot] of Object.entries(source.slots as Record<string, unknown>)) {
      if (explicit.has(level)) continue;
      take(level, (slot as { used?: unknown } | null)?.used);
    }
  }

  return used;
}

/**
 * Reescreve o `slotsUsed` PRESERVANDO o resto do estado gravado (`list`,
 * `pactMagic` e campos adicionais) e DESCARTANDO o shape antigo `slots`. É o
 * que os descansos, o Level Down e o backfill usam para persistir o uso saneado
 * sem tocar no resto.
 */
export function withSpellSlotsUsed(
  raw: unknown,
  slotsUsed: Record<string, number>,
): Record<string, unknown> {
  const { slots: _legacy, ...rest } = (raw ?? {}) as Record<string, unknown>;
  return { ...rest, slotsUsed };
}

/** Uma magia escolhida do catálogo para uma classe. */
export const spellbookEntrySchema = z.object({
  key: z.string().trim().min(1).max(80),
  prepared: z.boolean().default(false),
});

/** Corpo de `PUT /me/spellbook`: a seleção de magias de UMA classe. */
export const spellbookSchema = z.object({
  classKey: z.string().trim().min(1, 'Escolha uma classe.').max(40),
  entries: z.array(spellbookEntrySchema).max(300).default([]),
});

export type SpellbookInput = z.infer<typeof spellbookSchema>;

// `attackSchema` vem de ../shared/attacks.ts — o formato é compartilhado com as criaturas.

export const featureSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'A característica precisa de um nome.').max(120),
  source: z.enum(FEATURE_SOURCES),
  description: shortText(4000).default(''),
  /**
   * Id ESTÁVEL do talento no catálogo (`shared/feats`) — só nas features de
   * `source: 'feat'`. É o que liga a escolha gravada ao efeito mecânico do
   * talento no `derived`.
   */
  featId: z.string().trim().max(60).optional(),
  /**
   * Atributo escolhido nos talentos "meio-talentos" (ex.: Atleta: FOR ou DES).
   * Só existe junto de `featId` e de um talento com `abilityChoice`.
   */
  featAbility: z
    .enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]])
    .optional(),
});

/**
 * Estado de runtime da classe: toggles ativos, usos gastos por recurso e as
 * escolhas de característica (`choices[featureId] = [opção, ...]`).
 * As escolhas também são CONSTRUÇÃO — com a criação finalizada só o Level Up e o
 * mestre as mudam (ver assertPlayerCanPatch).
 */
export const featureChoicesSchema = z
  .record(z.string().trim().min(1).max(60), z.array(z.string().trim().min(1).max(80)).max(8))
  .default({});

export const classStateSchema = z.object({
  active: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  used: z.record(z.string(), z.number().int().min(0).max(99)).default({}),
  choices: featureChoicesSchema,
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
  /**
   * Perícia concedida pela ENTRADA numa classe nova por multiclasse (Bardo:
   * qualquer; Patrulheiro e Ladino: da lista da classe). A validade é conferida
   * no serviço, contra a classe escolhida.
   */
  skillChoice: z.string().trim().max(40).default(''),
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
  /**
   * Escolhas de característica do nível que está sendo ganho (ex.: Estilo de
   * Luta no 1º nível do Guerreiro): `{ [id da característica]: [opções] }`. A
   * validade é conferida no serviço, contra as características daquela classe.
   */
  choices: featureChoicesSchema,
  /**
   * Talento escolhido no nível de Aumento de Atributo. `id` liga ao catálogo
   * (`shared/feats`) e dá efeito mecânico; `ability` é a sub-escolha dos
   * "meio-talentos" (ex.: Atleta: Força ou Destreza). Sem `id` reconhecido, o
   * talento continua valendo como registro textual (compatibilidade).
   */
  feat: z
    .object({
      id: z.string().trim().max(60).optional(),
      name: z.string().trim().min(1, 'O talento precisa de um nome.').max(120),
      description: shortText(4000).default(''),
      ability: z
        .enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]])
        .optional(),
    })
    .nullable()
    .default(null),
});

export type LevelUpInput = z.infer<typeof levelUpSchema>;

/**
 * Downgrade de nível — exclusivo do MESTRE (`POST /api/characters/:id/level-down`).
 *
 * Tira UM nível de uma classe escolhida e reverte o que aquele nível concedeu,
 * usando o histórico gravado pelo Level Up (PV rolado, Aumento de Atributo ou
 * Talento, escolhas, subclasse, perícia de multiclasse e proficiências).
 *
 * Os campos opcionais existem para os níveis ANTERIORES ao histórico: ali o PV é
 * estimado pela média do dado de vida e o resto o mestre informa.
 */
export const levelDownSchema = z.object({
  /** Classe que perde um nível. */
  classKey: z.string().trim().min(1, 'Escolha a classe.').max(40),
  /**
   * PV a retirar. Padrão: o que o histórico registrou (dado de vida +
   * Constituição + ajuste retroativo de Constituição).
   */
  hpLost: z.number().int().min(0).max(999).optional(),
  /**
   * Aumentos de atributo a desfazer ALÉM do que o histórico manda. Nenhum
   * atributo fica abaixo de 1.
   */
  abilityDecreases: z
    .array(
      z.object({
        ability: z.enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]]),
        amount: z.number().int().min(1).max(2),
      }),
    )
    .max(2)
    .default([]),
  /** Id da característica (talento) a remover além do que o histórico registra. */
  removeFeatId: z.string().trim().min(1).max(80).optional(),
});

export type LevelDownInput = z.infer<typeof levelDownSchema>;

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

/**
 * Usa (consome) UMA unidade de um item do inventário.
 *
 * Só vale para Poção ou para item marcado como consumível pelo mestre; se o
 * item tiver `effectRoll`, o servidor rola a expressão e devolve o resultado.
 */
export const useInventoryItemSchema = z.object({
  itemInventoryId: z.string().min(1, 'Informe o item.'),
});

export type UseInventoryItemInput = z.infer<typeof useInventoryItemSchema>;

/**
 * Gasta UM Dado de Vida no descanso curto (PHB 2014).
 *
 * O cliente NUNCA diz quantos gastar: o endpoint gasta exatamente um dado do
 * tipo escolhido. `expectedVersion` é a `version` da ficha que o jogador tem em
 * mãos (a escrita só vale se ela ainda for a atual); `operationId` identifica o
 * pedido para que um reenvio não role o dado nem o consuma de novo.
 */
/**
 * Identificador de operação idempotente (ex.: um UUID gerado no cliente).
 * Formato seguro e com tamanho limitado — é a chave usada em
 * `CharacterOperation` para reconhecer um reenvio.
 */
export const operationIdSchema = z
  .string()
  .trim()
  .min(8, 'Identificador de operação muito curto.')
  .max(100, 'Identificador de operação muito longo.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador de operação inválido.');

/** Id de uma sessão de Descanso Curto (cuid do banco). */
const shortRestSessionIdSchema = z
  .string()
  .trim()
  .min(1, 'Informe a sessão de descanso.')
  .max(60);

/** Versão da ficha que o cliente acredita ser a atual (inteiro >= 1). */
const expectedVersionSchema = z.number().int().min(1);

/**
 * Inicia uma sessão de Descanso Curto.
 *
 * `expectedVersion` valida que o cliente tem a ficha atual; `operationId`
 * protege o início contra reenvio (idempotente).
 */
export const startShortRestSchema = z.object({
  expectedVersion: expectedVersionSchema,
  operationId: operationIdSchema,
});

export type StartShortRestInput = z.infer<typeof startShortRestSchema>;

/**
 * Ação sobre uma sessão existente (finalizar ou cancelar).
 *
 * `sessionId` identifica a sessão (entra no fingerprint da operação); os outros
 * dois campos são a proteção contra concorrência e duplicação.
 */
export const shortRestSessionActionSchema = z.object({
  sessionId: shortRestSessionIdSchema,
  expectedVersion: expectedVersionSchema,
  operationId: operationIdSchema,
});

export type ShortRestSessionActionInput = z.infer<typeof shortRestSessionActionSchema>;

/**
 * Gasta UM Dado de Vida DENTRO de uma sessão de Descanso Curto.
 *
 * Altera o endpoint anterior: agora exige a sessão ATIVA (`sessionId`). O
 * cliente NUNCA diz quantos gastar — o endpoint gasta exatamente um dado do
 * tipo escolhido.
 */
export const spendHitDieSchema = z.object({
  /** Sessão de Descanso Curto à qual o gasto pertence. */
  sessionId: shortRestSessionIdSchema,
  /** Face do Dado de Vida a gastar (só os d6/d8/d10/d12 do PHB). */
  die: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  expectedVersion: expectedVersionSchema,
  operationId: operationIdSchema,
});

export type SpendHitDieInput = z.infer<typeof spendHitDieSchema>;

// --- Moedas -----------------------------------------------------------------
//
// Só o mestre dá ou retira (PATCH e `POST /:id/coins`); o jogador gasta, troca
// e transfere pelos endpoints próprios. Nenhuma cobrança cabe no PATCH do
// jogador — ver assertPlayerCanPatch.

/** O mestre dá (positivo) ou retira (negativo) moedas de uma ficha. */
export const giveCoinsSchema = z.object({
  /** Delta por denominação: { pp?, gp?, ep?, sp?, cp? }. */
  delta: coinDeltaSchema,
});

/** Gasta exatamente as moedas informadas do próprio saldo (sem troco). */
export const spendCoinsSchema = z.object({
  amount: coinAmountSchema,
  /** Observação livre do gasto (não entra em histórico — fora do escopo). */
  note: shortText(200).optional(),
});

/** Transfere moedas para outro personagem de jogador. */
export const transferCoinsSchema = z.object({
  targetCharacterId: z.string().min(1, 'Escolha o personagem de destino.'),
  amount: coinAmountSchema,
});

export type GiveCoinsInput = z.infer<typeof giveCoinsSchema>;
export type SpendCoinsInput = z.infer<typeof spendCoinsSchema>;
export type TransferCoinsInput = z.infer<typeof transferCoinsSchema>;

// --- Atualização parcial (edição inline) ------------------------------------

export const updateCharacterSchema = z
  .object({
    // Identidade
    name: z.string().trim().min(1, 'O nome não pode ficar vazio.').max(120),
    race: shortText(60),
    /**
     * Raça/sub-raça do catálogo ESTRUTURADO (`shared/races`), pelo id. Campo de
     * construção — com a criação finalizada só o mestre grava. Trocar a
     * sub-raça liga/desliga o bônus de PV da Robustez Anã (ver o serviço).
     */
    raceId: z.string().trim().max(60).nullable(),
    subraceId: z.string().trim().max(60).nullable(),
    /** Raça PERSONALIZADA do mestre (id de CustomRace). */
    customRaceId: z.string().trim().max(60).nullable(),
    /** Escolhas da raça: `{ [id da escolha]: id da opção }`. */
    raceChoices: z.record(z.string().trim().max(60), z.string().trim().max(60)),
    /** Idiomas conhecidos (texto), concedidos pela raça/antecedente. */
    languages: z.array(z.string().trim().min(1).max(60)).max(20),
    /** Visão no escuro em metros (0 = sem). */
    darkvision: z.number().int().min(0).max(120),
    /** Tipos de dano resistidos concedidos pela RAÇA. */
    raceResistances: damageTypeListSchema,
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
    speed: z.number().min(0).max(999),

    // Coleções
    skills: skillsStateSchema,
    saves: savesStateSchema,
    proficiencies: proficienciesSchema,
    toolProficiencies: toolProficienciesSchema,
    inventory: inventoryListSchema,
    /**
     * Carteira de moedas { pp, gp, ep, sp, cp }. Campo de CONSTRUÇÃO: o jogador
     * NUNCA altera por PATCH (403, mesmo antes de finalizar a criação) — só o
     * mestre por aqui e pelas ações de gastar, trocar e transferir.
     */
    coins: coinsSchema,
    spells: spellsPatchSchema,
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
  /** Passos 3 e 4: raça (nome/chave do catálogo) e antecedente. */
  race: shortText(120).optional(),
  background: shortText(120).optional(),
  /**
   * Passo 3: escolhas da raça `{ [id da escolha]: id da opção }` — exceto as de
   * atributo, que vão em `abilityChoices`. Ex.: ancestralidade do Draconato,
   * perícias do Meio-Elfo, ferramenta do Anão.
   */
  raceChoices: z.record(z.string().trim().max(60), z.string().trim().max(60)).optional(),
  /**
   * Passo 3: atributos escolhidos para os `+1` da raça (Meio-Elfo escolhe dois).
   * Os atributos fora do `raceChoicePool` da raça são recusados no serviço.
   */
  abilityChoices: z
    .array(z.enum(ABILITY_KEYS as unknown as [AbilityKey, ...AbilityKey[]]))
    .max(2)
    .optional(),
  /**
   * Passo 3: idiomas escolhidos quando a raça concede idioma(s) à escolha
   * (Humano e Meio-Elfo concedem 1). Validados contra o catálogo no serviço.
   */
  languageChoices: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
  /**
   * Passo 4: ferramentas escolhidas nas categorias do antecedente
   * (`{ [id da escolha]: id da ferramenta }`), validadas contra o catálogo.
   */
  backgroundToolChoices: z.record(z.string().trim().max(60), z.string().trim().max(60)).optional(),
  /**
   * Passo 4: idiomas escolhidos quando o antecedente concede idioma(s) à
   * escolha (Acólito e Sábio: 2; outros: 1). Validados contra o catálogo.
   */
  backgroundLanguageChoices: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
  /** Passo 5: classe inicial. */
  classKey: classKeySchema.optional(),
  /**
   * Passo 5: subclasse, quando a classe já a exige no nível 1 (Clérigo,
   * Feiticeiro e Bruxo escolhem Domínio/Origem/Patrono logo na primeira classe).
   */
  subclass: shortText(120).optional(),
  /**
   * Passo 5: escolhas de característica do NÍVEL 1 da classe inicial (Estilo de
   * Luta do Guerreiro, Inimigo Favorito e Explorador Nato do Patrulheiro) —
   * `{ [id da característica]: [opções] }`. Validadas no serviço.
   */
  choices: featureChoicesSchema.optional(),
  /** Passo 6: valores-base dos seis atributos. */
  baseAbilities: creationAbilitiesSchema.optional(),
  /** Passo 7: perícias com proficiência escolhidas na classe. */
  skills: z.array(skillKeySchema).max(18).optional(),
});

export type CreationStepInput = z.infer<typeof creationStepSchema>;
export type CreationRollRequestInput = z.infer<typeof creationRollRequestSchema>;
