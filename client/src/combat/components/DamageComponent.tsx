import { damageTypeSlug } from '../../damage';
import { formatModifier } from '../../dnd';
import type { DamageComponentPayload, DamagePartPayload } from '../../types';

/**
 * Componente GENÉRICO de dano: apresenta UMA parcela do servidor (um tipo de
 * dano) com as suas fontes separadas (Arma, Ataque Furtivo, Destreza, Fúria,
 * Bônus da arma, Munição...). Nada é recalculado aqui — os dados individuais, os
 * subtotais e o tipo vêm prontos do payload. O frontend não tem lógica
 * exclusiva de nenhuma fonte: uma fonte nova (Smite, Hunter's Mark...) entra
 * exatamente pela mesma UI.
 */

const DEFENSE_LABEL: Record<NonNullable<DamageComponentPayload['modifier']>, string> = {
  resistance: 'resistência',
  immunity: 'imunidade',
  vulnerability: 'vulnerabilidade',
};

/** Fórmula de uma fonte: `1d8 → [5] = 5` ou, sem dados, `+3`. */
function partFormula(part: DamagePartPayload): string {
  if (part.dice !== '' && part.rolls.length > 0) {
    return `${part.dice} → ${part.rolls.map((roll) => `[${roll}]`).join(' ')} = ${part.value}`;
  }
  if (part.rolls.length > 0) {
    return `${part.rolls.map((roll) => `[${roll}]`).join(' ')} = ${part.value}`;
  }
  return formatModifier(part.value);
}

/** Uma fonte de dano (uma linha da composição). */
export function DamagePart({ part }: { part: DamagePartPayload }) {
  const hasDice = part.dice !== '' || part.rolls.length > 0;
  return (
    <li className={`damage-part${hasDice ? ' dice' : ''}`} data-source={part.source}>
      <span className="damage-part-name">{part.label}</span>
      <span className="damage-part-formula">{partFormula(part)}</span>
    </li>
  );
}

/**
 * Uma parcela de dano com o seu tipo e a defesa do alvo. `modifier` (quando
 * existe) explica por que o que entrou difere do bruto — a UI só apresenta.
 */
export function DamageComponent({ component }: { component: DamageComponentPayload }) {
  const parts = component.breakdown?.parts ?? [];
  const defended = component.modifier !== null;
  // O accent vem do tipo JÁ resolvido pelo servidor — a UI só o apresenta.
  return (
    <div
      className={`damage-component${defended ? ' defended' : ''}`}
      data-damage={damageTypeSlug(component.type)}
    >
      <p className="damage-component-head">
        <span className="damage-component-applied">{component.applied}</span>
        <span className="damage-component-marker" aria-hidden="true" />
        <span className="damage-component-type">{component.type || 'sem tipo'}</span>
        {defended ? (
          <span className={`damage-component-defense ${component.modifier}`}>
            {DEFENSE_LABEL[component.modifier as NonNullable<typeof component.modifier>]} · bruto{' '}
            {component.rolled}
          </span>
        ) : null}
      </p>
      {parts.length > 0 ? (
        <ul className="damage-parts">
          {parts.map((part, index) => (
            <DamagePart key={`${part.source}-${index}`} part={part} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
