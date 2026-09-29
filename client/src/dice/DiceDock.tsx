import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import { Die3D } from './Die3D';
import { announcement, resultBreakdown } from './format';
import { RemoteRollBoard } from './RemoteRollBoard';
import { RollLogList } from './RollLogList';
import { DICE_TYPES, type DiceRollerState } from './useDiceRoller';

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
 * ("Fulano está realizando um teste") e podem clicar nela para assistir o
 * tabuleiro daquela pessoa — sem mexer em nada.
 */
export function DiceDock({ roller }: DiceDockProps) {
  const {
    isMaster,
    open,
    context,
    pool,
    extraD20,
    remote,
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

  // Tabuleiro de outra pessoa, aberto por escolha de quem assiste.
  const [watching, setWatching] = useState(false);

  // Fechou a janela de quem rolava: o tabuleiro assistido sai da tela.
  useEffect(() => {
    if (!remote) setWatching(false);
  }, [remote]);

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

      {/* Alguém da mesa está rolando: a faixa no topo; clicar abre o tabuleiro
          de quem rola, só para assistir. */}
      {remote ? (
        <button
          type="button"
          className="dice-live"
          title={`Ver o tabuleiro de ${remote.actorName} (somente leitura)`}
          onClick={() => setWatching(true)}
        >
          <Portrait
            src={remote.avatarUrl}
            alt={remote.actorName}
            size="sm"
            icon="users"
            zoomable={false}
          />
          <span className="dice-live-text">
            <strong>{remote.actorName}</strong>
            {remote.label
              ? ` está realizando um teste de ${remote.label}`
              : ' está realizando um teste'}
          </span>
          <span className="dice-live-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="dice-live-hint">assistir</span>
        </button>
      ) : null}

      {watching && remote ? (
        <RemoteRollBoard board={remote} onClose={() => setWatching(false)} />
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
                      {!rolling && isPrivate ? (
                        <span className="dice-readout-note">
                          privada: a mesa não é avisada
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
                    <label
                      className="dice-toggle"
                      title="Privada: só você vê o resultado e a mesa não é avisada. Desmarque para a mesa acompanhar a rolagem."
                    >
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

                    <RollLogList history={history} />
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* No painel do mestre o botão sobe: acima dele ficam o Log e, abaixo,
          as Anotações (ver `.dice-fab.is-master` em styles.css). */}
      <button
        type="button"
        className={isMaster ? `dice-fab is-master${open ? ' active' : ''}` : open ? 'dice-fab active' : 'dice-fab'}
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
