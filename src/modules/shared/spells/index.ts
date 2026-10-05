import { CANTRIPS } from './catalog/cantrips.js';
import { LEVEL_1 } from './catalog/level-1.js';
import { LEVEL_2 } from './catalog/level-2.js';
import { LEVEL_3 } from './catalog/level-3.js';
import { LEVEL_4 } from './catalog/level-4.js';
import { LEVEL_5 } from './catalog/level-5.js';
import { LEVEL_6 } from './catalog/level-6.js';
import { LEVEL_7 } from './catalog/level-7.js';
import { LEVEL_8 } from './catalog/level-8.js';
import { LEVEL_9 } from './catalog/level-9.js';
import { spellClassesFor } from './class-lists.js';
import type { Spell, SpellSchool } from './types.js';

export * from './types.js';
export * from './class-lists.js';

/** As 8 escolas do PHB 2014, na ordem do livro. */
export const SPELL_SCHOOLS: readonly SpellSchool[] = [
  'abjuration',
  'divination',
  'conjuration',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
];

/** Rótulo em português de cada escola (para a ficha e o compêndio). */
export const SPELL_SCHOOL_LABELS: Record<SpellSchool, string> = {
  abjuration: 'Abjuração',
  divination: 'Adivinhação',
  conjuration: 'Conjuração',
  enchantment: 'Encantamento',
  evocation: 'Evocação',
  illusion: 'Ilusão',
  necromancy: 'Necromancia',
  transmutation: 'Transmutação',
};

/** Rótulo de cada nível (0 = Truques). */
export const SPELL_LEVEL_LABELS: Record<number, string> = {
  0: 'Truque',
  1: '1º nível',
  2: '2º nível',
  3: '3º nível',
  4: '4º nível',
  5: '5º nível',
  6: '6º nível',
  7: '7º nível',
  8: '8º nível',
  9: '9º nível',
};

/**
 * Lista fechada do PHB 2014 (truques + níveis 1 a 9). A ordem é por nível e,
 * dentro de cada nível, alfabética pelo nome em inglês (ver `catalog/`).
 *
 * O campo `classes` do catálogo nasce vazio e é preenchido aqui a partir das
 * Spell Lists de `class-lists.ts` — fonte única do vínculo magia ↔ classe.
 */
export const SPELLS: readonly Spell[] = [
  ...CANTRIPS,
  ...LEVEL_1,
  ...LEVEL_2,
  ...LEVEL_3,
  ...LEVEL_4,
  ...LEVEL_5,
  ...LEVEL_6,
  ...LEVEL_7,
  ...LEVEL_8,
  ...LEVEL_9,
].map((spell) => ({ ...spell, classes: spellClassesFor(spell.id) }));

const SPELLS_BY_ID: ReadonlyMap<string, Spell> = new Map(
  SPELLS.map((spell) => [spell.id, spell]),
);

/** Busca uma magia pelo id estável (ex.: "fireball"). */
export function getSpell(id: string): Spell | undefined {
  return SPELLS_BY_ID.get(id.trim());
}

/** Magias de um nível (0 = truques), na ordem do catálogo. */
export function spellsByLevel(level: number): Spell[] {
  return SPELLS.filter((spell) => spell.level === level);
}

/** Magias de uma escola, na ordem do catálogo. */
export function spellsBySchool(school: SpellSchool): Spell[] {
  return SPELLS.filter((spell) => spell.school === school);
}

/** Todas as magias, na ordem do catálogo (cópia — não muta o registro). */
export function allSpells(): Spell[] {
  return [...SPELLS];
}
