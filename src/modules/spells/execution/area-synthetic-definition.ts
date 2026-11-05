import type { SpellExecutionDefinition } from './spell-execution-definition.js';

/**
 * FASE 6.6J.3 — DEFINIÇÃO SINTÉTICA DE ÁREA (SOMENTE TESTE).
 *
 * Não é uma magia do PHB: prova a fundação de AREA TARGETING (origem, forma,
 * derivação de alvos pelo servidor e fluxo assistido pelo Mestre) reutilizando
 * integralmente o pipeline multi-alvo da 6.6J.2 (1 cast → N pendências → UM
 * roll de dano compartilhado).
 *
 * Regras da prova: esfera de 20 ft centrada em um PONTO a até 60 ft (sem exigir
 * visão do ponto), TODAS as criaturas válidas, salvaguarda de DESTREZA, 2d6 de
 * Fogo, sucesso → METADE e falha → CHEIO.
 *
 * Como as demais definições sintéticas, NÃO entra no catálogo, no repertório, no
 * cast-options, no compêndio nem em UI alguma.
 */
export const SYNTHETIC_AREA_SPELL_ID = 'test.synthetic-area-save-damage';

export const SYNTHETIC_AREA_LABEL = 'Área (prova)';

export const SYNTHETIC_AREA_SAVE_ABILITY = 'dexterity' as const;

export const SYNTHETIC_AREA_DAMAGE_TYPE = 'Fogo';

export const SYNTHETIC_AREA_DICE = { count: 2, sides: 6 } as const;

export const SYNTHETIC_AREA_DEFINITION: SpellExecutionDefinition = {
  spellId: SYNTHETIC_AREA_SPELL_ID,
  requiresConcentration: false,
  combatPrompt: 'Uma explosão de prova atinge a área.',
  targeting: {
    kind: 'area',
    origin: { kind: 'point', rangeFeet: 60, requiresSight: false },
    area: {
      shape: { kind: 'sphere', radiusFeet: 20 },
      affects: { kind: 'all-valid-creatures' },
    },
  },
  resolution: {
    kind: 'save-damage',
    ability: SYNTHETIC_AREA_SAVE_ABILITY,
    outcome: { success: 'half', failure: 'full' },
    // PHB 2014: efeito simultâneo → UM roll para todos os alvos.
    damageRollScope: 'shared',
    damage: {
      components: [{ type: SYNTHETIC_AREA_DAMAGE_TYPE, dice: SYNTHETIC_AREA_DICE }],
    },
  },
};
