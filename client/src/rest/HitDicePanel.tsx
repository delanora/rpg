import type { Character } from '../types';

type HitDice = Character['derived']['hitDice'];

/**
 * Dados de Vida por tipo (multiclasse mostra uma linha por dado).
 *
 * A UI nunca decide quantos dados gastar nem o resultado da cura: cada botão
 * gasta UM dado do tipo escolhido e o resultado chega do servidor. Durante um
 * gasto (`spendingDie`) só o botão daquele dado fica ocupado; com
 * `disabled` (por exemplo, já marcado como pronto) nada é clicável.
 */
export function HitDicePanel({
  hitDice,
  disabled = false,
  spendingDie = null,
  onSpend,
}: {
  hitDice: HitDice;
  disabled?: boolean;
  spendingDie?: number | null;
  onSpend: (die: number) => void;
}) {
  if (hitDice.byDie.length === 0) {
    return <p className="section-note">Você ainda não tem Dados de Vida.</p>;
  }

  return (
    <ul className="short-rest-dice">
      {hitDice.byDie.map((entry) => (
        <li key={entry.die} className="short-rest-die">
          <span className="short-rest-die-face">d{entry.die}</span>

          <span
            className="short-rest-die-pips"
            role="img"
            aria-label={`${entry.max - entry.used} de ${entry.max} dados d${entry.die} disponíveis`}
          >
            {Array.from({ length: entry.max }, (_unused, index) => (
              <span key={index} className={index < entry.used ? 'is-spent' : 'is-ready'} />
            ))}
          </span>

          <span className="short-rest-die-count">
            {entry.remaining}/{entry.max} disponíveis
          </span>

          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={disabled || entry.remaining <= 0 || spendingDie === entry.die}
            onClick={() => onSpend(entry.die)}
          >
            {spendingDie === entry.die ? 'rolando…' : `Gastar 1d${entry.die}`}
          </button>
        </li>
      ))}
    </ul>
  );
}
