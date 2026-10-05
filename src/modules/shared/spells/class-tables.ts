/**
 * Tabelas de conjuração do PHB 2014 por classe e nível (cap. 3).
 *
 * Aqui ficam as CONTAGENS que a ficha e o Level Up usam: truques conhecidos,
 * magias conhecidas (classes de lista fixa), nível máximo de magia conjurável e
 * o tamanho do grimório do Mago. NÃO mexem nas tabelas de espaços nem em
 * `pactMagicSlots` (esses vivem em `shared/classes`).
 *
 * Cavaleiro Arcano e Trapaceiro Arcano (terço-conjuradores) têm tabelas próprias,
 * indexadas pelo nível da CLASSE PAI (Guerreiro/Ladino).
 */

import type { SpellClassKey } from './types.js';

/** Limites de conjuração de uma classe (ou subclasse terço-conjuradora). */
export interface SpellcastingLimits {
  /** Truques conhecidos (0 para quem não tem truques). */
  cantripsKnown: number;
  /** Magias conhecidas; `null` para quem PREPARA (não tem lista fixa). */
  spellsKnown: number | null;
  /** Nível máximo de magia conjurável (0 = ainda não conjura). */
  maxSpellLevel: number;
  /** Tamanho do grimório (só Mago); `null` nas demais. */
  grimoireSize: number | null;
}

/** Array indexado pelo nível da classe (índice 1 = nível 1; índice 0 = 0). */
function byLevel(values: readonly number[]): readonly number[] {
  return [0, ...values];
}

// --- Truques conhecidos ----------------------------------------------------
const CANTRIPS_KNOWN: Record<SpellClassKey, readonly number[]> = {
  bard: byLevel([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  cleric: byLevel([3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  druid: byLevel([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  paladin: byLevel([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  ranger: byLevel([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  sorcerer: byLevel([4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]),
  warlock: byLevel([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  wizard: byLevel([3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
};

// --- Magias conhecidas (só classes de lista fixa) --------------------------
const SPELLS_KNOWN: Partial<Record<SpellClassKey, readonly number[]>> = {
  bard: byLevel([4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22]),
  sorcerer: byLevel([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15]),
  warlock: byLevel([2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15]),
  ranger: byLevel([0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11]),
  // (ranger tem 0 magias conhecidas no nível 1 por não conjurar ainda)
};

// --- Terço-conjuradores (Guerreiro: Cavaleiro Arcano / Ladino: Trapaceiro) --
const THIRD_CASTER_CANTRIPS: Record<string, readonly number[]> = {
  'eldritch-knight': byLevel([0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
  'arcane-trickster': byLevel([0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
};

const THIRD_CASTER_SPELLS_KNOWN: Record<string, readonly number[]> = {
  'eldritch-knight': byLevel([0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13]),
  'arcane-trickster': byLevel([0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13]),
};

const KNOWN_CLASS_KEYS = new Set<SpellClassKey>([
  'bard',
  'sorcerer',
  'warlock',
  'ranger',
]);

function at(table: readonly number[], level: number): number {
  const index = Math.min(table.length - 1, Math.max(0, Math.floor(level)));
  return table[index] ?? 0;
}

/** Nível máximo de magia conjurável por classe no nível dela (0 = não conjura). */
export function maxSpellLevelFor(classKey: SpellClassKey, level: number): number {
  const lvl = Math.max(0, Math.floor(level));

  if (classKey === 'paladin' || classKey === 'ranger') {
    return lvl < 2 ? 0 : Math.min(5, Math.ceil(lvl / 4));
  }

  if (classKey === 'warlock') {
    if (lvl >= 9) return 5;
    if (lvl >= 7) return 4;
    if (lvl >= 5) return 3;
    if (lvl >= 3) return 2;
    return 1;
  }

  // Conjurador completo.
  return Math.min(9, Math.ceil(lvl / 2));
}

/** Nível máximo de magia do terço-conjurador no nível da classe pai. */
export function thirdCasterMaxSpellLevel(level: number): number {
  const lvl = Math.max(0, Math.floor(level));
  if (lvl < 3) return 0;
  if (lvl < 7) return 1;
  if (lvl < 13) return 2;
  if (lvl < 19) return 3;
  return 4;
}

/** Tamanho do grimório do Mago: 6 no nível 1 e +2 por nível. */
export function wizardGrimoireSize(level: number): number {
  return 6 + 2 * (Math.max(1, Math.floor(level)) - 1);
}

/** Limites de conjuração de uma classe base (sem olhar a subclasse). */
export function classSpellcastingLimits(
  classKey: SpellClassKey,
  level: number,
): SpellcastingLimits {
  return {
    cantripsKnown: at(CANTRIPS_KNOWN[classKey], level),
    spellsKnown: KNOWN_CLASS_KEYS.has(classKey) ? at(SPELLS_KNOWN[classKey]!, level) : null,
    maxSpellLevel: maxSpellLevelFor(classKey, level),
    grimoireSize: classKey === 'wizard' ? wizardGrimoireSize(level) : null,
  };
}

/** Limites de conjuração da subclasse terço-conjuradora (pelo nível da classe pai). */
export function thirdCasterSpellcastingLimits(
  subclassId: string,
  level: number,
): SpellcastingLimits {
  return {
    cantripsKnown: at(THIRD_CASTER_CANTRIPS[subclassId] ?? [], level),
    spellsKnown: at(THIRD_CASTER_SPELLS_KNOWN[subclassId] ?? [], level),
    maxSpellLevel: thirdCasterMaxSpellLevel(level),
    grimoireSize: null,
  };
}
