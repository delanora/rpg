import { Icon } from '../../components/Icon';
import { formatModifier } from '../../dnd';
import type { AttackResolvedPayload } from '../../types';

interface AttackResultPanelProps {
  result: AttackResolvedPayload;
  onDismiss: () => void;
}

/**
 * Resultado da rolagem de ataque: selo com o total vs CA, o desfecho
 * (ACERTO / ERRO / CRÍTICO! / FALHA CRÍTICA) e a quebra do dano. Exibe apenas o
 * que o servidor devolveu — nada é recalculado aqui.
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
        : 'ERRO';

  // Parcelas com dano aplicado ou com defesa do alvo (resistência/imunidade).
  const components = result.components.filter(
    (component) => component.applied > 0 || component.modifier !== null,
  );

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
        {` · d20 ${result.attackRoll} ${formatModifier(result.attackBonus)}`}
      </p>

      {result.hit ? (
        <div className="attack-result-damage">
          <span className="attack-result-damage-title">
            <Icon name="flame" size={13} /> Dano
          </span>

          {components.length === 0 ? (
            <span className="attack-result-line">
              {result.damageRolled} {result.damageType}
            </span>
          ) : (
            <ul className="attack-result-lines">
              {components.map((component, index) => (
                <li key={index} className="attack-result-line">
                  <span className="attack-result-dealt">
                    {component.applied} {component.type || 'sem tipo'}
                  </span>
                  {component.modifier === 'resistance' ? (
                    <span className="attack-result-note">
                      após resistência ({component.rolled}→{component.applied})
                    </span>
                  ) : component.modifier === 'immunity' ? (
                    <span className="attack-result-note">imune</span>
                  ) : component.modifier === 'vulnerability' ? (
                    <span className="attack-result-note">vulnerável ×2</span>
                  ) : null}
                </li>
              ))}
            </ul>
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
