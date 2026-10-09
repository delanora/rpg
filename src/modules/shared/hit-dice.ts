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

// -----------------------------------------------------------------------------
// Recuperação no Descanso Longo (PHB 2014)
// -----------------------------------------------------------------------------

/**
 * Cota de Dados de Vida recuperáveis num Descanso Longo.
 *
 * PHB 2014: ao terminar um Descanso Longo o personagem recupera Dados de Vida
 * gastos em quantidade igual à METADE do total, arredondada para BAIXO, com
 * MÍNIMO 1. `effective` nunca passa do que foi realmente gasto (não há o que
 * recuperar quando nada foi gasto).
 */
export interface HitDiceRecoveryAllowance {
  /** `max(1, floor(total / 2))`. */
  base: number;
  /** `min(usado, base)` — quantos Dados de Vida podem voltar AGORA. */
  effective: number;
}

/** Calcula a cota de recuperação a partir do total derivado e do uso persistido. */
export function hitDiceRecoveryAllowance(total: number, used: number): HitDiceRecoveryAllowance {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.trunc(used)) : 0;
  const base = Math.max(1, Math.floor(safeTotal / 2));
  return { base, effective: Math.min(safeUsed, base) };
}

/**
 * Escolha do JOGADOR de quantos Dados de Vida de cada tipo recuperar.
 * A chave é a face do dado em texto (mesma convenção de `usedByDie`).
 */
export type HitDiceSelection = Record<string, number>;

/**
 * Lê/normaliza a seleção persistida (ou vinda do cliente): descarta chaves que
 * não são faces do PHB, valores não inteiros/negativos e o valor 0 (que é
 * equivalente a não escolher aquele tipo).
 */
export function normalizeHitDiceSelection(input: unknown): HitDiceSelection {
  const selection: HitDiceSelection = {};
  if (input === null || typeof input !== 'object') return selection;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const die = Number(key);
    if (!Number.isInteger(die) || !isHitDieSide(die)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const count = Math.max(0, Math.trunc(value));
    if (count > 0) selection[String(die)] = count;
  }

  return selection;
}

/** Chaves RECEBIDAS que não são faces de Dado de Vida válidas (6/8/10/12). */
export function invalidHitDiceSelectionKeys(input: unknown): string[] {
  if (input === null || typeof input !== 'object') return [];
  return Object.keys(input as Record<string, unknown>).filter((key) => {
    const die = Number(key);
    return !Number.isInteger(die) || !isHitDieSide(die);
  });
}

/** Soma escolhida na seleção (quantos Dados de Vida serão recuperados). */
export function selectedHitDiceTotal(selection: HitDiceSelection): number {
  return Object.values(selection).reduce((sum, count) => sum + count, 0);
}

/**
 * Devolve o uso com a seleção RECUPERADA (`usedByDie[die] − selecionado`,
 * nunca abaixo de zero). Não altera o total derivado — só o uso persistido.
 */
export function applyHitDiceRecovery(usage: unknown, selection: HitDiceSelection): HitDiceUsage {
  const usedByDie = { ...normalizeHitDiceUsage(usage).usedByDie };
  for (const [key, count] of Object.entries(selection)) {
    usedByDie[key] = Math.max(0, (usedByDie[key] ?? 0) - count);
  }
  return { usedByDie };
}

/**
 * Valida a seleção contra a derivação ATUAL e a cota efetiva.
 * Devolve a mensagem do problema ou `null` quando a seleção é válida.
 *
 * Regras: não recuperar mais de um tipo do que foi gasto dele e a soma não pode
 * passar da cota (`effectiveAllowance`). Seleção vazia/zero é permitida — o
 * jogador não é obrigado a recuperar o máximo.
 */
export function hitDiceSelectionProblem(
  selection: HitDiceSelection,
  derivation: HitDiceDerivation,
  effectiveAllowance: number,
): string | null {
  const usedByDie = new Map(derivation.byDie.map((entry) => [String(entry.die), entry.used]));

  for (const [key, count] of Object.entries(selection)) {
    const used = usedByDie.get(key) ?? 0;
    if (count > used) {
      return `Você só gastou ${used} Dado(s) de Vida d${key}; não é possível recuperar ${count}.`;
    }
  }

  const total = selectedHitDiceTotal(selection);
  if (total > effectiveAllowance) {
    return (
      `Você pode recuperar no máximo ${effectiveAllowance} Dado(s) de Vida neste Descanso Longo ` +
      `(selecionados: ${total}).`
    );
  }

  return null;
}
