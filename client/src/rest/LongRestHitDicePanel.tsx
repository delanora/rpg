import type { ReactElement } from 'react';
import type { LongRestHitDiceRecoveryDto } from '../types';

/**
 * Seleção dos Dados de Vida a recuperar no Descanso Longo (PHB 2014).
 *
 * Diferente do painel do Descanso Curto (que GASTA um dado), aqui o jogador
 * ESCOLHE quantos recuperar — e, em multiclasse, de QUAIS tipos: o livro não
 * define prioridade automática. A cota do descanso (`allowance`) e o uso atual
 * de cada face vêm prontos do servidor; a UI só monta a intenção.
 *
 * Recuperar 0 é permitido e nada é pré-selecionado no cliente: a UI mostra
 * exatamente o que já está persistido na sessão (`option.selected`).
 *
 * O teto de cada face é o que foi GASTO dela (`option.used`) — só se recupera o
 * que se gastou. `option.remaining` é o estoque NÃO gasto, que não limita nada
 * aqui. Quem limita o total é a cota GLOBAL do descanso (`allowance`), calculada
 * pelo servidor sobre o TOTAL de Dados de Vida do personagem — nunca por classe.
 */
export function LongRestHitDicePanel({
  recovery,
  disabled = false,
  busy = false,
  onSetSelection,
}: {
  recovery: LongRestHitDiceRecoveryDto;
  disabled?: boolean;
  busy?: boolean;
  onSetSelection: (selection: Record<string, number>) => void;
}): ReactElement {
  /** Seleção COMPLETA atual, por face — o servidor substitui o mapa inteiro. */
  const current: Record<string, number> = Object.fromEntries(
    recovery.options.map((option) => [String(option.die), option.selected]),
  );

  /** Aplica a mudança numa face e envia o mapa sem as chaves zeradas. */
  function change(die: number, selected: number): void {
    const next: Record<string, number> = { ...current, [String(die)]: Math.max(0, selected) };
    onSetSelection(
      Object.fromEntries(Object.entries(next).filter(([, count]) => count > 0)),
    );
  }

  const noControls = recovery.allowance === 0;

  return (
    <div className="long-rest-dice-panel">
      <div className="long-rest-dice-total">
        <span>Você pode recuperar até {recovery.allowance} Dado(s) de Vida.</span>
        <strong>
          Selecionados: {recovery.selectedTotal} / {recovery.allowance}
        </strong>
      </div>

      {noControls ? (
        <p className="section-note">
          Você não tem Dados de Vida gastos para recuperar neste descanso.
        </p>
      ) : null}

      <ul className="long-rest-dice">
        {recovery.options.map((option) => (
          <li className="long-rest-die" key={option.die}>
            <span className="long-rest-die-face">d{option.die}</span>

            <span className="long-rest-die-facts">
              gastos: {option.used} · não gastos: {option.remaining}
            </span>

            {noControls ? null : (
              <span className="long-rest-stepper">
                <button
                  type="button"
                  className="btn btn-small stepper-btn"
                  aria-label={`Devolver um dado d${option.die}`}
                  disabled={disabled || busy || option.selected <= 0}
                  onClick={() => change(option.die, option.selected - 1)}
                >
                  −
                </button>
                <span className="stepper-value">{option.selected}</span>
                <button
                  type="button"
                  className="btn btn-small stepper-btn"
                  aria-label={`Recuperar um dado d${option.die}`}
                  disabled={
                    disabled ||
                    busy ||
                    option.selected >= option.used ||
                    recovery.selectedTotal >= recovery.allowance
                  }
                  onClick={() => change(option.die, option.selected + 1)}
                >
                  +
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
