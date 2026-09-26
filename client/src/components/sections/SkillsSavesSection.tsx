import { ABILITY_ABBREVIATIONS, ABILITY_KEYS, ABILITY_LABELS, SKILLS, formatModifier } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { AbilityKey, SkillEntry } from '../../types';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

const DEFAULT_ENTRY: SkillEntry = { proficient: false, expertise: false };

export function SkillsSavesSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const { derived } = character;

  function setSkill(key: string, patch: Partial<SkillEntry>): void {
    const current = character.skills[key] ?? DEFAULT_ENTRY;
    const next: SkillEntry = { ...current, ...patch };

    // Sem proficiência não há especialização (expertise).
    if (!next.proficient) next.expertise = false;

    update({ skills: { ...character.skills, [key]: next } });
  }

  function setSave(ability: AbilityKey, proficient: boolean): void {
    update({ saves: { ...character.saves, [ability]: proficient } });
  }

  return (
    <Section title="Perícias e Salvaguardas" subtitle="Marque a proficiência; o bônus é automático">
      <div className="grid grid-2">
        <div>
          <h3 className="subsection-title">Perícias</h3>
          <ul className="prof-list">
            {SKILLS.map((skill) => {
              const entry = character.skills[skill.key] ?? DEFAULT_ENTRY;
              const detail = derived.skills[skill.key];

              return (
                <li className="prof-row" key={skill.key}>
                  <input
                    type="checkbox"
                    checked={entry.proficient}
                    disabled={readOnly}
                    aria-label={`Proficiência em ${skill.label}`}
                    onChange={(event) => setSkill(skill.key, { proficient: event.target.checked })}
                  />
                  <input
                    type="checkbox"
                    checked={entry.expertise}
                    disabled={readOnly || !entry.proficient}
                    aria-label={`Especialização em ${skill.label}`}
                    title="Especialização (dobra o bônus de proficiência)"
                    onChange={(event) => setSkill(skill.key, { expertise: event.target.checked })}
                  />
                  <span className="prof-ability" title={ABILITY_LABELS[skill.ability]}>
                    {ABILITY_ABBREVIATIONS[skill.ability]}
                  </span>
                  <span className="prof-label">
                    {skill.label}
                    {entry.expertise ? <em className="tag">esp.</em> : null}
                  </span>
                  <span className="prof-value">{formatModifier(detail?.total ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="subsection-title">Salvaguardas</h3>
          <ul className="prof-list">
            {ABILITY_KEYS.map((ability) => {
              const detail = derived.saves.find((save) => save.ability === ability);

              return (
                <li className="prof-row" key={ability}>
                  <input
                    type="checkbox"
                    checked={character.saves[ability] ?? false}
                    disabled={readOnly}
                    aria-label={`Proficiência em salvaguarda de ${ABILITY_LABELS[ability]}`}
                    onChange={(event) => setSave(ability, event.target.checked)}
                  />
                  <span className="prof-ability">{ABILITY_ABBREVIATIONS[ability]}</span>
                  <span className="prof-label">{ABILITY_LABELS[ability]}</span>
                  <span className="prof-value">{formatModifier(detail?.total ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}
