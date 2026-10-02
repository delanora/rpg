import { useEffect, useMemo, useState } from 'react';
import { fetchRaceCatalog } from '../../creationApi';
import {
  ABILITY_ABBREVIATIONS,
  ABILITY_KEYS,
  ABILITY_LABELS,
  SAVE_DESCRIPTIONS,
  SKILLS,
  formatModifier,
  type SkillDefinition,
} from '../../dnd';
import { findRaceOption, raceBonusesWithChoices } from '../../races';
import { useSheetAccess } from '../../readonly';
import type {
  AbilityKey,
  Character,
  ProficienciesState,
  RaceOption,
  SkillEntry,
} from '../../types';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

const DEFAULT_ENTRY: SkillEntry = { proficient: false, expertise: false };

/** Grupos das proficiências de armadura/arma/ferramenta do PHB (cap. 6). */
const PROFICIENCY_GROUPS: { key: keyof ProficienciesState; label: string; hint: string }[] = [
  { key: 'armor', label: 'Armaduras', hint: 'Armaduras leves · Escudos' },
  { key: 'weapons', label: 'Armas', hint: 'Armas simples · Espadas longas' },
  { key: 'tools', label: 'Ferramentas', hint: 'Ferramentas de ladrão' },
];

/**
 * Perícias de cada atributo, na ordem do livro (a lista de `SKILLS` já é
 * alfabética, então basta agrupar). Constituição não tem nenhuma — o card dela
 * termina na salvaguarda.
 */
const SKILLS_BY_ABILITY = ABILITY_KEYS.reduce(
  (groups, ability) => {
    groups[ability] = SKILLS.filter((skill) => skill.ability === ability);
    return groups;
  },
  {} as Record<AbilityKey, SkillDefinition[]>,
);

/** Abre a janela de dados já com 1d20 e o bônus do teste aplicado. */
export interface AbilityRollInput {
  kind: 'skill' | 'save';
  label: string;
  bonus: number;
}

interface AbilityCardsSectionProps extends SheetSectionProps {
  onRoll?: (input: AbilityRollInput) => void;
}

/** Uma linha do "i": de onde veio o valor do atributo. */
interface AbilitySource {
  label: string;
  value: number;
  /** Mostra com sinal (`+2`); o valor-base vai como número puro. */
  signed: boolean;
}

/**
 * O que compõe o atributo GRAVADO e o valor usado nos cálculos.
 *
 * O valor gravado é `base + raça + aumentos de nível` (a criação grava a base e
 * o servidor soma o bônus racial; o Level Up soma os aumentos). Quando a conta
 * não fecha — ficha antiga, edição do mestre — a diferença aparece como
 * "outros ajustes", para a soma explicada NUNCA mentir. O bônus de
 * característica (ex.: Campeão Primitivo) não é gravado: entra só no total.
 */
function compositionOf(
  character: Character,
  ability: AbilityKey,
  raceCatalog: RaceOption[],
): { sources: AbilitySource[]; stored: number; feature: number; total: number } {
  const stored = character[ability];
  const base = character.creationDraft.baseAbilities[ability] ?? null;
  const racial =
    raceBonusesWithChoices(
      findRaceOption(raceCatalog, character.race),
      character.creationDraft.abilityChoices,
    )[ability] ?? 0;
  const levels = character.levelHistory.reduce(
    (sum, record) =>
      sum +
      record.abilityIncreases.reduce(
        (total, increase) => (increase.ability === ability ? total + increase.amount : total),
        0,
      ),
    0,
  );

  const sources: AbilitySource[] = [];
  if (base !== null) sources.push({ label: 'Valor base (criação)', value: base, signed: false });
  if (racial !== 0) sources.push({ label: 'Bônus de raça', value: racial, signed: true });
  if (levels !== 0) sources.push({ label: 'Aumentos de nível', value: levels, signed: true });

  if (base !== null) {
    const adjust = stored - (base + racial + levels);
    if (adjust !== 0) sources.push({ label: 'Outros ajustes', value: adjust, signed: true });
  }

  const feature = character.classAdjustments.abilityBonuses[ability] ?? 0;
  const cap = character.classAdjustments.abilityCaps[ability] ?? Number.POSITIVE_INFINITY;

  return { sources, stored, feature, total: Math.min(stored + feature, cap) };
}

/**
 * Os seis atributos em cards — faixa com a sigla, selo hexagonal com o valor e
 * o modificador, a salvaguarda e as perícias do atributo.
 *
 * Substitui as antigas seções "Atributos" e "Perícias e Salvaguardas": tudo o
 * que depende de um atributo vive no card dele. Os cálculos continuam vindo do
 * servidor (`derived`); aqui não há regra de negócio.
 */
export function AbilityCardsSection({ character, update, onRoll }: AbilityCardsSectionProps) {
  const { lockedConstruction } = useSheetAccess();
  const { derived } = character;

  // O catálogo de raças serve só para explicar a composição do atributo no "i".
  const [raceCatalog, setRaceCatalog] = useState<RaceOption[]>([]);

  useEffect(() => {
    let active = true;
    fetchRaceCatalog().then((catalog) => {
      if (active) setRaceCatalog(catalog);
    });
    return () => {
      active = false;
    };
  }, []);

  // Salvaguardas fixas (classe e features, ex.: Mente Escorregadia do ladino):
  // ficam sempre marcadas e travadas.
  const lockedSaves = useMemo(
    () => new Set<AbilityKey>(character.derived.lockedSaves),
    [character.derived.lockedSaves],
  );

  function setSkill(key: string, patch: Partial<SkillEntry>): void {
    const current = character.skills[key] ?? DEFAULT_ENTRY;
    const next: SkillEntry = { ...current, ...patch };

    // Sem proficiência não há especialização (expertise).
    if (!next.proficient) next.expertise = false;

    update({ skills: { ...character.skills, [key]: next } });
  }

  /**
   * Proficiências de armadura/arma/ferramenta: construção (o jogador com a
   * criação finalizada só as VÊ). O mestre as edita como texto separado por
   * vírgula; as escolhas abertas do livro entram como descrição.
   */
  function setProficiencies(key: keyof ProficienciesState, raw: string): void {
    const items = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
    update({ proficiencies: { ...character.proficiencies, [key]: items } });
  }

  return (
    <Section
      title="Atributos, Perícias e Salvaguardas"
      icon="shield"
      subtitle="O modificador e os bônus são calculados automaticamente"
    >
      <div className="ability-cards">
        {ABILITY_KEYS.map((ability) => {
          const label = ABILITY_LABELS[ability];
          const modifier = derived.modifiers[ability];
          const save = derived.saves.find((item) => item.ability === ability);
          const saveLocked = lockedSaves.has(ability);
          // Só o mestre (em edição) altera o valor bruto; para quem joga, clicar
          // no número rola um teste puro daquele atributo.
          const editable = !lockedConstruction;
          const composition = compositionOf(character, ability, raceCatalog);
          const rollAbility = (): void =>
            onRoll?.({ kind: 'skill', label: `Teste de ${label}`, bonus: modifier });

          return (
            <article className="ability-block" key={ability}>
              <header className="ability-head">
                <span className="ability-head-label">{ABILITY_ABBREVIATIONS[ability]}</span>
                {/* O "i" vive no cabeçalho do card; a janela é IRMÃ da pastilha,
                    então abre com a largura do próprio card, sem vazar. */}
                <span className="info-tip ability-tip" tabIndex={0}>
                  <Icon name="info" size={12} />
                </span>
                <span
                  className="info-tip-text ability-tooltip"
                  role="tooltip"
                  aria-label={`O que compõe ${label}`}
                >
                  <strong>O que compõe {label}</strong>

                  {composition.sources.map((source) => (
                    <span className="ability-tip-row" key={source.label}>
                      <span>{source.label}</span>
                      <b>{source.signed ? formatModifier(source.value) : source.value}</b>
                    </span>
                  ))}

                  <span className="ability-tip-row ability-tip-total">
                    <span>Valor gravado</span>
                    <b>{composition.stored}</b>
                  </span>

                  {composition.feature !== 0 ? (
                    <span className="ability-tip-row">
                      <span>Bônus de classe</span>
                      <b>{formatModifier(composition.feature)}</b>
                    </span>
                  ) : null}

                  {composition.total !== composition.stored ? (
                    <span className="ability-tip-row ability-tip-total">
                      <span>Total nos cálculos</span>
                      <b>{composition.total}</b>
                    </span>
                  ) : null}

                  <span className="ability-tip-note">
                    Itens equipados não somam atributo neste sistema.
                  </span>
                </span>
              </header>

              <div className="ability-seal">
                <div className="ability-hex">
                  {editable ? (
                    <InlineField
                      className="ability-score"
                      value={character[ability]}
                      mode="number"
                      min={1}
                      max={30}
                      ariaLabel={label}
                      title="Clique para editar o valor do atributo"
                      onCommit={(value) =>
                        update({ [ability]: clampInt(value, 1, 30, character[ability]) })
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="ability-score ability-score-roll"
                      title={`Rolar teste de ${label} (1d20 ${formatModifier(modifier)})`}
                      aria-label={`Rolar teste de ${label}`}
                      onClick={rollAbility}
                    >
                      {character[ability]}
                    </button>
                  )}

                  <button
                    type="button"
                    className="ability-modifier"
                    title={`Rolar teste de ${label} (1d20 ${formatModifier(modifier)})`}
                    aria-label={`Rolar teste de ${label}`}
                    onClick={rollAbility}
                  >
                    {formatModifier(modifier)}
                  </button>
                </div>

              </div>

              <ul className="ability-lines">
                <li className="ability-line ability-line-save">
                  <input
                    type="checkbox"
                    checked={character.saves[ability] ?? false}
                    disabled
                    tabIndex={-1}
                    aria-label={`Proficiência em salvaguarda de ${label}`}
                  />
                  <span className="ability-line-value">{formatModifier(save?.total ?? 0)}</span>
                  <span className="ability-line-label">Salvaguarda</span>
                  {onRoll ? (
                    <button
                      type="button"
                      className="prof-roll"
                      aria-label={`Rolar salvaguarda de ${label}`}
                      onClick={() =>
                        onRoll({
                          kind: 'save',
                          label: `Salvaguarda de ${label}`,
                          bonus: save?.total ?? 0,
                        })
                      }
                    >
                      <Icon name="die" size={13} />
                    </button>
                  ) : null}

                  {/* Resumo do que a salvaguarda serve, aberto no hover da linha. */}
                  <span className="info-tip-text ability-skill-tip" role="tooltip">
                    <strong>Salvaguarda de {label}</strong>
                    <span>{SAVE_DESCRIPTIONS[ability]}</span>
                    <span className="ability-tip-note">
                      {saveLocked
                        ? 'Concedida pela classe (fixa nas duas salvaguardas dela).'
                        : 'Definida pela classe — muda só pela entrada em outra classe.'}
                    </span>
                    {onRoll ? (
                      <span className="ability-tip-note">Clique no dado para rolar o teste.</span>
                    ) : null}
                  </span>
                </li>

                {SKILLS_BY_ABILITY[ability].map((skill) => {
                  const entry = character.skills[skill.key] ?? DEFAULT_ENTRY;
                  const detail = derived.skills[skill.key];

                  return (
                    <li className="ability-line" key={skill.key}>
                      <input
                        type="checkbox"
                        checked={entry.proficient}
                        disabled={lockedConstruction}
                        aria-label={`Proficiência em ${skill.label}`}
                        onChange={(event) =>
                          setSkill(skill.key, { proficient: event.target.checked })
                        }
                      />
                      <span className="ability-line-value">
                        {formatModifier(detail?.total ?? 0)}
                      </span>
                      <span className="ability-line-label">{skill.label}</span>
                      {onRoll ? (
                        <button
                          type="button"
                          className="prof-roll"
                          aria-label={`Rolar teste de ${skill.label}`}
                          onClick={() =>
                            onRoll({ kind: 'skill', label: skill.label, bonus: detail?.total ?? 0 })
                          }
                        >
                          <Icon name="die" size={13} />
                        </button>
                      ) : null}

                      {/* Para que a perícia serve, resumido no hover da linha. */}
                      <span className="info-tip-text ability-skill-tip" role="tooltip">
                        <strong>{skill.label}</strong>
                        <span>{skill.description}</span>
                        <span className="ability-tip-note">Perícia de {label}.</span>
                        {onRoll ? (
                          <span className="ability-tip-note">
                            Clique no dado para rolar o teste.
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>

      <h3 className="subsection-title">Armaduras, Armas e Ferramentas</h3>
      <p className="section-note">
        Concedidas pela classe inicial e pelas entradas por multiclasse (multiclasse nunca concede
        salvaguardas). O efeito na CA e nos ataques ainda não é automático.
      </p>
      <div className="prof-groups">
        {PROFICIENCY_GROUPS.map((group) => {
          const items = character.proficiencies[group.key];

          return (
            <div className="prof-group" key={group.key}>
              <h4 className="prof-group-title">{group.label}</h4>
              {lockedConstruction ? (
                items.length === 0 ? (
                  <p className="prof-group-items muted">Nenhuma</p>
                ) : (
                  <p className="prof-group-items">{items.join(' · ')}</p>
                )
              ) : (
                <input
                  type="text"
                  className="prof-group-input"
                  key={items.join(',')}
                  defaultValue={items.join(', ')}
                  placeholder={group.hint}
                  aria-label={`Proficiências em ${group.label} (separe por vírgula)`}
                  onBlur={(event) => setProficiencies(group.key, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
