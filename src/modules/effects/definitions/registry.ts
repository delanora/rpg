import type { Condition } from '../../shared/conditions.js';
import type { EffectModifier } from '../effect-modifiers.js';
import {
  BLESS_DEFINITION_ID,
  BLESS_LABEL,
  BLESS_MAX_TARGETS,
  blessModifiers,
  blessTurnTriggers,
} from './bless.js';
import {
  HOLD_PERSON_CONDITIONS,
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_LABEL,
  holdPersonTurnTriggers,
} from './hold-person.js';
import type { EffectTurnTriggerDefinition } from '../effect-turn-triggers.js';

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
  /**
   * TRIGGERS DE TURNO (6.6H): comportamento do EFEITO contínuo, snapshotado na
   * instância. Bless não tem nenhum; Hold Person oferece a salvaguarda repetida
   * de Sabedoria no fim do turno do alvo.
   */
  turnTriggers: () => EffectTurnTriggerDefinition[];
}

export const EFFECT_DEFINITIONS: Record<string, EffectDefinition> = {
  [BLESS_DEFINITION_ID]: {
    definitionId: BLESS_DEFINITION_ID,
    label: BLESS_LABEL,
    requiresConcentration: true,
    maxTargets: BLESS_MAX_TARGETS,
    modifiers: blessModifiers,
    conditions: () => [],
    turnTriggers: blessTurnTriggers,
  },
  [HOLD_PERSON_DEFINITION_ID]: {
    definitionId: HOLD_PERSON_DEFINITION_ID,
    label: HOLD_PERSON_LABEL,
    requiresConcentration: true,
    maxTargets: 1,
    modifiers: () => [],
    conditions: () => [...HOLD_PERSON_CONDITIONS],
    turnTriggers: holdPersonTurnTriggers,
  },
};

/** Resolve uma definição de efeito pelo id canônico (`null` = não registrada). */
export function findEffectDefinition(definitionId: string): EffectDefinition | null {
  return EFFECT_DEFINITIONS[definitionId] ?? null;
}
