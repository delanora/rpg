import { COIN_KEYS, COIN_LABELS, visibleCoinKeys } from '../../coins';
import type { Character, CoinDelta, CoinKey, CoinPurse } from '../../types';
import { clampInt } from '../../utils';
import type { IconName } from '../Icon';

/**
 * Regras de APRESENTAÇÃO do painel **Entregar moedas** (aba Itens do Mestre).
 *
 * Fica separado do componente (mesmo padrão de `rest/narrativeSuggestions.ts`)
 * porque é lógica PURA: dado o rascunho digitado, o alvo e a configuração da
 * mesa, devolve tudo que a tela mostra — o delta assinado (positivo entrega,
 * negativo retira), o saldo depois, o efeito e o resultado de CADA denominação,
 * a retirada que passaria do saldo e o rótulo da ação. Nenhuma regra de servidor
 * mora aqui: o `POST /api/characters/:id/coins` continua sendo a autoridade.
 */

/** Rascunho dos campos: uma string por denominação. */
export type Draft = Record<CoinKey, string>;

export const EMPTY_DRAFT: Draft = { pp: '', gp: '', ep: '', sp: '', cp: '' };

/** Delta informado pelo mestre (só as denominações com valor diferente de zero). */
export function draftToDelta(draft: Draft): CoinDelta {
  const delta: CoinDelta = {};
  for (const key of COIN_KEYS) {
    const raw = draft[key].trim();
    if (raw === '') continue;
    const value = clampInt(raw, -9_999_999, 9_999_999, 0);
    if (value !== 0) delta[key] = value;
  }
  return delta;
}

/** Saldo que o jogador fica DEPOIS do delta (negativo = o servidor recusa). */
export function purseAfter(coins: CoinPurse, delta: CoinDelta): CoinPurse {
  const next = { ...coins };
  for (const key of COIN_KEYS) next[key] = coins[key] + (delta[key] ?? 0);
  return next;
}

/** "Entregue: 20 PO · Retirado: 5 PP" — o que a ação fez, para a mensagem. */
export function describeDelta(delta: CoinDelta): string {
  const given = COIN_KEYS.filter((key) => (delta[key] ?? 0) > 0).map(
    (key) => `${delta[key]} ${COIN_LABELS[key]}`,
  );
  const taken = COIN_KEYS.filter((key) => (delta[key] ?? 0) < 0).map(
    (key) => `${-(delta[key] ?? 0)} ${COIN_LABELS[key]}`,
  );

  const parts: string[] = [];
  if (given.length > 0) parts.push(`Entregue: ${given.join(', ')}`);
  if (taken.length > 0) parts.push(`Retirado: ${taken.join(', ')}`);
  return parts.join(' · ');
}

/** "+20" / "−5" / "—" — o efeito do campo naquela denominação. */
export function effectLabel(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '—';
}

/** Uma linha do bloco "Quanto" (uma denominação). */
export interface GrantRow {
  key: CoinKey;
  /** Saldo atual do jogador; `null` enquanto nenhum jogador foi escolhido. */
  current: number | null;
  /** Delta digitado (a prévia do efeito). */
  diff: number;
  /** Saldo depois da entrega; `null` sem jogador escolhido. */
  next: number | null;
  /** A retirada passaria do saldo desta denominação. */
  short: boolean;
}

/** Tudo o que o painel mostra, derivado do rascunho. */
export interface GrantPreview {
  selected: Character | null;
  delta: CoinDelta;
  after: CoinPurse | null;
  hasDelta: boolean;
  /** Denominações que ficariam negativas (o servidor recusa). */
  insufficient: CoinKey[];
  actionLabel: 'entregar' | 'retirar' | 'aplicar';
  actionIcon: IconName;
  rows: GrantRow[];
}

/**
 * Visão derivada do painel: quem recebe, o delta e a prévia por denominação.
 *
 * As denominações exibidas são as ligadas na mesa MAIS qualquer uma com saldo
 * (para não esconder moeda que o jogador já tem).
 */
export function grantPreview(
  characters: readonly Character[],
  targetId: string,
  draft: Draft,
  extraCoins: boolean,
): GrantPreview {
  const selected = characters.find((character) => character.id === targetId) ?? null;
  const delta = draftToDelta(draft);
  const after = selected ? purseAfter(selected.coins, delta) : null;

  const hasDelta = COIN_KEYS.some((key) => (delta[key] ?? 0) !== 0);
  const insufficient = after ? COIN_KEYS.filter((key) => after[key] < 0) : [];
  const giving = COIN_KEYS.some((key) => (delta[key] ?? 0) > 0);
  const taking = COIN_KEYS.some((key) => (delta[key] ?? 0) < 0);

  const visible = visibleCoinKeys(extraCoins);
  const displayed = COIN_KEYS.filter(
    (key) => visible.includes(key) || (selected?.coins[key] ?? 0) > 0,
  );

  return {
    selected,
    delta,
    after,
    hasDelta,
    insufficient,
    actionLabel: taking && !giving ? 'retirar' : giving && taking ? 'aplicar' : 'entregar',
    actionIcon: taking && !giving ? 'minus' : 'plus',
    rows: displayed.map((key) => {
      const current = selected ? selected.coins[key] : null;
      const diff = delta[key] ?? 0;
      const next = current === null ? null : current + diff;
      return { key, current, diff, next, short: next !== null && next < 0 };
    }),
  };
}
