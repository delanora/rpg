import { ABILITY_KEYS, ABILITY_LABELS, DAMAGE_TYPES, formatModifier } from '../../dnd';
import type { Creature, CreaturePatch } from '../../types';
import { clampInt } from '../../utils';
import { AttacksTable } from '../AttacksTable';
import { InlineField } from '../InlineField';
import { Section } from '../Section';

interface DamageChipsProps {
  label: string;
  selected: string[];
  onChange: (value: string[]) => void;
}

/** Seleção de tipos de dano em "chips" — edição direta, salva ao clicar. */
function DamageChips({ label, selected, onChange }: DamageChipsProps) {
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

interface CreatureEditorProps {
  creature: Creature;
  onPatch: (patch: CreaturePatch) => void;
  onDelete: () => void;
}

export function CreatureEditor({ creature, onPatch, onDelete }: CreatureEditorProps) {
  // Bônus sugerido para um novo ataque: o melhor entre Força e Destreza.
  const attackBonus = Math.max(
    creature.derived.modifiers.strength,
    creature.derived.modifiers.dexterity,
  );

  return (
    <div className="creature-editor">
      <div className="detail-head">
        <h2>{creature.name}</h2>
        <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
          remover criatura
        </button>
      </div>

      <Section title="Identificação">
        <div className="grid grid-3">
          <label className="field">
            <span>Nome</span>
            <InlineField
              value={creature.name}
              ariaLabel="Nome da criatura"
              onCommit={(value) => {
                const name = value.trim();
                if (name) onPatch({ name });
              }}
            />
          </label>

          <label className="field">
            <span>Tipo</span>
            <InlineField
              value={creature.type}
              placeholder="Humanoide, Besta, Dragão..."
              ariaLabel="Tipo da criatura"
              onCommit={(value) => onPatch({ type: value.trim() })}
            />
          </label>

          <label className="field">
            <span>Nível de Desafio</span>
            <InlineField
              value={creature.challengeRating}
              placeholder="ex.: 1/2"
              ariaLabel="Nível de desafio"
              onCommit={(value) => onPatch({ challengeRating: value.trim() })}
            />
          </label>
        </div>
      </Section>

      <Section title="Atributos">
        <div className="grid grid-abilities">
          {ABILITY_KEYS.map((ability) => (
            <div className="ability-card" key={ability}>
              <span className="ability-label">{ABILITY_LABELS[ability]}</span>
              <InlineField
                className="ability-score"
                value={creature[ability]}
                mode="number"
                min={1}
                max={30}
                ariaLabel={ABILITY_LABELS[ability]}
                onCommit={(value) =>
                  onPatch({ [ability]: clampInt(value, 1, 30, creature[ability]) })
                }
              />
              <span className="ability-modifier">
                {formatModifier(creature.derived.modifiers[ability])}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Vida e Defesa">
        <div className="grid grid-4">
          <div className="vital vital-hp">
            <span className="vital-label">HP atual</span>
            <InlineField
              className="vital-value"
              value={creature.hpCurrent}
              mode="number"
              min={-999}
              max={9999}
              ariaLabel="Pontos de vida atuais"
              onCommit={(value) =>
                onPatch({ hpCurrent: clampInt(value, -999, 9999, creature.hpCurrent) })
              }
            />
          </div>

          <div className="vital">
            <span className="vital-label">HP máximo</span>
            <InlineField
              className="vital-value"
              value={creature.hpMax}
              mode="number"
              min={0}
              max={9999}
              ariaLabel="Pontos de vida máximos"
              onCommit={(value) => onPatch({ hpMax: clampInt(value, 0, 9999, creature.hpMax) })}
            />
          </div>

          <div className="vital">
            <span className="vital-label">Classe de Armadura</span>
            <InlineField
              className="vital-value"
              value={creature.armorClass}
              mode="number"
              min={0}
              max={99}
              ariaLabel="Classe de armadura"
              onCommit={(value) =>
                onPatch({ armorClass: clampInt(value, 0, 99, creature.armorClass) })
              }
            />
          </div>

          <div className="vital">
            <span className="vital-label">Deslocamento</span>
            <InlineField
              className="vital-value"
              value={creature.speed}
              mode="number"
              min={0}
              max={999}
              ariaLabel="Deslocamento"
              onCommit={(value) => onPatch({ speed: clampInt(value, 0, 999, creature.speed) })}
            />
            <span className="vital-hint">pés</span>
          </div>
        </div>
      </Section>

      <Section title="Ataques">
        <AttacksTable
          attacks={creature.attacks}
          defaultBonus={attackBonus}
          onChange={(attacks) => onPatch({ attacks })}
        />
      </Section>

      <Section title="Resistências e Imunidades">
        <DamageChips
          label="Resistências"
          selected={creature.resistances}
          onChange={(resistances) => onPatch({ resistances })}
        />
        <DamageChips
          label="Imunidades"
          selected={creature.immunities}
          onChange={(immunities) => onPatch({ immunities })}
        />
      </Section>

      <Section title="Descrição">
        <InlineField
          value={creature.description}
          mode="textarea"
          placeholder="Aparência, comportamento, táticas, segredos..."
          ariaLabel="Descrição da criatura"
          onCommit={(value) => onPatch({ description: value })}
        />
      </Section>
    </div>
  );
}
