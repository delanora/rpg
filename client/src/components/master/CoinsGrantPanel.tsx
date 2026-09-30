import { useState, type ReactElement } from 'react';
import { COIN_KEYS, COIN_LABELS, COIN_NAMES, formatCoins, visibleCoinKeys } from '../../coins';
import { giveCoins } from '../../coinsApi';
import type { Character, CoinDelta, CoinKey, CoinPurse } from '../../types';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';
import { Section } from '../Section';

/**
 * Entrega de moedas do mestre, direto na aba **Itens**.
 *
 * O mestre escolhe o jogador e digita o valor por denominação — positivo ENTREGA,
 * negativo RETIRA — pelo mesmo `POST /api/characters/:id/coins` do bloco de
 * moedas da ficha, sem precisar abrir (nem editar) a ficha do jogador.
 *
 * O saldo atual e o saldo DEPOIS da entrega aparecem lado a lado antes de
 * aplicar, então dá para conferir quanto o jogador vai ficar. Na confirmação o
 * painel do mestre adota a ficha devolvida pelo servidor e o jogador vê o saldo
 * mudar na hora (`sheet:updated`).
 */

interface CoinsGrantPanelProps {
  characters: Character[];
  /** Denominações extras (PL/PE) ligadas pelo mestre na aba Mesa. */
  extraCoins: boolean;
  /** A ação devolveu a ficha inteira: o painel adota a versão nova. */
  onCharacter: (character: Character) => void;
}

/** Rascunho dos campos: uma string por denominação. */
type Draft = Record<CoinKey, string>;

const EMPTY_DRAFT: Draft = { pp: '', gp: '', ep: '', sp: '', cp: '' };

/** Delta informado pelo mestre (só as denominações com valor diferente de zero). */
function draftToDelta(draft: Draft): CoinDelta {
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
function purseAfter(coins: CoinPurse, delta: CoinDelta): CoinPurse {
  const next = { ...coins };
  for (const key of COIN_KEYS) next[key] = coins[key] + (delta[key] ?? 0);
  return next;
}

/** "Entregue: 20 PO · Retirado: 5 PP" — o que a ação fez, para a mensagem. */
function describeDelta(delta: CoinDelta): string {
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

export function CoinsGrantPanel({ characters, extraCoins, onCharacter }: CoinsGrantPanelProps) {
  const [targetId, setTargetId] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = characters.find((character) => character.id === targetId) ?? null;
  const delta = draftToDelta(draft);
  const after = selected ? purseAfter(selected.coins, delta) : null;

  // Denominações exibidas: as ligadas na mesa, mais qualquer uma com saldo (para
  // não esconder moeda que o jogador já tem).
  const visible = visibleCoinKeys(extraCoins);
  const displayed = COIN_KEYS.filter(
    (key) => visible.includes(key) || (selected?.coins[key] ?? 0) > 0,
  );

  /** Campos de valor, um por denominação (aceita negativos no dar/retirar). */
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

  async function submit(): Promise<void> {
    if (!selected) {
      setError('Escolha o jogador que recebe as moedas.');
      return;
    }
    if (COIN_KEYS.every((key) => (delta[key] ?? 0) === 0)) {
      setError('Informe quanto entregar.');
      return;
    }

    const negative = COIN_KEYS.filter((key) => (after?.[key] ?? 0) < 0);
    if (negative.length > 0) {
      setError(
        `Retirada maior que o saldo em ${negative.map((key) => COIN_LABELS[key]).join(', ')} ` +
          `(saldo atual: ${formatCoins(selected.coins, extraCoins)}).`,
      );
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await giveCoins(selected.id, delta);
      onCharacter(saved);
      setSuccess(
        `${describeDelta(delta)} → ${selected.name} (saldo: ${formatCoins(saved.coins, extraCoins)})`,
      );
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entregar as moedas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Entregar moedas"
      icon="bag"
      subtitle="Dê (ou retire) moedas de um jogador sem abrir a ficha — o saldo dele muda na hora"
    >
      {characters.length === 0 ? (
        <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
      ) : (
        <div className="coin-form">
          <div className="toolbar toolbar-wrap">
            <label className="field field-inline">
              <span>Jogador</span>
              <select
                value={targetId}
                disabled={busy}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  setSuccess(null);
                  setError(null);
                }}
              >
                <option value="">escolha o jogador</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                    {character.ownerUsername ? ` (${character.ownerUsername})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="coin-hint">Positivo entrega, negativo retira.</p>
          {amountFields()}

          {selected && after ? (
            <p className="coin-hint">
              Saldo: {formatCoins(selected.coins, extraCoins)} →{' '}
              <strong>{formatCoins(after, extraCoins)}</strong>
            </p>
          ) : null}

          <div className="coins-actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !selected}
              onClick={() => void submit()}
            >
              <Icon name="plus" size={14} /> {busy ? 'entregando...' : 'entregar'}
            </button>
          </div>
        </div>
      )}

      {success ? <p className="form-success">{success}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </Section>
  );
}
