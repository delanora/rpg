import { ABILITY_KEYS, type AbilityKey } from '../dnd5e.js';
import { getSpell, SPELL_SCHOOL_LABELS } from '../spells/index.js';
import { dragonborn } from './dragonborn.js';
import { dwarf } from './dwarf.js';
import { elf } from './elf.js';
import { gnome } from './gnome.js';
import { halfElf } from './half-elf.js';
import { halfOrc } from './half-orc.js';
import { halfling } from './halfling.js';
import { human } from './human.js';
import { tiefling } from './tiefling.js';
import type { Race, RaceChoiceDefinition, RaceTrait, Subrace } from './types.js';

/**
 * Registro agregado do catálogo ESTRUTURADO de raças (fundação).
 *
 * Segue o padrão de `shared/classes/index.ts`: aqui ficam a lista e as funções
 * utilitárias; cada raça vive no seu próprio arquivo (`dwarf.ts`, `elf.ts`…),
 * importado nesta lista nos próximos prompts.
 *
 * Enquanto o catálogo novo não substituir o `RACE_CATALOG` de `shared/creation.ts`
 * (Prompt 2.10), o assistente de criação e o compêndio continuam lendo o
 * catálogo antigo — os dois coexistem sem que nada em produção dependa daqui
 * ainda.
 */
export * from './types.js';

export const RACES: readonly Race[] = [
  dragonborn,
  elf,
  dwarf,
  human,
  halfling,
  gnome,
  halfElf,
  halfOrc,
  tiefling,
];

const RACE_BY_ID: ReadonlyMap<string, Race> = new Map(RACES.map((race) => [race.id, race]));

/** Todas as raças do catálogo (cópia defensiva). */
export function allRaces(): Race[] {
  return [...RACES];
}

/** Uma raça pelo id, ou `undefined` quando não existe. */
export function getRace(id: string): Race | undefined {
  return RACE_BY_ID.get(id);
}

/** Uma sub-raça pelo id da raça + o id da sub-raça, ou `undefined`. */
export function getSubrace(raceId: string, subraceId: string): Subrace | undefined {
  return getRace(raceId)?.subraces?.find((subrace) => subrace.id === subraceId);
}

/**
 * Soma dos efeitos `hpBonus` de uma raça + sub-raça no nível informado.
 *
 * É o ÚNICO efeito de raça aplicado de verdade hoje (a Robustez Anã, +1 PV por
 * nível TOTAL do personagem): o serviço de personagens usa `raceHpBonusDelta`
 * ao trocar a raça/sub-raça. Efeitos de traço podem vir em `mechanicalEffect`
 * (um) ou `mechanicalEffects` (vários).
 */
export function raceHpBonus(
  raceId: string | null | undefined,
  subraceId: string | null | undefined,
  level: number,
): number {
  const race = raceId ? getRace(raceId) : undefined;
  if (!race) return 0;
  const subrace = subraceId ? race.subraces?.find((item) => item.id === subraceId) : undefined;
  const traits = [...race.traits, ...(subrace?.traits ?? [])];

  let total = 0;
  for (const trait of traits) {
    const effects =
      trait.mechanicalEffects ?? (trait.mechanicalEffect ? [trait.mechanicalEffect] : []);
    for (const effect of effects) {
      if (effect.type === 'hpBonus') {
        total += (effect.value ?? 0) * (effect.perLevel ? level : 1);
      }
    }
  }
  return total;
}

/**
 * Delta de PV ao TROCAR de raça/sub-raça (positivo liga o bônus, negativo o
 * reverte). Compara o `hpBonus` da raça/sub-raça anterior com o da nova, no
 * mesmo nível total do personagem.
 */
export function raceHpBonusDelta(
  from: { raceId: string | null; subraceId: string | null },
  to: { raceId: string | null; subraceId: string | null },
  level: number,
): number {
  return raceHpBonus(to.raceId, to.subraceId, level) - raceHpBonus(from.raceId, from.subraceId, level);
}

/** Algum traço declara o Sortudo (`luckyReroll`)? */
function traitsHaveLucky(traits: readonly RaceTrait[]): boolean {
  for (const trait of traits) {
    const effects =
      trait.mechanicalEffects ?? (trait.mechanicalEffect ? [trait.mechanicalEffect] : []);
    if (effects.some((effect) => effect.type === 'luckyReroll')) return true;
  }
  return false;
}

/**
 * O personagem tem o Sortudo do Halfling?
 *
 * Resolve pelo catálogo ESTRUTURADO (`raceId`/`subraceId`) quando já estiver
 * gravado e, na falta dele, pelo texto livre `race` — o assistente de criação
 * ainda grava a linhagem como texto (ex.: "Halfling (Pés-Leves)") até o 2.10.
 * Usado pelo serviço de dados para marcar `lucky` no resultado.
 */
export function hasLuckyReroll(input: {
  raceId?: string | null;
  subraceId?: string | null;
  race?: string | null;
}): boolean {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (race) {
    const subrace = input.subraceId
      ? race.subraces?.find((item) => item.id === input.subraceId)
      : undefined;
    return traitsHaveLucky([...race.traits, ...(subrace?.traits ?? [])]);
  }
  // Sem raceId: cai no texto livre da raça/linhagem.
  return (input.race ?? '').trim().toLowerCase().startsWith('halfling');
}

// ---------------------------------------------------------------------------
// Motor de raça (Prompt 2.10)
//
// Resolve, a partir de `raceId`/`subraceId` + as escolhas gravadas em
// `raceChoices`, o que a raça concede à ficha. O assistente usa isto no passo 3
// e o PATCH do mestre reusa ao trocar a raça. Só o catálogo FIXO é resolvido
// aqui; as raças personalizadas do mestre (tabela CustomRace) têm o mesmo
// formato e são resolvidas pelo serviço, que tem acesso ao banco.
// ---------------------------------------------------------------------------

/** Entrada comum dos resolvedores: a raça/sub-raça e as escolhas já feitas. */
export interface RaceResolutionInput {
  raceId?: string | null;
  subraceId?: string | null;
  /** `{ [id da escolha]: id da opção }` — o mesmo formato de `raceChoices`. */
  choices?: Record<string, string>;
}

/** Todos os traços da raça + sub-raça, na ordem de exibição. */
export function raceTraits(input: RaceResolutionInput): RaceTrait[] {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (!race) return [];
  const subrace = input.subraceId
    ? race.subraces?.find((item) => item.id === input.subraceId)
    : undefined;
  return [...race.traits, ...(subrace?.traits ?? [])];
}

/** As escolhas que a raça exige (ancestralidade, atributos/perícias do Meio-Elfo). */
export function raceChoiceDefinitions(raceId: string | null | undefined): RaceChoiceDefinition[] {
  return raceId ? [...(getRace(raceId)?.hasChoices ?? [])] : [];
}

/** Percorre os efeitos mecânicos de um traço, com `mechanicalEffect` e `mechanicalEffects`. */
function effectsOf(trait: RaceTrait) {
  return trait.mechanicalEffects ?? (trait.mechanicalEffect ? [trait.mechanicalEffect] : []);
}

/** Bônus FIXOS de atributo da raça + sub-raça (sem os `+1` à escolha). */
export function raceFixedAbilityBonuses(
  input: RaceResolutionInput,
): Partial<Record<AbilityKey, number>> {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (!race) return {};
  const subrace = input.subraceId
    ? race.subraces?.find((item) => item.id === input.subraceId)
    : undefined;

  const bonuses: Partial<Record<AbilityKey, number>> = {};
  for (const increase of [...race.abilityScoreIncrease, ...(subrace?.abilityScoreIncrease ?? [])]) {
    bonuses[increase.ability] = (bonuses[increase.ability] ?? 0) + increase.amount;
  }
  return bonuses;
}

/**
 * Bônus de atributo da raça, já com os `+1` à escolha: soma os incrementos fixos
 * da raça/sub-raça e as escolhas com `apply: 'ability'` (o id da opção é a chave
 * do atributo). A regra de "não repetir" o mesmo atributo é do assistente.
 */
export function raceAbilityBonuses(
  input: RaceResolutionInput,
): Partial<Record<AbilityKey, number>> {
  const bonuses = raceFixedAbilityBonuses(input);
  const choices = input.choices ?? {};

  for (const definition of raceChoiceDefinitions(input.raceId)) {
    if (definition.apply !== 'ability') continue;
    const picked = choices[definition.id];
    if (!picked) continue;
    if (!(ABILITY_KEYS as readonly string[]).includes(picked)) continue;
    const ability = picked as AbilityKey;
    bonuses[ability] = (bonuses[ability] ?? 0) + 1;
  }

  return bonuses;
}

/** Deslocamento em metros (a sub-raça pode sobrescrever). 9 = padrão da ficha. */
export function raceSpeed(input: RaceResolutionInput): number {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (!race) return 9;
  const subrace = input.subraceId
    ? race.subraces?.find((item) => item.id === input.subraceId)
    : undefined;
  return subrace?.speed ?? race.speed;
}

/** Visão no escuro em metros (a sub-raça pode sobrescrever). 0 = sem. */
export function raceDarkvision(input: RaceResolutionInput): number {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (!race) return 0;
  const subrace = input.subraceId
    ? race.subraces?.find((item) => item.id === input.subraceId)
    : undefined;
  return subrace?.darkvision ?? race.darkvision ?? 0;
}

/**
 * Tipos de dano resistidos pela raça: os declarados no campo `damageResistances`
 * mais os efeitos `resistance` e `resistanceFromChoice` (cujo tipo sai da opção
 * escolhida via `choiceId`).
 */
export function raceDamageResistances(input: RaceResolutionInput): string[] {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (!race) return [];
  const choices = input.choices ?? {};
  const resistances = new Set<string>(race.damageResistances ?? []);

  for (const trait of raceTraits(input)) {
    for (const effect of effectsOf(trait)) {
      if (effect.type === 'resistance') {
        for (const type of effect.damageTypes ?? []) resistances.add(type);
      } else if (effect.type === 'resistanceFromChoice') {
        const definition = raceChoiceDefinitions(input.raceId).find(
          (item) => item.id === effect.choiceId,
        );
        const picked = effect.choiceId ? choices[effect.choiceId] : undefined;
        const option = definition?.options.find((item) => item.id === picked);
        if (option?.damageType) resistances.add(option.damageType);
      }
    }
  }

  return [...resistances];
}

/** Perícias em que a raça concede proficiência (fixas + pelas escolhas `apply: 'skill'`). */
export function raceSkillProficiencies(input: RaceResolutionInput): string[] {
  const skills = new Set<string>();
  for (const trait of raceTraits(input)) {
    for (const effect of effectsOf(trait)) {
      if (effect.type === 'skillProficiency' && effect.target) skills.add(effect.target);
    }
  }

  const choices = input.choices ?? {};
  for (const definition of raceChoiceDefinitions(input.raceId)) {
    if (definition.apply !== 'skill') continue;
    const picked = choices[definition.id];
    if (picked) skills.add(picked);
  }

  return [...skills];
}

/** Ferramentas em que a raça concede proficiência (fixas + escolhas `apply: 'tool'`). */
export function raceToolProficiencies(input: RaceResolutionInput): string[] {
  const tools = new Set<string>();
  for (const trait of raceTraits(input)) {
    for (const effect of effectsOf(trait)) {
      if (effect.type === 'toolProficiency' && effect.target) tools.add(effect.target);
    }
  }

  const choices = input.choices ?? {};
  for (const definition of raceChoiceDefinitions(input.raceId)) {
    if (definition.apply !== 'tool') continue;
    const picked = choices[definition.id];
    if (picked) tools.add(picked);
  }

  return [...tools];
}

/**
 * Armas em que a raça concede proficiência: ids CANÔNICOS do catálogo
 * `shared/weapons` (ex.: Treinamento de Combate Anão → 'battleaxe'). É o que o
 * motor de raça GRAVA em `proficiencies.weapons` e o que `isProficientWithWeapon`
 * compara pelo `canonicalWeaponId` do item.
 */
export function raceWeaponProficiencies(input: RaceResolutionInput): string[] {
  const weapons = new Set<string>();
  for (const trait of raceTraits(input)) {
    for (const effect of effectsOf(trait)) {
      if (effect.type !== 'weaponProficiency') continue;
      for (const id of effect.targets ?? []) weapons.add(id);
      if (effect.target) weapons.add(effect.target);
    }
  }
  return [...weapons];
}

/**
 * Aplica/REVERTE as proficiências de arma da raça sobre a lista JÁ GRAVADA na
 * ficha.
 *
 * Tira as armas que a raça ANTERIOR (`from`) concedia — exceto as que a raça NOVA
 * (`to`) ainda dá e as que `stillGranted` (as classes) continuam concedendo — e
 * soma as armas da raça NOVA, sem repetição. Sem troca de raça a lista não muda
 * (a remoção e a soma usam o mesmo conjunto). É o inverso de `raceHpBonusDelta`
 * para o PV: aqui o efeito fica GRAVADO na ficha.
 */
export function applyRaceWeaponProficiencies(
  current: readonly string[],
  from: RaceResolutionInput,
  to: RaceResolutionInput,
  stillGranted: readonly string[] = [],
): string[] {
  const removed = new Set(raceWeaponProficiencies(from));
  const added = new Set(raceWeaponProficiencies(to));
  const keep = new Set(stillGranted);

  const result = current.filter((id) => !removed.has(id) || added.has(id) || keep.has(id));
  const present = new Set(result);
  for (const id of added) {
    if (!present.has(id)) {
      result.push(id);
      present.add(id);
    }
  }
  return result;
}

/** Idiomas concedidos pela raça (texto informativo; sem campo de idioma antes). */
export function raceLanguages(input: RaceResolutionInput): string[] {
  return input.raceId ? [...(getRace(input.raceId)?.languages ?? [])] : [];
}

/** Uma magia racial já resolvida contra o catálogo (`shared/spells`). */
export interface RaceSpellGrant {
  /** Id estável do catálogo (ex.: 'faerie-fire'). */
  key: string;
  name: string;
  /** Nível da MAGIA (0 = truque). */
  level: number;
  /** Rótulo da escola em português. */
  school: string;
  description: string;
  /** Atributo de conjuração da raça (independente da classe). */
  ability: AbilityKey;
  /** Nível de ESPAÇO usado ao conjurar; `undefined` = nível da magia. */
  castLevel?: number;
  /** 'long' = 1x por descanso longo; `undefined` = à vontade (truque). */
  perRest?: 'long';
  /** Id do traço racial que concede a magia. */
  traitId: string;
}

/**
 * Magias concedidas pela RAÇA no NÍVEL TOTAL do personagem (Prompt 6.4).
 *
 * Percorre os traços (raça + sub-raça) e resolve os efeitos `type: 'spell'`: a
 * magia vem fixa (`spellId`) ou de uma escolha (`spellChoiceId` → id da opção
 * em `choices`). Filtra os efeitos pelo `minLevel` (nível de PERSONAGEM, não de
 * classe) e ignora ids fora do catálogo. Não se repetem.
 */
export function raceSpells(input: RaceResolutionInput, totalLevel = 1): RaceSpellGrant[] {
  const level = Math.max(1, Math.floor(totalLevel));
  const choices = input.choices ?? {};
  const seen = new Set<string>();
  const grants: RaceSpellGrant[] = [];

  for (const trait of raceTraits(input)) {
    for (const effect of effectsOf(trait)) {
      if (effect.type !== 'spell') continue;
      if ((effect.minLevel ?? 1) > level) continue;
      const spellId =
        effect.spellId ?? (effect.spellChoiceId ? choices[effect.spellChoiceId] : undefined);
      if (!spellId || seen.has(spellId)) continue;
      const spell = getSpell(spellId);
      if (!spell) continue;
      seen.add(spellId);
      grants.push({
        key: spell.id,
        name: spell.namePt,
        level: spell.level,
        school: SPELL_SCHOOL_LABELS[spell.school],
        description: spell.description.slice(0, 2000),
        ability: effect.ability ?? 'intelligence',
        castLevel: effect.castLevel,
        perRest: effect.perRest,
        traitId: trait.id,
      });
    }
  }

  return grants;
}
