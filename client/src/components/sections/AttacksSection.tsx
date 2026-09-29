import { AttacksTable } from '../AttacksTable';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function AttacksSection({ character, update }: SheetSectionProps) {
  const defaultBonus = character.derived.proficiencyBonus + character.derived.modifiers.strength;

  return (
    <Section title="Ataques e Armas" icon="sword">
      <AttacksTable
        attacks={character.attacks}
        defaultBonus={defaultBonus}
        inventory={character.inventory}
        onChange={(attacks) => update({ attacks })}
      />

      {character.derived.sneakAttack ? (
        <p className="section-note">
          Ataque Furtivo: +{character.derived.sneakAttack.expression} em armas marcadas como
          sutis ou à distância (somado automaticamente quando o ataque acerta).
        </p>
      ) : null}
    </Section>
  );
}
