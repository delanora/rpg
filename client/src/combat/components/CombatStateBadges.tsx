import { COMBAT_STATE_VISUALS, combatStatesOf } from '../combatVisuals';
import { FloatingTip, useFloatingTip } from './FloatingTip';

/** Um estado de turno do motor (`dodging`, `ready`, `concentrating`, ...). */
type CombatStateKey = keyof typeof COMBAT_STATE_VISUALS;

/**
 * ETIQUETA DE ESTADO DE COMBATE.
 *
 * A descrição abre no MESMO popup flutuante das condições (portal no `body`,
 * `fixed`): dentro do painel da iniciativa o tooltip inline era recortado e
 * alargava a área rolável. O tom do estado viaja em `data-combat-state` para o
 * CSS pintar borda e título.
 */
function StateChip({ state, concentrationLabel }: {
  state: CombatStateKey;
  concentrationLabel?: string | null;
}) {
  const visual = COMBAT_STATE_VISUALS[state];
  const tip = useFloatingTip();
  const content = (
    <>
      <strong>{visual.label}</strong>
      {visual.description}
      {concentrationLabel ? (
        <span className="ability-tip-note">Concentrando em: {concentrationLabel}</span>
      ) : null}
    </>
  );

  return (
    <span
      ref={tip.ref}
      className="combat-state-chip info-tip"
      data-combat-state={visual.tone}
      tabIndex={0}
      role="note"
      onPointerEnter={tip.show}
      onPointerLeave={tip.hide}
      onFocus={tip.show}
      onBlur={tip.hide}
    >
      <span className="combat-state-chip-label">{visual.label}</span>
      {/* Cópia inline: markup de SSR apenas — o CSS a mantém oculta. */}
      <span className="info-tip-text condition-tip" role="tooltip">
        {content}
      </span>
      {tip.open ? (
        <FloatingTip
          pos={tip.pos}
          className="info-tip-text condition-tip condition-tip-floating"
          data={{ 'data-combat-state': visual.tone }}
        >
          {content}
        </FloatingTip>
      ) : null}
    </span>
  );
}

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
      {states.map((state) => (
        <StateChip
          key={state}
          state={state as CombatStateKey}
          concentrationLabel={state === 'concentrating' ? concentration?.label ?? null : null}
        />
      ))}
    </div>
  );
}
