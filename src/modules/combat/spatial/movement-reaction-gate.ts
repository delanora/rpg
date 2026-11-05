import type { SpatialPosition2D } from './spatial.types.js';

/**
 * MOVEMENT REACTION GATE (Fase 6.6L.3 → 6.6L.3.1).
 *
 * PHB 2014: sair do alcance de uma criatura hostil que você consegue ver pode
 * provocar uma Opportunity Attack, que é uma Reação e INTERROMPE o movimento
 * antes de a criatura deixar o alcance.
 *
 * O gate é a fronteira de POLÍTICA do movimento voluntário, consultada ANTES de
 * qualquer escrita:
 *
 *  • `opportunityAttackMovementGate` — movimento voluntário (jogador OU Mestre
 *    movendo um NPC): o motor real de Opportunity Attack está ativo, então o
 *    commit pode pausar em boundaries de reach. `playerSafe: true` só porque a
 *    janela é persistida, resolvida pelo dono do reactor e o movimento só
 *    continua depois dela — sem isso, liberar seria sair do alcance de graça.
 *  • `administrativeMovementGate` — usado APENAS por placement administrativo
 *    (reposicionar no tabuleiro): nunca é movimento voluntário e nunca é
 *    player-safe.
 *  • `unavailableMovementGate` — política de recusa total. Fica no domínio como
 *    resposta honesta para quem não pode avaliar Reações (ex.: cena assistida).
 */

export type MovementReactionPolicy =
  | 'administrative-no-reaction'
  | 'phb-opportunity-attacks';

export interface MovementReactionGateInput {
  moverCombatantId: string;
  path: readonly SpatialPosition2D[];
}

export type MovementReactionGateResult =
  | { status: 'clear'; policy: MovementReactionPolicy; playerSafe: boolean }
  | { status: 'unavailable'; reason: string };

export interface MovementReactionGate {
  evaluate(input: MovementReactionGateInput): MovementReactionGateResult;
}

/**
 * Movimento voluntário com Opportunity Attack real: o passo que sairia de um
 * alcance é PAUSADO e a Reação decorre antes dele.
 */
export const opportunityAttackMovementGate: MovementReactionGate = {
  evaluate: () => ({
    status: 'clear',
    policy: 'phb-opportunity-attacks',
    playerSafe: true,
  }),
};

/** Autoridade administrativa do Mestre: libera, mas NUNCA é player-safe. */
export const administrativeMovementGate: MovementReactionGate = {
  evaluate: () => ({
    status: 'clear',
    policy: 'administrative-no-reaction',
    playerSafe: false,
  }),
};

/** Sem motor de Reação disponível: recusa (nunca "não há OA" por omissão). */
export const unavailableMovementGate: MovementReactionGate = {
  evaluate: () => ({
    status: 'unavailable',
    reason: 'opportunity-attacks-not-assessed',
  }),
};
