import { z } from 'zod';

/**
 * Formato de ataque compartilhado entre fichas de jogador e criaturas.
 *
 * Fica em `shared` porque a Etapa 4 (combate) precisa rolar ataques tanto de
 * personagens quanto de criaturas — o mesmo shape nos dois lados evita
 * conversões e duplicação de código.
 */

/** Tipos de dano do livro básico. */
export const DAMAGE_TYPES = [
  'Cortante',
  'Perfurante',
  'Concussão',
  'Ácido',
  'Frio',
  'Fogo',
  'Elétrico',
  'Necrótico',
  'Veneno',
  'Psíquico',
  'Radiante',
  'Trovão',
  'Força',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * Dano de um ataque, **estruturado** (nada de texto livre):
 * - `count`d`sides` são os dados rolados (ex.: 2d6 ⇒ count 2, sides 6);
 * - `bonus` é o modificador fixo, que pode ser negativo (ex.: 1d8-1);
 * - **dano fixo** (ex.: "4") é `count: 0` com o valor em `bonus`;
 * - `type` é um dos 13 tipos canônicos, ou `null` para "sem tipo" (nesse caso
 *   o ataque não aciona resistência — mesmo comportamento de antes).
 *
 * A expressão textual ("2d6+3") é **derivada** disto só na hora de exibir
 * (`damageExpression`), nunca gravada.
 */
export const damageSchema = z.object({
  count: z.number().int().min(0).max(50).default(0),
  sides: z.number().int().min(0).max(1000).default(0),
  bonus: z.number().int().min(-9999).max(9999).default(0),
  type: z.enum(DAMAGE_TYPES).nullable().default(null),
});

export type Damage = z.infer<typeof damageSchema>;

const EMPTY_DAMAGE: Damage = { count: 0, sides: 0, bonus: 0, type: null };

/** Expressão textual do dano ("2d6+3", "1d8-1", "4"), só para exibição. */
export function damageExpression(damage: Damage | null | undefined): string {
  if (!damage) return '—';
  const dice = damage.count > 0 && damage.sides > 0 ? `${damage.count}d${damage.sides}` : '';
  if (dice === '') return String(damage.bonus);
  if (damage.bonus === 0) return dice;
  return `${dice}${damage.bonus > 0 ? '+' : ''}${damage.bonus}`;
}

export const attackSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'O ataque precisa de um nome.').max(120),
  damage: damageSchema.default(EMPTY_DAMAGE),
  attackBonus: z.number().int().min(-30).max(30).default(0),
  notes: z.string().trim().max(1000).default(''),
  /**
   * Item do INVENTÁRIO que este ataque usa (opcional). Quando aponta para uma
   * arma equipada numa das mãos, o combate passa a olhar a munição dela.
   * O ataque some da ficha enquanto a arma não estiver equipada.
   */
  inventoryItemId: z.string().trim().max(60).optional(),
  /** Arma sutil: habilita o Ataque Furtivo do ladino. */
  finesse: z.boolean().default(false),
  /** Arma à distância: habilita o Ataque Furtivo do ladino. */
  ranged: z.boolean().default(false),
  /**
   * Texto de dano original, preservado só quando a migração não conseguiu
   * converter a expressão antiga com segurança (ver `legacy`).
   */
  damageText: z.string().trim().max(120).optional(),
  /** Verdadeiro quando o dano veio de uma expressão não conversível. */
  legacy: z.boolean().default(false),
});

export type Attack = z.infer<typeof attackSchema>;

/**
 * Lista de resistências ou imunidades a tipos de dano.
 * Restrita aos tipos canônicos para que o combate possa compará-las.
 */
export const damageTypeListSchema = z.array(z.enum(DAMAGE_TYPES)).max(DAMAGE_TYPES.length);
