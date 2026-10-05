import { Icon } from '../../components/Icon';
import type { CombatLogEntry } from '../useCombatState';

interface CombatLogProps {
  log: CombatLogEntry[];
}

/** O QUE ACONTECEU? Registro de rolagens e eventos, agora na coluna direita. */
export function CombatLog({ log }: CombatLogProps) {
  return (
    <section className="combat-block combat-log-panel">
      <h3>
        <Icon name="scroll" size={15} /> Registro
      </h3>
      {log.length === 0 ? (
        <p className="empty-hint">Sem rolagens ainda.</p>
      ) : (
        <ul className="combat-log">
          {log.map((entry) => (
            <li key={entry.id} className={entry.crit ? 'log-entry crit' : 'log-entry'}>
              <span className="log-text">{entry.text}</span>
              {entry.detail ? <span className="log-detail">{entry.detail}</span> : null}
              <span className="log-time">{new Date(entry.at).toLocaleTimeString('pt-BR')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
