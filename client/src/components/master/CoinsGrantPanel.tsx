import { useState } from 'react';
import { COIN_LABELS, COIN_METAL, COIN_NAMES, formatCoins } from '../../coins';
import { giveCoins } from '../../coinsApi';
import type { Character } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import {
  EMPTY_DRAFT,
  describeDelta,
  effectLabel,
  grantPreview,
  type Draft,
} from './coinGrant';

/**
 * Entrega de moedas do mestre, direto na aba **Itens**.
 *
 * O mestre escolhe o jogador e digita o valor por denominação — positivo ENTREGA,
 * negativo RETIRA — pelo mesmo `POST /api/characters/:id/coins` do bloco de
 * moedas da ficha, sem precisar abrir (nem editar) a ficha do jogador.
 *
 * O painel é organizado em DOIS blocos, na ordem em que a decisão acontece:
 *
 *   1. **Quem recebe** — o seletor e a carteira ATUAL do jogador (mesmas células
 *      de moeda coloridas da ficha), que já mostram `atual → depois` conforme o
 *      mestre digita;
 *   2. **Quanto** — uma linha por denominação com o saldo, o campo, o efeito
 *      (+/−) e o saldo resultante, seguida do resumo `Saldo: X → Y`.
 *
 * Antes de aplicar, o mestre confere o efeito de CADA denominação (a linha fica
 * marcada quando a retirada passaria do saldo) — a prévia inteira é derivada em
 * `./coinGrant`, sem nenhuma regra de servidor no cliente. Na confirmação o
 * painel adota a ficha devolvida pelo servidor e o jogador vê o saldo mudar na
 * hora (`sheet:updated`).
 */

interface CoinsGrantPanelProps {
  characters: Character[];
  /** Denominações extras (PL/PE) ligadas pelo mestre na aba Mesa. */
  extraCoins: boolean;
  /** A ação devolveu a ficha inteira: o painel adota a versão nova. */
  onCharacter: (character: Character) => void;
}

export function CoinsGrantPanel({ characters, extraCoins, onCharacter }: CoinsGrantPanelProps) {
  // Com UM jogador só na mesa a escolha já vem feita: o mestre não precisa
  // clicar no seletor só para ver a carteira e a prévia da entrega.
  const [targetId, setTargetId] = useState(() =>
    characters.length === 1 ? characters[0].id : '',
  );
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { selected, delta, after, hasDelta, insufficient, actionLabel, actionIcon, rows } =
    grantPreview(characters, targetId, draft, extraCoins);

  function clearDraft(): void {
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!selected) {
      setError('Escolha o jogador que recebe as moedas.');
      return;
    }
    if (!hasDelta) {
      setError('Informe quanto entregar.');
      return;
    }
    if (insufficient.length > 0) {
      setError(
        `Retirada maior que o saldo em ${insufficient.map((key) => COIN_LABELS[key]).join(', ')} ` +
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
      icon="coin"
      className="coin-grant"
      subtitle="Dê (ou retire) moedas de um jogador sem abrir a ficha — o saldo dele muda na hora"
    >
      {characters.length === 0 ? (
        <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
      ) : (
        <div className="coin-grant-body">
          {/* ---- 1. Quem recebe ------------------------------------------- */}
          <div className="coin-grant-block">
            <h3 className="coin-grant-title">Quem recebe</h3>

            <label className="field">
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

            {selected ? (
              <>
                <div className="coin-grant-target">
                  <Portrait src={selected.avatarUrl} alt={selected.name} icon="users" />
                  <span className="coin-grant-target-info">
                    <strong>{selected.name}</strong>
                    <span className="coin-grant-target-owner">
                      {selected.ownerUsername ?? 'sem conta vinculada'}
                    </span>
                  </span>
                </div>

                {/* Carteira ATUAL já com a prévia: `atual → depois`. */}
                <ul className="coin-grant-purse" aria-label={`Saldo de ${selected.name}`}>
                  {rows.map((row) => (
                    <li
                      key={row.key}
                      className={`coin-grant-purse-cell${
                        row.diff > 0 ? ' is-plus' : row.diff < 0 ? ' is-minus' : ''
                      }${row.short ? ' is-short' : ''}`}
                    >
                      <Icon
                        name="coin"
                        size={14}
                        className={`coin-icon ${COIN_METAL[row.key]}`}
                      />
                      <span className="coin-label">{COIN_LABELS[row.key]}</span>
                      <span className="coin-value">{row.current}</span>
                      {row.diff !== 0 ? (
                        <>
                          <span className="coin-grant-purse-arrow" aria-hidden="true">
                            →
                          </span>
                          <strong className="coin-value">{row.next}</strong>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty-hint">
                Escolha o jogador para ver a carteira dele e a prévia do saldo.
              </p>
            )}
          </div>

          {/* ---- 2. Quanto ------------------------------------------------ */}
          <div className="coin-grant-block">
            <h3 className="coin-grant-title">Quanto</h3>

            <div className="coin-grant-legend">
              <span className="coin-grant-legend-item is-plus">positivo entrega</span>
              <span className="coin-grant-legend-item is-minus">negativo retira</span>
            </div>

            <ul className="coin-grant-rows">
              {rows.map((row) => (
                <li key={row.key} className={`coin-grant-row${row.short ? ' is-short' : ''}`}>
                  <label className="coin-grant-row-head" title={COIN_NAMES[row.key]}>
                    <Icon name="coin" size={14} className={`coin-icon ${COIN_METAL[row.key]}`} />
                    <span className="coin-grant-denom">{COIN_LABELS[row.key]}</span>
                    <span className="coin-grant-denom-name">{COIN_NAMES[row.key]}</span>
                  </label>

                  <span className="coin-grant-current">
                    {row.current === null ? 'saldo —' : `saldo ${row.current}`}
                  </span>

                  <input
                    type="number"
                    className="coin-input coin-grant-input"
                    value={draft[row.key]}
                    step={1}
                    placeholder="0"
                    disabled={busy}
                    aria-label={`${COIN_NAMES[row.key]} (${COIN_LABELS[row.key]}): quanto entregar (positivo) ou retirar (negativo)`}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [row.key]: event.target.value }))
                    }
                  />

                  <span
                    className={`coin-grant-effect${
                      row.diff > 0 ? ' is-plus' : row.diff < 0 ? ' is-minus' : ' is-none'
                    }`}
                  >
                    {effectLabel(row.diff)}
                  </span>

                  <span className="coin-grant-after">
                    {row.next === null ? null : row.diff === 0 ? (
                      <span className="coin-grant-after-idle">sem mudança</span>
                    ) : (
                      <>
                        → <strong>{row.next}</strong>
                        {row.short ? <em className="coin-grant-short"> insuficiente</em> : null}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="coin-grant-summary">
              <span className="coin-grant-summary-line">
                <span className="coin-grant-summary-label">Saldo</span>
                <strong>{selected ? formatCoins(selected.coins, extraCoins) : '—'}</strong>
                <span className="coin-grant-summary-arrow" aria-hidden="true">
                  →
                </span>
                <strong className={insufficient.length > 0 ? 'is-short' : undefined}>
                  {after ? formatCoins(after, extraCoins) : '—'}
                </strong>
              </span>
              <span className="coin-grant-summary-change">
                {hasDelta
                  ? describeDelta(delta)
                  : 'Digite quanto entregar (ou retire com um valor negativo).'}
              </span>
            </div>

            <div className="coin-grant-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy || !selected || !hasDelta || insufficient.length > 0}
                onClick={() => void submit()}
              >
                <Icon name={actionIcon} size={14} /> {busy ? 'aplicando…' : actionLabel}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || !hasDelta}
                onClick={clearDraft}
              >
                <Icon name="x" size={13} /> limpar
              </button>
            </div>
          </div>
        </div>
      )}

      {success ? <p className="form-success coin-grant-feedback">{success}</p> : null}
      {error ? <p className="form-error coin-grant-feedback">{error}</p> : null}
    </Section>
  );
}
