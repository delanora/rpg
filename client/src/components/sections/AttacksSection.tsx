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
        onChange={(attacks) => update({ attacks })}
      />
    </Section>
  );
}
