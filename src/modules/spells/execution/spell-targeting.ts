/**
 * FASE 6.6E — SPELL TARGETING DEFINITION.
 *
 * Diz QUANTOS alvos e QUAIS criaturas uma conjuração aceita, e quais fatos
 * espaciais ela exige. Pertence à EXECUÇÃO da magia (o cast), NUNCA à Effect
 * Definition: o efeito durável não sabe de alcance/quantidade.
 *
 * Nenhuma regra fica no núcleo por nome de magia: Bless declara "3 criaturas,
 * +1 por espaço acima do 1º, 30 pés, caminho livre"; Hold Person declara
 * "1 humanoide, +1 por espaço acima do 2º, 60 pés, visão, caminho livre e 30
 * pés entre os alvos". O `spell-cast.service` só consome estes dados.
 *
 * Unidade canônica: PÉS. A conversão para metros (se a UI usar metros) é só de
 * apresentação — nunca da regra.
 */

import type { AreaTargetingDefinition } from './area-targeting.js';
import { areaTargetingSummary } from './area-targeting.js';

export type SpellTargetKind = 'creatures';

/** Filtro de alvo. Nesta fase só o tipo de criatura é executável. */
export type SpellTargetFilter = { kind: 'creature-type'; value: 'humanoid' };

/** Restrição sobre o CONJUNTO de alvos escolhidos. */
export type SpellGroupConstraint = { kind: 'mutual-distance'; feet: number };

/** Alcance. `self` existe para crescer sem inventar geometria. */
export type SpellRangeDefinition =
  | { kind: 'distance'; feet: number }
  | { kind: 'self' };

/**
 * Quantidade de alvos em função do espaço usado.
 *
 * `baseSlotLevel` é o nível de espaço do texto base da magia. Espaços acima
 * somam `additionalPerSlotLevel` por passo; truques (castAtLevel 0) e espaços
 * abaixo do base usam o valor BASE — nunca um número negativo.
 */
export interface SpellTargetCountDefinition {
  base: number;
  baseSlotLevel: number;
  additionalPerSlotLevel: number;
}

export interface ExplicitSpellTargetingDefinition {
  kind: SpellTargetKind;
  minTargets: number;
  targetCount: SpellTargetCountDefinition;
  range: SpellRangeDefinition;
  allowSelf: boolean;
  /** Exige que o conjurador VEJA o alvo (`canSee` mecânico + geometria). */
  requiresSight: boolean;
  /** Exige caminho livre (total cover bloqueia). */
  requiresClearPath: boolean;
  filters: readonly SpellTargetFilter[];
  groupConstraints: readonly SpellGroupConstraint[];
}

/**
 * 6.6J.3: o TARGETING passa a ter duas famílias — alvos EXPLÍCITOS (Bless, Hold
 * Person, Chama Sagrada...) e ÁREA (forma + origem + política de afetados).
 * Quem consome a definição SEMPRE discrimina por `kind`; nenhum `if` por nome
 * de magia.
 */
export type SpellTargetingDefinition =
  | ExplicitSpellTargetingDefinition
  | AreaTargetingDefinition;

export function isAreaTargeting(
  targeting: SpellTargetingDefinition,
): targeting is AreaTargetingDefinition {
  return targeting.kind === 'area';
}

export function isExplicitTargeting(
  targeting: SpellTargetingDefinition,
): targeting is ExplicitSpellTargetingDefinition {
  return targeting.kind === 'creatures';
}

/**
 * Quantidade MÁXIMA de alvos — DERIVADA da definição + `castAtLevel`.
 *
 * O cliente nunca envia este número: ele é consequência do espaço escolhido no
 * COMMIT (6.6C). Ex.: Bless slot 2 → 4; Hold Person slot 3 → 2.
 */
export function maximumTargets(
  targeting: ExplicitSpellTargetingDefinition,
  castAtLevel: number,
): number {
  const { base, baseSlotLevel, additionalPerSlotLevel } = targeting.targetCount;
  const level = Math.max(baseSlotLevel, castAtLevel);
  const steps = Math.max(0, level - baseSlotLevel);
  return base + steps * additionalPerSlotLevel;
}

/** Alcance em pés (`null` quando a definição não usa distância). */
export function targetingRangeFeet(
  targeting: ExplicitSpellTargetingDefinition,
): number | null {
  return targeting.range.kind === 'distance' ? targeting.range.feet : null;
}

/**
 * Resumo SEGURO para a UI do Mestre: o cliente recebe o que o SERVIDOR derivou
 * (máximo para o espaço escolhido, alcance em pés, requisitos), nunca escolhe
 * nenhum desses valores.
 */
export function targetingSummary(
  targeting: ExplicitSpellTargetingDefinition,
  castAtLevel: number,
) {
  return {
    kind: targeting.kind,
    minTargets: targeting.minTargets,
    maxTargets: maximumTargets(targeting, castAtLevel),
    castAtLevel,
    rangeFeet: targetingRangeFeet(targeting),
    allowSelf: targeting.allowSelf,
    requiresSight: targeting.requiresSight,
    requiresClearPath: targeting.requiresClearPath,
    filters: targeting.filters.map((filter) => `${filter.kind}:${filter.value}`),
    groupConstraints: targeting.groupConstraints.map((constraint) => ({
      kind: constraint.kind,
      feet: constraint.feet,
    })),
  };
}

/** Resumo do targeting independente da família (explicit × area). */
export function spellTargetingSummary(
  targeting: SpellTargetingDefinition,
  castAtLevel: number,
) {
  return isAreaTargeting(targeting)
    ? areaTargetingSummary(targeting, castAtLevel)
    : targetingSummary(targeting, castAtLevel);
}
