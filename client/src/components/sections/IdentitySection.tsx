import { ALIGNMENTS } from '../../dnd';
import { clampInt } from '../../utils';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function IdentitySection({ character, update }: SheetSectionProps) {
  return (
    <Section title="Identidade" icon="scroll" subtitle="Clique em qualquer campo para editar">
      <div className="grid grid-3">
        <label className="field">
          <span>Nome</span>
          <InlineField
            value={character.name}
            ariaLabel="Nome do personagem"
            onCommit={(value) => {
              const name = value.trim();
              if (name) update({ name });
            }}
          />
        </label>

        <label className="field">
          <span>Raça</span>
          <InlineField
            value={character.race}
            ariaLabel="Raça"
            placeholder="ex.: Anão"
            onCommit={(value) => update({ race: value.trim() })}
          />
        </label>

        <label className="field">
          <span>Nível</span>
          <InlineField
            value={character.level}
            mode="number"
            min={1}
            max={20}
            ariaLabel="Nível"
            onCommit={(value) => update({ level: clampInt(value, 1, 20, character.level) })}
          />
        </label>

        <label className="field">
          <span>Antecedente</span>
          <InlineField
            value={character.background}
            ariaLabel="Antecedente"
            placeholder="ex.: Sábio"
            onCommit={(value) => update({ background: value.trim() })}
          />
        </label>

        <label className="field">
          <span>Alinhamento</span>
          <InlineField
            value={character.alignment}
            mode="select"
            options={ALIGNMENTS}
            ariaLabel="Alinhamento"
            onCommit={(value) => update({ alignment: value })}
          />
        </label>

        <label className="field">
          <span>Experiência (XP)</span>
          <InlineField
            value={character.experience}
            mode="number"
            min={0}
            ariaLabel="Pontos de experiência"
            onCommit={(value) =>
              update({ experience: clampInt(value, 0, 99_999_999, character.experience) })
            }
          />
        </label>

        <div className="field readonly">
          <span>Bônus de proficiência</span>
          <strong>+{character.derived.proficiencyBonus}</strong>
        </div>
      </div>
    </Section>
  );
}
