import { api } from './api';
import type { Character, CoinAmount, CoinDelta, CoinKey, TransferTarget } from './types';

/**
 * Ações de moedas. Como o resto das escritas, passam por HTTP; o WebSocket só
 * divulga o novo saldo (`sheet:updated`). O servidor devolve a ficha inteira e
 * é ela que adotamos como fonte de verdade.
 */

/** O mestre dá (positivo) ou retira (negativo) moedas de uma ficha. */
export async function giveCoins(characterId: string, delta: CoinDelta): Promise<Character> {
  const { character } = await api<{ character: Character }>(`/api/characters/${characterId}/coins`, {
    method: 'POST',
    body: { delta },
  });
  return character;
}

/** Gasta exatamente as moedas informadas do próprio saldo (sem troco). */
export async function spendCoins(amount: CoinAmount, note?: string): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/coins/spend', {
    method: 'POST',
    body: note ? { amount, note } : { amount },
  });
  return character;
}

/** Troca entre denominações pelas conversões do PHB (valor total preservado). */
export async function exchangeCoins(
  from: CoinKey,
  to: CoinKey,
  amount: number,
): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/coins/exchange', {
    method: 'POST',
    body: { from, to, amount },
  });
  return character;
}

/** Transfere moedas para outro personagem de jogador. */
export async function transferCoins(
  targetCharacterId: string,
  amount: CoinAmount,
): Promise<Character> {
  const { character } = await api<{ character: Character }>('/api/characters/me/coins/transfer', {
    method: 'POST',
    body: { targetCharacterId, amount },
  });
  return character;
}

/** Destinos possíveis de uma transferência (outros jogadores, sem o mestre). */
export async function fetchTransferTargets(): Promise<TransferTarget[]> {
  const { characters } = await api<{ characters: TransferTarget[] }>('/api/characters/players');
  return characters;
}
