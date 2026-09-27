import { useEffect } from 'react';
import { Icon } from '../components/Icon';
import type { DiceRollDto } from '../types';
import { DICE_TYPES, type DiceRollerState } from './useDiceRoller';

interface Die3DProps {
  sides: number;
  value: number | null;
  dropped?: boolean;
  locked?: boolean;
  tumbling?: boolean;
  onClick?: () => void;
  title?: string;
}

/**
 * Um dado desenhado em CSS 3D. Fica parado levemente inclinado; durante a
 * rolagem entra na animação de queda (`tumbling`).
 */
function Die3D({ sides, value, dropped, locked, tumbling, onClick, title }: Die3DProps) {
  const classes = ['die3d'];
  if (tumbling) classes.push('is-tumbling');
  if (dropped) classes.push('is-dropped');
  if (locked) classes.push('is-locked');
  if (onClick) classes.push('is-clickable');

  const label = tumbling ? '?' : value === null ? '·' : String(value);

  const body = (
    <>
      <span className="die3d-type">d{sides}</span>
      <span className="die3d-value">{label}</span>
      {locked ? <span className="die3d-lock">fixo</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={classes.join(' ')}
        data-sides={sides}
        title={title ?? 'Clique para remover'}
        aria-label={locked ? `d${sides} fixo` : `Remover d${sides} do pool`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={classes.join(' ')}
      data-sides={sides}
      title={dropped ? `d${sides} descartado` : `d${sides}`}
    >
      {body}
    </span>
  );
}

/** Texto do aviso público que todos (menos o autor) veem. */
function announcement(roll: DiceRollDto): string {
  if (roll.kind === 'free') return `${roll.actorName} está fazendo uma rolagem de dados`;
  return `${roll.actorName} está fazendo um teste de ${roll.label}`;
}

/** Detalhe do resultado: valores individuais + bônus. */
function resultBreakdown(roll: DiceRollDto): string {
  const parts = roll.dice
    .filter((die) => !die.dropped)
    .map((die) => String(die.value));
  const expression = parts.join(' + ') || '0';
  const bonus = roll.bonus === 0 ? '' : roll.bonus > 0 ? ` + ${roll.bonus}` : ` − ${Math.abs(roll.bonus)}`;
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
 * Botão flutuante "Dados" (canto inferior esquerdo) e a janela de rolagem.
 *
 * Fica disponível em qualquer tela — ficha, combate e painel do mestre. As
 * rolagens públicas disparam um aviso para toda a mesa; o mestre tem ainda a
 * rolagem privada e o log lateral da sessão.
 */
export function DiceDock({ roller }: DiceDockProps) {
  const {
    isMaster,
    open,
    context,
    pool,
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
  } = roller;

  // Esc fecha a janela.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const settled = phase === 'settled' && result !== null;
  const hasRemovable = pool.some((die) => !die.locked);
  const rolling = phase === 'tumbling';

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

      {open ? (
        <section
          className={isMaster ? 'dice-window is-master' : 'dice-window'}
          role="dialog"
          aria-label="Janela de rolagem de dados"
        >
          <header className="dice-window-head">
            <h2>
              <Icon name="die" size={18} />
              {context ? `Teste de ${context.label}` : 'Rolagem livre'}
            </h2>
            {context ? (
              <span className="dice-window-bonus">
                bônus {context.bonus >= 0 ? `+${context.bonus}` : context.bonus}
              </span>
            ) : null}
            <button
              type="button"
              className="dice-window-close"
              aria-label="Fechar a janela de dados"
              onClick={close}
            >
              ×
            </button>
          </header>

          <div className="dice-window-body">
            <div className="dice-main">
              {/* Bandeja octogonal: os dados escolhidos ficam parados no centro. */}
              <div className={rolling ? 'dice-tray is-rolling' : 'dice-tray'}>
                <div className="dice-tray-inner">
                  {settled && result ? (
                    result.dice.map((die, index) => (
                      <Die3D
                        key={`r-${index}`}
                        sides={die.sides}
                        value={die.value}
                        dropped={die.dropped}
                      />
                    ))
                  ) : pool.length === 0 ? (
                    <p className="dice-tray-empty">Escolha os dados abaixo</p>
                  ) : (
                    pool.map((die, index) => (
                      <Die3D
                        key={`p-${index}`}
                        sides={die.sides}
                        value={null}
                        locked={die.locked}
                        tumbling={rolling}
                        onClick={
                          rolling || die.locked ? undefined : () => removeDie(index)
                        }
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Bandeja de tipos: cada clique empilha um dado no pool. */}
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

              {settled && result ? (
                <div className={result.crit ? 'dice-result is-crit' : 'dice-result'}>
                  <div className="dice-result-total">{result.total}</div>
                  <div className="dice-result-detail">{resultBreakdown(result)}</div>
                  {result.advantage ? <span className="dice-result-tag">vantagem</span> : null}
                  {result.disadvantage ? (
                    <span className="dice-result-tag">desvantagem</span>
                  ) : null}
                  {result.crit ? <span className="dice-result-tag crit">20 natural!</span> : null}
                </div>
              ) : null}
            </div>

            {isMaster ? (
              <aside className="dice-history" aria-label="Histórico de rolagens">
                <h3>
                  <Icon name="scroll" size={14} /> Histórico
                </h3>
                {history.length === 0 ? (
                  <p className="dice-history-empty">Nenhuma rolagem ainda.</p>
                ) : (
                  <ul className="dice-history-list">
                    {history.map((roll) => (
                      <li key={roll.id} className={roll.isPrivate ? 'is-private' : undefined}>
                        <span className="dice-history-text">{historyLine(roll)}</span>
                        <span className="dice-history-side">
                          {roll.isPrivate ? <em className="tag">privada</em> : null}
                          <span className="dice-history-time">
                            {new Date(roll.at).toLocaleTimeString('pt-BR')}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            ) : null}
          </div>
        </section>
      ) : null}

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

