import { abilityModifier, type AbilityKey } from '../dnd5e.js';
import { barbarian } from './barbarian.js';
import { bard } from './bard.js';
import { cleric } from './cleric.js';
import { druid } from './druid.js';
import { fighter } from './fighter.js';
import { rogue } from './rogue.js';
import { wizard } from './wizard.js';
import { monk } from './monk.js';
import { paladin } from './paladin.js';
import { ranger } from './ranger.js';
import { warlock } from './warlock.js';
import { sorcerer } from './sorcerer.js';
import type {
  ClassDefinition,
  ClassFeatureDefinition,
  ClassFeatureEffect,
  ClassFeatureResource,
  ClassSummary,
  SpellLearning,
  SpellcastingType,
  SubclassDefinition,
} from './types.js';

export * from './types.js';

/**
 * As 12 classes. Os níveis de subclasse seguem o PHB 2014:
 * Clérigo, Bruxo e Feiticeiro escolhem no nível 1; Druida e Mago no 2;
 * as demais no 3.
 */
export const CLASS_DEFINITIONS: readonly ClassDefinition[] = [
  barbarian,
  bard,
  cleric,
  druid,
  fighter,
  rogue,
  wizard,
  monk,
  paladin,
  ranger,
  warlock,
  sorcerer,
];

const CLASS_BY_KEY: ReadonlyMap<string, ClassDefinition> = new Map(
  CLASS_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** Converte uma definição no resumo usado pelo seletor. */
export function toClassSummary(definition: ClassDefinition): ClassSummary {
  return {
    key: definition.key,
    name: definition.name,
    hitDie: definition.hitDie,
    subclassLevel: definition.subclassLevel,
    spellcastingType: definition.spellcasting.type,
  };
}

/** Catálogo resumido das 12 classes (para o seletor da ficha). */
export const CLASS_CATALOG: ClassSummary[] = CLASS_DEFINITIONS.map(toClassSummary);

/** Busca uma classe pela chave canônica. */
export function getClassDefinition(key: string): ClassDefinition | null {
  return CLASS_BY_KEY.get(key.trim()) ?? null;
}

/** Busca a subclasse pelo nome ou pelo id. */
export function findSubclass(
  definition: ClassDefinition | null,
  subclass: string,
): SubclassDefinition | null {
  if (!definition || !subclass) return null;
  const key = subclass.trim();
  return definition.subclasses.find((item) => item.id === key || item.name === key) ?? null;
}

/**
 * Conjuração efetiva de uma entrada de classe (multiclasse): a subclasse pode
 * sobrepor a configuração da classe base (ex.: Trapaceiro Arcano e Cavaleiro
 * Arcano são terço-conjuradores). A mesma regra vale para o nível de
 * conjurador, os espaços de Pacto e o DTO da ficha.
 */
export function effectiveSpellcasting(
  entry: ClassEntry,
): ClassDefinition['spellcasting'] | null {
  const definition = getClassDefinition(entry.classKey);
  if (!definition) return null;
  const subclassDefinition = findSubclass(definition, entry.subclass);
  return subclassDefinition?.spellcasting ?? definition.spellcasting;
}

/** Uma feature já liberada para o personagem (classe ou subclasse). */
export interface ActiveClassFeature extends ClassFeatureDefinition {
  source: 'class' | 'subclass';
  /** Nome da subclasse, quando vier dela. */
  subclassName?: string;
  /** Chave da classe de origem (preenchida no modo multiclasse). */
  classKey?: string;
  /** Nível do personagem NAQUELA classe (usado nas escalas por nível). */
  classLevel?: number;
}

/**
 * Features efetivamente disponíveis: as da classe até o nível atual e, quando
 * houver subclasse escolhida, as dela até o nível atual.
 */
export function getActiveClassFeatures(
  definition: ClassDefinition | null,
  level: number,
  subclass: string,
): ActiveClassFeature[] {
  if (!definition) return [];

  const fromClass: ActiveClassFeature[] = definition.features
    .filter((feature) => feature.level <= level)
    .map((feature) => ({ ...feature, source: 'class' }));

  const subclassDefinition = findSubclass(definition, subclass);
  const fromSubclass: ActiveClassFeature[] = subclassDefinition
    ? subclassDefinition.features
        .filter((feature) => feature.level <= level)
        .map((feature) => ({
          ...feature,
          source: 'subclass' as const,
          subclassName: subclassDefinition.name,
        }))
    : [];

  return [...fromClass, ...fromSubclass].sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  );
}

/** Dados de Ataque Furtivo do ladino: 1d6 no nível 1 e +1d6 a cada 2 níveis. */
export function sneakAttackDice(level: number): number {
  return Math.max(1, Math.ceil(level / 2));
}

/** Efeitos de uma feature, aceitando tanto `effect` quanto `effects`. */
export function featureEffectsOf(feature: ClassFeatureDefinition): ClassFeatureEffect[] {
  if (feature.effects && feature.effects.length > 0) return feature.effects;
  return feature.effect ? [feature.effect] : [];
}

/** Valor escalonado por nível: usa o maior nível menor ou igual ao atual. */
export function effectValueAtLevel(
  effect: ClassFeatureEffect,
  level: number,
): number | null {
  if (effect.scaling && effect.scaling.length > 0) {
    const sorted = [...effect.scaling].sort((a, b) => a.level - b.level);
    let value: number | null = null;
    for (const step of sorted) if (step.level <= level) value = step.value;
    return value;
  }
  return effect.value ?? null;
}

/** Máximo de um recurso no nível atual (-1 = ilimitado). */
export function resourceMaxAtLevel(
  resource: ClassFeatureResource,
  level: number,
  abilities?: Record<AbilityKey, number>,
): number {
  let value: number;
  if (resource.perLevel) {
    value = Math.max(0, level) * (resource.perLevelMultiplier ?? 1);
  } else if (resource.maxByLevel && resource.maxByLevel.length > 0) {
    const sorted = [...resource.maxByLevel].sort((a, b) => a.level - b.level);
    value = sorted[0]?.value ?? 0;
    for (const step of sorted) if (step.level <= level) value = step.value;
  } else {
    value = resource.max ?? 0;
  }
  if (resource.abilityMod && abilities) {
    value += abilityModifier(abilities[resource.abilityMod]);
  }
  return value;
}

/** Total de espaços de Expertise concedidos pelas features ativas. */
export function expertiseSlots(features: ActiveClassFeature[]): number {
  return features.reduce(
    (sum, feature) =>
      sum +
      featureEffectsOf(feature).reduce(
        (inner, effect) => inner + (effect.type === 'expertise' ? (effect.value ?? 0) : 0),
        0,
      ),
    0,
  );
}

/** Estado de runtime da classe (toggles ativos e usos gastos). */
export interface ClassState {
  active: string[];
  used: Record<string, number>;
}

/** Lê/normaliza o estado de classe vindo do JSONB. */
export function normalizeClassState(input: unknown): ClassState {
  const source = (input ?? {}) as { active?: unknown; used?: unknown };

  const active = Array.isArray(source.active)
    ? source.active.filter((item): item is string => typeof item === 'string')
    : [];

  const used: Record<string, number> = {};
  if (source.used && typeof source.used === 'object') {
    for (const [key, value] of Object.entries(source.used as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        used[key] = Math.floor(value);
      }
    }
  }

  return { active, used };
}

/** Um toggle ativável (ex.: Fúria, Ataque Descuidado). */
export interface ActiveToggle {
  id: string;
  name: string;
  active: boolean;
  /** Recurso consumido ao ativar (ex.: 'rage'); nulo quando não há custo. */
  resourceId: string | null;
}

/** Um recurso com contador (ex.: usos de Fúria por descanso longo). */
export interface ActiveResource {
  id: string;
  name: string;
  recharge: 'short' | 'long' | 'none';
  max: number;
  used: number;
  remaining: number;
  unlimited: boolean;
}

/** Ajustes calculados a partir das features ativas e do estado de classe. */
export interface ClassAdjustments {
  toggles: ActiveToggle[];
  resources: ActiveResource[];
  activeToggleIds: string[];
  /** Bônus de dano corpo a corpo enquanto os toggles exigidos estiverem ativos. */
  meleeDamageBonus: number;
  /** Tipos de dano resistidos (ex.: contundente/perfurante/cortante em fúria). */
  resistances: string[];
  /** Bônus de deslocamento passivo (ex.: Movimento Rápido). */
  speedBonus: number;
  /** Dados de dano extras em críticos (ex.: Crítico Brutal). */
  critExtraDice: number;
  unarmoredDefense: boolean;
  /** Atributo somado à CA na Defesa sem Armadura (null quando não há). */
  unarmoredDefenseAbility: AbilityKey | null;
  /** Base da CA na Defesa sem Armadura (10 no Bárbaro/Monge; 13 na Linhagem Dracônica). */
  unarmoredDefenseBase: number;
  /** Faces do dado de dano desarmado de Artes Marciais (0 = sem a feature). */
  martialArtsDie: number;
  /** PV extras concedidos por features (ex.: +1 por nível de feiticeiro dracônico). */
  hpBonus: number;
  /** Limite de CR da Forma Selvagem (null = sem a feature). 0.25 = CR 1/4. */
  wildShapeCr: number | null;
  /** Forma Selvagem já permite deslocamento de voo (a partir do 8º nível). */
  wildShapeFlying: boolean;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  abilityCaps: Partial<Record<AbilityKey, number>>;
}

/**
 * Reúne os ajustes mecânicos das features ativas: toggles, recursos, bônus de
 * dano, resistências, deslocamento, dados de crítico e bônus de atributo.
 */
export function computeClassAdjustments(
  features: ActiveClassFeature[],
  level: number,
  state: ClassState,
  abilities?: Record<AbilityKey, number>,
): ClassAdjustments {
  const activeSet = new Set(state.active);
  const toggles: ActiveToggle[] = [];
  const resources: ActiveResource[] = [];
  let meleeDamageBonus = 0;
  const resistances = new Set<string>();
  let speedBonus = 0;
  let critExtraDice = 0;
  let unarmoredDefense = false;
  let unarmoredDefenseAbility: AbilityKey | null = null;
  let unarmoredDefenseBase = 10;
  let martialArtsDie = 0;
  let hpBonus = 0;
  let baseWildShapeCr = 0;
  let overrideWildShapeCr: number | null = null;
  const abilityBonuses: Partial<Record<AbilityKey, number>> = {};
  const abilityCaps: Partial<Record<AbilityKey, number>> = {};

  for (const feature of features) {
    for (const effect of featureEffectsOf(feature)) {
      const effectId = effect.id ?? feature.id;

      switch (effect.type) {
        case 'toggle':
          toggles.push({
            id: effectId,
            name: effect.name ?? feature.name,
            active: activeSet.has(effectId),
            resourceId: effect.resourceId ?? null,
          });
          break;
        case 'resource': {
          const resource = effect.resource;
          if (!resource) break;
          const max = resourceMaxAtLevel(resource, level, abilities);
          const used = Math.max(0, state.used[effectId] ?? 0);
          resources.push({
            id: effectId,
            name: effect.name ?? resource.name,
            recharge: resource.recharge,
            max,
            used,
            remaining: max < 0 ? -1 : Math.max(0, max - used),
            unlimited: max < 0,
          });
          break;
        }
        case 'damageBonus':
          if (effect.requiresActive && !activeSet.has(effect.requiresActive)) break;
          meleeDamageBonus += effectValueAtLevel(effect, level) ?? 0;
          break;
        case 'resistance':
          if (effect.requiresActive && !activeSet.has(effect.requiresActive)) break;
          for (const type of effect.damageTypes ?? []) resistances.add(type);
          break;
        case 'speed':
          speedBonus += effectValueAtLevel(effect, level) ?? 0;
          break;
        case 'critDice':
          critExtraDice = Math.max(critExtraDice, effectValueAtLevel(effect, level) ?? 0);
          break;
        case 'unarmoredDefense':
          unarmoredDefense = true;
          if (effect.unarmoredDefenseAbility) unarmoredDefenseAbility = effect.unarmoredDefenseAbility;
          unarmoredDefenseBase = Math.max(unarmoredDefenseBase, effect.base ?? 10);
          break;
        case 'martialArts':
          martialArtsDie = Math.max(martialArtsDie, effectValueAtLevel(effect, level) ?? 0);
          break;
        case 'hpBonus': {
          const value = effectValueAtLevel(effect, level) ?? 0;
          hpBonus += value * (effect.perLevel ? level : 1);
          break;
        }
        case 'wildShape': {
          const value = effectValueAtLevel(effect, level) ?? 0;
          if (effect.override) overrideWildShapeCr = Math.max(overrideWildShapeCr ?? 0, value);
          else baseWildShapeCr = Math.max(baseWildShapeCr, value);
          break;
        }
        case 'abilityBonus': {
          const ability = effect.ability;
          if (!ability) break;
          abilityBonuses[ability] = (abilityBonuses[ability] ?? 0) + (effect.value ?? 0);
          if (effect.max !== undefined) abilityCaps[ability] = effect.max;
          break;
        }
        default:
          break;
      }
    }
  }

  // Liga cada toggle sem recurso explícito ao recurso de mesmo id (ex.: Fúria).
  const resourceIds = new Set(resources.map((resource) => resource.id));
  for (const toggle of toggles) {
    if (toggle.resourceId === null && resourceIds.has(toggle.id)) toggle.resourceId = toggle.id;
  }

  return {
    toggles,
    resources,
    activeToggleIds: toggles.filter((toggle) => toggle.active).map((toggle) => toggle.id),
    meleeDamageBonus,
    resistances: [...resistances],
    speedBonus,
    critExtraDice,
    unarmoredDefense,
    unarmoredDefenseAbility,
    unarmoredDefenseBase,
    martialArtsDie,
    hpBonus,
    wildShapeCr: overrideWildShapeCr ?? (baseWildShapeCr > 0 ? baseWildShapeCr : null),
    wildShapeFlying: (overrideWildShapeCr ?? baseWildShapeCr) > 0 && level >= 8,
    abilityBonuses,
    abilityCaps,
  };
}

/**
 * Força as salvaguardas com proficiência da classe, que são fixas e nunca
 * podem ser desmarcadas. As demais salvaguardas permanecem como estavam.
 */
export function applySaveProficiencies(
  saves: Record<AbilityKey, boolean>,
  abilities: readonly AbilityKey[],
): Record<AbilityKey, boolean> {
  const next = { ...saves };
  for (const ability of abilities) next[ability] = true;
  return next;
}

export function applyClassSavingThrows(
  saves: Record<AbilityKey, boolean>,
  definition: ClassDefinition | null,
): Record<AbilityKey, boolean> {
  if (!definition) return saves;
  return applySaveProficiencies(saves, definition.savingThrows);
}

/** Rótulos do tipo de conjuração. */
export const SPELLCASTING_TYPE_LABELS: Record<SpellcastingType, string> = {
  none: 'Sem conjuração',
  full: 'Conjurador completo',
  half: 'Meio-conjurador',
  third: 'Terço-conjurador',
  pact: 'Magia de pacto',
};

/** Rótulos do modo de aprendizado de magias. */
export const SPELL_LEARNING_LABELS: Record<SpellLearning, string> = {
  known: 'Conhecidas',
  prepared: 'Preparadas',
  none: '—',
};

// ---------------------------------------------------------------------------
// Multiclasse (PHB 2014, capítulo 6)
//
// O personagem guarda uma LISTA de classes: `{ classKey, subclass, level }`.
// O nível é o nível NAQUELA classe; o nível total do personagem é a soma — é
// ele que determina bônus de proficiência, XP e o limite de 20.
// ---------------------------------------------------------------------------

/** Uma classe do personagem, com o nível específico dela. */
export interface ClassEntry {
  /** Chave canônica da classe (ex.: 'rogue'). */
  classKey: string;
  /** Subclasse escolhida ('' até o nível de escolha daquela classe). */
  subclass: string;
  /** Nível NAQUELA classe (começa em 1 quando ela entra). */
  level: number;
}

/** Quantas classes diferentes o personagem pode somar. */
export const MAX_CLASSES = 4;

/**
 * Pré-requisitos de atributo para ENTRAR numa classe (PHB 2014).
 * `all` exige todos os atributos; `any` exige pelo menos um deles.
 */
export const MULTICLASS_PREREQUISITES: Record<
  string,
  { all?: AbilityKey[]; any?: AbilityKey[] }
> = {
  barbarian: { all: ['strength'] },
  bard: { all: ['charisma'] },
  cleric: { all: ['wisdom'] },
  druid: { all: ['wisdom'] },
  fighter: { any: ['strength', 'dexterity'] },
  monk: { all: ['dexterity', 'wisdom'] },
  paladin: { all: ['strength', 'charisma'] },
  ranger: { all: ['dexterity', 'wisdom'] },
  rogue: { all: ['dexterity'] },
  sorcerer: { all: ['charisma'] },
  warlock: { all: ['charisma'] },
  wizard: { all: ['intelligence'] },
};

/** Atributo mínimo exigido para entrar numa classe. */
export const MULTICLASS_MINIMUM = 13;

const ABILITY_NAMES: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

/**
 * Atributos que FALTAM (abaixo de 13) para entrar na classe.
 * Vazio = pré-requisito atendido.
 */
export function multiclassMissingAbilities(
  classKey: string,
  abilities: Record<AbilityKey, number>,
): AbilityKey[] {
  const rule = MULTICLASS_PREREQUISITES[classKey.trim()];
  if (!rule) return [];

  const missing = (rule.all ?? []).filter(
    (ability) => abilities[ability] < MULTICLASS_MINIMUM,
  );

  // Em classes com alternativa (Guerreiro: Força OU Destreza), basta um deles.
  if (rule.any && rule.any.length > 0) {
    const ok = rule.any.some((ability) => abilities[ability] >= MULTICLASS_MINIMUM);
    if (!ok) missing.push(...rule.any);
  }

  return missing;
}

/** Texto pronto do motivo do bloqueio (ex.: "faltam Força 13 e Sabedoria 13"). */
export function multiclassMissingLabel(
  classKey: string,
  abilities: Record<AbilityKey, number>,
): string {
  const missing = multiclassMissingAbilities(classKey, abilities);
  if (missing.length === 0) return '';

  const names = missing.map((ability) => `${ABILITY_NAMES[ability]} 13`);
  return names.length === 1
    ? `faltam ${names[0]}`
    : `faltam ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Rótulo curto das classes com os níveis: "Bárbaro 3 / Ladino 2". */
export function classEntryLabel(entry: Pick<ClassEntry, 'classKey' | 'level'>): string {
  const definition = getClassDefinition(entry.classKey);
  if (!definition) return '';
  return `${definition.name} ${entry.level}`;
}

/** Nome composto de todas as classes ("Bárbaro 3 / Ladino 2"). */
export function classEntriesLabel(entries: ClassEntry[]): string {
  return entries.map(classEntryLabel).filter(Boolean).join(' / ');
}

/** Nível total do personagem: a soma dos níveis de todas as classes. */
export function totalCharacterLevel(entries: ClassEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.level, 0);
}

/** Lê/normaliza a lista de classes vinda do JSONB, descartando lixo. */
export function normalizeClassEntries(input: unknown): ClassEntry[] {
  if (!Array.isArray(input)) return [];

  const entries: ClassEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { classKey?: unknown; subclass?: unknown; level?: unknown };
    if (typeof item.classKey !== 'string') continue;

    const definition = getClassDefinition(item.classKey);
    if (!definition) continue;
    if (entries.some((entry) => entry.classKey === definition.key)) continue;

    const level = typeof item.level === 'number' && Number.isFinite(item.level)
      ? Math.min(20, Math.max(1, Math.floor(item.level)))
      : 1;

    entries.push({
      classKey: definition.key,
      subclass: typeof item.subclass === 'string' ? item.subclass.trim().slice(0, 120) : '',
      level,
    });
  }

  return entries.slice(0, MAX_CLASSES);
}

/**
 * Features de TODAS as classes do personagem, cada uma sabendo de que classe
 * veio e o nível dela — é assim que cada classe escala no próprio nível, sem
 * interferência do nível total.
 */
export function getMulticlassFeatures(entries: ClassEntry[]): ActiveClassFeature[] {
  return entries.flatMap((entry) => {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) return [];

    return getActiveClassFeatures(definition, entry.level, entry.subclass).map((feature) => ({
      ...feature,
      classKey: definition.key,
      classLevel: entry.level,
    }));
  });
}

function mergeAdjustments(base: ClassAdjustments, extra: ClassAdjustments): ClassAdjustments {
  const byId = <T extends { id: string }>(items: T[]): T[] => {
    const map = new Map<string, T>();
    for (const item of items) map.set(item.id, item);
    return [...map.values()];
  };

  const abilityBonuses: Partial<Record<AbilityKey, number>> = { ...base.abilityBonuses };
  for (const [ability, bonus] of Object.entries(extra.abilityBonuses)) {
    const key = ability as AbilityKey;
    abilityBonuses[key] = (abilityBonuses[key] ?? 0) + (bonus ?? 0);
  }

  return {
    toggles: byId([...base.toggles, ...extra.toggles]),
    resources: byId([...base.resources, ...extra.resources]),
    activeToggleIds: [...new Set([...base.activeToggleIds, ...extra.activeToggleIds])],
    meleeDamageBonus: base.meleeDamageBonus + extra.meleeDamageBonus,
    resistances: [...new Set([...base.resistances, ...extra.resistances])],
    speedBonus: base.speedBonus + extra.speedBonus,
    critExtraDice: Math.max(base.critExtraDice, extra.critExtraDice),
    unarmoredDefense: base.unarmoredDefense || extra.unarmoredDefense,
    unarmoredDefenseAbility:
      base.unarmoredDefenseAbility ?? extra.unarmoredDefenseAbility,
    unarmoredDefenseBase: Math.max(base.unarmoredDefenseBase, extra.unarmoredDefenseBase),
    martialArtsDie: Math.max(base.martialArtsDie, extra.martialArtsDie),
    hpBonus: base.hpBonus + extra.hpBonus,
    wildShapeCr:
      base.wildShapeCr === null && extra.wildShapeCr === null
        ? null
        : Math.max(base.wildShapeCr ?? 0, extra.wildShapeCr ?? 0),
    wildShapeFlying: base.wildShapeFlying || extra.wildShapeFlying,
    abilityBonuses,
    abilityCaps: { ...extra.abilityCaps, ...base.abilityCaps },
  };
}

/** Ajustes internos vazios (ponto de partida da soma). */
function emptyAdjustments(): ClassAdjustments {
  return {
    toggles: [],
    resources: [],
    activeToggleIds: [],
    meleeDamageBonus: 0,
    resistances: [],
    speedBonus: 0,
    critExtraDice: 0,
    unarmoredDefense: false,
    unarmoredDefenseAbility: null,
    unarmoredDefenseBase: 10,
    martialArtsDie: 0,
    hpBonus: 0,
    wildShapeCr: null,
    wildShapeFlying: false,
    abilityBonuses: {},
    abilityCaps: {},
  };
}

/**
 * Ajustes de multiclasse: cada classe é calculada com o PRÓPRIO nível (Fúria
 * escala com o nível de bárbaro, Ki com o de monge...) e os resultados são
 * somados/combinados — os dois conjuntos de features valem ao mesmo tempo.
 */
export function computeMulticlassAdjustments(
  entries: ClassEntry[],
  state: ClassState,
  abilities?: Record<AbilityKey, number>,
): ClassAdjustments {
  return entries.reduce((acc, entry) => {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) return acc;

    const features = getActiveClassFeatures(definition, entry.level, entry.subclass);
    return mergeAdjustments(
      acc,
      computeClassAdjustments(features, entry.level, state, abilities),
    );
  }, emptyAdjustments());
}

/**
 * Nível de conjurador para a tabela combinada de espaços de magia:
 * conjurador completo + metade do meio-conjurador + um terço do terço-conjurador.
 * O bruxo fica de fora (Magia de Pacto tem espaços próprios).
 */
export function multiclassCasterLevel(entries: ClassEntry[]): number {
  let casterLevel = 0;

  for (const entry of entries) {
    const type = effectiveSpellcasting(entry)?.type;

    if (type === 'full') casterLevel += entry.level;
    else if (type === 'half') casterLevel += Math.floor(entry.level / 2);
    else if (type === 'third') casterLevel += Math.floor(entry.level / 3);
  }

  return Math.min(20, casterLevel);
}

/** Tabela completa de espaços do conjurador de nível 1 a 20 (índice = nível). */
const FULL_CASTER_SLOTS: readonly number[][] = [
  [],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Máximo de espaços por nível de magia (1 a 9) para um nível de conjurador. */
export function spellSlotsForCasterLevel(level: number): { level: number; max: number }[] {
  const clamped = Math.min(FULL_CASTER_SLOTS.length - 1, Math.max(0, Math.floor(level)));
  const row = FULL_CASTER_SLOTS[clamped] ?? [];
  return row
    .map((max, index) => ({ level: index + 1, max }))
    .filter((slot) => slot.max > 0);
}

/** Tabela de Magia de Pacto do bruxo (espaços, nível do espaço e quantidade). */
const PACT_SLOTS: readonly { level: number; max: number; slotLevel: number }[] = [
  { level: 1, max: 1, slotLevel: 1 },
  { level: 2, max: 2, slotLevel: 1 },
  { level: 3, max: 2, slotLevel: 2 },
  { level: 4, max: 2, slotLevel: 2 },
  { level: 5, max: 2, slotLevel: 3 },
  { level: 6, max: 2, slotLevel: 3 },
  { level: 7, max: 2, slotLevel: 4 },
  { level: 8, max: 2, slotLevel: 4 },
  { level: 9, max: 2, slotLevel: 5 },
  { level: 10, max: 2, slotLevel: 5 },
  { level: 11, max: 3, slotLevel: 5 },
  { level: 12, max: 3, slotLevel: 5 },
  { level: 13, max: 3, slotLevel: 5 },
  { level: 14, max: 3, slotLevel: 5 },
  { level: 15, max: 3, slotLevel: 5 },
  { level: 16, max: 3, slotLevel: 5 },
  { level: 17, max: 4, slotLevel: 5 },
  { level: 18, max: 4, slotLevel: 5 },
  { level: 19, max: 4, slotLevel: 5 },
  { level: 20, max: 4, slotLevel: 5 },
];

/** Espaços de Magia de Pacto do bruxo no nível dele (null quando não é bruxo). */
export function pactMagicSlots(entries: ClassEntry[]): { max: number; slotLevel: number } | null {
  const warlock = entries.find((entry) => effectiveSpellcasting(entry)?.type === 'pact');
  if (!warlock) return null;

  const row = PACT_SLOTS[Math.min(20, Math.max(1, warlock.level)) - 1];
  return row ? { max: row.max, slotLevel: row.slotLevel } : null;
}

/** Dados de Ataque Furtivo do personagem (escala com o nível de LADINO). */
export function multiclassSneakAttack(entries: ClassEntry[]): number {
  const rogue = entries.find((entry) => entry.classKey === 'rogue');
  return rogue ? sneakAttackDice(rogue.level) : 0;
}

/** Níveis de Aumento de Atributo/Talento — são POR CLASSE, não pelo total. */
const DEFAULT_ASI_LEVELS: readonly number[] = [4, 8, 12, 16, 19];
const ASI_LEVELS_BY_CLASS: Record<string, readonly number[]> = {
  fighter: [4, 6, 8, 12, 14, 16, 19],
  rogue: [4, 8, 10, 12, 16, 19],
};

/** Níveis em que a classe concede Aumento de Atributo ou Talento. */
export function asiLevelsFor(classKey: string): readonly number[] {
  return ASI_LEVELS_BY_CLASS[classKey.trim()] ?? DEFAULT_ASI_LEVELS;
}

/** Verdadeiro quando o nível da classe é um dos níveis de ASI/Talento dela. */
export function isAsiLevel(classKey: string, level: number): boolean {
  return asiLevelsFor(classKey).includes(level);
}

/** Opção de classe para o seletor: o resumo + se o personagem pode entrar nela. */
export interface ClassOption extends ClassSummary {
  eligible: boolean;
  /** Texto do motivo do bloqueio ('' quando elegível). */
  missing: string;
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  /** Nomes das subclasses disponíveis. */
  subclassNames: string[];
}

/**
 * Catálogo com a elegibilidade do personagem calculada: o seletor esconde (ou
 * explica) as classes cujo pré-requisito de atributo não é atendido.
 */
export function classOptionsFor(
  abilities: Record<AbilityKey, number>,
  entries: ClassEntry[] = [],
): ClassOption[] {
  return CLASS_CATALOG.map((summary) => {
    const alreadyHas = entries.some((entry) => entry.classKey === summary.key);
    const missing = multiclassMissingLabel(summary.key, abilities);
    const definition = getClassDefinition(summary.key);

    return {
      ...summary,
      eligible: alreadyHas || missing === '',
      missing: alreadyHas ? '' : missing,
      asiLevels: [...asiLevelsFor(summary.key)],
      subclassNames: definition?.subclasses.map((subclass) => subclass.name) ?? [],
    };
  });
}

/**
 * Ganho de PV fixo (média arredondada para cima) por dado de vida, PHB 2014:
 * d6 → 4, d8 → 5, d10 → 6, d12 → 7.
 */
export function averageHitDie(hitDie: number): number {
  return Math.floor(hitDie / 2) + 1;
}
