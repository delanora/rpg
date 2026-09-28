import { ABILITY_KEYS, ABILITY_LABELS, formatModifier } from '../../dnd';
import { useSheetAccess } from '../../readonly';
import { clampInt } from '../../utils';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function AbilitiesSection({ character, update }: SheetSectionProps) {
  // Atributos são construção: só mudam pelo Level Up (ou pelo mestre) depois
  // que a criação é finalizada.
  const { lockedConstruction } = useSheetAccess();

  return (
    <Section title="Atributos" icon="shield" subtitle="O modificador é calculado automaticamente">
      <div className="grid grid-abilities">
        {ABILITY_KEYS.map((ability) => {
          const modifier = character.derived.modifiers[ability];

          return (
            <div className="ability-card" key={ability}>
              <span className="ability-label">{ABILITY_LABELS[ability]}</span>

              <InlineField
                className="ability-score"
                value={character[ability]}
                mode="number"
                min={1}
                max={30}
                readOnly={lockedConstruction}
                ariaLabel={ABILITY_LABELS[ability]}
                onCommit={(value) =>
                  update({ [ability]: clampInt(value, 1, 30, character[ability]) })
                }
              />

              <span className="ability-modifier" title="Modificador">
                {formatModifier(modifier)}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
