import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import type { DiceRollDto } from '../types';
import { Die3D } from './Die3D';
import { DICE_TYPES, type DiceRollerState } from './useDiceRoller';

/** Texto do aviso público que todos (menos o autor) veem. */
function announcement(roll: DiceRollDto): string {
  if (roll.kind === 'free') return `${roll.actorName} está fazendo uma rolagem de dados`;
  return `${roll.actorName} está fazendo um teste de ${roll.label}`;
}

/** Detalhe do resultado: valores individuais + bônus. */
function resultBreakdown(roll: DiceRollDto): string {
  const parts = roll.dice.filter((die) => !die.dropped).map((die) => String(die.value));
  const expression = parts.join(' + ') || '0';
  const bonus =
    roll.bonus === 0 ? '' : roll.bonus > 0 ? ` + ${roll.bonus}` : ` − ${Math.abs(roll.bonus)}`;
  return `${expression}${bonus}`;
}

function historyLine(roll: DiceRollDto): string {
  const label = roll.kind === 'free' ? 'Rolagem livre' : roll.label;
  return `${roll.actorName}: ${label}: ${roll.total}`;
}

interface DiceDockProps {
  roller: DiceRollerState;
}

/**
 * Botão flutuante "Dados" e a janela de rolagem.
 *
 * O botão fica disponível em qualquer tela. Ao abrir, o ring surge no centro da
 * tela com o fundo escurecido (como o lightbox das imagens), os dados rolam
 * dentro dele e o resultado e o log do mestre aparecem abaixo.
 *
 * A janela é de quem está rolando. Os demais veem a faixa no topo do tabuleiro
 * com a foto e o nome de quem está realizando o teste.
 */
export function DiceDock({ roller }: DiceDockProps) {
  const {
    isMaster,
    open,
    context,
    pool,
    extraD20,
    activeRoll,
    advantage,
    disadvantage,
    isPrivate,
    phase,
    result,
    error,
    toasts,
    history,
    openFree,
    close,
    addDie,
    removeDie,
    clearPool,
    setAdvantage,
    setDisadvantage,
    setPrivate,
    submit,
    dismissToast,
    clearHistory,
  } = roller;

  // Esc fecha e o fundo não rola enquanto o ring está aberto.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const rolling = phase === 'tumbling';
  const settled = phase === 'settled' && result !== null;
  const hasRemovable = pool.some((die) => !die.locked);

  return (
    <>
      {toasts.length > 0 ? (
        <div className="dice-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div className="dice-toast" key={toast.id} role="status">
              <div className="dice-toast-text">
                <strong>{announcement(toast.roll)}</strong>
                <span className="dice-toast-roll">
                  {resultBreakdown(toast.roll)} = <b>{toast.roll.total}</b>
                </span>
              </div>
              <button
                type="button"
                className="dice-toast-close"
                aria-label="Dispensar aviso"
                onClick={() => dismissToast(toast.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Alguém da mesa abriu a janela: quem não é o autor acompanha pela faixa. */}
      {activeRoll ? (
        <div className="dice-live" role="status">
          <Portrait
            src={activeRoll.avatarUrl}
            alt={activeRoll.actorName}
            size="sm"
            icon="users"
            zoomable={false}
          />
          <span className="dice-live-text">
            <strong>{activeRoll.actorName}</strong> está realizando
            {activeRoll.label ? ` um teste de ${activeRoll.label}` : ' um teste'}
          </span>
          <span className="dice-live-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}

      {open
        ? createPortal(
            <div className="dice-overlay" role="dialog" aria-modal="true" onClick={close}>
              <div className="dice-stage" onClick={(event) => event.stopPropagation()}>
                <header className="dice-head">
                  <h2>
                    <Icon name="die" size={18} />
                    {context ? `Teste de ${context.label}` : 'Rolagem livre'}
                  </h2>
                  {context ? (
                    <span className="dice-head-bonus">
                      bônus {context.bonus >= 0 ? `+${context.bonus}` : context.bonus}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="dice-head-close"
                    aria-label="Fechar a janela de dados"
                    onClick={close}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </header>

                {/* Ring: arena circular onde os dados giram e pousam. */}
                <div className={rolling ? 'dice-ring is-rolling' : 'dice-ring'}>
                  <div className="dice-ring-inner">
                    <div className="dice-ring-floor">
                      {settled && result ? (
                        result.dice.map((die, index) => (
                          <Die3D
                            key={`r-${index}`}
                            sides={die.sides}
                            value={die.value}
                            reveal
                            dropped={die.dropped}
                          />
                        ))
                      ) : pool.length === 0 ? (
                        <p className="dice-ring-hint">Escolha os dados abaixo</p>
                      ) : (
                        <>
                          {pool.map((die, index) => (
                            <Die3D
                              key={`p-${index}`}
                              sides={die.sides}
                              value={null}
                              reveal={false}
                              tumbling={rolling}
                              locked={die.locked}
                              onClick={rolling || die.locked ? undefined : () => removeDie(index)}
                            />
                          ))}

                          {/* Vantagem/desvantagem: o d20 rola duas vezes, então o segundo
                              dado já entra no ring junto com o primeiro. */}
                          {rolling
                            ? Array.from({ length: extraD20 }, (_, index) => (
                                <Die3D
                                  key={`x-${index}`}
                                  sides={20}
                                  value={null}
                                  reveal={false}
                                  tumbling
                                />
                              ))
                            : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Leitura do resultado, logo abaixo do ring. */}
                <div className="dice-readout">
                  {settled && result ? (
                    <div className={result.crit ? 'dice-total is-crit' : 'dice-total'}>
                      <span className="dice-total-value">{result.total}</span>
                      <span className="dice-total-detail">{resultBreakdown(result)}</span>
                      <span className="dice-total-tags">
                        {result.advantage ? <em>vantagem</em> : null}
                        {result.disadvantage ? <em>desvantagem</em> : null}
                        {result.crit ? <em className="crit">20 natural!</em> : null}
                        {result.isPrivate ? <em className="private">privada</em> : null}
                      </span>
                    </div>
                  ) : (
                    <p className="dice-readout-hint">
                      {rolling ? 'Rolando os dados...' : 'Monte o pool e role'}
                      {!rolling && (advantage || disadvantage) ? (
                        <span className="dice-readout-note">
                          {advantage ? 'vantagem' : 'desvantagem'}: cada d20 rola duas vezes
                        </span>
                      ) : null}
                    </p>
                  )}
                </div>

                <div className="dice-picker" role="group" aria-label="Tipos de dado">
                  {DICE_TYPES.map((sides) => (
                    <button
                      key={sides}
                      type="button"
                      className="dice-pick"
                      data-sides={sides}
                      onClick={() => addDie(sides)}
                      aria-label={`Adicionar d${sides}`}
                    >
                      d{sides}
                    </button>
                  ))}
                </div>

                <div className="dice-controls">
                  <label className="dice-toggle">
                    <input
                      type="checkbox"
                      checked={advantage}
                      onChange={(event) => setAdvantage(event.target.checked)}
                    />
                    Vantagem
                  </label>
                  <label className="dice-toggle">
                    <input
                      type="checkbox"
                      checked={disadvantage}
                      onChange={(event) => setDisadvantage(event.target.checked)}
                    />
                    Desvantagem
                  </label>
                  {isMaster ? (
                    <label className="dice-toggle">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(event) => setPrivate(event.target.checked)}
                      />
                      Privada
                    </label>
                  ) : null}

                  <span className="dice-controls-spacer" />

                  {hasRemovable ? (
                    <button type="button" className="btn btn-small" onClick={clearPool}>
                      limpar
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={rolling || pool.length === 0}
                    onClick={() => void submit()}
                  >
                    <Icon name="die" size={15} /> {rolling ? 'Rolando...' : 'Rolar'}
                  </button>
                </div>

                {error ? <p className="dice-error">{error}</p> : null}

                {/* Log do mestre, abaixo dos dados. */}
                {isMaster ? (
                  <div className="dice-log">
                    <div className="dice-log-head">
                      <h3>
                        <Icon name="scroll" size={14} /> Histórico
                      </h3>
                      {history.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-small dice-log-clear"
                          onClick={() => void clearHistory()}
                        >
                          limpar
                        </button>
                      ) : null}
                    </div>

                    {history.length === 0 ? (
                      <p className="dice-log-empty">Nenhuma rolagem ainda.</p>
                    ) : (
                      <ul className="dice-log-list">
                        {history.map((roll) => (
                          <li key={roll.id} className={roll.isPrivate ? 'is-private' : undefined}>
                            <span className="dice-log-text">{historyLine(roll)}</span>
                            <span className="dice-log-side">
                              {roll.isPrivate ? <em className="tag">privada</em> : null}
                              <span className="dice-log-time">
                                {new Date(roll.at).toLocaleTimeString('pt-BR')}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}

      <button
        type="button"
        className={open ? 'dice-fab active' : 'dice-fab'}
        aria-expanded={open}
        title={open ? 'Fechar a janela de dados' : 'Abrir a janela de dados'}
        onClick={() => (open ? close() : openFree())}
      >
        <Icon name="die" size={18} />
        <span className="dice-fab-label">Dados</span>
      </button>
    </>
  );
}
