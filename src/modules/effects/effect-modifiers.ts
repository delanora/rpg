import { z } from 'zod';
import { ABILITY_KEYS, ABILITY_LABELS, type AbilityKey } from '../shared/dnd5e.js';
import { conditionSchema, type Condition } from '../shared/conditions.js';

/**
 * FASE 6.5B — MODIFICADORES MECÂNICOS GENÉRICOS de um Effect.
 *
 * O pipeline de rolagem NUNCA conhece nome de magia/feature: ele lê apenas os
 * modificadores tipados abaixo. Quem sabe que "Bless" dá +1d4 em ataques é a
 * futura DEFINIÇÃO do efeito (6.6 Spell Engine), que cria instâncias com estes
 * modificadores — o motor continua cego ao `label`/`definitionId`.
 *
 * União discriminada (e não um objeto cheio de campos opcionais) para o Zod
 * recusar combinações inválidas (ex.: dado sem `sides`, AC com `roll`).
 */

export const EFFECT_ROLL_TYPES = ['attack', 'save', 'check'] as const;
export type EffectRollType = (typeof EFFECT_ROLL_TYPES)[number];

/**
 * Dados que a engine sabe rolar. Conjunto FECHADO de propósito: um modificador
 * de efeito não é uma expressão livre do cliente.
 */
export const EFFECT_MODIFIER_DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

const abilitySchema = z.enum([...ABILITY_KEYS] as [AbilityKey, ...AbilityKey[]]);
const rollScope = {
  roll: z.enum(EFFECT_ROLL_TYPES),
  /** Restringe o modificador a UM atributo (saves/checks). Ausente = todos. */
  ability: abilitySchema.optional(),
};
const flatValue = z.number().int().min(-100).max(100);

export const effectModifierSchema = z.discriminatedUnion('kind', [
  /** Bônus fixo (+2) em ataque, salvaguarda ou teste de habilidade. */
  z.object({ kind: z.literal('roll-flat'), ...rollScope, value: flatValue }),
  /** Dado extra rolado pelo SERVIDOR (+1d4, -1d4). */
  z.object({
    kind: z.literal('roll-dice'),
    ...rollScope,
    count: z.number().int().min(1).max(20),
    sides: z.number().int().refine(
      (sides) => (EFFECT_MODIFIER_DICE_SIDES as readonly number[]).includes(sides),
      { message: 'Dado não suportado pelo motor de efeitos.' },
    ),
    sign: z.union([z.literal(1), z.literal(-1)]),
  }),
  /** Fonte de vantagem (qualquer quantidade = uma fonte; nunca "dupla"). */
  z.object({ kind: z.literal('roll-advantage'), ...rollScope }),
  /** Fonte de desvantagem (idem). */
  z.object({ kind: z.literal('roll-disadvantage'), ...rollScope }),
  /** CA derivada (+1, +2, -1). Nunca grava na ficha. */
  z.object({ kind: z.literal('ac-flat'), value: flatValue }),
  /** Deslocamento derivado em metros (+3, -3). Nunca grava na ficha. */
  z.object({ kind: z.literal('speed-flat'), value: z.number().int().min(-1000).max(1000) }),
]);
export type EffectModifier = z.infer<typeof effectModifierSchema>;

/** Limite duro por instância (validado na borda e na leitura). */
export const MAX_EFFECT_MODIFIERS = 12;
export const effectModifierListSchema = z.array(effectModifierSchema).max(MAX_EFFECT_MODIFIERS);
export type EffectModifierList = z.infer<typeof effectModifierListSchema>;

/**
 * Leitura FECHADA do JSON gravado: qualquer coisa inválida vira lista vazia
 * (um efeito nunca passa a valer mais por dado corrompido).
 */
export function parseEffectModifiers(value: unknown): EffectModifierList {
  const parsed = effectModifierListSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * FASE 6.5C — Conditions que ESTE efeito declara aplicar.
 *
 * É DEFINIÇÃO da instância de efeito ("este efeito deve aplicar Paralyzed"),
 * não o estado mecânico real (que vive em `mechanicalState.conditions[]`).
 * Usa o `conditionSchema` EXISTENTE — nenhum enum paralelo de Conditions.
 */
export const MAX_EFFECT_CONDITIONS = 20;
export const effectConditionListSchema = z.array(conditionSchema).max(MAX_EFFECT_CONDITIONS);
export type EffectConditionList = z.infer<typeof effectConditionListSchema>;

/** Leitura FECHADA: JSON inválido nunca vira Condition aplicada. */
export function parseEffectConditions(value: unknown): EffectConditionList {
  const parsed = effectConditionListSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/** Rótulos PT-BR das Conditions (reexportado para o log do Effect). */
export type EffectCondition = Condition;

/** Origem de um modificador derivado — mantém rastreabilidade até a instância. */
export interface EffectModifierSource {
  effectId: string;
  label: string;
  visibility: 'public' | 'private';
}

/**
 * Rótulo SEGURO para o cliente: efeito privado não entrega nome/identidade
 * (mas o bônus mecânico continua valendo — privacidade não é inatividade).
 */
export function publicEffectLabel(source: EffectModifierSource): string | null {
  return source.visibility === 'private' ? null : source.label;
}

/** Dado extra já rolado (ou a rolar) por uma fonte de efeito. */
export interface EffectDiceModifier {
  count: number;
  sides: number;
  sign: 1 | -1;
  source: EffectModifierSource;
}

/** Modificadores de UM tipo de rolagem, normalizados para o pipeline. */
export interface EffectRollModifiers {
  /** Soma dos bônus fixos. */
  bonus: number;
  /** Dados extras — rolados pelo servidor, nunca somados ao bônus fixo. */
  dice: EffectDiceModifier[];
  /** Chaves das fontes de vantagem (para `resolveRollMode`). */
  advantage: string[];
  /** Chaves das fontes de desvantagem. */
  disadvantage: string[];
  /** Fontes que contribuíram (tooltip/log). */
  sources: EffectModifierSource[];
}

/** Resumo derivado, já sem DB: é o que os pipelines consomem. */
export interface EffectModifierSet {
  attack: EffectRollModifiers;
  saves: Record<AbilityKey, EffectRollModifiers>;
  checks: Record<AbilityKey, EffectRollModifiers>;
  /** Soma dos `ac-flat` ativos. */
  acBonus: number;
  /** Soma dos `speed-flat` ativos (metros). */
  speedBonus: number;
  /** Todas as instâncias que contribuíram (alguma coisa). */
  sources: EffectModifierSource[];
}

export function emptyRollModifiers(): EffectRollModifiers {
  return { bonus: 0, dice: [], advantage: [], disadvantage: [], sources: [] };
}

export function emptyEffectModifierSet(): EffectModifierSet {
  const perAbility = () =>
    Object.fromEntries(ABILITY_KEYS.map((ability) => [ability, emptyRollModifiers()])) as Record<
      AbilityKey,
      EffectRollModifiers
    >;
  return {
    attack: emptyRollModifiers(),
    saves: perAbility(),
    checks: perAbility(),
    acBonus: 0,
    speedBonus: 0,
    sources: [],
  };
}

/** Linha mínima de efeito ativo necessária para compor o resumo. */
export interface ActiveEffectRow {
  id: string;
  label: string;
  visibility: string;
  modifiers: unknown;
}

function addSource(target: EffectModifierSource[], source: EffectModifierSource): void {
  if (!target.some((item) => item.effectId === source.effectId)) target.push(source);
}

/**
 * Compõe o resumo de modificadores a partir dos efeitos ATIVOS de um alvo.
 *
 * Regras (Fase 6.5B, sem conteúdo de PHB):
 *  • numéricos STACKAM (dois efeitos +1 e +2 = +3) — a regra "mesma magia não
 *    acumula" pertence à camada de definição/aplicação, não ao motor;
 *  • dados viram pool independente (+1d4 e +1d6 rolam os dois);
 *  • vantagem/desvantagem são CONJUNTOS de fontes: qualquer quantidade vira
 *    uma fonte, e a presença dos dois lados cancela (`resolveRollMode`);
 *  • nada depende da ordem das linhas no banco nem do `label`.
 */
export function buildEffectModifierSet(rows: readonly ActiveEffectRow[]): EffectModifierSet {
  const set = emptyEffectModifierSet();
  for (const row of rows) {
    const source: EffectModifierSource = {
      effectId: row.id,
      label: row.label,
      visibility: row.visibility === 'private' ? 'private' : 'public',
    };
    const modifiers = parseEffectModifiers(row.modifiers);
    let contributed = false;
    for (const modifier of modifiers) {
      if (modifier.kind === 'ac-flat') {
        set.acBonus += modifier.value;
        contributed = true;
        addSource(set.sources, source);
        continue;
      }
      if (modifier.kind === 'speed-flat') {
        set.speedBonus += modifier.value;
        contributed = true;
        addSource(set.sources, source);
        continue;
      }
      // Modificador de rolagem: entra no escopo declarado e, se houver
      // `ability`, SÓ naquele atributo (saves e checks).
      const targets: EffectRollModifiers[] = [
        ...(modifier.roll === 'attack' ? [set.attack] : []),
        ...(modifier.roll === 'save' ? abilityTargets(set.saves, modifier.ability) : []),
        ...(modifier.roll === 'check' ? abilityTargets(set.checks, modifier.ability) : []),
      ];
      for (const target of targets) {
        applyRollModifier(target, modifier, source);
        contributed = true;
      }
      if (contributed) addSource(set.sources, source);
    }
  }
  return set;
}

function abilityTargets(
  map: Record<AbilityKey, EffectRollModifiers>,
  ability: AbilityKey | undefined,
): EffectRollModifiers[] {
  return ability ? [map[ability]] : ABILITY_KEYS.map((key) => map[key]);
}

function applyRollModifier(
  target: EffectRollModifiers,
  modifier: EffectModifier,
  source: EffectModifierSource,
): void {
  if (modifier.kind === 'roll-flat') {
    target.bonus += modifier.value;
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-dice') {
    target.dice.push({
      count: modifier.count,
      sides: modifier.sides,
      sign: modifier.sign,
      source,
    });
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-advantage') {
    target.advantage.push(`effect:${source.effectId}:advantage`);
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-disadvantage') {
    target.disadvantage.push(`effect:${source.effectId}:disadvantage`);
    addSource(target.sources, source);
  }
}

/** Seleciona o resumo de UMA rolagem (attack, ou save/check de um atributo). */
export function rollModifiersFor(
  set: EffectModifierSet,
  roll: EffectRollType,
  ability?: AbilityKey,
): EffectRollModifiers {
  if (roll === 'attack') return set.attack;
  const map = roll === 'save' ? set.saves : set.checks;
  return ability ? map[ability] : emptyRollModifiers();
}

/**
 * Rótulos das fontes para exibição: público mostra o nome; privado mostra
 * `null` (o bônus continua valendo, mas o segredo não vaza).
 */
export function effectSourceLabels(set: EffectModifierSet): (string | null)[] {
  return set.sources.map(publicEffectLabel);
}

/** Rótulos seguros das fontes que contribuíram para UMA rolagem. */
export function rollModifierSourceLabels(mods: EffectRollModifiers): (string | null)[] {
  return mods.sources.map(publicEffectLabel);
}

/** Peças de CA derivadas dos efeitos (para `computeArmorClass`). */
export function effectArmorClassBonuses(
  set: EffectModifierSet,
): { label: string | null; value: number }[] {
  if (set.acBonus === 0) return [];
  const labels = effectSourceLabels(set).filter((label): label is string => label !== null);
  return [{ label: labels.length > 0 ? labels.join(', ') : null, value: set.acBonus }];
}

/** Texto humano de um modificador (para a UI do Mestre e o log). */
export function describeEffectModifier(modifier: EffectModifier): string {
  const scope =
    modifier.kind === 'ac-flat' || modifier.kind === 'speed-flat'
      ? ''
      : `${ROLL_TYPE_LABELS[modifier.roll]}${modifier.ability ? ` (${ABILITY_LABELS[modifier.ability]})` : ''}`;
  if (modifier.kind === 'ac-flat') return `CA ${modifier.value >= 0 ? '+' : ''}${modifier.value}`;
  if (modifier.kind === 'speed-flat') {
    return `Deslocamento ${modifier.value >= 0 ? '+' : ''}${modifier.value} m`;
  }
  if (modifier.kind === 'roll-flat') {
    return `${modifier.value >= 0 ? '+' : ''}${modifier.value} em ${scope}`;
  }
  if (modifier.kind === 'roll-dice') {
    return `${modifier.sign > 0 ? '+' : '−'}${modifier.count}d${modifier.sides} em ${scope}`;
  }
  if (modifier.kind === 'roll-advantage') return `Vantagem em ${scope}`;
  return `Desvantagem em ${scope}`;
}

export const ROLL_TYPE_LABELS: Record<EffectRollType, string> = {
  attack: 'ataques',
  save: 'salvaguardas',
  check: 'testes de habilidade',
};

