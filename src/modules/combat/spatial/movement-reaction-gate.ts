import type { SpatialPosition2D } from './spatial.types.js';

/**
 * MOVEMENT REACTION GATE (Fase 6.6L.3) — fronteira para a 6.6L.3.1.
 *
 * PHB 2014: sair do alcance de uma criatura hostil pode provocar uma
 * Opportunity Attack, que é uma Reação e pode INTERROMPER o movimento antes de
 * a criatura deixar o alcance. Enquanto esse motor não existe, NENHUM movimento
 * voluntário de jogador pode ser liberado — liberar permitiria atravessar o
 * alcance de inimigos sem custo.
 *
 * O gate é consultado ANTES de qualquer escrita (e marca o snapshot de
 * auditoria). A versão desta fase:
 *
 *  • `administrativeMovementGate` — usado pelo Mestre. Política EXPLÍCITA de
 *    "sem reação" (`administrative-no-reaction`) e `playerSafe: false`: serve
 *    para operar o tabuleiro agora, mas NÃO é um movimento de jogador.
 *  • `unavailableMovementGate` — usado para PLAYER: recusa sempre. Nada de
 *    "não há Opportunity Attack" sem saber — o gate diz que não sabe.
 *
 * A 6.6L.3.1 substitui a implementação por uma que conheça alcance, lado,
 * visibilidade e Reação disponível, e poderá pausar o caminho passo a passo
 * (o commit atômico do Mestre continua válido como caminho administrativo).
 */

export type MovementReactionPolicy = 'administrative-no-reaction';

export interface MovementReactionGateInput {
  moverCombatantId: string;
  path: readonly SpatialPosition2D[];
}

export type MovementReactionGateResult =
  | { status: 'clear'; policy: MovementReactionPolicy; playerSafe: false }
  | { status: 'unavailable'; reason: string };

export interface MovementReactionGate {
  evaluate(input: MovementReactionGateInput): MovementReactionGateResult;
}

/** Autoridade administrativa do Mestre: libera, mas NUNCA é player-safe. */
export const administrativeMovementGate: MovementReactionGate = {
  evaluate: () => ({
    status: 'clear',
    policy: 'administrative-no-reaction',
    playerSafe: false,
  }),
};

/** Movimento voluntário de jogador: indisponível até a 6.6L.3.1. */
export const unavailableMovementGate: MovementReactionGate = {
  evaluate: () => ({
    status: 'unavailable',
    reason: 'opportunity-attacks-not-implemented',
  }),
};
