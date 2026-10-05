import { Icon, type IconName } from '../../components/Icon';
import { speedInSquares } from '../../dnd';

/** Recursos ainda NÃO governados pelo backend (Fase 8.1). */
const PENDING_RESOURCES = [
  { key: 'action', label: 'Ação', icon: 'sword' },
  { key: 'bonus', label: 'Ação bônus', icon: 'sparkle' },
  { key: 'reaction', label: 'Reação', icon: 'shield' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

interface TurnResourceBarProps {
  /** O combate está ativo (fora da espera pela iniciativa). */
  active: boolean;
  isMaster: boolean;
  /** Verdadeiro quando o turno atual é do próprio jogador. */
  isMyTurn?: boolean;
  /** Deslocamento do personagem em metros, quando o sistema já conhece. */
  movementMeters?: number | null;
  busy?: boolean;
  /**
   * Fim do turno: usa o MESMO mecanismo atual de avanço (`next-turn`), que
   * segue exclusivo do mestre. Não cria regra nova.
   */
  onEndTurn?: () => void;
}

/**
 * Barra inferior persistente dos recursos do turno — preparação visual para a
 * Fase 8.1. Mostra o deslocamento que o personagem já possui e deixa Ação/Ação
 * bônus/Reação como "em preparação" (o backend ainda não controla a economia de
 * ações). O Fim do turno continua disparando o avanço já existente.
 */
export function TurnResourceBar({
  active,
  isMaster,
  isMyTurn = false,
  movementMeters = null,
  busy = false,
  onEndTurn,
}: TurnResourceBarProps) {
  const hasMovement = Boolean(active && movementMeters && movementMeters > 0);

  return (
    <section
      className={[
        'turn-resource-bar',
        active ? 'active' : 'inactive',
        active && isMyTurn ? 'mine' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Recursos do turno"
    >
      {/* Movimento: valor real da ficha, sem consumo. */}
      <div className="turn-resource">
        <span className="turn-resource-icon">
          <Icon name="wind" size={15} />
        </span>
        <span className="turn-resource-label">Movimento</span>
        <span
          className="turn-resource-value"
          title={hasMovement ? speedInSquares(movementMeters ?? 0) : 'Deslocamento não informado'}
        >
          {hasMovement ? `${movementMeters} m` : '—'}
        </span>
      </div>

      {/* Ação / Ação bônus / Reação: ainda não controladas pelo backend. */}
      {PENDING_RESOURCES.map((resource) => (
        <div key={resource.key} className="turn-resource">
          <span className="turn-resource-icon">
            <Icon name={resource.icon} size={15} />
          </span>
          <span className="turn-resource-label">{resource.label}</span>
          <span className="turn-resource-state">{active ? 'Fase 8.1' : 'não controlado'}</span>
        </div>
      ))}

      {/* Fim do turno: mesmo mecanismo de avanço já existente. */}
      <div className="turn-resource end">
        <span className="turn-resource-icon">
          <Icon name="sun" size={15} />
        </span>
        <span className="turn-resource-label">Fim do turno</span>
        {active && isMaster && onEndTurn ? (
          <button
            type="button"
            className="btn btn-primary btn-small turn-resource-btn"
            disabled={busy}
            onClick={onEndTurn}
          >
            Encerrar →
          </button>
        ) : (
          <span className="turn-resource-state">
            {active ? (isMaster ? 'aguardando' : 'o mestre controla') : 'não controlado'}
          </span>
        )}
      </div>
    </section>
  );
}
