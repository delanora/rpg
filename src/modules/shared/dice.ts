import { randomInt } from 'node:crypto';

/**
 * Rolagem de dados.
 *
 * Usa `crypto.randomInt` (e não `Math.random`) para que os resultados sejam
 * justos e imprevisíveis — importante num jogo onde o mestre e os jogadores
 * confiam no sistema para rolar.
 */

export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
}

export interface DiceRollResult {
  expression: string;
  count: number;
  sides: number;
  modifier: number;
  rolls: number[];
  total: number;
  crit: boolean;
}

/** Rola um dado de `sides` lados (1..sides). */
export function rollDie(sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error('Número de lados inválido para o dado.');
  }
  // randomInt é exclusivo no limite superior, por isso o +1.
  return randomInt(1, sides + 1);
}

export function rollD20(): number {
  return rollDie(20);
}

const DICE_EXPRESSION = /^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/;
const FLAT_EXPRESSION = /^\s*([+-]?\d+)\s*$/;

/**
 * Interpreta expressões como `1d8`, `2d6+3`, `1d10 - 1` ou um valor fixo `4`.
 * Devolve `null` quando a expressão não é reconhecida.
 */
export function parseDiceExpression(expression: string): DiceSpec | null {
  const flat = FLAT_EXPRESSION.exec(expression);
  if (flat) return { count: 0, sides: 0, modifier: Number(flat[1]) };

  const match = DICE_EXPRESSION.exec(expression);
  if (!match) return null;

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const sign = match[3] === '-' ? -1 : 1;
  const modifier = match[4] ? sign * Number(match[4]) : 0;

  if (count < 1 || count > 50 || sides < 2 || sides > 1000) return null;

  return { count, sides, modifier };
}

/**
 * Rola uma expressão de dano.
 *
 * Crítico em D&D 5e: os dados de dano são rolados duas vezes e o modificador
 * entra uma vez só.
 */
export function rollDice(
  expression: string,
  options: { crit?: boolean } = {},
): DiceRollResult | null {
  const spec = parseDiceExpression(expression);
  if (!spec) return null;

  const count = spec.count * (options.crit ? 2 : 1);
  const rolls = Array.from({ length: count }, () => rollDie(spec.sides));
  const diceTotal = rolls.reduce((sum, value) => sum + value, 0);

  return {
    expression,
    count,
    sides: spec.sides,
    modifier: spec.modifier,
    rolls,
    // Dano nunca é negativo, mesmo com modificador negativo alto.
    total: Math.max(0, diceTotal + spec.modifier),
    crit: Boolean(options.crit),
  };
}
