import { SPELL_LEVEL_LABELS, SPELL_SCHOOLS, formatModifier } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { Spell, SpellSlot } from '../../types';
import { clampInt, newId } from '../../utils';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const EMPTY_SLOT: SpellSlot = { max: 0, used: 0 };

export function SpellsSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const { list, slots } = character.spells;
  const spellcasting = character.derived.spellcasting;

  function patchSpell(id: string, patch: Partial<Spell>): void {
    update({ spells: { ...character.spells, list: list.map((spell) => (spell.id === id ? { ...spell, ...patch } : spell)) } });
  }

  function setSlot(level: number, patch: Partial<SpellSlot>): void {
    const key = String(level);
    const current = slots[key] ?? EMPTY_SLOT;
    update({
      spells: { ...character.spells, slots: { ...slots, [key]: { ...current, ...patch } } },
    });
  }

  function addSpell(): void {
    update({
      spells: {
        ...character.spells,
        list: [
          ...list,
          { id: newId(), name: 'Nova magia', level: 1, school: '', prepared: false, description: '' },
        ],
      },
    });
  }

  function removeSpell(id: string): void {
    update({ spells: { ...character.spells, list: list.filter((spell) => spell.id !== id) } });
  }

  // Agrupa as magias por nível (0 = truques) para exibir em blocos.
  const levels = [...new Set(list.map((spell) => spell.level))].sort((a, b) => a - b);

  return (
    <Section
      title="Magias"
      subtitle={
        spellcasting
          ? `CD ${spellcasting.saveDC} · ataque ${formatModifier(spellcasting.attackBonus)}`
          : 'Informe uma classe conjuradora para calcular CD e ataque'
      }
      actions={
        readOnly ? undefined : (
          <button type="button" className="btn btn-small" onClick={addSpell}>
            + magia
          </button>
        )
      }
    >
      <h3 className="subsection-title">Espaços de magia</h3>
      <div className="grid grid-slots">
        {SLOT_LEVELS.map((level) => {
          const slot = slots[String(level)] ?? EMPTY_SLOT;

          return (
            <div className="slot-card" key={level}>
              <span className="slot-level">{SPELL_LEVEL_LABELS[level]}</span>
              <label className="slot-field">
                <span>usados</span>
                <InlineField
                  value={slot.used}
                  mode="number"
                  min={0}
                  ariaLabel={`Espaços usados de ${level}º nível`}
                  onCommit={(value) =>
                    setSlot(level, { used: clampInt(value, 0, 99, slot.used) })
                  }
                />
              </label>
              <label className="slot-field">
                <span>total</span>
                <InlineField
                  value={slot.max}
                  mode="number"
                  min={0}
                  ariaLabel={`Espaços totais de ${level}º nível`}
                  onCommit={(value) =>
                    setSlot(level, { max: clampInt(value, 0, 99, slot.max) })
                  }
                />
              </label>
            </div>
          );
        })}
      </div>

      <h3 className="subsection-title">Magias conhecidas e preparadas</h3>

      {list.length === 0 ? (
        <p className="empty-hint">Nenhuma magia cadastrada.</p>
      ) : (
        levels.map((level) => (
          <div className="spell-group" key={level}>
            <h4>{SPELL_LEVEL_LABELS[level]}</h4>
            <ul className="spell-list">
              {list
                .filter((spell) => spell.level === level)
                .map((spell) => (
                  <li className="spell-row" key={spell.id}>
                    <input
                      type="checkbox"
                      checked={spell.prepared}
                      disabled={readOnly}
                      aria-label={`Preparada: ${spell.name}`}
                      title="Preparada"
                      onChange={(event) => patchSpell(spell.id, { prepared: event.target.checked })}
                    />
                    <InlineField
                      value={spell.name}
                      ariaLabel="Nome da magia"
                      onCommit={(value) => {
                        const name = value.trim();
                        if (name) patchSpell(spell.id, { name });
                      }}
                    />
                    <InlineField
                      value={spell.school}
                      mode="select"
                      options={SPELL_SCHOOLS}
                      ariaLabel="Escola da magia"
                      onCommit={(value) => patchSpell(spell.id, { school: value })}
                    />
                    <InlineField
                      value={spell.level}
                      mode="number"
                      min={0}
                      max={9}
                      ariaLabel="Nível da magia"
                      onCommit={(value) =>
                        patchSpell(spell.id, { level: clampInt(value, 0, 9, spell.level) })
                      }
                    />
                    <InlineField
                      className="spell-description"
                      value={spell.description}
                      placeholder="efeito / descrição"
                      ariaLabel="Descrição da magia"
                      onCommit={(value) => patchSpell(spell.id, { description: value })}
                    />
                    {readOnly ? null : (
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => removeSpell(spell.id)}
                        aria-label={`Remover ${spell.name}`}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}
