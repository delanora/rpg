import { useState, type ReactElement } from 'react';
import {
  COIN_KEYS,
  COIN_LABELS,
  COIN_METAL,
  COIN_NAMES,
  canPay,
  coinsWeight,
  exchangeIsExact,
  exchangeResult,
  visibleCoinKeys,
} from '../../coins';
import { exchangeCoins, giveCoins, spendCoins, transferCoins } from '../../coinsApi';
import { useSheetAccess } from '../../readonly';
import type { Character, CoinAmount, CoinKey, CoinPurse, TransferTarget } from '../../types';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';

/**
 * Bloco de moedas da ficha, logo abaixo da mochila.
 *
 * - O JOGADOR gasta, troca e transfere pelos endpoints próprios.
 * - O MESTRE (em modo de edição) dá ou retira.
 * - As denominações PL (pp) e PE (ep) só aparecem com `extraCoins` ligado na
 *   mesa — mas se houver saldo nelas, aparecem sempre (senão o jogador ficaria
 *   com moeda invisível).
 */

type Action = 'spend' | 'exchange' | 'transfer' | 'give';

interface CoinsPanelProps {
  character: Character;
  /** Denominações extras (PL/PE) ligadas pelo mestre na aba Mesa. */
  extraCoins: boolean;
  /** Destinos possíveis de transferência (outros jogadores). */
  targets?: TransferTarget[];
  /** Adota a ficha devolvida pela ação (o servidor é a fonte de verdade). */
  onCharacter: (character: Character) => void;
}

/** Rascunho dos campos de valor: uma string por denominação. */
type Draft = Record<CoinKey, string>;

const EMPTY_DRAFT: Draft = { pp: '', gp: '', ep: '', sp: '', cp: '' };

function draftToAmount(draft: Draft): CoinAmount {
  const amount: CoinAmount = {};
  for (const key of COIN_KEYS) {
    const value = clampInt(draft[key], 0, 9_999_999, 0);
    if (value > 0) amount[key] = value;
  }
  return amount;
}

function hasPositiveAmount(amount: CoinAmount): boolean {
  return COIN_KEYS.some((key) => (amount[key] ?? 0) > 0);
}

/** Peso da carteira em quilos (50 moedas = 0,5 kg). */
function coinWeightLabel(coins: CoinPurse): string {
  const weight = coinsWeight(coins);
  return weight > 0 ? `${weight} kg` : '';
}

export function CoinsPanel({
  character,
  extraCoins,
  targets = [],
  onCharacter,
}: CoinsPanelProps) {
  const { readOnly, masterView } = useSheetAccess();
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [from, setFrom] = useState<CoinKey>('sp');
  const [to, setTo] = useState<CoinKey>('gp');
  const [amount, setAmount] = useState('');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const coins = character.coins;
  const canTrade = !readOnly && !masterView;
  const canGive = !readOnly && masterView;

  // Denominações exibidas: as visíveis, mais qualquer uma com saldo (para não
  // esconder moeda que o jogador tem).
  const visible = visibleCoinKeys(extraCoins);
  const displayed = COIN_KEYS.filter((key) => visible.includes(key) || coins[key] > 0);

  function reset(): void {
    setAction(null);
    setDraft(EMPTY_DRAFT);
    setAmount('');
    setTargetId('');
    setError(null);
  }

  function open(next: Action): void {
    setAction((current) => (current === next ? null : next));
    setDraft(EMPTY_DRAFT);
    setAmount('');
    setError(null);
    if (next === 'transfer' && !targetId && targets.length > 0) setTargetId(targets[0].id);
  }

  async function run(operation: () => Promise<Character>): Promise<void> {
    setBusy(true);
    try {
      const saved = await operation();
      onCharacter(saved);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  function submitSpend(): void {
    const value = draftToAmount(draft);
    if (!hasPositiveAmount(value)) {
      setError('Informe quantas moedas gastar.');
      return;
    }
    if (!canPay(coins, value)) {
      setError('Saldo insuficiente nessas denominações.');
      return;
    }
    void run(() => spendCoins(value));
  }

  function submitExchange(): void {
    const parsed = clampInt(amount, 1, 9_999_999, 0);
    if (from === to) {
      setError('Escolha denominações diferentes.');
      return;
    }
    if (parsed <= 0) {
      setError('Informe quantas moedas trocar.');
      return;
    }
    if (!exchangeIsExact(parsed, from, to)) {
      setError(
        `Troca não exata: ${parsed} ${COIN_LABELS[from]} não vira um número inteiro de ${COIN_LABELS[to]}.`,
      );
      return;
    }
    if (coins[from] < parsed) {
      setError(`Você tem só ${coins[from]} ${COIN_LABELS[from]}.`);
      return;
    }
    void run(() => exchangeCoins(from, to, parsed));
  }

  function submitTransfer(): void {
    const value = draftToAmount(draft);
    if (!targetId) {
      setError('Escolha o personagem de destino.');
      return;
    }
    if (!hasPositiveAmount(value)) {
      setError('Informe quantas moedas transferir.');
      return;
    }
    if (!canPay(coins, value)) {
      setError('Saldo insuficiente nessas denominações.');
      return;
    }
    void run(() => transferCoins(targetId, value));
  }

  function submitGive(): void {
    const delta: CoinAmount = {};
    for (const key of COIN_KEYS) {
      const raw = draft[key].trim();
      if (raw === '') continue;
      const value = clampInt(raw, -9_999_999, 9_999_999, 0);
      if (value !== 0) delta[key] = value;
    }
    if (!hasPositiveAmount(delta) && !COIN_KEYS.some((key) => (delta[key] ?? 0) < 0)) {
      setError('Informe quanto dar (positivo) ou retirar (negativo).');
      return;
    }
    void run(() => giveCoins(character.id, delta));
  }

  /** Campos de valor, um por denominação (aceita negativos no "dar/retirar"). */
  function amountFields(): ReactElement {
    return (
      <div className="coin-fields">
        {displayed.map((key) => (
          <label key={key} className="coin-field">
            <span title={COIN_NAMES[key]}>{COIN_LABELS[key]}</span>
            <input
              type="number"
              className="coin-input"
              value={draft[key]}
              min={action === 'give' ? undefined : 0}
              step={1}
              disabled={busy}
              aria-label={`${COIN_NAMES[key]} (${COIN_LABELS[key]})`}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [key]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="coins-panel">
      <div className="coins-head">
        <span>Moedas</span>
        <span className="coins-weight">
          {coinWeightLabel(coins)}
        </span>
      </div>

      <div className="coins-grid">
        {visible.map((key) => (
          <div key={key} className="coin-cell" title={COIN_NAMES[key]}>
            <Icon name="coin" size={15} className={`coin-icon ${COIN_METAL[key]}`} />
            <span className="coin-label">{COIN_LABELS[key]}</span>
            <span className="coin-value">{coins[key]}</span>
          </div>
        ))}
      </div>

      {error ? <p className="coin-error">{error}</p> : null}

      {canTrade ? (
        <div className="coins-actions">
          <button
            type="button"
            className={action === 'spend' ? 'btn btn-small active' : 'btn btn-small'}
            onClick={() => open('spend')}
          >
            Gastar
          </button>
          <button
            type="button"
            className={action === 'exchange' ? 'btn btn-small active' : 'btn btn-small'}
            onClick={() => open('exchange')}
          >
            Trocar
          </button>
          <button
            type="button"
            className={action === 'transfer' ? 'btn btn-small active' : 'btn btn-small'}
            disabled={targets.length === 0}
            title={targets.length === 0 ? 'Nenhum outro jogador com ficha na mesa' : undefined}
            onClick={() => open('transfer')}
          >
            Transferir
          </button>
        </div>
      ) : null}

      {canGive ? (
        <div className="coins-actions">
          <button
            type="button"
            className={action === 'give' ? 'btn btn-small active' : 'btn btn-small'}
            onClick={() => open('give')}
          >
            Dar / Retirar
          </button>
        </div>
      ) : null}

      {action === 'spend' ? (
        <div className="coin-form">
          <p className="coin-hint">Gasto exato, sem troco automático.</p>
          {amountFields()}
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={submitSpend}>
            Gastar
          </button>
        </div>
      ) : null}

      {action === 'exchange' ? (
        <div className="coin-form">
          <div className="coin-row">
            <label className="coin-field">
              <span>De</span>
              <select className="coin-input" value={from} onChange={(e) => setFrom(e.target.value as CoinKey)}>
                {COIN_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {COIN_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="coin-field">
              <span>Para</span>
              <select className="coin-input" value={to} onChange={(e) => setTo(e.target.value as CoinKey)}>
                {COIN_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {COIN_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="coin-field">
              <span>Qtd.</span>
              <input
                type="number"
                className="coin-input"
                min={1}
                step={1}
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          {from !== to && amount && exchangeIsExact(clampInt(amount, 0, 9_999_999, 0), from, to) ? (
            <p className="coin-hint">
              {clampInt(amount, 0, 9_999_999, 0)} {COIN_LABELS[from]} →{' '}
              {exchangeResult(clampInt(amount, 0, 9_999_999, 0), from, to)} {COIN_LABELS[to]}
            </p>
          ) : null}
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={submitExchange}>
            Trocar
          </button>
        </div>
      ) : null}

      {action === 'transfer' ? (
        <div className="coin-form">
          <label className="coin-field">
            <span>Destino</span>
            <select
              className="coin-input"
              value={targetId}
              disabled={busy}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} ({target.ownerUsername})
                </option>
              ))}
            </select>
          </label>
          {amountFields()}
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy || targets.length === 0}
            onClick={submitTransfer}
          >
            Transferir
          </button>
        </div>
      ) : null}

      {action === 'give' ? (
        <div className="coin-form">
          <p className="coin-hint">Positivo dá, negativo retira.</p>
          {amountFields()}
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={submitGive}>
            Aplicar
          </button>
        </div>
      ) : null}
    </div>
  );
}
