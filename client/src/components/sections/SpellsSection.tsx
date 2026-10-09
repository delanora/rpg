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
import type { CompendiumSpell, Spell } from '../../types';
import { clampInt, newId } from '../../utils';
import { FieldInfo } from '../FieldInfo';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';
import { SpellPicker } from './SpellPicker';

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
  max: number;
  used: number;
  readOnly: boolean;
  onChange: (used: number) => void;
}

/** Espaços de magia como estrelas clicáveis: gastas ficam apagadas. */
function SlotPips({ level, max, used, readOnly, onChange }: SlotPipsProps) {
  if (max <= 0) {
    return (
      <span className="slot-pips">
        <span className="slot-empty">—</span>
      </span>
    );
  }

  const usedCount = Math.min(used, max);

  return (
    <span
      className="slot-pips"
      role="group"
      aria-label={`Espaços de ${level}º nível: ${usedCount} de ${max} usados`}
    >
      {Array.from({ length: max }, (_, index) => {
        const isUsed = index < usedCount;
        return (
          <button
            key={index}
            type="button"
            className={isUsed ? 'slot-pip used' : 'slot-pip'}
            disabled={readOnly}
            title={isUsed ? 'Marcar como disponível' : 'Marcar como gasto'}
            aria-label={isUsed ? `Recuperar espaço ${index + 1}` : `Gastar espaço ${index + 1}`}
            onClick={() => onChange(isUsed ? index : index + 1)}
          >
            <Icon name="sparkle" size={13} />
          </button>
        );
      })}
    </span>
  );
}

export function SpellsSection({ character, update }: SheetSectionProps) {
  // Gastar/recuperar espaços é estado de jogo; o TOTAL de cada nível é DERIVADO
  // do nível de conjurador (não fica gravado) e a lista de magias conhecidas é
  // construção (vem da classe e do Level Up).
  const { readOnly, lockedConstruction } = useSheetAccess();
  const { list } = character.spells;
  // Uso persistido dos espaços NORMAIS por nível (`{ "1": 2 }`); ausente = 0.
  const slotsUsed = character.spells.slotsUsed ?? {};
  // Catálogo de magias (para o seletor por classe). Buscado uma vez na montagem.
  const [catalogSpells, setCatalogSpells] = useState<CompendiumSpell[]>([]);
  useEffect(() => {
    fetchCompendium()
      .then((data) => setCatalogSpells(data.spells))
      .catch(() => undefined);
  }, []);
  const spellcasting = character.derived.spellcasting;
  // Espaços pela regra do PHB (tabela da própria classe, ou a combinada quando
  // há duas ou mais classes conjuradoras): o TOTAL de cada nível vem SEMPRE
  // daqui. A Magia de Pacto é um pool próprio, calculado à parte.
  const derivedSlots = character.derived.spellSlots ?? [];
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

  /** Grava o USO de um nível — o total é derivado e nunca é enviado. */
  function setSlotUsed(level: number, next: number): void {
    update({
      spells: { ...character.spells, slotsUsed: { ...slotsUsed, [String(level)]: next } },
    });
  }

  // Magia de Pacto (Bruxo): o TOTAL e o nível do espaço vêm do nível de Bruxo
  // (`derived.pactSlots`); só os USADOS são gravados na ficha. Pool PRÓPRIO —
  // nada aqui toca os espaços normais.
  const pactUsed = character.spells.pactMagic?.used ?? 0;
  function setPactUsed(next: number): void {
    update({ spells: { ...character.spells, pactMagic: { used: next } } });
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

  /**
   * Contador das magias raciais 1x/descanso longo: alterna usado/disponível.
   * NÃO há reset automático nesta fase (Categoria B) — o uso só muda por ação
   * explícita do jogador. O estado vive em `classState.used`.
   */
  function toggleRaceUse(spell: Spell): void {
    if (!spell.raceUses) return;
    const id = `race-spell:${spell.id}`;
    const used = character.classState.used[id] ?? 0;
    const next = used >= spell.raceUses.max ? 0 : used + 1;
    update({
      classState: {
        ...character.classState,
        used: { ...character.classState.used, [id]: next },
      },
    });
  }

  // Fonte de Magia (Feiticeiro): converte pontos de feitiçaria em espaços de
  // magia gastos e vice-versa. O TOTAL de cada nível é derivado; só o USO é
  // gravado na ficha (`slotsUsed`).
  const sorcery = character.classAdjustments.resources.find(
    (resource) => resource.id === 'sorcery-points',
  );
  const sorceryLevels = derivedSlots.filter((slot) => slot.level <= 5);

  function spendPointsForSlot(level: number, cost: number): void {
    if (!sorcery) return;
    const used = slotsUsed[String(level)] ?? 0;
    if (sorcery.remaining < cost || used <= 0) return;
    update({
      classState: {
        ...character.classState,
        used: { ...character.classState.used, [sorcery.id]: (character.classState.used[sorcery.id] ?? 0) + cost },
      },
      spells: { ...character.spells, slotsUsed: { ...slotsUsed, [String(level)]: used - 1 } },
    });
  }

  function convertSlotToPoints(level: number): void {
    if (!sorcery) return;
    const slot = derivedSlots.find((item) => item.level === level);
    const used = slotsUsed[String(level)] ?? 0;
    if (!slot || used >= slot.max || sorcery.remaining + level > sorcery.max) return;
    update({
      classState: {
        ...character.classState,
        used: {
          ...character.classState.used,
          [sorcery.id]: Math.max(0, (character.classState.used[sorcery.id] ?? 0) - level),
        },
      },
      spells: { ...character.spells, slotsUsed: { ...slotsUsed, [String(level)]: used + 1 } },
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
                current={list.filter(
                  (spell) => spell.classKey === entry.classKey && !spell.oath && !spell.race,
                )}
                onSaved={(saved) => update({ spells: saved.spells })}
              />
            ) : null,
          )
        : null}

      {derivedSlots.length > 0 || pactSlots ? (
        <>
          <h3 className="subsection-title">Espaços pela regra de multiclasse</h3>
          <p className="section-note">
            Somados como no PHB: conjurador completo + metade do meio-conjurador + um terço do
            terço-conjurador. As magias preparadas continuam sendo contadas por classe.
          </p>
          <div className="slot-reference">
            {derivedSlots.map((slot) => (
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

      {derivedSlots.length === 0 ? (
        <p className="empty-hint">Nenhum espaço de magia configurado.</p>
      ) : (
        <div className="grid grid-slots">
          {derivedSlots.map((slot) => {
            const level = slot.level;
            const used = Math.min(slotsUsed[String(level)] ?? 0, slot.max);

            return (
              <div className="slot-card" key={level}>
                <span className="slot-level">{SPELL_LEVEL_LABELS[level]}</span>

                <SlotPips
                  level={level}
                  max={slot.max}
                  used={used}
                  readOnly={readOnly}
                  onChange={(next) => setSlotUsed(level, next)}
                />

                <label className="slot-field">
                  <span>usados</span>
                  <InlineField
                    value={used}
                    mode="number"
                    min={0}
                    ariaLabel={`Espaços usados de ${level}º nível`}
                    onCommit={(value) => setSlotUsed(level, clampInt(value, 0, slot.max, used))}
                  />
                </label>
                <label className="slot-field">
                  <span>total</span>
                  {/* O total é DERIVADO do nível de conjurador: não é editável
                      nem fica gravado na ficha. */}
                  <InlineField
                    value={slot.max}
                    mode="number"
                    readOnly
                    title="Derivado do nível de conjurador"
                    ariaLabel={`Espaços totais de ${level}º nível (derivados)`}
                    onCommit={() => undefined}
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}

      {/* Magia de Pacto: pool separado do Bruxo (todos os espaços têm o mesmo
          nível e recuperam no Descanso Curto). O total e o nível são derivados;
          só os usados ficam na ficha. */}
      {pactSlots ? (
        <>
          <h3 className="subsection-title">Magia de Pacto</h3>
          <p className="section-note">
            Recurso próprio do Bruxo: <strong>{pactSlots.max}</strong> espaço(s) de{' '}
            {SPELL_LEVEL_LABELS[pactSlots.slotLevel]}, todos do mesmo nível. O total e o nível saem
            do nível de Bruxo; só os usados ficam gravados na ficha.
          </p>
          <div className="grid grid-slots">
            <div className="slot-card">
              <span className="slot-level">{SPELL_LEVEL_LABELS[pactSlots.slotLevel]}</span>

              <span
                className="slot-pips"
                role="group"
                aria-label={`Magia de Pacto: ${pactUsed} de ${pactSlots.max} usados`}
              >
                {Array.from({ length: pactSlots.max }, (_, index) => {
                  const isUsed = index < pactUsed;
                  return (
                    <button
                      key={index}
                      type="button"
                      className={isUsed ? 'slot-pip used' : 'slot-pip'}
                      disabled={readOnly}
                      title={isUsed ? 'Marcar como disponível' : 'Marcar como gasto'}
                      aria-label={
                        isUsed
                          ? `Recuperar espaço de Pacto ${index + 1}`
                          : `Gastar espaço de Pacto ${index + 1}`
                      }
                      onClick={() => setPactUsed(isUsed ? index : index + 1)}
                    >
                      <Icon name="sparkle" size={13} />
                    </button>
                  );
                })}
              </span>

              <label className="slot-field">
                <span>usados</span>
                <InlineField
                  value={pactUsed}
                  mode="number"
                  min={0}
                  ariaLabel="Espaços de Pacto usados"
                  onCommit={(value) => setPactUsed(clampInt(value, 0, pactSlots.max, pactUsed))}
                />
              </label>
              <label className="slot-field">
                <span>total</span>
                <InlineField
                  value={pactSlots.max}
                  mode="number"
                  readOnly
                  title="Derivado do nível de Bruxo"
                  ariaLabel="Espaços de Pacto (derivados do nível de Bruxo)"
                  onCommit={() => undefined}
                />
              </label>
            </div>
          </div>
        </>
      ) : null}

      {sorcery ? (
        <>
          <h3 className="subsection-title">Fonte de Magia</h3>
          <p className="section-note">
            Pontos de feitiçaria: {sorcery.remaining}/{sorcery.max}. Converta pontos em espaços de
            magia gastos ou espaços em pontos (1º = 2, 2º = 3, 3º = 5, 4º = 6, 5º = 7; sem 6º+).
          </p>
          <div className="sorcery-convert">
            {sorceryLevels.map((slot) => {
              const level = slot.level;
              const cost = SORCERY_SLOT_COSTS[level];
              const used = Math.min(slotsUsed[String(level)] ?? 0, slot.max);
              return (
                <div className="sorcery-row" key={level}>
                  <span className="sorcery-level">{SPELL_LEVEL_LABELS[level]}</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={readOnly || sorcery.remaining < cost || used <= 0}
                    onClick={() => spendPointsForSlot(level, cost)}
                  >
                    {cost} pts → recuperar 1 espaço
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={
                      readOnly || used >= slot.max || sorcery.remaining + level > sorcery.max
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
                .map((spell) => {
                  // Magias DERIVADAS (juramento ou raça): sempre preparadas, fora
                  // do limite e não editáveis/removíveis.
                  const derived = Boolean(spell.oath || spell.race);
                  return (
                    <li
                      className={
                        spell.oath ? 'spell-row oath' : spell.race ? 'spell-row race' : 'spell-row'
                      }
                      key={spell.id}
                    >
                      <input
                        type="checkbox"
                        checked={derived ? true : spell.prepared}
                        disabled={lockedConstruction || derived}
                        aria-label={`Preparada: ${spell.name}`}
                        title={
                          spell.oath
                            ? 'Sempre preparada (magia de Juramento)'
                            : spell.race
                              ? 'Magia racial (sempre disponível)'
                              : 'Preparada'
                        }
                        onChange={(event) => patchSpell(spell.id, { prepared: event.target.checked })}
                      />
                      <InlineField
                        value={spell.name}
                        readOnly={lockedConstruction || derived}
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
                        readOnly={lockedConstruction || derived}
                        ariaLabel="Escola da magia"
                        onCommit={(value) => patchSpell(spell.id, { school: value })}
                      />
                      <InlineField
                        value={spell.level}
                        mode="number"
                        min={0}
                        max={9}
                        readOnly={lockedConstruction || derived}
                        ariaLabel="Nível da magia"
                        onCommit={(value) =>
                          patchSpell(spell.id, { level: clampInt(value, 0, 9, spell.level) })
                        }
                      />
                      <InlineField
                        className="spell-description"
                        value={spell.description}
                        readOnly={lockedConstruction || derived}
                        placeholder="efeito / descrição"
                        ariaLabel="Descrição da magia"
                        onCommit={(value) => patchSpell(spell.id, { description: value })}
                      />
                      {spell.oath ? (
                        <span
                          className="spell-oath-badge"
                          title="Magia de Juramento: sempre preparada e fora do limite de preparadas"
                        >
                          <Icon name="shield" size={12} /> Juramento
                        </span>
                      ) : spell.race ? (
                        <span className="spell-race-tag">
                          <span
                            className="spell-race-badge"
                            title={
                              'Magia racial: sempre preparada, fora do limite de classe e conjurada sem espaço' +
                              (spell.raceSaveDC ? ` · CD ${spell.raceSaveDC}` : '') +
                              (spell.raceAttackBonus !== undefined
                                ? ` · ataque ${formatModifier(spell.raceAttackBonus)}`
                                : '') +
                              (spell.raceAbility
                                ? ` · ${ABILITY_ABBREVIATIONS[spell.raceAbility]}`
                                : '')
                            }
                          >
                            <Icon name="sparkle" size={12} /> Raça
                          </span>
                          {spell.raceUses ? (
                            <button
                              type="button"
                              className="btn btn-small"
                              disabled={readOnly}
                              title={
                                spell.raceUses.used >= spell.raceUses.max
                                  ? 'Devolver o uso (descanso longo)'
                                  : 'Marcar como usado (1x por descanso longo)'
                              }
                              onClick={() => toggleRaceUse(spell)}
                            >
                              {spell.raceUses.used >= spell.raceUses.max ? 'repor' : 'usar'}
                            </button>
                          ) : null}
                        </span>
                      ) : lockedConstruction ? null : (
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
                  );
                })}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}
