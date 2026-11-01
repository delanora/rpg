import { Icon } from '../../components/Icon';
import type { TurnAlert } from '../useCombatState';

/**
 * AVISO DE INÍCIO DE TURNO.
 *
 * • JOGADOR: o próprio turno é uma TOMADA DE TELA CHEIA — o MESMO efeito do
 *   início da batalha (`CombatIntro`): selo dourado com as espadas, escurecimento
 *   radial e o nome do combatente com a rodada. Um toast no topo era discreto
 *   demais para o momento mais importante da rodada (junto com ele toca o
 *   chamado de batalha em `sound.ts`).
 * • MESTRE: criaturas/NPCs continuam com o toast curto — ele acompanha vários
 *   turnos seguidos e não pode levar um overlay de tela cheia a cada um.
 *
 * Nos dois casos nada exige clique: `pointer-events: none`, `aria-live` e o
 * estado expira sozinho em `TURN_TOAST_MS` (2 s) no `useCombatState`.
 */
export function TurnToast({ alert }: { alert: TurnAlert | null }) {
  if (!alert) return null;

  if (alert.role === 'PLAYER') {
    return (
      <div className="combat-intro is-turn" role="status" aria-live="assertive">
        <div className="combat-intro-seal is-turn">
          <span className="combat-intro-swords">
            <Icon name="sword" />
            <Icon name="sword" />
          </span>
          <span className="combat-intro-text is-turn">{alert.title}</span>
          <span className="combat-intro-sub">
            {alert.combatantName} · Rodada {alert.round}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="turn-toast master" role="status" aria-live="polite">
      <span className="turn-toast-icon" aria-hidden="true">
        <Icon name="sword" size={22} />
      </span>
      <span className="turn-toast-title">{alert.title}</span>
      <span className="turn-toast-name">{alert.combatantName}</span>
    </div>
  );
}
