import type { Condition } from '../../shared/conditions.js';
import type { EffectModifier } from '../effect-modifiers.js';
import {
  BLESS_DEFINITION_ID,
  BLESS_LABEL,
  BLESS_MAX_TARGETS,
  blessModifiers,
} from './bless.js';
import {
  HOLD_PERSON_CONDITIONS,
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_LABEL,
} from './hold-person.js';

/**
 * FASE 6.6A — REGISTRY DE EFFECT DEFINITIONS.
 *
 * Uma Effect Definition diz QUAL estado mecânico durável o efeito produz
 * (modificadores/conditions), separada da Spell Execution Definition — que diz
 * COMO a magia resolve. A execução referencia `effectDefinitionId`; nunca copia
 * de novo os modificadores/Conditions.
 *
 * As funções devolvem valores NOVOS a cada uso: o JSON gravado na instância não
 * compartilha array com o registry.
 */
export interface EffectDefinition {
  definitionId: string;
  label: string;
  requiresConcentration: boolean;
  maxTargets: number;
  modifiers: () => EffectModifier[];
  conditions: () => Condition[];
}

export const EFFECT_DEFINITIONS: Record<string, EffectDefinition> = {
  [BLESS_DEFINITION_ID]: {
    definitionId: BLESS_DEFINITION_ID,
    label: BLESS_LABEL,
    requiresConcentration: true,
    maxTargets: BLESS_MAX_TARGETS,
    modifiers: blessModifiers,
    conditions: () => [],
  },
  [HOLD_PERSON_DEFINITION_ID]: {
    definitionId: HOLD_PERSON_DEFINITION_ID,
    label: HOLD_PERSON_LABEL,
    requiresConcentration: true,
    maxTargets: 1,
    modifiers: () => [],
    conditions: () => [...HOLD_PERSON_CONDITIONS],
  },
};

/** Resolve uma definição de efeito pelo id canônico (`null` = não registrada). */
export function findEffectDefinition(definitionId: string): EffectDefinition | null {
  return EFFECT_DEFINITIONS[definitionId] ?? null;
}
