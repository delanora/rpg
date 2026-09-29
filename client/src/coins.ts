import { COIN_KEYS } from './types';
import type { CoinKey, CoinPurse } from './types';

export { COIN_KEYS };

/**
 * Regras de MOEDAS no cliente (espelha `src/modules/shared/coins.ts`).
 *
 * A carteira tem sempre as cinco denominações; a chave `extraCoins` da mesa só
 * decide quais aparecem na ficha (PL e PE são opcionais).
 */

/** Abreviações em português (PL = platina, PP = prata). */
export const COIN_LABELS: Record<CoinKey, string> = {
  pp: 'PL',
  gp: 'PO',
  ep: 'PE',
  sp: 'PP',
  cp: 'PC',
};

export const COIN_NAMES: Record<CoinKey, string> = {
  pp: 'platina',
  gp: 'ouro',
  ep: 'electrum',
  sp: 'prata',
  cp: 'cobre',
};

/** Valor de UMA moeda em peças de cobre (conversões do PHB). */
export const COPPER_PER_COIN: Record<CoinKey, number> = {
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1,
};

/** Peso de uma moeda em quilos (50 moedas = 0,5 kg). */
export const COIN_WEIGHT_KG = 0.01;

export function emptyCoins(): CoinPurse {
  return { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
}

/** Denominações visíveis na ficha (PL e PE só com `extraCoins`). */
export function visibleCoinKeys(extraCoins: boolean): CoinKey[] {
  return extraCoins ? [...COIN_KEYS] : ['gp', 'sp', 'cp'];
}

export function coinCount(coins: CoinPurse): number {
  return COIN_KEYS.reduce((sum, key) => sum + coins[key], 0);
}

/** Peso das moedas em quilos, arredondado a 2 casas. */
export function coinsWeight(coins: CoinPurse): number {
  return Math.round(coinCount(coins) * COIN_WEIGHT_KG * 100) / 100;
}

/** "3 PL, 12 PO" — só as denominações com valor; "sem moedas" quando zerada. */
export function formatCoins(coins: CoinPurse, extraCoins = true): string {
  const parts = visibleCoinKeys(extraCoins)
    .filter((key) => coins[key] > 0)
    .map((key) => `${coins[key]} ${COIN_LABELS[key]}`);
  return parts.length > 0 ? parts.join(', ') : 'sem moedas';
}

/** A troca é exata? (1 PC para PO exigiria fração — o PHB não permite.) */
export function exchangeIsExact(amount: number, from: CoinKey, to: CoinKey): boolean {
  return (amount * COPPER_PER_COIN[from]) % COPPER_PER_COIN[to] === 0;
}

/** Quantas moedas de `to` saem de `amount` moedas de `from` (troca exata). */
export function exchangeResult(amount: number, from: CoinKey, to: CoinKey): number {
  return (amount * COPPER_PER_COIN[from]) / COPPER_PER_COIN[to];
}

/** A carteira cobre exatamente o valor informado? */
export function canPay(coins: CoinPurse, amount: Partial<CoinPurse>): boolean {
  return COIN_KEYS.every((key) => coins[key] >= (amount[key] ?? 0));
}
