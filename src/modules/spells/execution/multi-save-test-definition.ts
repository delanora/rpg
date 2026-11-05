import type { SpellExecutionDefinition } from './spell-execution-definition.js';

/**
 * FASE 6.6J.2 — DEFINIÇÃO SINTÉTICA MULTI-ALVO (SOMENTE TESTE).
 *
 * Prova o padrão genérico de UM cast com N saves independentes e UM único dano
 * rolado para o efeito simultâneo (PHB 2014). NÃO é uma magia do PHB: Fireball,
 * Burning Hands, Thunderwave e Chain Lightning continuam fora do escopo porque
 * todas exigem área/origem/geometria, que esta fase não implementa.
 *
 * Escolhas da prova:
 *  • EXATAMENTE 3 alvos, selecionados explicitamente (sem área);
 *  • salvaguarda de DESTREZA;
 *  • dano 2d6 Fogo + 1d6 Frio (3 dados no total) para cobrir o roll
 *    COMPARTILHADO e a preservação de tipos de 6.6J.1 numa só prova;
 *  • sucesso = METADE (floor por componente), falha = CHEIO;
 *  • `damageRollScope: 'shared'` — o dano NÃO é rolado por alvo;
 *  • instantânea: sem Effect, sem duração e sem Concentração do conjurador.
 *
 * Ela NÃO está no catálogo, no repertório, no cast-options, no compêndio nem em
 * UI alguma — só o smoke a conhece e só ele cria casts com este id.
 */
export const SYNTHETIC_MULTI_SAVE_SPELL_ID = 'test.synthetic-multi-save-damage';

export const SYNTHETIC_MULTI_SAVE_LABEL = 'Meia-dano multi-alvo (prova)';

/** Salvaguarda fixada na definição; o cliente nunca escolhe o atributo. */
export const SYNTHETIC_MULTI_SAVE_SAVE_ABILITY = 'dexterity' as const;

export const SYNTHETIC_MULTI_SAVE_COMPONENTS = [
  { type: 'Fogo', dice: { count: 2, sides: 6 } },
  { type: 'Frio', dice: { count: 1, sides: 6 } },
] as const;

/** Quantidade EXATA de alvos desta prova. */
export const SYNTHETIC_MULTI_SAVE_TARGETS = 3;

export const SYNTHETIC_MULTI_SAVE_DEFINITION: SpellExecutionDefinition = {
  spellId: SYNTHETIC_MULTI_SAVE_SPELL_ID,
  requiresConcentration: false,
  combatPrompt: 'Uma onda de prova atinge todos os alvos escolhidos.',
  targeting: {
    kind: 'creatures',
    minTargets: SYNTHETIC_MULTI_SAVE_TARGETS,
    targetCount: {
      base: SYNTHETIC_MULTI_SAVE_TARGETS,
      baseSlotLevel: 0,
      additionalPerSlotLevel: 0,
    },
    range: { kind: 'distance', feet: 60 },
    allowSelf: true,
    // Sem área/geometria: os alvos são escolhidos explicitamente na fixture.
    requiresSight: false,
    requiresClearPath: false,
    filters: [],
    groupConstraints: [],
  },
  resolution: {
    kind: 'save-damage',
    ability: SYNTHETIC_MULTI_SAVE_SAVE_ABILITY,
    outcome: { success: 'half', failure: 'full' },
    damageRollScope: 'shared',
    damage: { components: SYNTHETIC_MULTI_SAVE_COMPONENTS },
  },
};
