import { Icon } from '../../components/Icon';
import type { TurnAlert } from '../useCombatState';

/**
 * TOAST CENTRAL DE INÍCIO DE TURNO.
 *
 * Não fica preso no layout: é um overlay fixo, sem clique obrigatório e sem
 * bloquear a interface (`pointer-events: none`). Quem some é o estado do hook
 * (`useCombatState`), 2 s depois — inclusive se um novo turno chegar antes.
 *
 * A audiência também é decidida no hook: jogador recebe só o PRÓPRIO turno e o
 * Mestre recebe o turno de criaturas/NPCs. Turno pulado (morto/estabilizado)
 * não gera toast porque o servidor só emite o turno de quem realmente age.
 */
export function TurnToast({ alert }: { alert: TurnAlert | null }) {
  if (!alert) return null;
  return (
    <div
      className={alert.role === 'MASTER' ? 'turn-toast master' : 'turn-toast player'}
      role="status"
      aria-live="polite"
    >
      <span className="turn-toast-icon" aria-hidden="true">
        <Icon name="sword" size={22} />
      </span>
      <span className="turn-toast-title">{alert.title}</span>
      <span className="turn-toast-name">{alert.combatantName}</span>
    </div>
  );
}
