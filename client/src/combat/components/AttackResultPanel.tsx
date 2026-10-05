import { Icon } from '../../components/Icon';
import { formatModifier } from '../../dnd';
import type { AttackResolvedPayload } from '../../types';
import { DamageComponent } from './DamageComponent';

interface AttackResultPanelProps {
  result: AttackResolvedPayload;
  onDismiss: () => void;
}

/**
 * Resultado da rolagem de ataque: selo com o total vs CA, o desfecho
 * (ACERTO / ERROU / CRÍTICO! / FALHA CRÍTICA) e a composição do dano fonte a
 * fonte, com os dados individuais. Exibe apenas o que o servidor devolveu —
 * nada é recalculado aqui.
 */
export function AttackResultPanel({ result, onDismiss }: AttackResultPanelProps) {
  const naturalOne = result.attackRoll === 1 && !result.critical;
  const outcome = result.critical ? 'crit' : naturalOne ? 'fail' : result.hit ? 'hit' : 'miss';
  const outcomeLabel = result.critical
    ? 'CRÍTICO!'
    : naturalOne
      ? 'FALHA CRÍTICA'
      : result.hit
        ? 'ACERTO'
        : 'ERROU';
  const rolls = result.attackRolls.length > 0 ? result.attackRolls : [result.attackRoll];
  const rollLabel = rolls.map((roll) => `[${roll}]`).join(' ');

  return (
    <section className={`attack-result ${outcome}`} role="status" aria-live="polite">
      <header className="attack-result-head">
        <span className="attack-result-title">
          <Icon name="sword" size={14} /> Ataque
        </span>
        <button type="button" className="btn btn-small" onClick={onDismiss}>
          fechar
        </button>
      </header>

      <p className="attack-result-roll">
        <span className="attack-result-total">{result.attackTotal}</span>
        <span className="attack-result-vs">
          {result.targetArmorClass === null ? 'vs CA oculta' : `vs CA ${result.targetArmorClass}`}
        </span>
        <span className={`attack-result-outcome ${outcome}`}>{outcomeLabel}</span>
      </p>

      <p className="attack-result-sub">
        {result.attackerName} · {result.attackName} em {result.targetName}
        {result.advantage ? ' · vantagem' : result.disadvantage ? ' · desvantagem' : ''}
        {` · d20 ${rollLabel} ${formatModifier(result.attackBonus)}`}
      </p>

      {result.hit ? (
        <div className="attack-result-damage">
          <span className="attack-result-damage-title">
            <Icon name="flame" size={13} /> Dano
          </span>

          {result.components.length === 0 ? (
            <span className="attack-result-line">
              {result.damageRolled} {result.damageType}
            </span>
          ) : (
            <div className="attack-card-components">
              {result.components.map((component, index) => (
                <DamageComponent key={`${component.type}-${index}`} component={component} />
              ))}
            </div>
          )}

          <span className="attack-result-total-damage">TOTAL {result.damageRolled}</span>

          {result.sneakAttack ? (
            <span className="attack-result-sneak">
              <Icon name="sparkle" size={12} /> Ataque Furtivo {result.sneakAttack.expression} (
              {result.sneakAttack.reason})
            </span>
          ) : null}

          {!result.targetStatsHidden ? (
            <span className="attack-result-hp">
              {result.targetName}: {result.targetHpCurrent}/{result.targetHpMax} HP
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
