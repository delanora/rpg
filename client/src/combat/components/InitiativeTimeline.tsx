import { Icon } from '../../components/Icon';
import type { CombatDto } from '../../types';
import { CombatantCard } from './CombatantCard';

interface InitiativeTimelineProps {
  combat: CombatDto;
  isMaster: boolean;
  busy: boolean;
  ownCombatantId?: string;
  onAnticipate?: (combatantId: string) => void;
  /** Mestre: rola a iniciativa por uma criatura ou jogador ausente. */
  onRollFor: (combatantId: string) => void;
}

/**
 * QUEM JOGA? A ordem de iniciativa como coleção de cartões. A ordem nunca é
 * alterada mecanicamente no cliente — pendentes aparecem no topo; o restante segue `combat.combatants` (já ordenado pelo backend)
 * e só marca o atual e o próximo, para o destaque acompanhar o Socket.io sem
 * piscar nem saltar o layout.
 */
export function InitiativeTimeline({
  combat,
  isMaster,
  busy,
  onRollFor,
  ownCombatantId,
  onAnticipate,
}: InitiativeTimelineProps) {
  const currentIndex = combat.combatants.findIndex(
    (combatant) => combatant.id === combat.currentCombatantId,
  );
  const pending = combat.combatants.filter((c) => !c.rolled);
  const ordered = combat.combatants.filter((c) => c.rolled);

  return (
    <section className="combat-block combat-timeline">
      <h3>
        <Icon name="users" size={15} /> Iniciativa
      </h3>

      <ol className="combatant-list">
        {[...pending, ...ordered].map((combatant) => {
          const index = combat.combatants.findIndex(
            (c) => c.id === combatant.id,
          );
          return (
            <li key={combatant.id}>
              <CombatantCard
                combatant={combatant}
                rank={
                  combatant.rolled
                    ? ordered.findIndex((c) => c.id === combatant.id) + 1
                    : undefined
                }
                current={index === currentIndex}
                next={combatant.id === combat.nextCombatantId}
                trailing={
                  combatant.rolled ? (
                    <>
                      <span className="combatant-card-init-label">inic</span>
                      <span className="combatant-card-init">
                        {combatant.initiative}
                      </span>
                    </>
                  ) : isMaster || combatant.id === ownCombatantId ? (
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
              {combatant.firstTurnPending && index < currentIndex ? (
                <p className="section-note">Aguarda a próxima rodada</p>
              ) : null}
              {isMaster &&
              combatant.firstTurnPending &&
              index < currentIndex &&
              onAnticipate ? (
                <button
                  className="btn btn-small combat-initiative-anticipate"
                  disabled={busy}
                  onClick={() => onAnticipate(combatant.id)}
                  title="Encerrar o turno atual e conceder um turno extra ao reforço"
                >
                  Antecipar turno
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
