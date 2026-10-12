import { Icon } from '../../components/Icon';

import type { TurnEconomy } from '../../types';

interface TurnResourceBarProps {
  /** O combate está ativo (fora da espera pela iniciativa). */
  active: boolean;
  isMaster: boolean;
  /** Verdadeiro quando o turno atual é do próprio jogador. */
  isMyTurn?: boolean;
  /** Deslocamento do personagem em metros, quando o sistema já conhece. */
  economy?: TurnEconomy;
  busy?: boolean;
  /**
   * Fim do turno: usa o MESMO avanço já existente (`next-turn`). O mestre pode
   * avançar a qualquer momento; o jogador só o PRÓPRIO turno (o backend
   * confere e recusa fora do turno dele).
   */
  onEndTurn?: () => void;
}

/** Economia persistida no servidor; encerrar usa o avanço único existente. */
export function TurnResourceBar({
  active,
  isMaster,
  isMyTurn = false,
  economy,
  busy = false,
  onEndTurn,
}: TurnResourceBarProps) {

  // O mestre encerra a qualquer momento; o jogador, só no próprio turno.
  const canEndTurn = Boolean(active && onEndTurn && (isMaster || isMyTurn));

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
      {[
        { label: 'Ação', value: economy ? `${economy.actionsGranted - economy.actionsUsed} / ${economy.actionsGranted}` : '—' },
        { label: 'Ação bônus', value: economy ? (economy.bonusActionUsed ? 'Utilizada' : 'Disponível*') : '—' },
        { label: 'Reação', value: economy ? (economy.reactionAvailable ? 'Disponível' : 'Utilizada') : '—' },
        { label: 'Movimento', value: economy ? `${Number((economy.movementBudget - economy.movementUsed).toFixed(2))} / ${economy.movementBudget} m` : '—' },
      ].map(resource => (
        <div className="turn-resource" key={resource.label} title={resource.label === 'Ação bônus' ? 'Somente uma regra específica concede uma Ação Bônus utilizável.' : undefined}>
          <span className="turn-resource-label">{resource.label}</span>
          <span className="turn-resource-value">{active ? resource.value : 'em espera'}</span>
        </div>
      ))}

      {/* Fim do turno: mesmo mecanismo de avanço já existente. */}
      <div className="turn-resource end">
        {canEndTurn ? (
          <button
            type="button"
            className="end-turn"
            disabled={busy}
            onClick={onEndTurn}
            aria-label="Encerrar turno"
          >
            <span className="end-turn-text">Encerrar turno</span>
            <span className="end-turn-arrow" aria-hidden="true">
              <svg viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 6h13" />
                <path d="M9.5 1.5 15 6l-5.5 4.5" />
              </svg>
            </span>
          </button>
        ) : (
          <>
            <span className="turn-resource-icon">
              <Icon name="sun" size={13} />
            </span>
            <span className="turn-resource-label">Encerrar turno</span>
            <span className="turn-resource-state">
              {active
                ? isMyTurn
                  ? 'encerre quando quiser'
                  : isMaster
                    ? 'aguardando'
                    : 'aguardando seu turno'
                : 'não controlado'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
