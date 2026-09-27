import type { DiceRollDto } from '../types';

/**
 * Detalhe do resultado: valores individuais + bônus (`8 + 5`, com o bônus
 * negado quando for negativo). Os dados descartados pela vantagem/desvantagem
 * ficam de fora.
 */
export function resultBreakdown(roll: DiceRollDto): string {
  const parts = roll.dice.filter((die) => !die.dropped).map((die) => String(die.value));
  const expression = parts.join(' + ') || '0';
  const bonus =
    roll.bonus === 0 ? '' : roll.bonus > 0 ? ` + ${roll.bonus}` : ` − ${Math.abs(roll.bonus)}`;
  return `${expression}${bonus}`;
}

/** Texto do aviso público de uma rolagem da mesa. */
export function announcement(roll: DiceRollDto): string {
  if (roll.kind === 'free') return `${roll.actorName} está fazendo uma rolagem de dados`;
  return `${roll.actorName} está fazendo um teste de ${roll.label}`;
}
