import { getClassDefinition } from './classes.js';

/**
 * Dados de Vida (PHB 2014) — derivação e uso persistido.
 *
 * O TOTAL de Dados de Vida nunca é gravado: ele é derivado de `character.classes`
 * (a soma dos níveis das classes, agrupada pelo dado de vida de cada uma). O que
 * a ficha persiste é apenas o USO, em `Character.hitDice`:
 *
 *   { "usedByDie": { "6": 0, "8": 1, "10": 2, "12": 0 } }
 *
 * Multiclasse: cada tipo de dado tem o seu próprio contador — Fíghter 3 / Mago 2
 * tem 3d10 + 2d6 e o jogador escolhe qual tipo gastar.
 */

/** Faces possíveis dos Dados de Vida do PHB 2014 (d6, d8, d10 e d12). */
export const HIT_DIE_SIDES = [6, 8, 10, 12] as const;

export type HitDieSide = (typeof HIT_DIE_SIDES)[number];

/**
 * Uso persistido: quantos Dados de Vida de cada tipo já foram gastos.
 * A chave é a face do dado em texto (o JSON não tem chave numérica).
 */
export interface HitDiceUsage {
  usedByDie: Record<string, number>;
}

/** Quantos Dados de Vida de UM tipo o personagem tem, gastou e ainda dispõe. */
export interface HitDieCount {
  die: HitDieSide;
  /** Total disponível = soma dos níveis das classes com esse dado de vida. */
  max: number;
  /** Gastos (sempre limitado a `[0, max]`). */
  used: number;
  remaining: number;
}

/** Derivação completa, exposta na ficha em `derived.hitDice`. */
export interface HitDiceDerivation {
  byDie: HitDieCount[];
  total: number;
  used: number;
  remaining: number;
}

/** Uma entrada de classe (o que basta para derivar o dado de vida). */
export interface HitDiceClassEntry {
  classKey: string;
  level: number;
}

function isHitDieSide(value: number): value is HitDieSide {
  return (HIT_DIE_SIDES as readonly number[]).includes(value);
}

/**
 * Lê `usedByDie` do JSONB com tolerância a lixo.
 *
 * Fichas antigas (coluna com o default vazio), valores negativos ou não
 * numéricos e chaves de dados desconhecidos são descartados aqui; o limite
 * contra o `max` é aplicado em `deriveHitDice`.
 */
export function normalizeHitDiceUsage(input: unknown): HitDiceUsage {
  const usedByDie: Record<string, number> = {};

  if (input !== null && typeof input === 'object') {
    const raw = (input as { usedByDie?: unknown }).usedByDie;
    if (raw !== null && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const die = Number(key);
        if (!Number.isInteger(die) || !isHitDieSide(die)) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        usedByDie[String(die)] = Math.max(0, Math.trunc(value));
      }
    }
  }

  return { usedByDie };
}

/**
 * Deriva os Dados de Vida disponíveis a partir das classes e do uso persistido.
 *
 * `max` por tipo = soma dos níveis das classes cujo dado de vida corresponde ao
 * tipo. `used` é SEMPRE limitado a `[0, max]` — isso cobre Level Up, Level Down,
 * fichas antigas, troca de classe e dados inconsistentes sem confiar no JSON.
 *
 * Só entram os tipos com `max > 0`; os tipos são ordenados do maior para o
 * menor (o dado principal do personagem aparece primeiro).
 */
export function deriveHitDice(
  entries: readonly HitDiceClassEntry[],
  usage: unknown,
): HitDiceDerivation {
  const maxByDie = new Map<HitDieSide, number>();

  for (const entry of entries) {
    const sides = getClassDefinition(entry.classKey)?.hitDie;
    if (sides === undefined || !isHitDieSide(sides)) continue;
    const level = Math.max(0, Math.trunc(entry.level));
    maxByDie.set(sides, (maxByDie.get(sides) ?? 0) + level);
  }

  const spent = normalizeHitDiceUsage(usage).usedByDie;
  const byDie: HitDieCount[] = [];

  for (const die of [...HIT_DIE_SIDES].sort((a, b) => b - a)) {
    const max = maxByDie.get(die) ?? 0;
    if (max <= 0) continue;
    const used = Math.min(max, Math.max(0, spent[String(die)] ?? 0));
    byDie.push({ die, max, used, remaining: max - used });
  }

  const total = byDie.reduce((sum, entry) => sum + entry.max, 0);
  const usedTotal = byDie.reduce((sum, entry) => sum + entry.used, 0);

  return { byDie, total, used: usedTotal, remaining: total - usedTotal };
}

/**
 * Devolve o uso com UM Dado de Vida do tipo informado consumido, no formato
 * persistido em `Character.hitDice`. É a operação inversa-de-leitura do
 * `normalizeHitDiceUsage` — normaliza o que veio do banco antes de somar, para
 * nunca gravar lixo por cima.
 */
export function markHitDieSpent(usage: unknown, die: HitDieSide): HitDiceUsage {
  const usedByDie = { ...normalizeHitDiceUsage(usage).usedByDie };
  const key = String(die);
  usedByDie[key] = (usedByDie[key] ?? 0) + 1;
  return { usedByDie };
}
