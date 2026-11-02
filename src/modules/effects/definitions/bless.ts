import type { EffectModifier } from '../effect-modifiers.js';

/**
 * FASE 6.5G — DEFINIÇÃO REAL DE BLESS (PHB 2014, p. 219).
 *
 * Este arquivo é o ÚNICO lugar que sabe que Bless concede +1d4 em ataques e
 * salvaguardas. Nenhum pipeline de rolagem/ataque/concentração conhece o nome
 * ou o `definitionId`: eles leem apenas os modificadores tipados que a
 * instância carrega.
 *
 * Escopo desta fase (prova de arquitetura):
 *  • 1º nível, até 3 criaturas;
 *  • +1d4 OPCIONAL em Attack Rolls e Saving Throws (o PHB diz "pode");
 *  • exige Concentração;
 *  • NÃO consome Ação/slot, NÃO valida alcance/componentes, NÃO tem duração
 *    automática (essas responsabilidades são da futura Spell Execution/Duration).
 *
 * O identificador canônico reutiliza o id do catálogo de magias (`bless`), sem
 * duplicar nome/nível/escola/range/componentes — esses dados continuam no
 * catálogo.
 */

/** Id canônico no catálogo de magias (`src/modules/shared/spells/catalog`). */
export const BLESS_SPELL_ID = 'bless';

/** Chave mecânica da DEFINIÇÃO (separada do label humano). */
export const BLESS_DEFINITION_ID = `spell.${BLESS_SPELL_ID}`;

/** Bless de 1º nível atinge até três criaturas. */
export const BLESS_MAX_TARGETS = 3;

export const BLESS_LABEL = 'Bless';

/**
 * Modificadores da instância. `optional: true` porque o alvo PODE usar o d4;
 * `stackingKey` garante que duas aplicações de Bless no mesmo alvo ofereçam
 * apenas UM +1d4 (a mais antiga vence; quando ela termina, a outra assume).
 */
export function blessModifiers(): EffectModifier[] {
  return [
    {
      kind: 'roll-dice',
      roll: 'attack',
      count: 1,
      sides: 4,
      sign: 1,
      optional: true,
      stackingKey: BLESS_DEFINITION_ID,
      key: 'attack',
    },
    {
      kind: 'roll-dice',
      roll: 'save',
      count: 1,
      sides: 4,
      sign: 1,
      optional: true,
      stackingKey: BLESS_DEFINITION_ID,
      key: 'save',
    },
  ];
}

/** Metadados da definição (sem copiar o catálogo de magias). */
export const BLESS_EFFECT_DEFINITION = {
  definitionId: BLESS_DEFINITION_ID,
  label: BLESS_LABEL,
  requiresConcentration: true,
  maxTargets: BLESS_MAX_TARGETS,
} as const;
