import type { SpellExecutionDefinition } from './spell-execution-definition.js';

/**
 * FASE 6.6J.1 — DEFINIÇÃO SINTÉTICA DE "SAVE FOR HALF" (SOMENTE TESTE).
 *
 * Não é uma magia do PHB: prova a mecânica genérica de meia-dano sem antecipar
 * Fireball/Burning Hands/Thunderwave (todas exigem área, e área é etapa
 * separada). Por isso ela NÃO entra no catálogo, no repertório, no cast-options,
 * no compêndio nem em qualquer UI — só o smoke a conhece e só ele cria linhas
 * de `SpellCast` com este id.
 *
 * Regras da prova: UMA criatura, salvaguarda de DESTREZA, 3d6 de Fogo, sucesso
 * → METADE (floor) e falha → dano CHEIO. Instantânea: sem Effect, sem duração,
 * sem Concentração do conjurador.
 */
export const SYNTHETIC_SAVE_HALF_SPELL_ID = 'test.synthetic-save-half';

export const SYNTHETIC_SAVE_HALF_LABEL = 'Meia-dano (prova)';

/** Salvaguarda fixada na definição; o cliente nunca escolhe o atributo. */
export const SYNTHETIC_SAVE_HALF_SAVE_ABILITY = 'dexterity' as const;

/** Tipo canônico do projeto (o mesmo usado por Fogo no catálogo). */
export const SYNTHETIC_SAVE_HALF_DAMAGE_TYPE = 'Fogo';

/** 3d6: base sem escalonamento (não é truque, não cresce por nível). */
export const SYNTHETIC_SAVE_HALF_DICE = { count: 3, sides: 6 } as const;

export const SYNTHETIC_SAVE_HALF_DEFINITION: SpellExecutionDefinition = {
  spellId: SYNTHETIC_SAVE_HALF_SPELL_ID,
  requiresConcentration: false,
  combatPrompt: 'Uma labareda de prova desce sobre você.',
  targeting: {
    kind: 'creatures',
    minTargets: 1,
    targetCount: { base: 1, baseSlotLevel: 0, additionalPerSlotLevel: 0 },
    range: { kind: 'distance', feet: 60 },
    allowSelf: true,
    // A prova NÃO depende de medição espacial: quem valida alvo/alcance/visão
    // continua sendo a engine, e aqui não há área nem linha de efeito.
    requiresSight: false,
    requiresClearPath: false,
    filters: [],
    groupConstraints: [],
  },
  resolution: {
    kind: 'save-damage',
    ability: SYNTHETIC_SAVE_HALF_SAVE_ABILITY,
    outcome: { success: 'half', failure: 'full' },
    damage: {
      components: [{ type: SYNTHETIC_SAVE_HALF_DAMAGE_TYPE, dice: SYNTHETIC_SAVE_HALF_DICE }],
    },
  },
};
