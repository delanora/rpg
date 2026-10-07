import { HttpError } from '../../../lib/http-error.js';
import {
  abilityModifier,
  SKILL_KEYS,
  SKILL_LABELS,
  type AbilityKey,
} from '../dnd5e.js';
import { getFeat } from '../feats/index.js';
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
  FeatureChoiceOption,
  MulticlassSkillChoice,
  ProficienciesState,
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
  // Piso do recurso (1 + mod. de CAR nunca fica abaixo de 1).
  if (resource.min !== undefined && value !== -1) value = Math.max(resource.min, value);
  return value;
}

/**
 * Modificador somado por `abilityMod` (Aura de Proteção: +mod. de CAR em todas
 * as salvaguardas), respeitando o piso (`minValue`).
 */
function effectValueWithAbilityMod(
  effect: ClassFeatureEffect,
  abilities?: Record<AbilityKey, number>,
): number {
  let value = effect.value ?? 0;
  if (effect.abilityMod && abilities) {
    value += abilityModifier(abilities[effect.abilityMod]);
  }
  if (effect.minValue !== undefined) value = Math.max(effect.minValue, value);
  return value;
}

/**
 * Features da classe MAIS as da subclasse escolhida (as duas podem declarar
 * escolhas — o Caçador escolhe Presa do Caçador já no 3º nível).
 */
export function featuresWithSubclass(
  definition: ClassDefinition,
  subclassName: string,
): ClassFeatureDefinition[] {
  const subclass = findSubclass(definition, subclassName);
  return subclass ? [...definition.features, ...subclass.features] : [...definition.features];
}

/**
 * Proficiências que a SUBCLASSE concede ao ser escolhida (Colégio da Bravura:
 * armaduras médias, escudos e armas marciais). Vazio quando não concede.
 */
export function subclassProficiencyGrant(
  definition: ClassDefinition,
  subclassName: string,
): ProficienciesState {
  const subclass = findSubclass(definition, subclassName);
  return subclass?.proficiencies ?? emptyProficiencies();
}

/**
 * Nível (da CLASSE) em que a escolha de uma característica é feita.
 *
 * O padrão é o nível da própria característica; as melhorias declaram o seu
 * (`choice.level`), porque valem no nível da característica de origem.
 */
export function featureChoiceLevel(feature: ClassFeatureDefinition): number {
  return feature.choice?.level ?? feature.level;
}

/** Quantas opções a escolha pede (padrão 1). */
export function featureChoiceCount(feature: ClassFeatureDefinition): number {
  return Math.max(1, feature.choice?.count ?? 1);
}

/**
 * Características de UMA classe que pedem escolha, com o que já foi escolhido.
 *
 * Serve ao assistente de Level Up (só as escolhas do nível que está sendo
 * ganho) e à ficha (mostrar/editar o que já foi escolhido).
 */
export interface FeatureChoiceInfo {
  /** Id da característica que declara a escolha. */
  featureId: string;
  /** Nome da característica (ex.: 'Estilo de Luta'). */
  name: string;
  /** Rótulo do passo na interface (padrão: o nome). */
  prompt: string;
  /** Nível (da classe) em que a escolha é feita. */
  level: number;
  /** Quantas opções escolher. */
  count: number;
  /** Se a mesma opção pode ser repetida nesta escolha múltipla. */
  allowRepeat: boolean;
  /** O que a escolha FAZ na ficha ('skill', 'expertise'). */
  apply?: 'skill' | 'expertise';
  /** Opções aceitas. */
  options: { key: string; name: string; description: string }[];
  /** Opções já escolhidas (vazio enquanto não houve escolha). */
  chosen: string[];
}

/**
 * Opções DINÂMICAS por TIPO de escolha — hoje só a Expertise: as opções saem do
 * que o personagem JÁ tem proficiência (perícias e ferramentas), então não podem
 * ser fixadas na definição da classe.
 */
export type FeatureChoiceOptionsOverride = Partial<
  Record<'skill' | 'expertise', FeatureChoiceOption[]>
>;

export function featureChoiceInfo(
  definition: ClassDefinition,
  chosen: Record<string, string[]> = {},
  /** Subclasse escolhida: as features dela também podem pedir escolha. */
  subclassName = '',
  /** Opções que sobrepõem as da definição (ex.: Expertise só entre proficientes). */
  optionsOverride: FeatureChoiceOptionsOverride = {},
  /**
   * Nível da CLASSE usado para esconder as opções com pré-requisito de nível
   * (`FeatureChoiceOption.requiresLevel`). `undefined` = não filtra por nível.
   */
  level?: number,
): FeatureChoiceInfo[] {
  const features = featuresWithSubclass(definition, subclassName).filter(
    (feature) => feature.choice !== undefined,
  );

  return features.map((feature) => ({
    featureId: feature.id,
    name: feature.name,
    prompt: feature.choice?.prompt ?? feature.name,
    level: featureChoiceLevel(feature),
    count: featureChoiceCount(feature),
    allowRepeat: Boolean(feature.choice?.allowRepeat),
    apply: feature.choice?.apply,
    options: (
      (feature.choice?.apply ? optionsOverride[feature.choice.apply] : undefined) ??
      feature.choice?.options ??
      []
    )
      // `excludeChosen`: tira o que já foi aprendido nas OUTRAS características
      // desta classe (a própria característica mantém as suas escolhas).
      .filter((option) => !learnedElsewhere(features, chosen, feature).has(option.key))
      // Pré-requisitos de nível/pacto (Invocações Místicas): fora da lista
      // enquanto não forem atendidos — o servidor também recusa a escolha.
      .filter((option) => optionMeetsPrerequisites(option, level, chosen))
      .map((option) => ({
        key: option.key,
        name: option.name,
        description: option.description ?? '',
      })),
    chosen: chosen[feature.id] ?? [],
  }));
}

/**
 * Chaves já escolhidas nas OUTRAS características desta classe, quando a
 * característica pede `excludeChosen` (Metamagia não repete o que já aprendeu).
 * Fora desse caso, o conjunto volta vazio e nada é filtrado.
 */
/**
 * A opção pode ser escolhida no contexto atual? Vale para os pré-requisitos
 * declarados na própria opção (nível da classe e Dádiva do Pacto). Sem `level`
 * informado, o filtro de nível não é aplicado.
 */
function optionMeetsPrerequisites(
  option: FeatureChoiceOption,
  level: number | undefined,
  chosen: Record<string, string[]>,
): boolean {
  if (option.requiresLevel !== undefined && level !== undefined && level < option.requiresLevel) {
    return false;
  }
  if (option.requiresPact !== undefined) {
    const boon = chosen['pact-boon'] ?? [];
    if (!boon.includes(option.requiresPact)) return false;
  }
  return true;
}

function learnedElsewhere(
  features: ClassFeatureDefinition[],
  chosen: Record<string, string[]>,
  feature: ClassFeatureDefinition,
): Set<string> {
  if (!feature.choice?.excludeChosen) return new Set();
  const keys = features
    .filter((other) => other.id !== feature.id)
    .flatMap((other) => chosen[other.id] ?? []);
  return new Set(keys);
}

/**
 * Escolhas que FALTAM numa classe, no nível que está sendo ganho.
 *
 * Vale para o assistente de criação (nível 1 da primeira classe) e para o Level
 * Up (nível novo): só entram as características cuja escolha é feita neste
 * nível e que ainda não têm valor gravado.
 */
export function pendingFeatureChoices(
  definition: ClassDefinition,
  classLevel: number,
  chosen: Record<string, string[]> = {},
  subclassName = '',
  optionsOverride: FeatureChoiceOptionsOverride = {},
  /** Escolhas adiadas para outro momento (a criação resolve a Expertise no passo das perícias). */
  ignoreApply: readonly ('skill' | 'expertise')[] = [],
): FeatureChoiceInfo[] {
  return featureChoiceInfo(definition, chosen, subclassName, optionsOverride, classLevel).filter(
    (info) =>
      info.level === classLevel &&
      info.chosen.length < info.count &&
      !(info.apply !== undefined && ignoreApply.includes(info.apply)),
  );
}

/**
 * Valida e mescla as escolhas enviadas numa subida de nível (ou na criação).
 *
 * Regras:
 *  • só são aceitas escolhas de características cujo nível de escolha é o nível
 *    que está sendo ganho (`classLevel`);
 *  • a quantidade tem de bater com a declarada e cada opção precisa existir;
 *  • a mesma opção não se repete, salvo quando a característica permite;
 *  • escolha já gravada é PRESERVADA (o nível é ganho uma vez só).
 */
export function resolveFeatureChoices(
  definition: ClassDefinition,
  classLevel: number,
  incoming: Record<string, string[]>,
  current: Record<string, string[]> = {},
  /** Subclasse escolhida (as features dela têm escolhas próprias). */
  subclassName = '',
  /** Opções dinâmicas (Expertise só entre o que o personagem já domina). */
  optionsOverride: FeatureChoiceOptionsOverride = {},
  /** Escolhas adiadas (a criação resolve a Expertise no passo das perícias). */
  ignoreApply: readonly ('skill' | 'expertise')[] = [],
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...current };
  const features = featuresWithSubclass(definition, subclassName);
  const pending = new Map(
    pendingFeatureChoices(
      definition,
      classLevel,
      current,
      subclassName,
      optionsOverride,
      ignoreApply,
    ).map((info) => [info.featureId, info]),
  );

  for (const [featureId, keys] of Object.entries(incoming)) {
    const info = pending.get(featureId);
    if (!info) {
      const feature = features.find((item) => item.id === featureId);
      if (!feature?.choice) {
        throw new HttpError(`A característica ${featureId} não pede escolha.`, 400);
      }
      if (featureChoiceLevel(feature) !== classLevel) {
        throw new HttpError(
          `A escolha de ${feature.name} é feita no nível ${featureChoiceLevel(feature)} de ${definition.name}.`,
          400,
        );
      }
      // Já escolhida: mantém o que está gravado.
      continue;
    }

    const unique = [...new Set(keys)];
    if (unique.length !== keys.length && !info.allowRepeat) {
      throw new HttpError(`Escolha opções diferentes em ${info.prompt}.`, 400);
    }
    if (unique.length !== info.count) {
      throw new HttpError(
        `${info.prompt}: escolha ${info.count} ${info.count === 1 ? 'opção' : 'opções'}.`,
        400,
      );
    }

    const valid = new Set(info.options.map((option) => option.key));
    const outside = unique.filter((key) => !valid.has(key));
    if (outside.length > 0) {
      throw new HttpError(`Opção inválida em ${info.prompt}: ${outside.join(', ')}.`, 400);
    }

    next[featureId] = unique;
  }

  // Nenhuma escolha deste nível pode ficar sem resposta: o nível só é ganho uma
  // vez, então ou ela é feita agora ou fica faltando para sempre.
  const stillMissing = pendingFeatureChoices(
    definition,
    classLevel,
    next,
    subclassName,
    optionsOverride,
    ignoreApply,
  );
  if (stillMissing.length > 0) {
    const prompts = stillMissing.map((info) => info.prompt).join(', ');
    throw new HttpError(`Escolha ${prompts} para o nível ${classLevel} de ${definition.name}.`, 400);
  }

  return next;
}

/**
 * Duas escolhas são iguais? A ORDEM das características não importa (o JSONB do
 * Postgres reordena as chaves), mas a ordem das opções dentro de cada escolha
 * importa.
 */
export function sameFeatureChoices(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;

  return keysA.every((key) => {
    const listA = a[key] ?? [];
    const listB = b[key];
    if (!listB || listA.length !== listB.length) return false;
    return listA.every((item, index) => item === listB[index]);
  });
}

/** Rótulo legível das opções escolhidas numa característica ("Defesa"). */
export function featureChoiceLabels(feature: ClassFeatureDefinition, keys: string[]): string[] {
  return keys.map(
    (key) => feature.choice?.options.find((option) => option.key === key)?.name ?? key,
  );
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

/** Prefixo das ferramentas nas escolhas de Expertise (nunca colide com perícia). */
export const EXPERTISE_TOOL_PREFIX = 'tool:';

/** Uma ferramenta é a chave `tool:<rótulo>` de uma proficiência de ferramenta. */
export function isToolExpertiseKey(key: string): boolean {
  return key.startsWith(EXPERTISE_TOOL_PREFIX);
}

/** Rótulo exibido de uma chave de Expertise (tira o prefixo de ferramenta). */
export function expertiseKeyLabel(key: string): string {
  if (isToolExpertiseKey(key)) return key.slice(EXPERTISE_TOOL_PREFIX.length);
  return SKILL_LABELS[key] ?? key;
}

/**
 * Opções de Expertise de UM personagem: só o que ele JÁ tem proficiência —
 * as perícias marcadas na ficha e as ferramentas dela. O PHB só deixa dobrar
 * uma proficiência existente, então esta é a lista completa do que pode ser
 * escolhido (o servidor recusa qualquer coisa fora dela).
 */
export function expertiseOptionsFor(
  proficientSkills: readonly string[],
  tools: readonly string[],
): FeatureChoiceOption[] {
  const options: FeatureChoiceOption[] = [];

  for (const key of SKILL_KEYS) {
    if (proficientSkills.includes(key)) {
      options.push({ key, name: SKILL_LABELS[key] ?? key });
    }
  }
  for (const tool of tools) {
    const label = tool.trim();
    if (label === '') continue;
    options.push({ key: `${EXPERTISE_TOOL_PREFIX}${label}`, name: label });
  }

  return options;
}

/**
 * Explicação de uma escolha de Expertise, para a mensagem de erro: lista as
 * perícias/ferramentas que o personagem domina (ou avisa que não há nenhuma).
 */
export function expertiseOptionsHint(options: FeatureChoiceOption[]): string {
  return options.length > 0
    ? `pode escolher entre ${options.map((option) => option.name).join(', ')}`
    : 'não há nenhuma proficiência para dobrar';
}

/**
 * Ajustes de `skills[].expertise` a partir das escolhas de Expertise gravadas em
 * `classState.choices`: liga as perícias escolhidas (as ferramentas não vivem em
 * `skills`) e desliga as que saíram. Sempre devolve o mapa completo.
 *
 * É chamado no Level Up, no assistente de criação e no rebaixamento de nível,
 * para `expertiseSlots` (as escolhas) e o bônus dobrado (a ficha) nunca
 * divergirem.
 */
export function expertiseSkillsState(
  features: readonly ClassFeatureDefinition[],
  choices: Record<string, string[]>,
  current: Record<string, { proficient: boolean; expertise: boolean }>,
): Record<string, { proficient: boolean; expertise: boolean }> {
  const expertised = new Set<string>();
  for (const feature of features) {
    if (feature.choice?.apply !== 'expertise') continue;
    for (const key of choices[feature.id] ?? []) {
      if (SKILL_KEYS.includes(key)) expertised.add(key);
    }
  }

  const next: Record<string, { proficient: boolean; expertise: boolean }> = {};
  for (const key of SKILL_KEYS) {
    const entry = current[key];
    next[key] = {
      proficient: entry?.proficient ?? false,
      expertise: expertised.has(key),
    };
  }
  return next;
}

/**
 * Estado de runtime da classe.
 *
 * - `active`: toggles ligados (ex.: Fúria);
 * - `used`: usos gastos por recurso;
 * - `choices`: escolha de característica por id dela (ex.: `{ 'fighting-style':
 *   ['defense'] }`). É campo de CONSTRUÇÃO: só o Level Up, o assistente de
 *   criação e o mestre mexem nele (ver `assertPlayerCanPatch`).
 */
export interface ClassState {
  active: string[];
  used: Record<string, number>;
  choices: Record<string, string[]>;
}

/** Teto de opções numa escolha (evita JSONB gigante vindo do cliente). */
export const MAX_FEATURE_CHOICES = 8;

/** Lê/normaliza o estado de classe vindo do JSONB. */
export function normalizeClassState(input: unknown): ClassState {
  const source = (input ?? {}) as { active?: unknown; used?: unknown; choices?: unknown };

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

  const choices: Record<string, string[]> = {};
  if (source.choices && typeof source.choices === 'object') {
    for (const [key, value] of Object.entries(source.choices as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const keys = value
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, MAX_FEATURE_CHOICES);
      if (keys.length > 0) choices[key] = keys;
    }
  }

  return { active, used, choices };
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

/**
 * Devolve o estado de classe com os recursos de recarga CURTA restaurados.
 *
 * Um recurso volta ao máximo quando o seu contador de usos deixa de existir
 * (`used[id]` removido) — a MESMA convenção que a ficha já usa. Só entram os
 * recursos cujo `recharge === 'short'`; recursos de recarga LONGA, sem recarga
 * ('none') e QUALQUER outro contador (inclusive de recursos que não existem
 * mais) ficam intactos. `state.active` (toggles) NÃO é tocado.
 *
 * É a regra autoritativa do SERVIDOR: o frontend deixa de ser a autoridade da
 * recuperação (ver `POST /me/rest/short/complete`).
 */
export function restoreShortRestResources(
  state: ClassState,
  resources: readonly ActiveResource[],
): ClassState {
  const used = { ...state.used };
  for (const resource of resources) {
    if (resource.recharge === 'short') delete used[resource.id];
  }
  return { ...state, used };
}

/**
 * Uma fórmula de Defesa sem Armadura concedida por uma classe.
 *
 * As fórmulas **não se acumulam**: a ficha usa a que der o MAIOR valor. Por
 * isso o ajuste guarda a lista (um Bárbaro/Feiticeiro Dracônico tem as duas).
 */
export interface UnarmoredDefenseOption {
  /** Rótulo para a ficha (nome da feature que concede). */
  label: string;
  /** Base da CA (10 no Bárbaro/Monge; 13 na Linhagem Dracônica). */
  base: number;
  /** Atributo somado além de Destreza (null na Linhagem Dracônica). */
  ability: AbilityKey | null;
  /** Fórmulas que não valem com escudo equipado (Defesa sem Armadura do Monge). */
  requiresNoShield: boolean;
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
  /** Todas as fórmulas de Defesa sem Armadura disponíveis (só uma vale: a maior). */
  unarmoredDefenseOptions: UnarmoredDefenseOption[];
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
  /**
   * Atributos com proficiência de SALVAGUARDA concedida por features/talentos
   * (efeito `save`, ex.: Mente Escorregadia do ladino e o Resiliente). É a mesma
   * fonte que trava as salvaguardas no DTO.
   */
  saveProficiencies: AbilityKey[];
  /** Bônus fixo de CA (Estilo de Luta Defesa: +1). */
  armorClassBonus: number;
  /** O bônus de CA acima só vale com armadura vestida (regra da Defesa). */
  armorClassBonusRequiresArmor: boolean;
  /** Rótulo do bônus de CA (ex.: 'Estilo de Luta (Defesa)'). */
  armorClassBonusLabel: string;
  /** Bônus somado a TODAS as salvaguardas (Aura de Proteção: mod. de CAR). */
  saveBonus: number;
  /** Rótulo do bônus de salvaguarda (ex.: 'Aura de Proteção'). */
  saveBonusLabel: string;
  /**
   * Efeitos de "metade da proficiência" nos testes de habilidade: Pau para Toda
   * Obra do bardo ('checks', arredondando para BAIXO) e Atleta Extraordinário do
   * Campeão ('physicalChecks' — FOR/DES/CON —, arredondando para CIMA). Dois
   * efeitos no MESMO teste nunca somam: vale o maior valor.
   */
  halfProficiency: { target: 'checks' | 'physicalChecks'; round: 'down' | 'up' }[];
  /**
   * Limiar de crítico no d20 (Campeão: 19 e depois 18). `null` = 20 (só o 20
   * natural). O MENOR limiar prevalece quando houver mais de uma fonte.
   */
  critThreshold: number | null;
}

/**
 * Reúne os ajustes mecânicos das features ativas: toggles, recursos, bônus de
 * dano, resistências, deslocamento, dados de crítico, escolhas de característica
 * (Estilo de Luta) e bônus de atributo.
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
  const unarmoredDefenseOptions: UnarmoredDefenseOption[] = [];
  let martialArtsDie = 0;
  let hpBonus = 0;
  let baseWildShapeCr = 0;
  let overrideWildShapeCr: number | null = null;
  const abilityBonuses: Partial<Record<AbilityKey, number>> = {};
  const abilityCaps: Partial<Record<AbilityKey, number>> = {};
  let armorClassBonus = 0;
  let armorClassBonusRequiresArmor = false;
  let armorClassBonusLabel = '';
  let saveBonus = 0;
  let saveBonusLabel = '';
  const halfProficiency: { target: 'checks' | 'physicalChecks'; round: 'down' | 'up' }[] = [];
  const saveProficiencies: AbilityKey[] = [];
  let critThreshold: number | null = null;

  /**
   * Aplica UM efeito. Os efeitos das opções escolhidas (Estilo de Luta) passam
   * por aqui também, com o id/nome da característica que os declarou.
   */
  function applyEffect(
    effect: ClassFeatureEffect,
    effectId: string,
    sourceName: string,
  ): void {
    {
      switch (effect.type) {
        case 'toggle':
          toggles.push({
            id: effectId,
            name: effect.name ?? sourceName,
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
        case 'unarmoredDefense': {
          const base = effect.base ?? 10;
          const ability = effect.unarmoredDefenseAbility ?? null;

          unarmoredDefense = true;
          if (ability) unarmoredDefenseAbility = ability;
          unarmoredDefenseBase = Math.max(unarmoredDefenseBase, base);

          const option: UnarmoredDefenseOption = {
            label: effect.name ?? sourceName,
            base,
            ability,
            requiresNoShield: Boolean(effect.requiresNoShield),
          };
          const known = unarmoredDefenseOptions.some(
            (item) => item.base === base && item.ability === ability && item.label === option.label,
          );
          if (!known) unarmoredDefenseOptions.push(option);
          break;
        }
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
        case 'armorClass':
          // Bônus fixo de CA (Estilo de Luta Defesa). Dois "Estilos de Luta" não
          // se acumulam: vale o MAIOR (o livro proíbe repetir a mesma opção).
          if ((effectValueAtLevel(effect, level) ?? 0) > armorClassBonus) {
            armorClassBonus = effectValueAtLevel(effect, level) ?? 0;
            armorClassBonusLabel = effect.name ?? sourceName;
          }
          if (effect.requiresArmor) armorClassBonusRequiresArmor = true;
          break;
        case 'save':
          // Proficiência de salvaguarda concedida pela feature/talento (o DTO
          // usa esta lista para TRAVAR a salvaguarda).
          if (effect.ability) saveProficiencies.push(effect.ability);
          break;
        case 'saveBonus':
          // Aura de Proteção é única na mesa: também vale o MAIOR, nunca a soma.
          if (effectValueWithAbilityMod(effect, abilities) > saveBonus) {
            saveBonus = effectValueWithAbilityMod(effect, abilities);
            saveBonusLabel = effect.name ?? sourceName;
          }
          break;
        case 'halfProficiency': {
          const target = effect.target === 'physicalChecks' ? 'physicalChecks' : 'checks';
          // O arredondamento padrão do efeito é PARA BAIXO (Pau para Toda Obra);
          // o Atleta Extraordinário do Campeão declara `round: 'up'`.
          const round = effect.round === 'up' ? 'up' : 'down';
          const known = halfProficiency.some(
            (item) => item.target === target && item.round === round,
          );
          if (!known) halfProficiency.push({ target, round });
          break;
        }
        case 'critThreshold': {
          const value = effectValueAtLevel(effect, level) ?? 20;
          critThreshold = critThreshold === null ? value : Math.min(critThreshold, value);
          break;
        }
        default:
          break;
      }
    }
  }

  for (const feature of features) {
    for (const effect of featureEffectsOf(feature)) {
      applyEffect(effect, effect.id ?? feature.id, feature.name);
    }

    // Efeitos das OPÇÕES ESCOLHIDAS: o +1 CA da "Defesa" só vale com essa opção
    // escolhida no Estilo de Luta daquela classe.
    if (feature.choice) {
      const chosen = state.choices[feature.id] ?? [];
      for (const option of feature.choice.options) {
        if (!option.effect || !chosen.includes(option.key)) continue;
        applyEffect(option.effect, option.effect.id ?? feature.id, feature.name);
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
    unarmoredDefenseOptions,
    martialArtsDie,
    hpBonus,
    wildShapeCr: overrideWildShapeCr ?? (baseWildShapeCr > 0 ? baseWildShapeCr : null),
    wildShapeFlying: (overrideWildShapeCr ?? baseWildShapeCr) > 0 && level >= 8,
    abilityBonuses,
    abilityCaps,
    armorClassBonus,
    armorClassBonusRequiresArmor,
    armorClassBonusLabel,
    saveBonus,
    saveBonusLabel,
    saveProficiencies,
    halfProficiency,
    critThreshold,
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

/** Listas de exibição das proficiências (evitam strings soltas no mapa). */
const ARMOR_LIGHT = 'Armaduras leves';
const ARMOR_MEDIUM = 'Armaduras médias';
const ARMOR_HEAVY = 'Armaduras pesadas';
const ARMOR_SHIELD = 'Escudos';
const WEAPON_SIMPLE = 'Armas simples';
const WEAPON_MARTIAL = 'Armas marciais';

/**
 * Proficiências de armadura, arma e ferramenta (PHB 2014, cap. 6).
 *
 * Vive aqui, junto dos demais mapas de MULTICLASSE, porque o livro traz as duas
 * tabelas lado a lado: o que a classe concede quando é a PRIMEIRA (`first`) e o
 * conjunto reduzido de quando se entra nela por multiclasse (`multiclass`).
 * Nenhuma entrada de multiclasse concede salvaguardas (PHB p.164).
 *
 * As listas são o TEXTO exibido na ficha. O efeito mecânico (CA de armadura,
 * ataque de arma) ainda não é calculado a partir daqui.
 */
export const CLASS_PROFICIENCIES: Record<
  string,
  { first: ProficienciesState; multiclass: ProficienciesState }
> = {
  barbarian: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
    multiclass: { armor: [ARMOR_SHIELD], weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL], tools: [] },
  },
  bard: {
    first: {
      armor: [ARMOR_LIGHT],
      weapons: [WEAPON_SIMPLE, 'Bestas de mão', 'Espadas longas', 'Rapieiras', 'Espadas curtas'],
      tools: ['3 instrumentos musicais à sua escolha'],
    },
    multiclass: {
      armor: [ARMOR_LIGHT],
      weapons: [],
      tools: ['1 instrumento musical à sua escolha'],
    },
  },
  cleric: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE],
      tools: [],
    },
    multiclass: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [],
      tools: [],
    },
  },
  druid: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, 'Escudos (não usa metal)'],
      weapons: [
        'Clavas',
        'Adagas',
        'Dardos',
        'Azagaias',
        'Maças',
        'Bordões',
        'Cimitarras',
        'Foices',
        'Fundas',
        'Lanças',
      ],
      tools: ['Kit de herbalismo'],
    },
    multiclass: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [],
      tools: [],
    },
  },
  fighter: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_HEAVY, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
    multiclass: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
  },
  monk: {
    first: {
      armor: [],
      weapons: [WEAPON_SIMPLE, 'Espadas curtas'],
      tools: ['1 ferramenta de artesão ou instrumento musical à sua escolha'],
    },
    multiclass: { armor: [], weapons: [WEAPON_SIMPLE, 'Espadas curtas'], tools: [] },
  },
  paladin: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_HEAVY, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
    multiclass: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
  },
  ranger: {
    first: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
    multiclass: {
      armor: [ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_SHIELD],
      weapons: [WEAPON_SIMPLE, WEAPON_MARTIAL],
      tools: [],
    },
  },
  rogue: {
    first: {
      armor: [ARMOR_LIGHT],
      weapons: [WEAPON_SIMPLE, 'Bestas de mão', 'Espadas longas', 'Rapieiras', 'Espadas curtas'],
      tools: ['Ferramentas de ladrão'],
    },
    multiclass: { armor: [ARMOR_LIGHT], weapons: [], tools: ['Ferramentas de ladrão'] },
  },
  sorcerer: {
    first: {
      armor: [],
      weapons: ['Adagas', 'Dardos', 'Fundas', 'Bordões', 'Bestas leves'],
      tools: [],
    },
    multiclass: { armor: [], weapons: [], tools: [] },
  },
  warlock: {
    first: { armor: [ARMOR_LIGHT], weapons: [WEAPON_SIMPLE], tools: [] },
    multiclass: { armor: [ARMOR_LIGHT], weapons: [WEAPON_SIMPLE], tools: [] },
  },
  wizard: {
    first: {
      armor: [],
      weapons: ['Adagas', 'Dardos', 'Fundas', 'Bordões', 'Bestas leves'],
      tools: [],
    },
    multiclass: { armor: [], weapons: [], tools: [] },
  },
};

/**
 * Perícias à escolha concedidas ao ENTRAR na classe por multiclasse. O livro dá
 * uma perícia ao Bardo (qualquer), ao Patrulheiro e ao Ladino (da lista da
 * classe) — os demais não concedem perícia na multiclasse.
 */
const MULTICLASS_SKILL_COUNT: Record<string, number> = { bard: 1, ranger: 1, rogue: 1 };

/** Proficiências vazias (ficha sem classe ou classe que não concede nada). */
export function emptyProficiencies(): ProficienciesState {
  return { armor: [], weapons: [], tools: [] };
}

/**
 * Lê/normaliza as proficiências vindas do JSONB: só texto, sem repetição e sem
 * vazio. Qualquer outra coisa é descartada (dado antigo não quebra a leitura).
 */
export function normalizeProficiencies(input: unknown): ProficienciesState {
  const source = (input ?? {}) as { armor?: unknown; weapons?: unknown; tools?: unknown };

  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const text = item.trim().slice(0, 120);
      if (text !== '') seen.add(text);
    }
    return [...seen].slice(0, 60);
  };

  return { armor: list(source.armor), weapons: list(source.weapons), tools: list(source.tools) };
}

/** Soma proficiências sem repetir, mantendo a ordem de quem veio primeiro. */
export function mergeProficiencies(
  ...grants: ProficienciesState[]
): ProficienciesState {
  const merge = (pick: (grant: ProficienciesState) => string[]): string[] => {
    const seen = new Set<string>();
    for (const grant of grants) for (const item of pick(grant)) seen.add(item);
    return [...seen];
  };

  return {
    armor: merge((grant) => grant.armor),
    weapons: merge((grant) => grant.weapons),
    tools: merge((grant) => grant.tools),
  };
}

/** Proficiências do nível 1 quando a classe é a PRIMEIRA do personagem. */
export function firstClassProficiencies(classKey: string): ProficienciesState {
  return CLASS_PROFICIENCIES[classKey.trim()]?.first ?? emptyProficiencies();
}

/** Proficiências concedidas ao ENTRAR na classe por multiclasse (PHB p.164). */
export function multiclassProficiencyGrant(classKey: string): ProficienciesState {
  return CLASS_PROFICIENCIES[classKey.trim()]?.multiclass ?? emptyProficiencies();
}

/**
 * Perícia à escolha da ENTRADA por multiclasse (null quando a classe não dá
 * nenhuma). A lista é a mesma da criação da classe — vazia = qualquer perícia.
 */
export function multiclassSkillChoiceFor(classKey: string): MulticlassSkillChoice | null {
  const key = classKey.trim();
  const count = MULTICLASS_SKILL_COUNT[key] ?? 0;
  if (count <= 0) return null;
  return { count, from: classSkillChoice(key).from };
}

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

/** Atributos no formato "Força 13, Destreza 13 e Sabedoria 13". */
function abilityRequirementsLabel(abilities: AbilityKey[]): string {
  const names = abilities.map((ability) => `${ABILITY_NAMES[ability]} ${MULTICLASS_MINIMUM}`);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Mensagem do pré-requisito de atributo para entrar numa classe NOVA.
 *
 * O PHB (cap. 6) exige 13 nos atributos exigidos pela classe nova **e também
 * por todas as classes que o personagem já possui**, então a mensagem cita cada
 * classe que está bloqueando:
 *
 *   "Para entrar em Ladino você precisa de Destreza 13; para continuar como
 *    Paladino você precisa de Força 13 e Carisma 13"
 *
 * Devolve '' quando o pré-requisito está atendido. Os valores comparados são os
 * atributos GRAVADOS na ficha (a mesma referência que o sistema já usava).
 */
export function multiclassPrerequisiteLabel(
  classKey: string,
  abilities: Record<AbilityKey, number>,
  entries: ClassEntry[] = [],
): string {
  const clauses: string[] = [];

  const definition = getClassDefinition(classKey);
  const newClassMissing = multiclassMissingAbilities(classKey, abilities);
  if (definition && newClassMissing.length > 0) {
    clauses.push(
      `Para entrar em ${definition.name} você precisa de ${abilityRequirementsLabel(newClassMissing)}`,
    );
  }

  for (const entry of entries) {
    if (entry.classKey === classKey) continue;

    const existingMissing = multiclassMissingAbilities(entry.classKey, abilities);
    const existingDefinition = getClassDefinition(entry.classKey);
    if (existingDefinition && existingMissing.length > 0) {
      clauses.push(
        `para continuar como ${existingDefinition.name} você precisa de ${abilityRequirementsLabel(
          existingMissing,
        )}`,
      );
    }
  }

  return clauses.join('; ');
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

export function mergeAdjustments(base: ClassAdjustments, extra: ClassAdjustments): ClassAdjustments {
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
    unarmoredDefenseOptions: [
      ...base.unarmoredDefenseOptions,
      ...extra.unarmoredDefenseOptions.filter(
        (option) =>
          !base.unarmoredDefenseOptions.some(
            (item) =>
              item.base === option.base &&
              item.ability === option.ability &&
              item.label === option.label,
          ),
      ),
    ],
    martialArtsDie: Math.max(base.martialArtsDie, extra.martialArtsDie),
    hpBonus: base.hpBonus + extra.hpBonus,
    wildShapeCr:
      base.wildShapeCr === null && extra.wildShapeCr === null
        ? null
        : Math.max(base.wildShapeCr ?? 0, extra.wildShapeCr ?? 0),
    wildShapeFlying: base.wildShapeFlying || extra.wildShapeFlying,
    abilityBonuses,
    abilityCaps: { ...extra.abilityCaps, ...base.abilityCaps },
    saveProficiencies: [...new Set([...base.saveProficiencies, ...extra.saveProficiencies])],
    // Bônus de CA e de salvaguarda NÃO somam entre classes (dois "Estilos de
    // Luta" ou duas "Auras" valem uma vez só): o maior vence.
    armorClassBonus: Math.max(base.armorClassBonus, extra.armorClassBonus),
    armorClassBonusRequiresArmor:
      base.armorClassBonusRequiresArmor || extra.armorClassBonusRequiresArmor,
    armorClassBonusLabel:
      extra.armorClassBonus > base.armorClassBonus
        ? extra.armorClassBonusLabel
        : base.armorClassBonusLabel,
    saveBonus: Math.max(base.saveBonus, extra.saveBonus),
    saveBonusLabel:
      extra.saveBonus > base.saveBonus ? extra.saveBonusLabel : base.saveBonusLabel,
    halfProficiency: [
      ...base.halfProficiency,
      ...extra.halfProficiency.filter(
        (item) =>
          !base.halfProficiency.some(
            (known) => known.target === item.target && known.round === item.round,
          ),
      ),
    ],
    // O MENOR limiar prevalece (dois Campeões não "somam" críticos).
    critThreshold:
      base.critThreshold === null && extra.critThreshold === null
        ? null
        : Math.min(base.critThreshold ?? 20, extra.critThreshold ?? 20),
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
    unarmoredDefenseOptions: [],
    martialArtsDie: 0,
    hpBonus: 0,
    wildShapeCr: null,
    wildShapeFlying: false,
    abilityBonuses: {},
    abilityCaps: {},
    saveProficiencies: [],
    armorClassBonus: 0,
    armorClassBonusRequiresArmor: false,
    armorClassBonusLabel: '',
    saveBonus: 0,
    saveBonusLabel: '',
    halfProficiency: [],
    critThreshold: null,
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
 * Feature de TALENTO já gravada na ficha (source: 'feat'), no formato mínimo que
 * o motor de talentos precisa ler. Espelha os campos do schema da característica.
 */
export interface FeatFeatureInput {
  /** Id estável do talento no catálogo (`shared/feats`). */
  featId?: string;
  /** Nome do talento (fallback quando `featId` não estiver gravado). */
  name: string;
  /** Atributo escolhido nos "meio-talentos" (ex.: Atleta: FOR ou DES). */
  featAbility?: AbilityKey;
}

/**
 * Ajustes mecânicos dos TALENTOS escolhidos no Level Up (source: 'feat').
 *
 * Os talentos entram pelo MESMO pipeline das classes: cada talento é resolvido
 * no catálogo (`shared/feats`), os efeitos declarados viram uma feature sintética
 * e `computeClassAdjustments` os aplica com as mesmas regras (o maior prevalece
 * em CA/salvaguarda, soma em atributo/PV...). O resultado é combinado com o das
 * classes via `mergeAdjustments`.
 *
 * O `abilityChoice` (half-feats) vira um `abilityBonus` no atributo ESCOLHIDO
 * (`featAbility`); o `saveProficiency` do Resiliente vira um efeito `save` nesse
 * mesmo atributo (reaproveita a Mente Escorregadia do ladino).
 */
export function computeFeatAdjustments(
  features: readonly FeatFeatureInput[],
  level: number,
  abilities?: Record<AbilityKey, number>,
): ClassAdjustments {
  const synthetic: ActiveClassFeature[] = [];

  for (const feature of features) {
    const feat = feature.featId ? getFeat(feature.featId) : undefined;
    if (!feat) continue;

    const effects: ClassFeatureEffect[] = [...(feat.effects ?? [])];

    // Half-feat: o +1 no atributo ESCOLHIDO (o valor de `abilityChoice.amount`).
    if (feat.abilityChoice && feature.featAbility) {
      effects.push({
        type: 'abilityBonus',
        ability: feature.featAbility,
        value: feat.abilityChoice.amount,
        max: 20,
      });
      // Resiliente: proficiência na salvaguarda do atributo escolhido.
      if (feat.saveProficiency) {
        effects.push({ type: 'save', ability: feature.featAbility });
      }
    }

    if (effects.length === 0) continue;
    synthetic.push({
      id: feat.id,
      name: feat.name,
      level: 0,
      description: feat.description,
      effects,
      source: 'class',
    });
  }

  return computeClassAdjustments(synthetic, level, { active: [], used: {}, choices: {} }, abilities);
}

/**
 * Nível de conjurador da TABELA COMBINADA de multiclasse (PHB 2014, cap. 6):
 * conjurador completo com o nível cheio + METADE do meio-conjurador + UM TERÇO
 * do terço-conjurador, tudo **arredondado para baixo**. O bruxo fica de fora
 * (Magia de Pacto tem espaços próprios).
 *
 * Esta função só vale para personagens com DUAS OU MAIS classes conjuradoras:
 * com uma só, a tabela é a da PRÓPRIA classe — ver `spellSlotsForClasses`.
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

/**
 * Entradas que conjuram com a tabela de espaços do livro (o bruxo NÃO entra:
 * ele usa Magia de Pacto, calculada à parte).
 */
function spellcastingEntries(
  entries: ClassEntry[],
): { entry: ClassEntry; type: 'full' | 'half' | 'third' }[] {
  const casters: { entry: ClassEntry; type: 'full' | 'half' | 'third' }[] = [];

  for (const entry of entries) {
    const type = effectiveSpellcasting(entry)?.type;
    if (type === 'full' || type === 'half' || type === 'third') casters.push({ entry, type });
  }

  return casters;
}

/**
 * Nível de conjurador de uma classe na tabela DELA (PHB 2014, cap. 3).
 *
 * Com uma classe só, a tabela é a da própria classe — e as equivalências do
 * livro são: conjurador completo = nível cheio; meio-conjurador = **metade
 * arredondada para CIMA** (Paladino 3 → 3 espaços de 1º, Paladino 5 → 4 de 1º e
 * 2 de 2º); terço-conjurador = **um terço arredondado para CIMA** (Cavaleiro
 * Arcano 4 → 3 espaços de 1º).
 *
 * Meio-conjurador só conjura a partir do 2º nível da classe e terço-conjurador a
 * partir do 3º: abaixo disso o nível de conjurador é 0 (nenhum espaço).
 *
 * O arredondamento para BAIXO é exclusivo da tabela COMBINADA de multiclasse
 * (`multiclassCasterLevel`).
 */
export function ownCasterLevel(entry: ClassEntry): number {
  const type = effectiveSpellcasting(entry)?.type;

  if (type === 'full') return entry.level;
  if (type === 'half') return entry.level < 2 ? 0 : Math.ceil(entry.level / 2);
  if (type === 'third') return entry.level < 3 ? 0 : Math.ceil(entry.level / 3);
  return 0;
}

/**
 * Espaços de magia do personagem (sem a Magia de Pacto, que vai à parte).
 *
 * Regra do PHB 2014:
 *  • NENHUMA classe conjuradora (ou só bruxo) ⇒ sem espaços;
 *  • UMA classe conjuradora ⇒ a tabela da PRÓPRIA classe (`ownCasterLevel`) —
 *    Guerreiro 5 / Paladino 4 usa a tabela do Paladino, porque o Guerreiro sem
 *    Cavaleiro Arcano não conjura;
 *  • DUAS OU MAIS ⇒ a tabela COMBINADA do cap. 6 (`multiclassCasterLevel`,
 *    meio e terço arredondados para baixo).
 */
export function spellSlotsForClasses(entries: ClassEntry[]): { level: number; max: number }[] {
  const casters = spellcastingEntries(entries);
  if (casters.length === 0) return [];

  if (casters.length === 1) return spellSlotsForCasterLevel(ownCasterLevel(casters[0].entry));
  return spellSlotsForCasterLevel(multiclassCasterLevel(entries));
}

/**
 * Quantas magias a classe PREPARA por dia (PHB 2014, cap. 3/10).
 *
 *  • Clérigo, Druida e Mago: modificador do atributo + NÍVEL NA CLASSE (mínimo 1).
 *  • Paladino: modificador de Carisma + **METADE** do nível de paladino,
 *    arredondado para BAIXO (mínimo 1) — e só a partir do 2º nível, quando a
 *    conjuração começa (no 1º são 0 magias e 0 espaços).
 *  • `null` = a classe NÃO prepara magias: Bardo, Patrulheiro, Feiticeiro,
 *    Bruxo e as subclasses de terço-conjurador usam a lista fixa de conhecidas.
 *
 * O cálculo é POR CLASSE, com o atributo e o nível dela — no multiclasse não
 * existe um total único (Mago e Clérigo preparam, cada um, as suas).
 */
export function preparedSpellCountFor(
  entry: ClassEntry,
  abilityModifier: number,
): number | null {
  const config = effectiveSpellcasting(entry);
  if (!config || config.learning !== 'prepared') return null;

  if (config.type === 'full') return Math.max(1, abilityModifier + entry.level);

  if (config.type === 'half') {
    if (entry.level < 2) return 0;
    return Math.max(1, abilityModifier + Math.floor(entry.level / 2));
  }

  return null;
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
  /** O que a classe concede ao ser a PRIMEIRA do personagem (nível 1). */
  firstProficiencies: ProficienciesState;
  /** O que ela concede ao ENTRAR por multiclasse (PHB p.164). */
  multiclassProficiencies: ProficienciesState;
  /** Perícia à escolha da entrada por multiclasse (null quando não concede). */
  multiclassSkillChoice: MulticlassSkillChoice | null;
  /**
   * Perícias à escolha quando a classe é a PRIMEIRA do personagem (criação):
   * quantas e de qual lista. É o que o assistente usa para podar as escolhas ao
   * trocar de classe inicial (lista vazia = qualquer perícia, como no Bardo).
   */
  skillChoice: ClassSkillChoice;
  /**
   * Escolhas de característica feitas no NÍVEL 1 da classe — é o que a entrada
   * por multiclasse (e a criação) precisa pedir na hora (Estilo de Luta do
   * guerreiro, Inimigo Favorito e Explorador Nato do patrulheiro).
   */
  featureChoices: FeatureChoiceInfo[];
  /**
   * Escolhas declaradas pelas SUBCLASSES desta classe, com o nome da subclasse
   * em `subclass` (vazio de `chosen`, porque a subclasse ainda não foi
   * escolhida).
   *
   * Serve ao assistente de Level Up quando a subclasse é escolhida no MESMO
   * nível em que ela já pede uma escolha (Caçador: Presa do Caçador no 3º): o
   * DTO da classe só passa a enxergar as escolhas da subclasse depois que ela
   * está gravada na ficha.
   */
  subclassChoices: (FeatureChoiceInfo & { subclass: string })[];
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
    // O bloqueio cita a classe nova E as classes que o personagem já tem (PHB).
    const missing = multiclassPrerequisiteLabel(summary.key, abilities, entries);
    const definition = getClassDefinition(summary.key);

    return {
      ...summary,
      eligible: alreadyHas || missing === '',
      missing: alreadyHas ? '' : missing,
      asiLevels: [...asiLevelsFor(summary.key)],
      subclassNames: definition?.subclasses.map((subclass) => subclass.name) ?? [],
      firstProficiencies: firstClassProficiencies(summary.key),
      multiclassProficiencies: multiclassProficiencyGrant(summary.key),
      multiclassSkillChoice: multiclassSkillChoiceFor(summary.key),
      skillChoice: classSkillChoice(summary.key),
      // As escolhas de NÍVEL 1 da classe: o nível vai junto para esconder as
      // opções de nível superior (Invocações Místicas exigem 5º+).
      featureChoices: definition
        ? featureChoiceInfo(definition, {}, '', {}, 1).filter((info) => info.level === 1)
        : [],
      // Só as escolhas que vêm DA SUBCLASSE (as da classe já estão acima).
      subclassChoices: definition
        ? definition.subclasses.flatMap((subclass) =>
            featureChoiceInfo(definition, {}, subclass.name)
              .filter(
                (info) =>
                  !definition.features.some((feature) => feature.id === info.featureId),
              )
              .map((info) => ({ ...info, subclass: subclass.name })),
          )
        : [],
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

// ---------------------------------------------------------------------------
// Perícias de classe (usadas na criação de personagem)
//
// Cada classe do PHB 2014 deixa o jogador escolher algumas perícias de uma
// lista fixa. Isso é dados da CLASSE (não muda com o nível), então vive aqui
// junto do resto do registro — o assistente de criação usa o mesmo mapa que o
// resto das regras, sem duplicar a lista de perícias.
// ---------------------------------------------------------------------------

/** Perícias que a classe oferece: quantas escolher e de qual lista. */
export interface ClassSkillChoice {
  /** Quantas perícias o jogador escolhe da lista. */
  count: number;
  /**
   * Chaves de perícia aceitas (ver SKILLS em shared/dnd5e.ts).
   * Lista vazia = qualquer uma das 18 perícias.
   */
  from: string[];
}

/** Listas do PHB 2014 (as chaves são as de `shared/dnd5e.ts`). */
export const CLASS_SKILL_CHOICES: Record<string, ClassSkillChoice> = {
  barbarian: {
    count: 2,
    from: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
  },
  bard: { count: 3, from: [] },
  cleric: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
  druid: {
    count: 2,
    from: [
      'arcana',
      'animalHandling',
      'insight',
      'medicine',
      'nature',
      'perception',
      'religion',
      'survival',
    ],
  },
  fighter: {
    count: 2,
    from: [
      'acrobatics',
      'animalHandling',
      'athletics',
      'history',
      'insight',
      'intimidation',
      'perception',
      'survival',
    ],
  },
  monk: { count: 2, from: ['acrobatics', 'athletics', 'stealth', 'history', 'insight', 'religion'] },
  paladin: {
    count: 2,
    from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
  },
  ranger: {
    count: 3,
    from: [
      'animalHandling',
      'athletics',
      'stealth',
      'insight',
      'investigation',
      'nature',
      'perception',
      'survival',
    ],
  },
  rogue: {
    count: 4,
    from: [
      'acrobatics',
      'athletics',
      'deception',
      'stealth',
      'intimidation',
      'insight',
      'investigation',
      'perception',
      'performance',
      'persuasion',
      'sleightOfHand',
    ],
  },
  sorcerer: {
    count: 2,
    from: ['arcana', 'deception', 'intimidation', 'insight', 'persuasion', 'religion'],
  },
  warlock: {
    count: 2,
    from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
  },
  wizard: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
};

/** Perícias oferecidas por uma classe (padrão do livro para classe sem lista). */
export function classSkillChoice(classKey: string): ClassSkillChoice {
  return CLASS_SKILL_CHOICES[classKey.trim()] ?? { count: 2, from: [] };
}

/**
 * Perícias que o personagem escolhe na criação, já somando o multiclasse: as
 * quantidades somam e a lista é a UNIÃO das oferecidas (lista vazia em
 * qualquer classe = qualquer perícia entra, como no Bardo).
 */
export function creationSkillChoice(entries: ClassEntry[]): ClassSkillChoice {
  let count = 0;
  let any = false;
  const from = new Set<string>();

  for (const entry of entries) {
    const choice = classSkillChoice(entry.classKey);
    count += choice.count;
    if (choice.from.length === 0) any = true;
    else choice.from.forEach((skill) => from.add(skill));
  }

  return { count, from: any ? [] : [...from] };
}
