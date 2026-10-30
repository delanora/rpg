import { COMBAT_STATE_VISUALS, combatStatesOf } from '../combatVisuals';

/**
 * ETIQUETAS DE ESTADO DE COMBATE (Turn Order).
 *
 * NÃO são Conditions: Esquiva, Ação Preparada e Concentração vivem em uma linha
 * própria, ao lado das condições, com cor e tooltip próprios
 * (`COMBAT_STATE_VISUALS`). Hidden só entraria aqui se existisse como estado
 * REAL do motor — não existe hoje, então nada é inventado.
 *
 * A fonte é o estado derivado (`turnEconomy` + `concentration` do estado
 * mecânico), nunca uma flag só visual: quando o turno vira ou a concentração
 * termina (save falho, Incapacitado, 0 PV, nova concentração), o servidor
 * republica e a etiqueta some sozinha.
 */
export function CombatStateBadges({
  turnEconomy,
  concentration,
}: {
  turnEconomy: { dodging?: boolean; ready?: unknown } | null | undefined;
  /** Concentração ativa da criatura (efeito privado já filtrado no servidor). */
  concentration?: { label: string } | null;
}) {
  if (!turnEconomy && !concentration) return null;
  const states = combatStatesOf(turnEconomy ?? {}, Boolean(concentration));
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
              {state === 'concentrating' && concentration ? (
                <span className="ability-tip-note">Concentrando em: {concentration.label}</span>
              ) : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}
