import { useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, DAMAGE_TYPES } from '../../dnd';
import type { AbilityKey, CustomRace, CustomRacePatch } from '../../types';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';

/** Seleção de tipos de dano em "chips" — edição direta, salva ao clicar. */
function DamageChips({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  function toggle(type: string): void {
    onChange(
      selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type],
    );
  }

  return (
    <div className="chips-field">
      <span className="field-label">{label}</span>
      <div className="chips">
        {DAMAGE_TYPES.map((type) => {
          const active = selected.includes(type);
          return (
            <button
              key={type}
              type="button"
              className={active ? 'chip chip-on' : 'chip'}
              aria-pressed={active}
              onClick={() => toggle(type)}
            >
              {type}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface RaceEditorProps {
  race: CustomRace;
  onPatch: (patch: CustomRacePatch) => void;
  onDelete: () => void;
}

/**
 * Editor de uma raça PERSONALIZADA do mestre (Prompt 2.10).
 *
 * Segue o padrão dos editores de Localidade/Criatura: cada campo salva sozinho
 * ao confirmar. As raças personalizadas têm traços em TEXTO LIVRE (sem efeito
 * mecânico estruturado) e nenhuma sub-raça.
 */
export function RaceEditor({ race, onPatch, onDelete }: RaceEditorProps) {
  // Idiomas são editados como texto separado por vírgula; só sobem ao servidor
  // quando o campo é confirmado.
  const [languagesDraft, setLanguagesDraft] = useState(race.languages.join(', '));

  function commitLanguages(): void {
    const languages = languagesDraft
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    setLanguagesDraft(languages.join(', '));
    onPatch({ languages });
  }

  function setIncrease(index: number, patch: { ability?: AbilityKey; amount?: number }): void {
    const next = race.abilityScoreIncrease.map((increase, position) =>
      position === index ? { ...increase, ...patch } : increase,
    );
    onPatch({ abilityScoreIncrease: next });
  }

  function addIncrease(): void {
    onPatch({ abilityScoreIncrease: [...race.abilityScoreIncrease, { ability: 'strength', amount: 1 }] });
  }

  function removeIncrease(index: number): void {
    onPatch({
      abilityScoreIncrease: race.abilityScoreIncrease.filter((_, position) => position !== index),
    });
  }

  function setTrait(index: number, patch: { name?: string; description?: string }): void {
    const next = race.traits.map((trait, position) =>
      position === index ? { ...trait, ...patch } : trait,
    );
    onPatch({ traits: next });
  }

  function addTrait(): void {
    onPatch({ traits: [...race.traits, { name: 'Novo traço', description: '' }] });
  }

  function removeTrait(index: number): void {
    onPatch({ traits: race.traits.filter((_, position) => position !== index) });
  }

  const sizeOptions = ['Medium', 'Small'];

  return (
    <div className="race-editor">
      <Section
        title="Raça personalizada"
        icon="sparkle"
        actions={
          <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
            <Icon name="trash" size={14} /> remover
          </button>
        }
      >
        <div className="grid grid-2">
          <label className="field">
            <span>Nome</span>
            <InlineField
              value={race.name}
              ariaLabel="Nome da raça"
              onCommit={(value) => {
                const name = value.trim();
                if (name) onPatch({ name });
              }}
            />
          </label>
          <label className="field">
            <span>Tamanho</span>
            <InlineField
              value={race.size}
              mode="select"
              options={sizeOptions}
              ariaLabel="Tamanho"
              onCommit={(value) => onPatch({ size: value === 'Small' ? 'Small' : 'Medium' })}
            />
          </label>
        </div>

        <label className="field">
          <span>Descrição</span>
          <InlineField
            value={race.description}
            mode="textarea"
            ariaLabel="Descrição da raça"
            onCommit={(value) => onPatch({ description: value })}
          />
        </label>

        <div className="grid grid-3">
          <label className="field">
            <span>Deslocamento (m)</span>
            <InlineField
              value={race.speed}
              mode="number"
              min={0}
              max={60}
              ariaLabel="Deslocamento em metros"
              onCommit={(value) => onPatch({ speed: clampInt(value, 0, 60, race.speed) })}
            />
          </label>
          <label className="field">
            <span>Visão no escuro (m)</span>
            <InlineField
              value={race.darkvision}
              mode="number"
              min={0}
              max={120}
              ariaLabel="Visão no escuro em metros"
              onCommit={(value) => onPatch({ darkvision: clampInt(value, 0, 120, race.darkvision) })}
            />
          </label>
          <label className="field">
            <span>Idiomas à escolha</span>
            <InlineField
              value={race.bonusLanguageChoices}
              mode="number"
              min={0}
              max={5}
              ariaLabel="Idiomas à escolha"
              onCommit={(value) =>
                onPatch({ bonusLanguageChoices: clampInt(value, 0, 5, race.bonusLanguageChoices) })
              }
            />
          </label>
        </div>

        <label className="field">
          <span>Idiomas (separados por vírgula)</span>
          <input
            type="text"
            value={languagesDraft}
            placeholder="Comum, Élfico..."
            onChange={(event) => setLanguagesDraft(event.target.value)}
            onBlur={commitLanguages}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
      </Section>

      <Section title="Bônus de atributo" icon="bolt">
        {race.abilityScoreIncrease.length === 0 ? (
          <p className="empty-hint">Nenhum bônus de atributo.</p>
        ) : (
          <ul className="race-editor-list">
            {race.abilityScoreIncrease.map((increase, index) => (
              <li key={`${increase.ability}-${index}`} className="race-editor-row">
                <InlineField
                  value={ABILITY_LABELS[increase.ability]}
                  mode="select"
                  options={ABILITY_KEYS.map((ability) => ABILITY_LABELS[ability])}
                  ariaLabel="Atributo"
                  onCommit={(value) => {
                    const found = ABILITY_KEYS.find((ability) => ABILITY_LABELS[ability] === value);
                    if (found) setIncrease(index, { ability: found });
                  }}
                />
                <InlineField
                  value={increase.amount}
                  mode="number"
                  min={-5}
                  max={5}
                  ariaLabel="Incremento"
                  onCommit={(value) => setIncrease(index, { amount: clampInt(value, -5, 5, 1) })}
                />
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => removeIncrease(index)}
                  aria-label="Remover bônus"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-small" onClick={addIncrease}>
          + bônus de atributo
        </button>
      </Section>

      <Section title="Resistências" icon="shield">
        <DamageChips
          label="Resistência a dano"
          selected={race.damageResistances}
          onChange={(value) => onPatch({ damageResistances: value })}
        />
      </Section>

      <Section
        title="Traços"
        icon="book"
        actions={
          <button type="button" className="btn btn-small" onClick={addTrait}>
            + traço
          </button>
        }
      >
        {race.traits.length === 0 ? (
          <p className="empty-hint">Nenhum traço cadastrado.</p>
        ) : (
          <div className="feature-list">
            {race.traits.map((trait, index) => (
              <article className="feature-card" key={`${trait.name}-${index}`}>
                <div className="feature-head">
                  <InlineField
                    value={trait.name}
                    ariaLabel="Nome do traço"
                    onCommit={(value) => {
                      const name = value.trim();
                      if (name) setTrait(index, { name });
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={() => removeTrait(index)}
                    aria-label="Remover traço"
                  >
                    ×
                  </button>
                </div>
                <InlineField
                  value={trait.description}
                  mode="textarea"
                  placeholder="Descreva o traço..."
                  ariaLabel="Descrição do traço"
                  onCommit={(value) => setTrait(index, { description: value })}
                />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
