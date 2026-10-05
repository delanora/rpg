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
 * QUEM JOGA? A ordem de iniciativa como coleção de cartões. A ordem nunca é
 * reordenada no cliente — segue `combat.combatants` (já ordenado pelo backend)
 * e só marca o atual e o próximo, para o destaque acompanhar o Socket.io sem
 * piscar nem saltar o layout.
 */
export function InitiativeTimeline({
  combat,
  isMaster,
  busy,
  onRollFor,
}: InitiativeTimelineProps) {
  const currentIndex = combat.combatants.findIndex(
    (combatant) => combatant.id === combat.currentCombatantId,
  );
  // Só há "próximo" durante o combate ativo e com um turno corrente definido.
  const nextIndex =
    combat.status === 'ACTIVE' && currentIndex >= 0 && combat.combatants.length > 1
      ? (currentIndex + 1) % combat.combatants.length
      : -1;

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
              current={index === currentIndex}
              next={index === nextIndex}
              trailing={
                combatant.rolled ? (
                  <>
                    <span className="combatant-card-init-label">inic</span>
                    <span className="combatant-card-init">{combatant.initiative}</span>
                  </>
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
