import { getSpell, SPELL_SCHOOL_LABELS } from './index.js';
import { thirdCasterAllowsSpell } from './class-lists.js';
import {
  classSpellcastingLimits,
  thirdCasterSpellcastingLimits,
  type SpellcastingLimits,
} from './class-tables.js';
import { SPELL_CLASS_KEYS, type SpellClassKey } from './types.js';

/**
 * Livro de magias da ficha (Prompt 6.2).
 *
 * Valida a seleção de magias de UMA classe contra o PHB 2014: a magia existe no
 * catálogo, pertence à lista da classe, respeita o nível máximo conjurável e os
 * limites de truques/conhecidas/preparadas — tudo POR CLASSE (no multiclasse os
 * limites nunca são somados). Cavaleiro Arcano e Trapaceiro Arcano usam a lista
 * do Mago com a restrição de escola da subclasse.
 *
 * Não conjura, não gasta espaço e não altera tabelas de espaços.
 */

/** Uma magia escolhida (id do catálogo + se está preparada). */
export interface SpellbookSelection {
  key: string;
  prepared: boolean;
}

/** Magia já resolvida contra o catálogo, pronta para virar estado de ficha. */
export interface ResolvedSpell {
  key: string;
  name: string;
  level: number;
  school: string;
  prepared: boolean;
  description: string;
}

export interface SpellbookContext {
  classKey: string;
  className: string;
  /** Id da subclasse (ex.: 'eldritch-knight'); null quando não há. */
  subclassId: string | null;
  /** Nível NAQUELA classe. */
  classLevel: number;
  /** Limite de preparadas (de `preparedSpellCountFor`); null = não prepara. */
  preparedCount: number | null;
}

export interface SpellbookResult {
  error: string | null;
  spells: ResolvedSpell[];
}

const THIRD_CASTER_IDS: Record<string, true> = {
  'eldritch-knight': true,
  'arcane-trickster': true,
};

/** Limites da classe/subclasse; null quando ela não conjura pelo catálogo. */
function limitsFor(context: SpellbookContext): SpellcastingLimits | null {
  if (context.subclassId !== null && context.subclassId in THIRD_CASTER_IDS) {
    return thirdCasterSpellcastingLimits(context.subclassId, context.classLevel);
  }
  if ((SPELL_CLASS_KEYS as readonly string[]).includes(context.classKey)) {
    return classSpellcastingLimits(context.classKey as SpellClassKey, context.classLevel);
  }
  return null;
}

/** A classe/subclasse conhece a magia (lista do PHB)? */
function classKnowsSpell(context: SpellbookContext, key: string): boolean {
  const spell = getSpell(key);
  if (!spell) return false;
  if (context.subclassId && context.subclassId in THIRD_CASTER_IDS) {
    return spell.classes.includes('wizard');
  }
  return (spell.classes as readonly string[]).includes(context.classKey);
}

/**
 * Valida a seleção de uma classe e devolve as magias resolvidas.
 * `error` é uma mensagem amigável (null quando tudo passa).
 */
export function validateSpellbook(
  context: SpellbookContext,
  selections: readonly SpellbookSelection[],
): SpellbookResult {
  const limits = limitsFor(context);
  if (!limits) {
    return {
      error: `${context.className} não conjura magias pelo catálogo.`,
      spells: [],
    };
  }

  const isThirdCaster = context.subclassId !== null && context.subclassId in THIRD_CASTER_IDS;
  const seen = new Set<string>();
  const resolved: ResolvedSpell[] = [];

  for (const selection of selections) {
    const key = selection.key.trim();
    const spell = getSpell(key);

    if (!spell) {
      return { error: `Magia desconhecida: ${key}.`, spells: [] };
    }
    if (seen.has(key)) {
      return { error: `A magia ${spell.namePt} foi escolhida mais de uma vez.`, spells: [] };
    }
    seen.add(key);

    if (!classKnowsSpell(context, key)) {
      const listName = isThirdCaster ? 'Mago' : context.className;
      return {
        error: `${spell.namePt} não está na lista de magias de ${listName}.`,
        spells: [],
      };
    }

    if (spell.level > limits.maxSpellLevel) {
      return {
        error: `${spell.namePt} é de ${spell.level}º nível, acima do máximo conjurável (${limits.maxSpellLevel}º) de ${context.className}.`,
        spells: [],
      };
    }

    if (isThirdCaster && !thirdCasterAllowsSpell(context.subclassId!, spell.school, context.classLevel)) {
      const schools = THIRD_CASTER_SCHOOL_LABELS[context.subclassId!] ?? 'as escolas da subclasse';
      return {
        error: `${spell.namePt} não é permitida para ${context.className}: só ${schools} (ou qualquer escola nos níveis 8, 14 e 20).`,
        spells: [],
      };
    }

    resolved.push({
      key,
      name: spell.namePt,
      level: spell.level,
      school: SPELL_SCHOOL_LABELS[spell.school],
      prepared: selection.prepared,
      description: spell.description.slice(0, 2000),
    });
  }

  const cantrips = resolved.filter((spell) => spell.level === 0);
  const leveled = resolved.filter((spell) => spell.level > 0);

  if (cantrips.length > limits.cantripsKnown) {
    return {
      error: `${context.className} conhece no máximo ${limits.cantripsKnown} truque(s) neste nível.`,
      spells: [],
    };
  }

  // Classes de lista fixa: limite = magias conhecidas.
  if (limits.spellsKnown !== null && leveled.length > limits.spellsKnown) {
    return {
      error: `${context.className} conhece no máximo ${limits.spellsKnown} magia(s) neste nível.`,
      spells: [],
    };
  }

  // Mago: grimório próprio + o subconjunto preparado do dia.
  if (limits.grimoireSize !== null && leveled.length > limits.grimoireSize) {
    return {
      error: `O grimório do Mago tem no máximo ${limits.grimoireSize} magia(s) neste nível.`,
      spells: [],
    };
  }

  const preparedLimit = context.preparedCount;
  if (preparedLimit !== null && preparedLimit > 0) {
    const preparedCount = resolved.filter((spell) => spell.prepared).length;
    if (preparedCount > preparedLimit) {
      return {
        error: `${context.className} prepara no máximo ${preparedLimit} magia(s) neste nível.`,
        spells: [],
      };
    }
  }

  return { error: null, spells: resolved };
}

const THIRD_CASTER_SCHOOL_LABELS: Record<string, string> = {
  'eldritch-knight': 'Abjuração e Evocação',
  'arcane-trickster': 'Encantamento e Ilusão',
};
