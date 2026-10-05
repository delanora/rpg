import { useState } from 'react';
import { SPELL_LEVEL_LABELS } from '../../dnd';
import { setSpellbook } from '../../spellbookApi';
import type { Character, ClassEntry, CompendiumSpell, Spell } from '../../types';
import { Icon } from '../Icon';

/**
 * Terço-conjuradores: usam a lista do Mago com restrição de escola. O cliente
 * identifica pela subclasse; o SERVIDOR sempre revalida.
 */
const THIRD_CASTER_SUBCLASSES: Record<string, { schools: string[] }> = {
  'Cavaleiro Arcano': { schools: ['Abjuração', 'Evocação'] },
  'Trapaceiro Arcano': { schools: ['Encantamento', 'Ilusão'] },
};

/** Lista(s) do catálogo que a classe enxerga. */
function classListKeys(entry: ClassEntry): string[] {
  return entry.subclass && entry.subclass in THIRD_CASTER_SUBCLASSES
    ? ['wizard']
    : [entry.classKey];
}

interface SpellPickerProps {
  entry: ClassEntry;
  allSpells: CompendiumSpell[];
  /** Magias já gravadas nesta classe. */
  current: Spell[];
  onSaved: (character: Character) => void;
}

function selectedCounts(selection: Map<string, boolean>, byKey: Map<string, CompendiumSpell>) {
  let cantrips = 0;
  let leveled = 0;
  let prepared = 0;
  for (const [key, isPrepared] of selection) {
    const spell = byKey.get(key);
    if (!spell) continue;
    if (spell.level === 0) cantrips += 1;
    else leveled += 1;
    if (isPrepared) prepared += 1;
  }
  return { cantrips, leveled, prepared };
}

/** Seletor de magias do catálogo, filtrado pela lista da classe. */
export function SpellPicker({ entry, allSpells, current, onSaved }: SpellPickerProps) {
  const limits = entry.spellcasting;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Map<string, boolean>>(
    // As magias DERIVADAS (juramento e raça) ficam fora do limite e não são
    // editáveis: nunca entram na seleção do seletor.
    () =>
      new Map(
        current
          .filter((spell) => !spell.oath && !spell.race)
          .map((spell) => [spell.id, spell.prepared]),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [levelFilter, setLevelFilter] = useState<'all' | number>('all');

  if (!limits || limits.type === 'none') return null;

  const byKey = new Map(allSpells.map((spell) => [spell.key, spell]));
  // (As magias de juramento não aparecem no pool: não são escolhidas pelo jogador.)
  const listKeys = classListKeys(entry);
  const third = entry.subclass in THIRD_CASTER_SUBCLASSES;

  const pool = allSpells.filter((spell) => {
    if (!spell.classes.some((key) => listKeys.includes(key))) return false;
    if (spell.level > limits.maxSpellLevel) return false;
    if (third && spell.level > 0) {
      const schools = THIRD_CASTER_SUBCLASSES[entry.subclass].schools;
      if (!schools.includes(spell.school)) return false;
    }
    return true;
  });

  const counts = selectedCounts(selection, byKey);
  // Classes de lista fixa limitam o TOTAL de magias (conhecidas ou grimório);
  // quem só PREPARA (Clérigo, Druida, Paladino) não tem teto de lista, apenas
  // de quantas ficam preparadas. O servidor é quem revalida.
  const totalLimit = limits.spellsKnown ?? limits.grimoireSize ?? null;
  const preparedLimit =
    limits.preparedCount !== null && limits.preparedCount > 0 ? limits.preparedCount : null;

  function toggle(key: string): void {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, false);
      return next;
    });
  }

  function togglePrepared(key: string): void {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.set(key, !next.get(key));
      return next;
    });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const entries = [...selection].map(([key, prepared]) => ({ key, prepared }));
      const character = await setSpellbook(entry.classKey, entries);
      onSaved(character);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar as magias.');
    } finally {
      setBusy(false);
    }
  }

  const visible = levelFilter === 'all' ? pool : pool.filter((spell) => spell.level === levelFilter);

  return (
    <div className="spellbook-block">
      <div className="spellbook-head">
        <span className="spellbook-title">
          <Icon name="book" size={15} /> {entry.className}
          <span className="spellbook-counters">
            {limits.cantripsKnown > 0 ? `Truques ${counts.cantrips}/${limits.cantripsKnown}` : 'Sem truques'}
            {limits.spellsKnown !== null
              ? ` · Conhecidas ${counts.leveled}/${limits.spellsKnown}`
              : ''}
            {limits.grimoireSize !== null
              ? ` · Grimório ${counts.leveled}/${limits.grimoireSize}`
              : ''}
            {preparedLimit !== null ? ` · Preparadas ${counts.prepared}/${preparedLimit}` : ''}
          </span>
        </span>
        <button type="button" className="btn btn-small" onClick={() => setOpen((value) => !value)}>
          {open ? 'Fechar' : 'Escolher magias'}
        </button>
      </div>

      {open ? (
        <div className="spellbook-picker">
          <div className="config-filters">
            <label className="field">
              <span>NÍVEL</span>
              <select
                value={String(levelFilter)}
                onChange={(event) =>
                  setLevelFilter(
                    event.target.value === 'all' ? 'all' : Number(event.target.value),
                  )
                }
              >
                <option value="all">Todos</option>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
                  .filter((level) => level <= limits.maxSpellLevel)
                  .map((level) => (
                    <option key={level} value={level}>
                      {SPELL_LEVEL_LABELS[level]}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <p className="config-note">
            Liste as magias da lista de {third ? 'Mago' : entry.className}.{' '}
            {totalLimit !== null
              ? `Máximo de ${totalLimit} magia(s) de 1º nível ou superior.`
              : preparedLimit !== null
                ? `Marque até ${preparedLimit} como preparada(s).`
                : ''}
          </p>

          {visible.length === 0 ? (
            <p className="empty-hint">Nenhuma magia disponível neste nível.</p>
          ) : (
            <ul className="spell-picker-list">
              {visible.map((spell) => {
                const selected = selection.has(spell.key);
                const prepared = selection.get(spell.key) ?? false;
                return (
                  <li className="spell-picker-item" key={spell.key}>
                    <label className="spell-picker-main">
                      <input type="checkbox" checked={selected} onChange={() => toggle(spell.key)} />
                      <span className="spell-picker-name">{spell.name}</span>
                    </label>
                    <span className="spell-picker-meta">
                      {SPELL_LEVEL_LABELS[spell.level]} · {spell.school}
                    </span>
                    {preparedLimit !== null && selected ? (
                      <label className="spell-picker-prepared">
                        <input
                          type="checkbox"
                          checked={prepared}
                          onChange={() => togglePrepared(spell.key)}
                        />{' '}
                        preparada
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {error ? <p className="config-empty config-empty-error">{error}</p> : null}

          <div className="spellbook-actions">
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void save()}>
              {busy ? 'Salvando…' : 'Salvar magias'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
