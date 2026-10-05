import {
  ABILITY_ABBREVIATIONS,
  SPELL_LEVEL_LABELS,
  SPELL_LEARNING_LABELS,
  SPELL_SCHOOLS,
  SPELLCASTING_TYPE_LABELS,
  formatModifier,
} from '../../dnd';
import { useEffect, useState } from 'react';
import { fetchCompendium } from '../../gameApi';
import { useSheetAccess } from '../../readonly';
import type { CompendiumSpell, Spell, SpellSlot } from '../../types';
import { clampInt, newId } from '../../utils';
import { FieldInfo } from '../FieldInfo';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';
import { SpellPicker } from './SpellPicker';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const EMPTY_SLOT: SpellSlot = { max: 0, used: 0 };

/** Abreviações dos tipos de conjuração mostradas no bloco de Conjuração. */
const SPELLCASTING_SHORT: Record<string, string> = {
  full: 'completo',
  half: 'meio',
  third: '1/3',
  pact: 'pacto',
};

/** Abreviações de como as magias são aprendidas. */
const SPELL_LEARNING_SHORT: Record<string, string> = {
  known: 'conhecidas',
  prepared: 'preparadas',
};

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
  // Gastar/recuperar espaços é estado de jogo; a lista de magias conhecidas e
  // o TOTAL de cada nível são construção (vêm da classe e do Level Up).
  const { readOnly, lockedConstruction } = useSheetAccess();
  const { list, slots } = character.spells;
  // Catálogo de magias (para o seletor por classe). Buscado uma vez na montagem.
  const [catalogSpells, setCatalogSpells] = useState<CompendiumSpell[]>([]);
  useEffect(() => {
    fetchCompendium()
      .then((data) => setCatalogSpells(data.spells))
      .catch(() => undefined);
  }, []);
  const spellcasting = character.derived.spellcasting;
  // Espaços pela regra do PHB (tabela da própria classe, ou a combinada quando
  // há duas ou mais classes conjuradoras) e Magia de Pacto à parte.
  const combinedSlots = character.derived.spellSlots ?? [];
  const pactSlots = character.derived.pactSlots ?? null;

  // Conjuração por classe: como cada uma conjura e como aprende as magias. O
  // resumo de CD/ataque fica no subtítulo da seção; aqui vai o detalhe por
  // classe (versão curta visível, texto completo no title).
  const castingShort = character.classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.type !== 'none')
    .map((entry) => {
      const ability = entry.spellcasting?.ability;
      return (
        `${entry.className} (${SPELLCASTING_SHORT[entry.spellcasting!.type]})` +
        (ability ? ` · ${ABILITY_ABBREVIATIONS[ability]}` : '')
      );
    })
    .join(' · ');
  const learningShort = character.classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.learning !== 'none')
    .map(
      (entry) =>
        `${entry.className} (${SPELL_LEARNING_SHORT[entry.spellcasting!.learning] ?? entry.spellcasting!.learning})`,
    )
    .join(' · ');
  const castingFull = character.classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.type !== 'none')
    .map((entry) => {
      const ability = entry.spellcasting?.ability;
      return (
        `${entry.className}: ${SPELLCASTING_TYPE_LABELS[entry.spellcasting!.type]}` +
        (ability ? ` · ${ABILITY_ABBREVIATIONS[ability]}` : '')
      );
    })
    .join(' · ');
  const learningFull = character.classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.learning !== 'none')
    .map((entry) => `${entry.className}: ${SPELL_LEARNING_LABELS[entry.spellcasting!.learning]}`)
    .join(' · ');

  // Magias PREPARADAS são por classe: cada conjurador preparado tem o seu
  // limite, com o próprio atributo (Paladino conta metade do nível).
  const preparedByClass = character.classes
    .map((entry) => ({ name: entry.className, count: entry.spellcasting?.preparedCount ?? null }))
    .filter((item): item is { name: string; count: number } => item.count !== null && item.count > 0);

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
          { id: newId(), name: 'Nova magia', level: 1, school: '', prepared: false, description: '', classKey: '' },
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

  // Só os níveis com espaços ganham o card grande; os níveis zerados ficam numa
  // linha compacta (mas ainda com o campo de total, para poder configurá-los).
  const slotTotal = (level: number): number => (slots[String(level)] ?? EMPTY_SLOT).max;
  const activeSlotLevels = SLOT_LEVELS.filter((level) => slotTotal(level) > 0);
  const emptySlotLevels = SLOT_LEVELS.filter((level) => slotTotal(level) <= 0);

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
        lockedConstruction ? undefined : (
          <button type="button" className="btn btn-small" onClick={addSpell}>
            + magia
          </button>
        )
      }
    >
      {/*
       * Conjuração (vinda da Identidade): tipos por classe, como as magias são
       * aprendidas e o resumo de CD/ataque (que já aparece no subtítulo).
       */}
      {castingShort || learningShort ? (
        <div className="casting-block">
          <span className="casting-title">
            Conjuração
            <FieldInfo>
              Como cada classe conjura magias, a CD para resistir a elas e o bônus de ataque mágico.
            </FieldInfo>
          </span>

          <p className="casting-detail">
            <em>Conjuração</em>
            <span title={castingFull || undefined}>{castingShort || '—'}</span>
          </p>
          <p className="casting-detail">
            <em>Magias</em>
            <span title={learningFull || undefined}>{learningShort || '—'}</span>
          </p>
        </div>
      ) : null}

      {/* Livro de magias por classe (catálogo do PHB) — a escolha alimenta a
          lista da ficha; o servidor revalida os limites. */}
      {catalogSpells.length > 0
        ? character.classes.map((entry) =>
            entry.spellcasting && entry.spellcasting.type !== 'none' ? (
              <SpellPicker
                key={entry.classKey}
                entry={entry}
                allSpells={catalogSpells}
                current={list.filter((spell) => spell.classKey === entry.classKey)}
                onSaved={(saved) => update({ spells: saved.spells })}
              />
            ) : null,
          )
        : null}

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

      {activeSlotLevels.length === 0 ? (
        <p className="empty-hint">Nenhum espaço de magia configurado.</p>
      ) : (
        <div className="grid grid-slots">
          {activeSlotLevels.map((level) => {
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
                    readOnly={lockedConstruction}
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
      )}

      {/* Níveis sem espaços: uma linha compacta em vez de um card vazio cada. */}
      {emptySlotLevels.length > 0 ? (
        <div className="slot-inactive">
          <span className="slot-inactive-label">Sem espaços</span>
          {emptySlotLevels.map((level) => {
            const slot = slots[String(level)] ?? EMPTY_SLOT;
            return (
              <label className="slot-inactive-item" key={level}>
                <span className="slot-inactive-level">{SPELL_LEVEL_LABELS[level]}</span>
                <InlineField
                  className="slot-inactive-total"
                  value={slot.max}
                  mode="number"
                  min={0}
                  readOnly={lockedConstruction}
                  ariaLabel={`Espaços totais de ${level}º nível`}
                  onCommit={(value) =>
                    setSlot(level, { max: clampInt(value, 0, 99, slot.max) })
                  }
                />
              </label>
            );
          })}
        </div>
      ) : null}

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
        {preparedByClass.length > 0
          ? ` — prepara: ${preparedByClass
              .map((item) => `${item.name} ${item.count}`)
              .join(' · ')}`
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
                      disabled={lockedConstruction}
                      aria-label={`Preparada: ${spell.name}`}
                      title="Preparada"
                      onChange={(event) => patchSpell(spell.id, { prepared: event.target.checked })}
                    />
                    <InlineField
                      value={spell.name}
                      readOnly={lockedConstruction}
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
                      readOnly={lockedConstruction}
                      ariaLabel="Escola da magia"
                      onCommit={(value) => patchSpell(spell.id, { school: value })}
                    />
                    <InlineField
                      value={spell.level}
                      mode="number"
                      min={0}
                      max={9}
                      readOnly={lockedConstruction}
                      ariaLabel="Nível da magia"
                      onCommit={(value) =>
                        patchSpell(spell.id, { level: clampInt(value, 0, 9, spell.level) })
                      }
                    />
                    <InlineField
                      className="spell-description"
                      value={spell.description}
                      readOnly={lockedConstruction}
                      placeholder="efeito / descrição"
                      ariaLabel="Descrição da magia"
                      onCommit={(value) => patchSpell(spell.id, { description: value })}
                    />
                    {lockedConstruction ? null : (
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
