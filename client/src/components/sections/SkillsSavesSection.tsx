import { ABILITY_ABBREVIATIONS, ABILITY_KEYS, ABILITY_LABELS, SKILLS, formatModifier } from '../../dnd';
import { useSheetAccess } from '../../readonly';
import type { AbilityKey, SkillEntry } from '../../types';
import { Icon } from '../Icon';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

const DEFAULT_ENTRY: SkillEntry = { proficient: false, expertise: false };

/** Abre a janela de dados já com 1d20 e o bônus do teste aplicado. */
interface RollInput {
  kind: 'skill' | 'save';
  label: string;
  bonus: number;
}

/** Reparte uma lista em colunas de tamanho fixo (ex.: 18 perícias em 2×9). */
function splitInColumns<T>(items: readonly T[], columnSize: number): T[][] {
  const columns: T[][] = [];
  for (let index = 0; index < items.length; index += columnSize) {
    columns.push(items.slice(index, index + columnSize));
  }
  return columns;
}

export function SkillsSavesSection({
  character,
  update,
  onRoll,
}: SheetSectionProps & { onRoll?: (input: RollInput) => void }) {
  // Proficiências de perícias e salvaguardas são construção.
  const { lockedConstruction } = useSheetAccess();
  const { derived } = character;
  const readOnly = lockedConstruction;

  // Salvaguardas fixas (classe e features, ex.: Mente Escorregadia do ladino):
  // ficam sempre marcadas e travadas.
  const lockedSaves = new Set<AbilityKey>(character.derived.lockedSaves);

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
    <Section
      title="Perícias e Salvaguardas"
      icon="eye"
      subtitle="Marque a proficiência; o bônus é automático"
    >
      <h3 className="subsection-title">Perícias</h3>
      <div className="prof-columns">
        {splitInColumns(SKILLS, 9).map((column, columnIndex) => (
          <ul className="prof-list" key={columnIndex}>
            {column.map((skill) => {
              const entry = character.skills[skill.key] ?? DEFAULT_ENTRY;
              const detail = derived.skills[skill.key];

              return (
                <li className={onRoll ? 'prof-row with-roll' : 'prof-row'} key={skill.key}>
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
                  {onRoll ? (
                    <button
                      type="button"
                      className="prof-roll"
                      title={`Rolar ${skill.label}`}
                      aria-label={`Rolar teste de ${skill.label}`}
                      onClick={() =>
                        onRoll({ kind: 'skill', label: skill.label, bonus: detail?.total ?? 0 })
                      }
                    >
                      <Icon name="die" size={13} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      <h3 className="subsection-title">Salvaguardas</h3>
      <div className="prof-columns">
        {splitInColumns(ABILITY_KEYS, 3).map((column, columnIndex) => (
          <ul className="prof-list" key={columnIndex}>
            {column.map((ability) => {
              const detail = derived.saves.find((save) => save.ability === ability);
              const locked = lockedSaves.has(ability);

              return (
                <li
                  className={onRoll ? 'prof-row prof-row-save with-roll' : 'prof-row prof-row-save'}
                  key={ability}
                >
                  <input
                    type="checkbox"
                    checked={character.saves[ability] ?? false}
                    disabled={readOnly || locked}
                    aria-label={`Proficiência em salvaguarda de ${ABILITY_LABELS[ability]}`}
                    title={locked ? 'Concedida pela classe (fixa)' : undefined}
                    onChange={(event) => setSave(ability, event.target.checked)}
                  />
                  <span className="prof-ability">{ABILITY_ABBREVIATIONS[ability]}</span>
                  <span className="prof-label">
                    {ABILITY_LABELS[ability]}
                    {locked ? <em className="tag">classe</em> : null}
                  </span>
                  <span className="prof-value">{formatModifier(detail?.total ?? 0)}</span>
                  {onRoll ? (
                    <button
                      type="button"
                      className="prof-roll"
                      title={`Rolar salvaguarda de ${ABILITY_LABELS[ability]}`}
                      aria-label={`Rolar salvaguarda de ${ABILITY_LABELS[ability]}`}
                      onClick={() =>
                        onRoll({
                          kind: 'save',
                          label: `Salvaguarda de ${ABILITY_LABELS[ability]}`,
                          bonus: detail?.total ?? 0,
                        })
                      }
                    >
                      <Icon name="die" size={13} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </Section>
  );
}
