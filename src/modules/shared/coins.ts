import { z } from 'zod';

/**
 * Sistema de MOEDAS da ficha (PHB p.143).
 *
 * A carteira é `{ pp, gp, ep, sp, cp }` — platina, ouro, electrum, prata e
 * cobre —, sempre com as CINCO denominações gravadas como inteiros >= 0. A
 * chave `extraCoins` da mesa só controla a EXIBIÇÃO de PL (pp) e PE (ep); o
 * valor delas existe de qualquer forma.
 *
 * Conversões do livro (todas exatas, em peças de cobre):
 *   1 pp = 10 gp · 1 gp = 2 ep = 10 sp = 100 cp · 1 ep = 5 sp · 1 sp = 10 cp
 */

export const COIN_KEYS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
export type CoinKey = (typeof COIN_KEYS)[number];

export interface CoinPurse {
  pp: number;
  gp: number;
  ep: number;
  sp: number;
  cp: number;
}

/** Abreviações em português (usadas na ficha e nas mensagens). */
export const COIN_LABELS: Record<CoinKey, string> = {
  pp: 'PL',
  gp: 'PO',
  ep: 'PE',
  sp: 'PP',
  cp: 'PC',
};

/** Nomes por extenso (mensagens de erro e descrições). */
export const COIN_NAMES: Record<CoinKey, string> = {
  pp: 'platina',
  gp: 'ouro',
  ep: 'electrum',
  sp: 'prata',
  cp: 'cobre',
};

/**
 * Quanto vale UMA moeda de cada denominação, em peças de cobre. É a tabela do
 * PHB usada na troca: 1 pp = 1000 cp, 1 gp = 100 cp, 1 ep = 50 cp, 1 sp = 10 cp.
 */
export const COPPER_PER_COIN: Record<CoinKey, number> = {
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1,
};

/** Peso de UMA moeda em quilos (50 moedas = 0,5 kg — regra do PHB). */
export const COIN_WEIGHT_KG = 0.01;

const nonNegativeInt = z.number().int().min(0).max(9_999_999);

/** Carteira completa: todas as denominações, inteiros >= 0 (padrão 0). */
export const coinsSchema = z.object({
  pp: nonNegativeInt.default(0),
  gp: nonNegativeInt.default(0),
  ep: nonNegativeInt.default(0),
  sp: nonNegativeInt.default(0),
  cp: nonNegativeInt.default(0),
});

/** Valor de moedas informado por uma ação (gastar, trocar, transferir). */
export const coinAmountSchema = z
  .object({
    pp: nonNegativeInt.optional(),
    gp: nonNegativeInt.optional(),
    ep: nonNegativeInt.optional(),
    sp: nonNegativeInt.optional(),
    cp: nonNegativeInt.optional(),
  })
  .refine((value) => COIN_KEYS.some((key) => (value[key] ?? 0) > 0), {
    message: 'Informe um valor de moedas.',
  });

/**
 * Ajuste do mestre: aceita positivos (dar) e negativos (retirar). Pelo menos
 * uma denominação precisa ser diferente de zero.
 */
export const coinDeltaSchema = z
  .object({
    pp: z.number().int().min(-9_999_999).max(9_999_999).optional(),
    gp: z.number().int().min(-9_999_999).max(9_999_999).optional(),
    ep: z.number().int().min(-9_999_999).max(9_999_999).optional(),
    sp: z.number().int().min(-9_999_999).max(9_999_999).optional(),
    cp: z.number().int().min(-9_999_999).max(9_999_999).optional(),
  })
  .refine((value) => COIN_KEYS.some((key) => (value[key] ?? 0) !== 0), {
    message: 'Informe quanto dar ou retirar.',
  });

/** Troca entre denominações: `from`/`to` canônicos e quantidade positiva. */
export const exchangeCoinsSchema = z.object({
  from: z.enum(COIN_KEYS),
  to: z.enum(COIN_KEYS),
  amount: z.number().int().min(1).max(9_999_999),
});

export type CoinAmount = z.infer<typeof coinAmountSchema>;
export type CoinDelta = z.infer<typeof coinDeltaSchema>;
export type ExchangeCoinsInput = z.infer<typeof exchangeCoinsSchema>;

/** Carteira zerada. */
export function emptyCoins(): CoinPurse {
  return { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
}

/**
 * Normaliza um valor vindo do banco (JSONB) ou do cliente para a carteira
 * completa. Qualquer coisa inesperada vira carteira zerada — o campo nunca
 * pode derrubar a leitura da ficha.
 */
export function normalizeCoins(raw: unknown): CoinPurse {
  const parsed = coinsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : emptyCoins();
}

/** Preenche as denominações ausentes com zero (para valores de ação). */
export function fillCoins(amount: CoinAmount | CoinDelta): CoinPurse {
  return {
    pp: amount.pp ?? 0,
    gp: amount.gp ?? 0,
    ep: amount.ep ?? 0,
    sp: amount.sp ?? 0,
    cp: amount.cp ?? 0,
  };
}

/** Número total de moedas (todas as denominações somadas). */
export function coinCount(coins: CoinPurse): number {
  return COIN_KEYS.reduce((sum, key) => sum + coins[key], 0);
}

/** Peso das moedas em quilos (0,01 kg cada), arredondado a 2 casas. */
export function coinsWeight(coins: CoinPurse): number {
  return Math.round(coinCount(coins) * COIN_WEIGHT_KG * 100) / 100;
}

/** Valor total da carteira em peças de cobre. */
export function coinsToCopper(coins: CoinPurse): number {
  return COIN_KEYS.reduce((sum, key) => sum + coins[key] * COPPER_PER_COIN[key], 0);
}

/** Carteira resultante de aplicar um delta (pode ficar negativa; o chamador confere). */
export function addDelta(coins: CoinPurse, delta: CoinPurse): CoinPurse {
  return {
    pp: coins.pp + delta.pp,
    gp: coins.gp + delta.gp,
    ep: coins.ep + delta.ep,
    sp: coins.sp + delta.sp,
    cp: coins.cp + delta.cp,
  };
}

/** Há saldo para pagar exatamente `amount` (sem troco automático)? */
export function hasCoinsFor(coins: CoinPurse, amount: CoinPurse): boolean {
  return COIN_KEYS.every((key) => coins[key] >= amount[key]);
}

/** Subtrai `amount` da carteira (o chamador garante que há saldo). */
export function subtractCoins(coins: CoinPurse, amount: CoinPurse): CoinPurse {
  return {
    pp: coins.pp - amount.pp,
    gp: coins.gp - amount.gp,
    ep: coins.ep - amount.ep,
    sp: coins.sp - amount.sp,
    cp: coins.cp - amount.cp,
  };
}

/** A troca é exata? (1 cp para gp exigiria fração — o PHB não permite.) */
export function exchangeIsExact(amount: number, from: CoinKey, to: CoinKey): boolean {
  return (amount * COPPER_PER_COIN[from]) % COPPER_PER_COIN[to] === 0;
}

/** Quantas moedas de `to` saem de `amount` moedas de `from` (troca exata). */
export function exchangeResult(amount: number, from: CoinKey, to: CoinKey): number {
  return (amount * COPPER_PER_COIN[from]) / COPPER_PER_COIN[to];
}

/** "3 PL, 12 PO" — só as denominações com valor; "sem moedas" quando zerada. */
export function formatCoins(coins: CoinPurse): string {
  const parts = COIN_KEYS.filter((key) => coins[key] > 0).map(
    (key) => `${coins[key]} ${COIN_LABELS[key]}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'sem moedas';
}

/**
 * Denominações visíveis na ficha: com `extraCoins` desligado só PO, PP e PC;
 * ligado, também PL e PE.
 */
export function visibleCoinKeys(extraCoins: boolean): CoinKey[] {
  return extraCoins ? [...COIN_KEYS] : ['gp', 'sp', 'cp'];
}
