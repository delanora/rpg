import { Icon } from '../../components/Icon';
import type { CombatDto } from '../../types';
import { CombatantCard } from './CombatantCard';

interface InitiativeTimelineProps {
  combat: CombatDto;
  isMaster: boolean;
  busy: boolean;
  /** Mestre: rola a iniciativa por uma criatura ou jogador ausente. */
  onRollFor: (combatantId: string) => void;
}

/**
 * QUEM JOGA? A linha de iniciativa em cartões. Substitui a antiga tabela
 * vertical mantendo exatamente as mesmas permissões: o mestre vê os números e
 * pode rolar pelos ausentes; o jogador aguarda a própria vez.
 */
export function InitiativeTimeline({
  combat,
  isMaster,
  busy,
  onRollFor,
}: InitiativeTimelineProps) {
  return (
    <section className="combat-block combat-timeline">
      <h3>
        <Icon name="users" size={15} /> Iniciativa
      </h3>

      <ol className="combatant-list">
        {combat.combatants.map((combatant, index) => (
          <li key={combatant.id}>
            <CombatantCard
              combatant={combatant}
              rank={index + 1}
              current={combatant.id === combat.currentCombatantId}
              trailing={
                combatant.rolled ? (
                  <span className="combatant-card-init">{combatant.initiative}</span>
                ) : isMaster ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => onRollFor(combatant.id)}
                  >
                    rolar
                  </button>
                ) : (
                  <span className="combat-waiting">aguardando</span>
                )
              }
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
