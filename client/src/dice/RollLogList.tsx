import type { DiceRollDto } from '../types';
import { historyLine, rollDebug } from './format';

/**
 * Lista do histórico de rolagens (log do mestre).
 *
 * Vive fora da janela de dados porque é usada em dois lugares com a mesma
 * aparência: dentro da bandeja de rolagem e no painel flutuante só com o log.
 */
export function RollLogList({ history }: { history: DiceRollDto[] }) {
  if (history.length === 0) return <p className="dice-log-empty">Nenhuma rolagem ainda.</p>;

  return (
    <ul className="dice-log-list">
      {history.map((roll) => (
        <li key={roll.id} className={roll.isPrivate ? 'is-private' : undefined}>
          <span className="dice-log-text">
            {historyLine(roll)}
            <span className="dice-log-debug">({rollDebug(roll)})</span>
          </span>
          <span className="dice-log-side">
            {roll.isPrivate ? <em className="tag">privada</em> : null}
            <span className="dice-log-time">{new Date(roll.at).toLocaleTimeString('pt-BR')}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
