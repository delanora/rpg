import { z } from 'zod';

/**
 * Formato de ataque compartilhado entre fichas de jogador e criaturas.
 *
 * Um ataque pode dar MAIS DE UM TIPO de dano: `damage` é o principal (somado no
 * combate hoje) e `extraDamages` traz os demais, cada um independente — quem é
 * imune a um tipo continua levando o outro. Ver `attackDamages`.
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

/**
 * Tetos de danos ADICIONAIS por ataque/arma (o principal não conta).
 * Existe para o JSONB não virar depósito: uma arma do livro tem no máximo uns
 * dois tipos extras (ex.: espada flamejante = cortante + fogo).
 */
export const MAX_EXTRA_DAMAGES = 10;

/**
 * Dano de VÁRIOS tipos: o principal vem primeiro e é o que o combate resolve
 * hoje; os demais são calculados à parte (cada um com a sua resistência).
 *
 * Fica em `shared` porque a ficha, as criaturas e as armas do catálogo
 * (`item-details.ts`) usam a MESMA lista.
 */
export const damageListSchema = z.array(damageSchema).max(MAX_EXTRA_DAMAGES);

/** Um dano está vazio (não rola dado nenhum e não soma bônus)? */
export function damageIsEmpty(damage: Damage | null | undefined): boolean {
  if (!damage) return true;
  const hasDice = damage.count > 0 && damage.sides > 0;
  return !hasDice && damage.bonus === 0;
}

/**
 * TODOS os danos de um ataque: o principal (`damage`) mais os adicionais.
 *
 * É o que o combate vai percorrer quando cada tipo passar a ser aplicado de
 * forma independente (hoje: resistência por tipo em `applyDamageResistance`).
 * Enquanto isso o combate segue rolando só `attack.damage`.
 */
export function attackDamages(attack: {
  damage: Damage;
  extraDamages?: Damage[];
}): Damage[] {
  return [attack.damage, ...(attack.extraDamages ?? [])];
}

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
  /** Dano PRINCIPAL do ataque (o combate resolve este por enquanto). */
  damage: damageSchema.default(EMPTY_DAMAGE),
  /**
   * Danos ADICIONAIS, cada um com o seu tipo (ex.: espada flamejante =
   * `damage` cortante + um extra de fogo). São independentes: quem resiste a um
   * tipo não resiste ao outro. Vazio = ataque de um tipo só, como antes.
   *
   * O mestre cadastra os extras pelo "+" ao lado da linha de dano (ficha e
   * bestiário) e na arma do catálogo.
   */
  extraDamages: damageListSchema.default([]),
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
 * Ataque pronto para o combate: os campos gravados MAIS o que é derivado na
 * hora. `derived` marca o ataque calculado da arma equipada (nunca gravado na
 * ficha) e `blocked`, quando presente, diz por que ele não pode ser usado — o
 * combate devolve 400 com essa mensagem (ver shared/weapon-attacks.ts).
 *
 * Nenhum dos dois entra no `attackSchema`: eles são sempre calculados e o
 * `parseJson` do que está gravado os descarta.
 */
export interface CombatAttack extends Attack {
  derived?: boolean;
  blocked?: string;
}

/**
 * Lista de danos escrita como texto ("1d8 Cortante + 1d6 Necrótico") — é o que a
 * ficha e o combate mostram quando o ataque tem mais de um tipo. O dano sem
 * tipo conhecido sai sem rótulo.
 */
export function damagesExpression(damages: Damage[]): string {
  return damages
    .filter((damage) => !damageIsEmpty(damage))
    .map((damage) => {
      const expression = damageExpression(damage);
      return damage.type ? `${expression} ${damage.type}` : expression;
    })
    .join(' + ');
}

/**
 * Lista de resistências ou imunidades a tipos de dano.
 * Restrita aos tipos canônicos para que o combate possa compará-las.
 */
export const damageTypeListSchema = z.array(z.enum(DAMAGE_TYPES)).max(DAMAGE_TYPES.length);
