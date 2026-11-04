import type { AbilityKey } from '../dnd5e.js';
import { effectiveSpellcasting, findSubclass, getClassDefinition } from '../classes.js';
import { classSpellcastingLimits, thirdCasterMaxSpellLevel } from './class-tables.js';
import { oathSpellKeys } from './oath-spells.js';
import { allSpells, getSpell } from './index.js';
import type { SpellClassKey } from './types.js';

/**
 * FASE 6.6F — SPELL REPERTOIRE (domínio PURO).
 *
 * Até a 6.6E a pergunta era "a engine sabe executar esta magia?". A partir daqui
 * existe uma segunda pergunta, independente: "este conjurador PODE legalmente
 * conjurar esta magia por ESTA fonte?". Executável ≠ disponível.
 *
 * Este arquivo responde a segunda pergunta sem I/O: modos de repertório por
 * classe, limite de preparação, nível máximo de magia POR FONTE (nunca pelo pool
 * multiclasse) e a classificação de disponibilidade de uma magia.
 *
 * REGRA DE OURO do PHB 2014 (p.164): known/prepared são decididos POR CLASSE,
 * como se o personagem fosse single-class NAQUELA classe. O nível de conjurador
 * combinado decide apenas ESPAÇOS. Wizard 3 / Cleric 2 tem slot combinado de 3º
 * nível, mas nenhuma das duas fontes prepara magia de 3º — o slot superior serve
 * para UPCAST de magia menor.
 */

/** Como uma fonte mantém as magias que pode conjurar. */
export type SpellRepertoireMode =
  /** Lista fixa de conhecidas (Bardo, Patrulheiro, Feiticeiro, Bruxo). */
  | 'known'
  /** Prepara um subconjunto da lista da classe (Clérigo, Druida, Paladino). */
  | 'prepared-list'
  /** Grimório próprio + subconjunto preparado (Mago). */
  | 'spellbook-prepared'
  /** Repertório DECLARADO pelo statblock (NPC/criatura). */
  | 'explicit';

/** Fórmula do limite MANUAL de preparadas (always-prepared não conta). */
export type PreparationFormula = 'level-plus-ability' | 'half-level-plus-ability';

export interface SpellRepertoireDefinition {
  mode: SpellRepertoireMode;
  /** Spell List do PHB usada na elegibilidade (`null` em `explicit`). */
  spellListKey: SpellClassKey | null;
  /** Fórmula do limite manual; `null` quando a fonte não prepara. */
  preparation: PreparationFormula | null;
  /** Truques são sempre CONHECIDOS (nunca preparados) nesta engine. */
  cantripMode: 'known';
}

/** Fontes de lista fixa (PHB 2014). */
const KNOWN_MODE_CLASSES: Record<string, true> = {
  bard: true,
  ranger: true,
  sorcerer: true,
  warlock: true,
};

/** Fontes que PREPARAM a partir da lista da classe (PHB 2014). */
const PREPARED_MODE_CLASSES: Record<string, true> = {
  cleric: true,
  druid: true,
  paladin: true,
};

/** Terço-conjuradores: usam a lista do Mago e a tabela própria (3º nível+). */
const THIRD_CASTER_IDS: Record<string, true> = {
  'eldritch-knight': true,
  'arcane-trickster': true,
};

/** A própria classKey do Mago (a única de grimório). */
const WIZARD_CLASS_KEY = 'wizard';

/**
 * Definição de repertório da fonte. `null` = a fonte não conjura pelo catálogo
 * (Guerreiro/Ladino comuns, Bárbaro...).
 *
 * Cavaleiro Arcano e Trapaceiro Arcano são `known` porque as magias escolhidas
 * ficam PERSISTIDAS na ficha (a restrição de escola é validada na aquisição, em
 * `validateSpellbook`); o runtime só lê o que foi persistido — nenhuma regra de
 * Abjuração/Evocação é espalhada pelo serviço de conjuração.
 */
export function repertoireDefinitionFor(input: {
  classKey: string;
  subclassId?: string | null;
}): SpellRepertoireDefinition | null {
  const { classKey } = input;
  const subclassId = input.subclassId ?? '';

  if (subclassId && subclassId in THIRD_CASTER_IDS) {
    return {
      mode: 'known',
      spellListKey: WIZARD_CLASS_KEY,
      preparation: null,
      cantripMode: 'known',
    };
  }
  if (classKey === WIZARD_CLASS_KEY) {
    return {
      mode: 'spellbook-prepared',
      spellListKey: WIZARD_CLASS_KEY,
      preparation: 'level-plus-ability',
      cantripMode: 'known',
    };
  }
  if (classKey in PREPARED_MODE_CLASSES) {
    return {
      mode: 'prepared-list',
      spellListKey: classKey as SpellClassKey,
      // Paladino (meio-conjurador) prepara floor(nível/2) + CAR.
      preparation: classKey === 'paladin' ? 'half-level-plus-ability' : 'level-plus-ability',
      cantripMode: 'known',
    };
  }
  if (classKey in KNOWN_MODE_CLASSES) {
    return {
      mode: 'known',
      spellListKey: classKey as SpellClassKey,
      preparation: null,
      cantripMode: 'known',
    };
  }
  return null;
}

/**
 * Nível MÁXIMO de magia que ESTA fonte acessa, como se fosse single-class.
 *
 * Proibido usar o maior espaço do pool multiclasse: slot de 3º não abre magia de
 * 3º para uma fonte que só alcança o 2º.
 */
export function maxSpellLevelForSource(input: {
  classKey: string;
  subclassId?: string | null;
  level: number;
}): number {
  const subclassId = input.subclassId ?? '';
  if (subclassId && subclassId in THIRD_CASTER_IDS) {
    return thirdCasterMaxSpellLevel(input.level);
  }
  if (!(input.classKey in KNOWN_MODE_CLASSES) && !(input.classKey in PREPARED_MODE_CLASSES) && input.classKey !== WIZARD_CLASS_KEY) {
    return 0;
  }
  return classSpellcastingLimits(input.classKey as SpellClassKey, input.level).maxSpellLevel;
}

/**
 * Limite de magias preparadas MANUALMENTE.
 *
 * Piso de 1 sempre (Clérigo 1 com SAB 8: 1 + (-1) = 0, mas o livro permite 1).
 * Meio-conjurador só conjura a partir do 2º nível da classe (0 antes disso).
 */
export function manualPreparationLimit(input: {
  formula: PreparationFormula;
  level: number;
  abilityModifier: number;
}): number {
  const level = Math.max(0, Math.floor(input.level));
  if (input.formula === 'half-level-plus-ability') {
    if (level < 2) return 0;
    return Math.max(1, Math.floor(level / 2) + input.abilityModifier);
  }
  return Math.max(1, level + input.abilityModifier);
}

/**
 * Magias SEMPRE PREPARADAS concedidas pela subclasse (juramentos do Paladino).
 *
 * São DERIVADAS do nível da classe pai: não entram em `spells.list`, não contam
 * no limite manual e não precisam de plano. As magias de DOMÍNIO do Clérigo
 * continuam como texto no catálogo (limitação conhecida da 6.6F).
 */
export function alwaysPreparedSpellIds(input: {
  classKey: string;
  subclassId?: string | null;
  classLevel: number;
}): string[] {
  const definition = getClassDefinition(input.classKey);
  if (!definition) return [];
  const subclass = findSubclass(definition, input.subclassId ?? '');
  return oathSpellKeys(subclass?.oathSpells, input.classLevel);
}

/* -------------------------------------------------------------------------- */
/* Autorização da conjuração                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Classificação da disponibilidade de UMA magia em UMA fonte.
 *
 * Os três primeiros (`cantrip-known`, `known`, `prepared`/`always-prepared`)
 * são CONJURÁVEIS. `recorded-unprepared` existe para o Mago e NÃO é conjurável
 * nesta fase (Ritual Casting é fase futura).
 */
export type SpellAvailabilityKind =
  /** Truque conhecido: não prepara e não gasta espaço. */
  | 'cantrip-known'
  /** Magia de nível conhecida (Bardo/Patrulheiro/Feiticeiro/Bruxo/terço). */
  | 'known'
  /** Preparação ACTIVE (o plano NUNCA autoriza). */
  | 'prepared'
  /** Concedida pela subclasse (juramento): sempre preparada, fora do limite. */
  | 'always-prepared'
  /** Repertório declarado pelo statblock do NPC. */
  | 'explicit'
  /** Mago: registrada no grimório, mas não preparada hoje. */
  | 'recorded-unprepared'
  | 'not-known'
  | 'not-prepared'
  | 'not-recorded'
  | 'not-on-source-list'
  | 'level-too-high'
  | 'source-not-supported';

/** Disponibilidades que PERMITEM conjurar pelo fluxo normal. */
export const CASTABLE_AVAILABILITY: readonly SpellAvailabilityKind[] = [
  'cantrip-known',
  'known',
  'prepared',
  'always-prepared',
  'explicit',
];

export function isCastableAvailability(kind: SpellAvailabilityKind): boolean {
  return CASTABLE_AVAILABILITY.includes(kind);
}

/** Entrada de repertório já lida da ficha (nunca decide sozinha). */
export interface SpellRepertoireEntryView {
  spellId: string;
  level: number;
  /** A magia pertence à Spell List da fonte (ou é concedida por feature). */
  onSourceList: boolean;
  /** `known` do caster de lista fixa (e do terço-conjurador). */
  known: boolean;
  /** Só grimório do Mago: a magia está REGISTRADA. */
  recorded: boolean;
  /** Preparação ACTIVE — a única que autoriza. */
  preparedActive: boolean;
  /** Preparação PLANEJADA (informativa: nunca autoriza). */
  preparedPlanned: boolean;
}

export interface SpellAvailabilityResult {
  eligible: boolean;
  availabilityKind: SpellAvailabilityKind;
  /** Mensagem pronta para o erro HTTP (null quando elegível). */
  reason: string | null;
}

/**
 * Classifica a disponibilidade da magia nesta fonte. PURA: toda a leitura de
 * banco acontece antes (ver `spell-authorization.service.ts`).
 *
 * Ordem deliberada: always-prepared → nível → lista → truque → modo.
 * `monotonously`: uma linha persistida CORROMPIDA (ex.: Mago com Bless) nunca
 * autoriza só por existir — a Spell List continua sendo checada.
 */
export function resolveSpellAvailability(input: {
  definition: SpellRepertoireDefinition;
  spell: { id: string; name: string; level: number };
  entry: SpellRepertoireEntryView | null;
  /** Nível máximo de magia da própria fonte. */
  maxSpellLevel: number;
  /** Concedida por subclasse/feature (juramento). */
  alwaysPrepared: boolean;
}): SpellAvailabilityResult {
  const { definition, spell, entry, maxSpellLevel, alwaysPrepared } = input;

  if (alwaysPrepared) {
    return { eligible: true, availabilityKind: 'always-prepared', reason: null };
  }

  if (spell.level > maxSpellLevel) {
    return {
      eligible: false,
      availabilityKind: 'level-too-high',
      reason: `${spell.name} é de ${spell.level}º nível, acima do acesso desta fonte (${maxSpellLevel}º).`,
    };
  }

  if (definition.mode === 'explicit') {
    // Statblock: o repertório DECLARADO é a única autoridade — sem lista de
    // classe e sem inferência por ND/CR.
    if (!entry) {
      return {
        eligible: false,
        availabilityKind: 'not-known',
        reason: `${spell.name} não está no repertório deste NPC.`,
      };
    }
    return { eligible: true, availabilityKind: 'explicit', reason: null };
  }

  if (!entry || !entry.onSourceList) {
    return {
      eligible: false,
      availabilityKind: 'not-on-source-list',
      reason: `${spell.name} não está na lista de magias desta fonte.`,
    };
  }

  // Truque: conhecido basta (nunca preparado, nunca gasta espaço).
  if (spell.level === 0) {
    return entry.known
      ? { eligible: true, availabilityKind: 'cantrip-known', reason: null }
      : {
          eligible: false,
          availabilityKind: 'not-known',
          reason: `Este truque não é conhecido nesta fonte.`,
        };
  }

  if (definition.mode === 'known') {
    return entry.known
      ? { eligible: true, availabilityKind: 'known', reason: null }
      : {
          eligible: false,
          availabilityKind: 'not-known',
          reason: `${spell.name} não está entre as magias conhecidas desta fonte.`,
        };
  }

  if (definition.mode === 'spellbook-prepared') {
    if (!entry.recorded) {
      return {
        eligible: false,
        availabilityKind: 'not-recorded',
        reason: `${spell.name} não está registrada no grimório deste personagem.`,
      };
    }
    return entry.preparedActive
      ? { eligible: true, availabilityKind: 'prepared', reason: null }
      : {
          eligible: false,
          availabilityKind: 'recorded-unprepared',
          reason: `${spell.name} está no grimório, mas não está preparada agora.`,
        };
  }

  return entry.preparedActive
    ? { eligible: true, availabilityKind: 'prepared', reason: null }
    : {
        eligible: false,
        availabilityKind: 'not-prepared',
        reason: `${spell.name} não está preparada agora.`,
      };
}

/* -------------------------------------------------------------------------- */
/* Validação do PLANO de preparação                                            */
/* -------------------------------------------------------------------------- */

/** Uma magia planejada, já resolvida contra o catálogo. */
export interface PlannedSpellCandidate {
  spellId: string;
  level: number;
  onSourceList: boolean;
  /** Só grimório: a magia está registrada. */
  recorded: boolean;
}

/**
 * Valida o CONJUNTO planejado (o que o Descanso Longo aplicará).
 *
 * O cliente manda só os IDs: limite, lista, nível e grimório são derivados aqui.
 * Truque NÃO entra em preparação (é conhecido, não preparado) — recusar é mais
 * honesto do que ignorar em silêncio.
 */
export function planPreparationProblem(input: {
  definition: SpellRepertoireDefinition;
  spells: readonly PlannedSpellCandidate[];
  spellIds: readonly string[];
  maxSpellLevel: number;
  manualLimit: number;
}): string | null {
  const { definition, spells, spellIds, maxSpellLevel, manualLimit } = input;
  const byId = new Map(spells.map((spell) => [spell.spellId, spell]));
  const seen = new Set<string>();

  for (const spellId of spellIds) {
    if (seen.has(spellId)) return 'Uma magia foi planejada mais de uma vez.';
    seen.add(spellId);

    const spell = byId.get(spellId);
    if (!spell) return 'Magia desconhecida no catálogo.';
    if (spell.level === 0) {
      return 'Truques são conhecidos e não entram na preparação.';
    }
    if (spell.level > maxSpellLevel) {
      return `Esta fonte não acessa magias de ${spell.level}º nível (máximo ${maxSpellLevel}º).`;
    }
    if (!spell.onSourceList) {
      return 'Uma das magias não pertence à lista desta fonte.';
    }
    if (definition.mode === 'spellbook-prepared' && !spell.recorded) {
      return 'O Mago só prepara magias registradas no grimório.';
    }
  }

  if (spellIds.length > manualLimit) {
    return `Esta fonte prepara no máximo ${manualLimit} magia(s) manualmente.`;
  }
  return null;
}

/**
 * Candidatas ao PLANO de preparação.
 *
 * `prepared-list` (Clérigo/Druida/Paladino): TODA a lista da classe dentro do
 * nível máximo da fonte — o livro permite preparar qualquer magia da lista, não
 * só as que já estavam na ficha.
 * `spellbook-prepared` (Mago): SÓ o que está registrado no grimório.
 */
export function planCandidates(input: {
  definition: SpellRepertoireDefinition;
  maxSpellLevel: number;
  /** Linhas já persistidas (para o grimório do Mago). */
  rows?: readonly { spellId: string; level: number }[];
}): PlannedSpellCandidate[] {
  const { definition, maxSpellLevel } = input;
  if (definition.mode === 'spellbook-prepared') {
    return (input.rows ?? []).flatMap((row) => {
      if (row.level <= 0 || row.level > maxSpellLevel) return [];
      return [
        { spellId: row.spellId, level: row.level, onSourceList: true, recorded: true },
      ];
    });
  }
  if (definition.mode !== 'prepared-list' || !definition.spellListKey) return [];
  const listKey = definition.spellListKey;
  return allSpells().flatMap((spell) => {
    if (spell.level <= 0 || spell.level > maxSpellLevel) return [];
    if (!(spell.classes as readonly string[]).includes(listKey)) return [];
    return [
      { spellId: spell.id, level: spell.level, onSourceList: true, recorded: true },
    ];
  });
}

/** Rótulo de apresentação do modo (nunca identidade). */
export const REPERTOIRE_MODE_LABELS: Record<SpellRepertoireMode, string> = {
  known: 'Conhecidas',
  'prepared-list': 'Preparadas da lista',
  'spellbook-prepared': 'Grimório + preparadas',
  explicit: 'Repertório do statblock',
};

/** Resumo seguro para a UI/observabilidade. */
export function repertoireSummary(definition: SpellRepertoireDefinition) {
  return {
    mode: definition.mode,
    label: REPERTOIRE_MODE_LABELS[definition.mode],
    spellListKey: definition.spellListKey,
    preparation: definition.preparation,
    cantripMode: definition.cantripMode,
  };
}

/** Atributo de conjuração declarado pela classe (nunca escolhido no cliente). */
export function spellcastingAbilityOf(input: {
  classKey: string;
  subclassId?: string | null;
}): AbilityKey | null {
  const entry = { classKey: input.classKey, subclass: input.subclassId ?? '', level: 1 };
  const config = effectiveSpellcasting(entry);
  return config?.ability ?? null;
}

/** A magia pertence à Spell List daquela chave de classe? */
export function spellOnList(spellId: string, listKey: SpellClassKey): boolean {
  const spell = getSpell(spellId);
  if (!spell) return false;
  return (spell.classes as readonly string[]).includes(listKey);
}
