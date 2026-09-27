import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import { Die3D } from './Die3D';
import { resultBreakdown } from './format';
import type { RemoteBoard } from './useDiceRoller';

interface RemoteRollBoardProps {
  board: RemoteBoard;
  onClose: () => void;
}

/**
 * O tabuleiro de rolagem de outra pessoa da mesa.
 *
 * Quem abre a janela de dados anuncia a rolagem para todos; quem não é o autor
 * clica na faixa e vê este tabuleiro — os mesmos dados, caindo no mesmo
 * instante, e o mesmo resultado. É só leitura: não tem picker, controles nem
 * botão de rolar.
 */
export function RemoteRollBoard({ board, onClose }: RemoteRollBoardProps) {
  const rolling = board.phase === 'tumbling';
  const result = board.result;
  const settled = board.phase === 'settled' && result !== null;
  const extraD20 =
    board.advantage || board.disadvantage
      ? board.pool.filter((die) => die.sides === 20).length
      : 0;

  // Esc fecha e o fundo não rola enquanto o tabuleiro está aberto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="dice-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dice-stage" onClick={(event) => event.stopPropagation()}>
        {/* Cabeçalho: quem está rolando (só leitura para quem assiste). */}
        <header className="dice-watch-head">
          <Portrait
            src={board.avatarUrl}
            alt={board.actorName}
            size="sm"
            icon="users"
            zoomable={false}
          />
          <span className="dice-live-text">
            <strong>{board.actorName}</strong>
            {board.label
              ? ` está realizando um teste de ${board.label}`
              : ' está realizando um teste'}
          </span>
          <span className="dice-watch-tag">somente leitura</span>
          <button
            type="button"
            className="dice-head-close"
            aria-label="Fechar o tabuleiro"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* Ring: o mesmo tabuleiro do autor, sem os controles. */}
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
              ) : board.pool.length === 0 ? (
                <p className="dice-ring-hint">Escolhendo os dados</p>
              ) : (
                <>
                  {board.pool.map((die, index) => (
                    <Die3D
                      key={`p-${index}`}
                      sides={die.sides}
                      value={null}
                      reveal={false}
                      tumbling={rolling}
                      locked={die.locked}
                    />
                  ))}

                  {/* Vantagem/desvantagem: o d20 rola duas vezes. */}
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

        <div className="dice-readout">
          {settled && result ? (
            <div className={result.crit ? 'dice-total is-crit' : 'dice-total'}>
              <span className="dice-total-value">{result.total}</span>
              <span className="dice-total-detail">{resultBreakdown(result)}</span>
              <span className="dice-total-tags">
                {result.advantage ? <em>vantagem</em> : null}
                {result.disadvantage ? <em>desvantagem</em> : null}
                {result.crit ? <em className="crit">20 natural!</em> : null}
              </span>
            </div>
          ) : (
            <p className="dice-readout-hint">
              {rolling ? 'Rolando os dados...' : 'Aguardando a rolagem'}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
