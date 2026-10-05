import { getSpell, SPELL_SCHOOL_LABELS } from './index.js';

/**
 * Magias de juramento do Paladino (Prompt 6.3).
 *
 * A subclasse declara os IDs do catálogo por nível de PALADINO
 * (`SubclassDefinition.oathSpells`); aqui eles viram as magias resolvidas do
 * catálogo. São DERIVADAS do nível da classe pai (não do nível total): não
 * entram em `spells.list`, ficam sempre preparadas, não contam no limite de
 * preparadas e não podem ser removidas/despreparadas.
 */

/** Uma magia de juramento já resolvida contra o catálogo. */
export interface OathSpellEntry {
  key: string;
  name: string;
  level: number;
  /** Rótulo da escola em português (mesmo formato da lista da ficha). */
  school: string;
  description: string;
}

/** Resolve uma lista de IDs contra o catálogo, sem repetir e ignorando IDs ausentes. */
function resolveIds(ids: readonly string[]): OathSpellEntry[] {
  const seen = new Set<string>();
  const entries: OathSpellEntry[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const spell = getSpell(id);
    if (!spell) continue;
    entries.push({
      key: spell.id,
      name: spell.namePt,
      level: spell.level,
      school: SPELL_SCHOOL_LABELS[spell.school],
      description: spell.description.slice(0, 2000),
    });
  }
  return entries;
}

/** Magias concedidas EXATAMENTE no nível de paladino informado (uma faixa). */
export function oathSpellsAtLevel(
  oathSpells: Record<number, readonly string[]> | undefined,
  paladinLevel: number,
): OathSpellEntry[] {
  return resolveIds(oathSpells?.[Math.floor(paladinLevel)] ?? []);
}

/** IDs liberados até `paladinLevel` (inclusive), na ordem do livro. */
export function oathSpellKeys(
  oathSpells: Record<number, readonly string[]> | undefined,
  paladinLevel: number,
): string[] {
  if (!oathSpells) return [];
  const level = Math.max(0, Math.floor(paladinLevel));
  const ids: string[] = [];
  for (const [key, list] of Object.entries(oathSpells)) {
    if (Number(key) <= level) ids.push(...list);
  }
  return ids;
}

/**
 * Resolve as magias de juramento contra o catálogo, sem repetir (uma mesma
 * magia pode aparecer em dois juramentos, mas o juramento é único). IDs que não
 * existirem no catálogo são ignorados (não devem existir, mas não quebram a ficha).
 */
export function resolveOathSpells(
  oathSpells: Record<number, readonly string[]> | undefined,
  paladinLevel: number,
): OathSpellEntry[] {
  return resolveIds(oathSpellKeys(oathSpells, paladinLevel));
}
