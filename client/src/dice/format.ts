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

/**
 * Linha do histórico de rolagens (log do mestre): "Jogador: Perícia: total".
 *
 * A depuração do total — cada dado, o bônus e o que foi descartado — vem de
 * `rollDebug` e é exibida ao lado, dentro dos parênteses.
 */
export function historyLine(roll: DiceRollDto): string {
  const label = roll.kind === 'free' ? 'Rolagem livre' : roll.label;
  return `${roll.actorName}: ${label}: ${roll.total}`;
}

/**
 * DEPURAÇÃO de uma rolagem, para o histórico do mestre: mostra de onde saiu o
 * total — cada dado com o TIPO, a origem do bônus e os dados descartados pela
 * vantagem/desvantagem.
 *
 * Ex.: `d20 6 + 4 perícia` (total 10) · `2d6: 3 + 5 + 1 bônus` ·
 *      `d20 6, descartado d20 2 + 4 salvaguarda`
 *
 * O bônus de perícia/salvaguarda já vem somado no `bonus` da rolagem; aqui ele
 * é apenas rotulado com a origem, que o tipo da rolagem informa.
 */
export function rollDebug(roll: DiceRollDto): string {
  const kept = roll.dice.filter((die) => !die.dropped);
  const dropped = roll.dice.filter((die) => die.dropped);

  const expression = kept.map((die) => `d${die.sides} ${die.value}`).join(' + ') || '0';

  const bonusSource =
    roll.kind === 'skill' ? 'perícia' : roll.kind === 'save' ? 'salvaguarda' : 'bônus';
  const bonus =
    roll.bonus === 0
      ? ''
      : roll.bonus > 0
        ? ` + ${roll.bonus} ${bonusSource}`
        : ` − ${Math.abs(roll.bonus)} ${bonusSource}`;

  const discarded =
    dropped.length === 0
      ? ''
      : `, descartado${dropped.length > 1 ? 's' : ''} ${dropped
          .map((die) => `d${die.sides} ${die.value}`)
          .join(', ')}`;

  return `${expression}${bonus}${discarded}`;
}

/** Texto do aviso público de uma rolagem da mesa. */
export function announcement(roll: DiceRollDto): string {
  if (roll.kind === 'free') return `${roll.actorName} está fazendo uma rolagem de dados`;
  return `${roll.actorName} está fazendo um teste de ${roll.label}`;
}
