import {
  ABILITY_ABBREVIATIONS,
  SPELLCASTING_TYPE_LABELS,
  SPELL_LEARNING_LABELS,
  hitDieLabel,
} from '../../dnd';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/**
 * Classe do personagem: seletor + fatos derivados (dado de vida, salvaguardas,
 * conjuração) e a subclasse, liberada a partir do nível definido pela classe.
 */
export function ClassSection({ character, update }: SheetSectionProps) {
  const definition = character.classDefinition;
  const classNames = character.classCatalog.map((item) => item.name);
  const subclassEligible = definition !== null && character.level >= definition.subclassLevel;
  const subclassNames = definition?.subclasses.map((item) => item.name) ?? [];

  function classKeyFromName(name: string): string {
    return character.classCatalog.find((item) => item.name === name)?.key ?? '';
  }

  return (
    <Section title="Classe" icon="crown" subtitle="Dado de vida, salvaguardas e conjuração">
      <div className="grid grid-3">
        <label className="field">
          <span>Classe</span>
          <InlineField
            value={definition?.name ?? ''}
            mode="select"
            options={classNames}
            ariaLabel="Classe do personagem"
            onCommit={(value) => update({ classKey: classKeyFromName(value) })}
          />
        </label>
      </div>

      {definition ? (
        <>
          <ul className="class-facts">
            <li>
              <span>Dado de Vida</span>
              <strong>{hitDieLabel(definition.hitDie)}</strong>
            </li>
            <li>
              <span>Salvaguardas</span>
              <strong>
                {definition.savingThrows.map((ability) => ABILITY_ABBREVIATIONS[ability]).join(' · ')}
              </strong>
            </li>
            <li>
              <span>Conjuração</span>
              <strong>
                {SPELLCASTING_TYPE_LABELS[definition.spellcasting.type]}
                {definition.spellcasting.ability
                  ? ` · ${ABILITY_ABBREVIATIONS[definition.spellcasting.ability]}`
                  : ''}
              </strong>
            </li>
            <li>
              <span>Magias</span>
              <strong>{SPELL_LEARNING_LABELS[definition.spellcasting.learning]}</strong>
            </li>
          </ul>

          <h3 className="subsection-title">
            Subclasse
            {subclassEligible && subclassNames.length > 0 ? (
              <em className="tag">liberada</em>
            ) : null}
          </h3>

          {!subclassEligible ? (
            <p className="section-note">
              A subclasse de {definition.name} é escolhida no nível {definition.subclassLevel} (nível
              atual: {character.level}).
            </p>
          ) : (
            <>
              <InlineField
                value={character.subclass}
                mode="select"
                options={subclassNames}
                ariaLabel="Subclasse"
                onCommit={(value) => update({ subclass: value })}
              />
              {subclassNames.length === 0 ? (
                <p className="section-note">
                  Subclasse liberada — nenhuma opção cadastrada para {definition.name} ainda.
                </p>
              ) : null}
            </>
          )}
        </>
      ) : (
        <p className="section-note">
          Escolha uma classe para aplicar automaticamente o dado de vida e as salvaguardas.
        </p>
      )}
    </Section>
  );
}
