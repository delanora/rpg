import { SPELL_LEVEL_LABELS, SPELL_SCHOOLS, formatModifier } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { Spell, SpellSlot } from '../../types';
import { clampInt, newId } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const EMPTY_SLOT: SpellSlot = { max: 0, used: 0 };

/** Custo em pontos de feitiçaria para criar um espaço de magia (Fonte de Magia). */
const SORCERY_SLOT_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

interface SlotPipsProps {
  level: number;
  slot: SpellSlot;
  readOnly: boolean;
  onChange: (patch: Partial<SpellSlot>) => void;
}

/** Espaços de magia como estrelas clicáveis: gastas ficam apagadas. */
function SlotPips({ level, slot, readOnly, onChange }: SlotPipsProps) {
  if (slot.max <= 0) {
    return (
      <span className="slot-pips">
        <span className="slot-empty">—</span>
      </span>
    );
  }

  const used = Math.min(slot.used, slot.max);

  return (
    <span
      className="slot-pips"
      role="group"
      aria-label={`Espaços de ${level}º nível: ${used} de ${slot.max} usados`}
    >
      {Array.from({ length: slot.max }, (_, index) => {
        const isUsed = index < used;
        return (
          <button
            key={index}
            type="button"
            className={isUsed ? 'slot-pip used' : 'slot-pip'}
            disabled={readOnly}
            title={isUsed ? 'Marcar como disponível' : 'Marcar como gasto'}
            aria-label={isUsed ? `Recuperar espaço ${index + 1}` : `Gastar espaço ${index + 1}`}
            onClick={() => onChange({ used: isUsed ? index : index + 1 })}
          >
            <Icon name="sparkle" size={13} />
          </button>
        );
      })}
    </span>
  );
}

export function SpellsSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const { list, slots } = character.spells;
  const spellcasting = character.derived.spellcasting;
  // Espaços combinados pela regra de multiclasse (PHB) e Magia de Pacto à parte.
  const combinedSlots = character.derived.spellSlots ?? [];
  const pactSlots = character.derived.pactSlots ?? null;

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

  // Fonte de Magia (Feiticeiro): converte pontos de feitiçaria em espaços de
  // magia gastos e vice-versa, usando os campos já existentes (used/total).
  const sorcery = character.classAdjustments.resources.find(
    (resource) => resource.id === 'sorcery-points',
  );

  function spendPointsForSlot(level: number, cost: number): void {
    if (!sorcery) return;
    const key = String(level);
    const slot = slots[key] ?? EMPTY_SLOT;
    if (sorcery.remaining < cost || slot.used <= 0) return;
    update({
      classState: {
        ...character.classState,
        used: { ...character.classState.used, [sorcery.id]: (character.classState.used[sorcery.id] ?? 0) + cost },
      },
      spells: { ...character.spells, slots: { ...slots, [key]: { ...slot, used: slot.used - 1 } } },
    });
  }

  function convertSlotToPoints(level: number): void {
    if (!sorcery) return;
    const key = String(level);
    const slot = slots[key] ?? EMPTY_SLOT;
    if (slot.used >= slot.max || sorcery.remaining + level > sorcery.max) return;
    update({
      classState: {
        ...character.classState,
        used: {
          ...character.classState.used,
          [sorcery.id]: Math.max(0, (character.classState.used[sorcery.id] ?? 0) - level),
        },
      },
      spells: { ...character.spells, slots: { ...slots, [key]: { ...slot, used: slot.used + 1 } } },
    });
  }

  // Agrupa as magias por nível (0 = truques) para exibir em blocos.
  const levels = [...new Set(list.map((spell) => spell.level))].sort((a, b) => a - b);

  return (
    <Section
      title="Magias"
      icon="star"
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
      {combinedSlots.length > 0 || pactSlots ? (
        <>
          <h3 className="subsection-title">Espaços pela regra de multiclasse</h3>
          <p className="section-note">
            Somados como no PHB: conjurador completo + metade do meio-conjurador + um terço do
            terço-conjurador. As magias preparadas continuam sendo contadas por classe.
          </p>
          <div className="slot-reference">
            {combinedSlots.map((slot) => (
              <span className="slot-ref" key={slot.level}>
                {SPELL_LEVEL_LABELS[slot.level]}: <strong>{slot.max}</strong>
              </span>
            ))}
            {pactSlots ? (
              <span className="slot-ref pact">
                Magia de Pacto: <strong>{pactSlots.max}</strong> espaço(s) de{' '}
                {SPELL_LEVEL_LABELS[pactSlots.slotLevel]}
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      <h3 className="subsection-title">Espaços de magia</h3>
      <div className="grid grid-slots">
        {SLOT_LEVELS.map((level) => {
          const slot = slots[String(level)] ?? EMPTY_SLOT;

          return (
            <div className="slot-card" key={level}>
              <span className="slot-level">{SPELL_LEVEL_LABELS[level]}</span>

              <SlotPips
                level={level}
                slot={slot}
                readOnly={readOnly}
                onChange={(patch) => setSlot(level, patch)}
              />

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

      {sorcery ? (
        <>
          <h3 className="subsection-title">Fonte de Magia</h3>
          <p className="section-note">
            Pontos de feitiçaria: {sorcery.remaining}/{sorcery.max}. Converta pontos em espaços de
            magia gastos ou espaços em pontos (1º = 2, 2º = 3, 3º = 5, 4º = 6, 5º = 7; sem 6º+).
          </p>
          <div className="sorcery-convert">
            {SLOT_LEVELS.filter((level) => level <= 5).map((level) => {
              const cost = SORCERY_SLOT_COSTS[level];
              const slot = slots[String(level)] ?? EMPTY_SLOT;
              return (
                <div className="sorcery-row" key={level}>
                  <span className="sorcery-level">{SPELL_LEVEL_LABELS[level]}</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={readOnly || sorcery.remaining < cost || slot.used <= 0}
                    onClick={() => spendPointsForSlot(level, cost)}
                  >
                    {cost} pts → recuperar 1 espaço
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={
                      readOnly || slot.used >= slot.max || sorcery.remaining + level > sorcery.max
                    }
                    onClick={() => convertSlotToPoints(level)}
                  >
                    espaço → +{level} pts
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <h3 className="subsection-title">
        Magias conhecidas e preparadas
        {character.derived.preparedSpellCount !== null
          ? ` — até ${character.derived.preparedSpellCount} preparadas`
          : ''}
      </h3>

      {list.length === 0 ? (
        <p className="empty-hint">Nenhuma magia cadastrada.</p>
      ) : (
        levels.map((level) => (
          <div className="spell-group" key={level}>
            <h4>
              <Icon name="sparkle" size={15} />
              {SPELL_LEVEL_LABELS[level]}
            </h4>
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
