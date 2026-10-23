import { COMBAT_STATE_VISUALS, combatStatesOf } from '../combatVisuals';

/**
 * ETIQUETAS DE ESTADO DE COMBATE (Turn Order).
 *
 * NÃO são Conditions: Esquiva e Ação Preparada vêm da economia de turno e
 * vivem em uma linha própria, ao lado das condições, com cor e tooltip
 * próprios (`COMBAT_STATE_VISUALS`). Hidden só entraria aqui se existisse como
 * estado REAL do motor — não existe hoje, então nada é inventado.
 *
 * A fonte é o estado derivado (`turnEconomy`), nunca uma flag só visual: quando
 * o turno vira, o servidor recria a economia e a etiqueta some sozinha.
 */
export function CombatStateBadges({
  turnEconomy,
}: {
  turnEconomy: { dodging?: boolean; ready?: unknown } | null | undefined;
}) {
  if (!turnEconomy) return null;
  const states = combatStatesOf(turnEconomy);
  if (states.length === 0) return null;

  return (
    <div className="combat-state-chips" aria-label="Estados de combate">
      {states.map((state) => {
        const visual = COMBAT_STATE_VISUALS[state];
        return (
          <span
            key={state}
            className="combat-state-chip info-tip"
            data-combat-state={visual.tone}
            tabIndex={0}
            role="note"
          >
            <span className="combat-state-chip-label">{visual.label}</span>
            <span className="info-tip-text condition-tip" role="tooltip">
              <strong>{visual.label}</strong>
              {visual.description}
            </span>
          </span>
        );
      })}
    </div>
  );
}
