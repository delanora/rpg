import { conditionDamageFamily, conditionDescription } from '../combatVisuals';
import type { ConditionEffects, MechanicalState } from '../../types';

/** Quantas etiquetas cabem no card antes de resumir o resto em "+N". */
const MAX_VISIBLE_CONDITIONS = 4;

/**
 * Uma etiqueta de condição INTERATIVA: o hover/focus na própria etiqueta abre a
 * explicação curta (PHB 2014). Não há ícone "i" — a etiqueta é o gatilho. A cor
 * semântica vem do atributo `data-condition` no CSS, que reaproveita a família
 * `--damage-*` quando há associação clara (Envenenado ↔ Veneno).
 */
function ConditionChip({ condition, label, count, suspended, sources }: {
  condition: string;
  label: string;
  count: number;
  suspended: boolean;
  sources: string[];
}) {
  const family = conditionDamageFamily(condition);
  return (
    <span
      className="condition-chip info-tip"
      data-condition={condition}
      data-damage-family={family ?? undefined}
      tabIndex={0}
      role="note"
    >
      <span className="condition-chip-label">
        {label}
        {count > 1 ? ` ×${count}` : ''}
        {suspended ? ' (suspenso)' : ''}
      </span>
      <span className="info-tip-text condition-tip" role="tooltip">
        <strong>{label}</strong>
        {conditionDescription(condition)}
        {sources.length > 0 ? (
          <span className="condition-tip-sources">Fontes: {sources.join(' · ')}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Etiquetas de condições ativas. Apresentação apenas: nomes e efeitos vêm do
 * servidor. A Exaustão é uma REGRA OPCIONAL da mesa — quando está desligada, o
 * nível salvo continua na ficha (nunca é apagado), mas o status NÃO aparece.
 *
 * Para várias condições, mostra até `MAX_VISIBLE_CONDITIONS` e resume o resto
 * em um chip `+N` (com a lista no tooltip): 6 condições não esticam o card.
 */
export function ConditionBadges({ state, effects, exhaustionEnabled = effects.exhaustionEnabled }: {
  state: MechanicalState;
  effects: ConditionEffects;
  /** Sobrepõe o valor derivado do DTO (usado pela ficha, que ouve `game:config`). */
  exhaustionEnabled?: boolean;
}) {
  const grouped = [...new Set(state.conditions.map((instance) => instance.condition))];
  if (grouped.length === 0 && !exhaustionEnabled) return null;
  const visible = grouped.slice(0, MAX_VISIBLE_CONDITIONS);
  const hidden = grouped.slice(MAX_VISIBLE_CONDITIONS);
  return (
    <div className="condition-chips">
      {visible.map((condition) => {
        const sources = state.conditions.filter((instance) => instance.condition === condition);
        return (
          <ConditionChip
            key={condition}
            condition={condition}
            label={effects.labels[condition] ?? condition}
            count={sources.length}
            suspended={condition === 'poisoned' && effects.poisonSuspended}
            sources={sources.map((instance) => instance.sourceLabel ?? 'Origem não informada')}
          />
        );
      })}
      {hidden.length > 0 ? (
        <span className="condition-chip more info-tip" tabIndex={0} role="note">
          +{hidden.length}
          <span className="info-tip-text condition-tip" role="tooltip">
            <strong>Outras condições</strong>
            {hidden.map((condition) => effects.labels[condition] ?? condition).join(' · ')}
          </span>
        </span>
      ) : null}
      {exhaustionEnabled ? (
        <span className="condition-chip exhaustion" data-condition="exhaustion">
          Exaustão {state.exhaustionLevel}/6
        </span>
      ) : null}
    </div>
  );
}
