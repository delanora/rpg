import type { Condition } from '../../shared/conditions.js';
import type { EffectTurnTriggerDefinition } from '../effect-turn-triggers.js';

/**
 * FASE 6.5H — DEFINIÇÃO REAL DE HOLD PERSON (PHB 2014, p. 251).
 *
 * Este arquivo é o ÚNICO lugar que sabe que Imobilizar Pessoa exige uma
 * salvaguarda de Sabedoria e deixa o alvo Paralisado. Nenhum motor genérico
 * (`deriveConditionEffects`, `dice.service`, `combat.service`, Concentração,
 * lifecycle) conhece esta magia: eles leem apenas o atributo fixado pela
 * pendência e a Condition declarada pela instância.
 *
 * Escopo desta prova de arquitetura:
 *  • 2º nível, UM alvo humanoide;
 *  • salvaguarda INICIAL de Sabedoria, resolvida pelo pipeline real;
 *  • falha → EffectInstance com `conditions: ['paralyzed']` (Paralyzed é do
 *    motor de Conditions — Incapacitated, deslocamento 0, etc. vêm dele);
 *  • exige Concentração (grupo de efeitos ligado à concentração do caster);
 *  • NÃO implementa duração de 1 minuto, save repetido no fim do turno,
 *    upcasting, alcance, componentes, Ação, slot nem conjuração por PLAYER.
 *
 * O identificador canônico reutiliza o id do catálogo de magias
 * (`hold-person`), sem duplicar nome/nível/escola/alcance/componentes.
 */

/** Id canônico no catálogo de magias (`src/modules/shared/spells/catalog`). */
export const HOLD_PERSON_SPELL_ID = 'hold-person';

/** Chave mecânica da DEFINIÇÃO (separada do label humano). */
export const HOLD_PERSON_DEFINITION_ID = `spell.${HOLD_PERSON_SPELL_ID}`;

export const HOLD_PERSON_LABEL = 'Imobilizar Pessoa';

/** Salvaguarda inicial e (futura) repetida — fixada no SERVIDOR. */
export const HOLD_PERSON_SAVE_ABILITY = 'wisdom' as const;

/** Condition do PHB aplicada pelo efeito (nunca uma Condition inventada). */
export const HOLD_PERSON_CONDITIONS: Condition[] = ['paralyzed'];

/**
 * FASE 6.6H — SALVAGUARDA REPETIDA (PHB 2014, p. 251).
 *
 * "At the end of each of its turns, the target can make another Wisdom saving
 * throw. On a success, the spell ends on the target."
 *
 * • `end-of-target-turn` — no fim do turno DO ALVO, nunca do conjurador;
 * • `optional: true` — o texto diz "can": o alvo escolhe rolar ou recusar, e
 *   recusar NÃO encerra o efeito (o próximo turno oferece outra chance);
 * • `dc: origin-spell-cast` — snapshot do `SpellCast` de origem, jamais
 *   recalculada com o atributo atual do conjurador;
 * • `onSuccess: end-effect` — sucesso encerra SOMENTE aquela instância.
 */
export function holdPersonTurnTriggers(): EffectTurnTriggerDefinition[] {
  return [
    {
      key: 'repeat-save',
      timing: 'end-of-target-turn',
      kind: 'saving-throw',
      ability: HOLD_PERSON_SAVE_ABILITY,
      dc: { kind: 'origin-spell-cast' },
      optional: true,
      repeat: 'every-turn',
      onSuccess: 'end-effect',
    },
  ];
}

/** Faixa técnica da CD manual de prova (ver `PENDING_EFFECT_DC_MANUAL`). */
export const HOLD_PERSON_MIN_DC = 1;
export const HOLD_PERSON_MAX_DC = 30;

/**
 * Metadados da definição. `dcSource: 'manual'` é uma marca explícita de que a
 * CD ainda é informada pelo Mestre nesta fase — a Spell Execution Engine
 * passará a derivá-la do caster (8 + proficiência + atributo de conjuração).
 */
export const HOLD_PERSON_EFFECT_DEFINITION = {
  definitionId: HOLD_PERSON_DEFINITION_ID,
  label: HOLD_PERSON_LABEL,
  requiresConcentration: true,
  maxTargets: 1,
  saveAbility: HOLD_PERSON_SAVE_ABILITY,
  conditions: HOLD_PERSON_CONDITIONS,
  dcSource: 'manual',
} as const;
