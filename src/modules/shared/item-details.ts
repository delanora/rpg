import { z } from 'zod';
import { DAMAGE_TYPES, damageListSchema } from './attacks.js';

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
  'Munição',
  'Item Geral',
  'Tesouro',
  'Outro',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * Raridades de item do PHB 2014, na ordem crescente de poder. Os VALORES
 * internos são estáveis (gravados no banco); a exibição em português fica no
 * cliente. Um item sem raridade classificada usa `null`.
 */
export const ITEM_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'very_rare',
  'legendary',
  'artifact',
] as const;

export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** Converte um valor vindo do banco para uma raridade conhecida (senão `null`). */
export function itemRarityOf(value: unknown): ItemRarity | null {
  return typeof value === 'string' && (ITEM_RARITIES as readonly string[]).includes(value)
    ? (value as ItemRarity)
    : null;
}

/**
 * Categorias de FINALIDADE de uma poção (só a categoria Poção usa). Os valores
 * internos são estáveis (gravados no JSONB `details`); a exibição em português
 * fica no cliente (`POTION_CATEGORY_LABELS` em `dnd.ts`). É OPCIONAL: poções
 * cadastradas antes desta classificação continuam válidas sem ela.
 */
export const POTION_CATEGORIES = [
  'healing',
  'enhancement',
  'protection',
  'mobility',
  'stealth',
  'exploration',
  'poison',
  'longevity',
] as const;

export type PotionCategory = (typeof POTION_CATEGORIES)[number];

/**
 * Faces válidas de um dado de cura de poção (PHB 2014): d4, d6, d8, d10 e d12.
 * Usado tanto pela validação quanto pelo rolador de cura.
 */
export const HEALING_DICE_SIDES = [4, 6, 8, 10, 12] as const;

/**
 * Cura ESTRUTURADA de uma poção de Cura (`potionCategory === 'healing'`).
 * Substitui a rolagem de texto livre (`effectRoll`) nesse caso: o uso do item
 * rola `count`d`sides` + `bonus` e aplica o total na ficha automaticamente.
 * Só existe quando a categoria é Poção E a finalidade é Cura.
 */
export const healingDiceSchema = z.object({
  /** Quantidade de dados (1 a 10). */
  count: z.number().int().min(1).max(10),
  /** Faces do dado: 4, 6, 8, 10 ou 12. */
  sides: z.union([
    z.literal(4),
    z.literal(6),
    z.literal(8),
    z.literal(10),
    z.literal(12),
  ]),
  /** Bônus fixo somado ao total (0 a 20). */
  bonus: z.number().int().min(0).max(20),
});

export type HealingDice = z.infer<typeof healingDiceSchema>;

/**
 * Categoria de peso das armaduras (PHB 2014), usada no cálculo da CA:
 * - Leve: CA base + mod. Destreza inteiro.
 * - Média: CA base + mod. Destreza, no máximo +2.
 * - Pesada: só a CA base.
 */
export const ARMOR_TYPES = ['Leve', 'Média', 'Pesada'] as const;

export type ArmorType = (typeof ARMOR_TYPES)[number];

/**
 * Arma corpo a corpo x arma à distância. O cadastro separa as duas porque só
 * a arma à distância (ou a arremessável) tem alcance e munição.
 */
export const WEAPON_TYPES = ['melee', 'ranged'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** Categoria de proficiência da arma (PHB 2014). */
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/**
 * Propriedades de arma do PHB (subconjunto). São as regras que o mestre marca
 * no cadastro; o efeito mecânico de cada uma fica para a Fase 7.
 */
export const WEAPON_PROPERTIES = [
  'light',
  'finesse',
  'heavy',
  'two-handed',
  'versatile',
  'thrown',
  'reach',
  'ammunition',
  'loading',
  'special',
] as const;

export type WeaponProperty = (typeof WEAPON_PROPERTIES)[number];

/**
 * Tipos de munição (PHB 2014). Uma arma à distância com a propriedade
 * `ammunition` declara qual deles consome; a pilha do inventário cujo
 * `ammoType` casar é que é gasta no ataque.
 */
export const AMMO_TYPES = ['Flecha', 'Virote', 'Bala de funda', 'Agulha de zarabatana'] as const;

export type AmmoType = (typeof AMMO_TYPES)[number];

/**
 * Atributos de item, todos opcionais. A categoria decide quais são usados
 * (ver `sanitizeItemDetails`), mas o formato é único para simplificar o JSONB.
 *
 * O `superRefine` no fim valida a COERÊNCIA das propriedades de arma (ex.:
 * Munição só em arma à distância, Versátil exige o dado de duas mãos).
 */
export const itemDetailsSchema = z
  .object({
    // Arma / Cajado — dano estruturado (mesmos limites de `Damage` no ataque).
    /** Dano PRINCIPAL da arma: quantidade de dados, dado, tipo e bônus. */
    damageCount: z.number().int().min(0).max(50).optional(),
    damageDie: z.number().int().min(0).max(1000).optional(),
    damageType: z.enum(DAMAGE_TYPES).optional(),
    /**
     * Danos ADICIONAIS da arma, cada um com o seu tipo (ex.: espada flamejante
     * = cortante no principal + 1d6 de fogo aqui). O ataque derivado da arma
     * equipada leva os extras junto — eles ainda não são somados no combate.
     */
    extraDamages: damageListSchema.optional(),
    /** Bônus de ataque da arma. */
    attackBonus: z.number().int().min(-30).max(30).optional(),
    /** Bônus mágico somado ao DANO da arma (ex.: +1 de uma arma mágica). */
    damageBonus: z.number().int().min(-9999).max(9999).optional(),
    // Arma / Cajado — uso e propriedades (PHB)
    /** Corpo a corpo ou à distância (padrão 'melee' na categoria Arma). */
    weaponType: z.enum(WEAPON_TYPES).optional(),
    /** Simples ou marcial (padrão 'simple'). */
    weaponCategory: z.enum(WEAPON_CATEGORIES).optional(),
    /** Propriedades do PHB marcadas pelo mestre. */
    properties: z.array(z.enum(WEAPON_PROPERTIES)).max(WEAPON_PROPERTIES.length).optional(),
    /** Munição consumida (obrigatória quando a propriedade `ammunition` está marcada). */
    ammoType: z.enum(AMMO_TYPES).optional(),
    /** Dado do dano empunhada com as DUAS MÃOS (exige a propriedade Versátil). */
    versatileDie: z.number().int().min(0).max(1000).optional(),
    /** Alcance normal em metros (à distância ou arremessável). */
    rangeNormal: z.number().int().min(0).max(1000).optional(),
    /** Alcance longo em metros (à distância ou arremessável). */
    rangeLong: z.number().int().min(0).max(1000).optional(),
    /** Cajado também é foco de conjuração. */
    spellcastingFocus: z.boolean().optional(),
    // Armadura / Escudo
    /** Peso da armadura (só a categoria Armadura usa; decide como a Destreza entra). */
    armorType: z.enum(ARMOR_TYPES).optional(),
    /** CA base da armadura (ex.: couro = 11, cota de malha = 16). */
    baseArmorClass: z.number().int().min(0).max(30).optional(),
    /** Bônus avulso de CA (escudos e itens mágicos somam ao total). */
    armorClassBonus: z.number().int().min(-10).max(30).optional(),
    // Poção / Anel / item consumível
    effectRoll: z.string().trim().max(60).optional(),
    duration: z.string().trim().max(120).optional(),
    /** Finalidade da poção (só a categoria Poção guarda este campo). */
    potionCategory: z.enum(POTION_CATEGORIES).optional(),
    /**
     * Cura estruturada da poção (só quando `potionCategory === 'healing'`).
     * O descarte fora desse caso é feito por `sanitizeItemDetails`.
     */
    healingDice: healingDiceSchema.optional(),
    /**
     * Marcado pelo mestre (Item Geral e Outro): o item pode ser USADO pelo
     * jogador, consumindo 1 unidade. Poções são consumíveis pela categoria.
     */
    consumable: z.boolean().optional(),
  })
  .superRefine((details, ctx) => {
    const properties = details.properties ?? [];
    const weaponType = details.weaponType ?? 'melee';

    // Munição é exclusiva da arma à distância e exige um tipo de munição.
    if (properties.includes('ammunition')) {
      if (weaponType !== 'ranged') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['properties'],
          message: "A propriedade 'Munição' só vale para arma à distância.",
        });
      }
      if (details.ammoType === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ammoType'],
          message: "A propriedade 'Munição' exige o tipo de munição (Flecha, Virote...).",
        });
      }
    }

    // Versátil: exige o dado de duas mãos e não combina com Duas mãos.
    if (properties.includes('versatile')) {
      if (details.versatileDie === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['versatileDie'],
          message: "'Versátil' exige o dado do dano com as duas mãos.",
        });
      }
      if (properties.includes('two-handed')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['properties'],
          message: "'Versátil' e 'Duas mãos' não podem coexistir.",
        });
      }
    } else if (details.versatileDie !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versatileDie'],
        message: "O dado de duas mãos só vale com a propriedade 'Versátil'.",
      });
    }

    // Arma à distância ou arremessável exige os dois alcances (em metros).
    if (properties.includes('thrown') || weaponType === 'ranged') {
      if (details.rangeNormal === undefined || details.rangeLong === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rangeNormal'],
          message: 'Arma à distância ou arremessável exige o alcance normal e o longo.',
        });
      }
    }
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
  Arma: [
    'damageCount',
    'damageDie',
    'damageType',
    'extraDamages',
    'attackBonus',
    'damageBonus',
    'weaponType',
    'weaponCategory',
    'properties',
    'ammoType',
    'versatileDie',
    'rangeNormal',
    'rangeLong',
  ],
  Cajado: [
    'damageCount',
    'damageDie',
    'damageType',
    'extraDamages',
    'attackBonus',
    'damageBonus',
    'weaponType',
    'weaponCategory',
    'properties',
    'ammoType',
    'versatileDie',
    'rangeNormal',
    'rangeLong',
    'spellcastingFocus',
  ],
  Munição: ['ammoType', 'attackBonus', 'damageBonus'],
  Armadura: ['armorType', 'baseArmorClass', 'armorClassBonus'],
  Escudo: ['armorClassBonus'],
  Poção: ['effectRoll', 'duration', 'potionCategory', 'healingDice'],
  Anel: ['effectRoll'],
  'Item Geral': ['effectRoll', 'consumable'],
  Tesouro: [],
  Outro: ['effectRoll', 'consumable'],
};

/** Categorias que funcionam como arma (têm as propriedades de arma). */
function isWeaponCategory(category: string): boolean {
  return category === 'Arma' || category === 'Cajado';
}

/**
 * O item pode ser USADO pelo jogador (consumindo 1 unidade)?
 *
 * Toda Poção é consumível; nas demais categorias só vale com o campo
 * `consumable` marcado pelo mestre (Item Geral e Outro aceitam o campo).
 */
export function isConsumableItem(category: string, details: ItemDetails): boolean {
  return category === 'Poção' || details.consumable === true;
}

/**
 * Normaliza os atributos: mantém só os campos que a categoria usa e aplica os
 * padrões da arma. Devolve `{}` quando os dados são incoerentes (o item não
 * passa da validação da rota, então isto é só uma segunda barreira).
 */
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

  // `healingDice` é exclusivo da poção de CURA: mesmo estando em `DETAIL_KEYS`
  // da categoria Poção, ele é descartado quando a finalidade não é 'healing'
  // (o mesmo cuidado que se aplica às chaves de outras categorias).
  if (result.healingDice !== undefined && result.potionCategory !== 'healing') {
    delete result.healingDice;
  }

  if (isWeaponCategory(category)) {
    if (result.weaponType === undefined) result.weaponType = 'melee';
    if (result.weaponCategory === undefined) result.weaponCategory = 'simple';
    if (result.properties === undefined) result.properties = [];
  }

  return result;
}
