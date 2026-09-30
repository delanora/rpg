import type { AbilityKey } from './dnd5e.js';
import { ABILITY_KEYS } from './dnd5e.js';
import {
  emptyProficiencies,
  featureEffectsOf,
  featuresWithSubclass,
  firstClassProficiencies,
  getClassDefinition,
  mergeProficiencies,
  multiclassProficiencyGrant,
  subclassProficiencyGrant,
  type ClassEntry,
  type ProficienciesState,
} from './classes.js';

/**
 * Histórico do que UM nível concedeu.
 *
 * O Level Up aplica várias coisas de uma vez (nível da classe, PV, subclasse,
 * escolhas de característica, perícia de multiclasse, proficiências, Aumento de
 * Atributo/Talento) e nada disso era registrado: só o resultado ficava na ficha.
 * Sem esse registro não há como o mestre REDUZIR um nível — não se sabe quanto de
 * PV aquele nível deu (a rolagem se perde) nem que atributo o jogador subiu.
 *
 * Cada nível ganho grava um destes (ver `applyLevelUp`) e cada nível revertido
 * apaga o último dele (ver `levelDownCharacter`).
 */
export interface LevelHistoryRecord {
  /** Classe que subiu (a entrada em si). */
  classKey: string;
  /** Nível da CLASSE depois deste nível (1 = entrada por multiclasse). */
  classLevel: number;
  /** Nível TOTAL do personagem depois deste nível. */
  totalLevel: number;
  /**
   * PV somado ao máximo neste nível. `gained` é o dado (rolado ou a média) mais
   * o modificador de Constituição daquele momento; `conDelta` é o ajuste
   * retroativo que um Aumento de Constituição deste mesmo nível provocou nos
   * níveis anteriores; `total` é o que foi somado em `hpMax`/`hpCurrent`.
   */
  hp: { rolled: boolean; die: number; gained: number; conDelta: number; total: number };
  /** Aumento de Atributo aplicado neste nível (vazio quando foi talento). */
  abilityIncreases: { ability: AbilityKey; amount: number }[];
  /** Talento escolhido neste nível (com o id da característica gravada). */
  feat: { id: string; name: string } | null;
  /** Escolhas de característica feitas NESTE nível (`{ [featureId]: [opções] }`). */
  choices: Record<string, string[]>;
  /** Subclasse escolhida neste nível ('' quando não houve escolha). */
  subclass: string;
  /** Perícias que ficaram proficientes por causa deste nível. */
  skills: string[];
  /** Proficiências somadas neste nível (null quando nenhuma). */
  proficiencies: ProficienciesState | null;
  /** Quando o nível foi ganho (ISO). */
  at: string;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function num(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.floor(value)))
    : 0;
}

function proficiencyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = str(item, 120);
    if (text !== '') seen.add(text);
  }
  return [...seen].slice(0, 60);
}

function normalizeProficienciesOrNull(value: unknown): ProficienciesState | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { armor?: unknown; weapons?: unknown; tools?: unknown };
  const state: ProficienciesState = {
    armor: proficiencyList(source.armor),
    weapons: proficiencyList(source.weapons),
    tools: proficiencyList(source.tools),
  };
  return state.armor.length + state.weapons.length + state.tools.length === 0 ? null : state;
}

/**
 * Lê/normaliza o histórico vindo do JSONB.
 *
 * Tudo é tolerante: registro malformado é descartado em vez de quebrar a
 * leitura da ficha (dado antigo, edição manual no banco).
 */
export function normalizeLevelHistory(input: unknown): LevelHistoryRecord[] {
  if (!Array.isArray(input)) return [];

  const records: LevelHistoryRecord[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;

    const classKey = str(source.classKey, 40);
    const classLevel = num(source.classLevel, 99);
    if (classKey === '' || classLevel < 1) continue;

    const hpSource = (source.hp ?? {}) as Record<string, unknown>;
    const increases: { ability: AbilityKey; amount: number }[] = [];
    if (Array.isArray(source.abilityIncreases)) {
      for (const raw of source.abilityIncreases) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as Record<string, unknown>;
        const ability = str(entry.ability, 20) as AbilityKey;
        const amount = num(entry.amount, 2);
        if (!ABILITY_KEYS.includes(ability) || amount < 1) continue;
        increases.push({ ability, amount });
      }
    }

    const featSource = (source.feat ?? null) as Record<string, unknown> | null;
    const featId = str(featSource?.id, 80);

    const choices: Record<string, string[]> = {};
    if (source.choices && typeof source.choices === 'object') {
      for (const [key, value] of Object.entries(source.choices as Record<string, unknown>)) {
        const id = str(key, 60);
        if (id === '' || !Array.isArray(value)) continue;
        const keys = proficiencyList(value).slice(0, 8);
        if (keys.length > 0) choices[id] = keys;
      }
    }

    const skills = proficiencyList(source.skills).slice(0, 12);

    records.push({
      classKey,
      classLevel,
      totalLevel: num(source.totalLevel, 99),
      hp: {
        rolled: hpSource.rolled === true,
        die: num(hpSource.die, 20),
        gained: num(hpSource.gained, 999),
        conDelta:
          typeof hpSource.conDelta === 'number' && Number.isFinite(hpSource.conDelta)
            ? Math.max(-99, Math.min(99, Math.floor(hpSource.conDelta)))
            : 0,
        total: num(hpSource.total, 999),
      },
      abilityIncreases: increases,
      feat: featId === '' ? null : { id: featId, name: str(featSource?.name, 120) },
      choices,
      subclass: str(source.subclass, 120),
      skills,
      proficiencies: normalizeProficienciesOrNull(source.proficiencies),
      at: str(source.at, 40),
    });
  }

  // Teto de segurança: um personagem tem no máximo 20 níveis.
  return records.slice(-40);
}

/**
 * Proficiências concedidas pela ENTRADA numa classe.
 *
 * `isFirst` separa os dois casos do PHB: a PRIMEIRA classe da ficha concede o
 * conjunto completo do nível 1; entrar numa classe nova por multiclasse concede
 * só o conjunto reduzido (PHB p.164). A subclasse escolhida soma por cima.
 */
export function classEntryProficiencyGrant(
  entry: ClassEntry,
  isFirst: boolean,
): ProficienciesState {
  const definition = getClassDefinition(entry.classKey);
  if (!definition) return emptyProficiencies();

  const entryGrant = isFirst
    ? firstClassProficiencies(entry.classKey)
    : multiclassProficiencyGrant(entry.classKey);

  return entry.subclass === ''
    ? entryGrant
    : mergeProficiencies(entryGrant, subclassProficiencyGrant(definition, entry.subclass));
}

/** Proficiências que a LISTA de classes concede como um todo (entrada + subclasse). */
export function classProficiencyGrant(entries: ClassEntry[]): ProficienciesState {
  return mergeProficiencies(
    ...entries.map((entry, index) => classEntryProficiencyGrant(entry, index === 0)),
  );
}

/**
 * Tira de `current` o que aquele nível tinha concedido (`removed`), mas mantém o
 * que as classes que FICARAM ainda concedem (`stillGranted`).
 *
 * É o que evita tirar uma proficiência compartilhada (ex.: "Armas simples" da
 * primeira classe e também da entrada por multiclasse de outra).
 */
export function subtractProficiencies(
  current: ProficienciesState,
  removed: ProficienciesState,
  stillGranted: ProficienciesState,
): ProficienciesState {
  const keep = (list: string[], remove: string[], readd: string[]): string[] => {
    if (remove.length === 0) return list;
    const removeSet = new Set(remove);
    const readdSet = new Set(readd);
    return list.filter((item) => !removeSet.has(item) || readdSet.has(item));
  };

  return {
    armor: keep(current.armor, removed.armor, stillGranted.armor),
    weapons: keep(current.weapons, removed.weapons, stillGranted.weapons),
    tools: keep(current.tools, removed.tools, stillGranted.tools),
  };
}

/**
 * Ids de estado de runtime (`classState.active`/`used`) que pertencem a uma
 * classe: os das características dela e das subclasses, e os dos efeitos
 * (recursos/toggles) que elas declaram.
 *
 * Serve para limpar o estado quando a classe sai inteira da ficha — um contador
 * de usos órfão continuaria aparecendo na ficha.
 */
export function classStateIdsFor(entry: ClassEntry): Set<string> {
  const ids = new Set<string>();
  const definition = getClassDefinition(entry.classKey);
  if (!definition) return ids;

  for (const feature of featuresWithSubclass(definition, entry.subclass)) {
    ids.add(feature.id);
    for (const effect of featureEffectsOf(feature)) ids.add(effect.id ?? feature.id);
    for (const option of feature.choice?.options ?? []) {
      if (option.effect) ids.add(option.effect.id ?? feature.id);
    }
  }

  return ids;
}
