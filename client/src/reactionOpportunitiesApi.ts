import { api } from './api';
import type { CombatDto } from './types';

/**
 * FASE 6.6L.3.1 — OPPORTUNITY ATTACK (read model + resolução no SERVIDOR).
 *
 * O WebSocket só NOTIFICA (`combat:updated`); a janela de Reação é reconstruída
 * por este read model. Depois de refresh/reconnect o painel reaparece sozinho,
 * porque nada aqui depende de estado do React.
 *
 * O cliente NUNCA envia bônus de ataque, alcance, dano, CA do alvo ou resultado
 * de dado: só `opportunityId` + `attackId` (a opção oferecida) + a versão do
 * combate. O servidor revalida tudo antes de gastar a Reação.
 */

export interface ReactionOpportunityOption {
  id: string;
  attackId: string;
  label: string;
  description: string;
  reachFeet: number;
}

export interface ServerReactionOpportunity {
  id: string;
  kind: 'opportunity-attack';
  moverCombatantId: string;
  moverName: string;
  reactorCombatantId: string;
  reactorName: string;
  trigger: string;
  status: 'pending' | 'resolved' | 'declined' | 'cancelled';
  visibilityStatus: 'known-visible' | 'known-not-visible' | 'unknown';
  orderIndex: number;
  options: ReactionOpportunityOption[];
  /** Só a PRIMEIRA janela pendente do boundary pode ser resolvida. */
  actionable: boolean;
}

/** Movimento pausado esperando Reação (sanitizado: sem identidade de reactor). */
export interface MovementPause {
  combatantId: string;
  combatantName: string;
  remainingSteps: number;
  opportunities: number;
  awaitingMaster: boolean;
}

export interface ReactionOpportunitiesReadModel {
  combatId: string;
  combatVersion: number;
  opportunities: ServerReactionOpportunity[];
  movement: MovementPause | null;
}

export interface ReactionResolutionResponse {
  combat: CombatDto;
  opportunityId?: string;
  status?: string;
  reason?: string;
  pending?: MovementPause | null;
}

function newOperationId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `reaction-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Read model da janela: o servidor já filtra o que este usuário pode ver. */
export function fetchReactionOpportunities(combatId: string): Promise<ReactionOpportunitiesReadModel> {
  return api<ReactionOpportunitiesReadModel>(`/api/combat/${combatId}/reaction-opportunities`);
}

/** Executa o Ataque de Oportunidade escolhido (gasta a Reação no servidor). */
export function resolveOpportunityAttack(
  combatId: string,
  opportunityId: string,
  attackId: string,
  expectedVersion: number,
): Promise<ReactionResolutionResponse> {
  return api<ReactionResolutionResponse>(
    `/api/combat/${combatId}/reaction-opportunities/${opportunityId}/attack`,
    {
      method: 'POST',
      body: { combatId, attackId, expectedVersion, operationId: newOperationId() },
    },
  );
}

/** "Não reagir": fecha SÓ esta janela e NÃO gasta a Reação. */
export function declineOpportunityReaction(
  combatId: string,
  opportunityId: string,
  expectedVersion: number,
): Promise<ReactionResolutionResponse> {
  return api<ReactionResolutionResponse>(
    `/api/combat/${combatId}/reaction-opportunities/${opportunityId}/decline`,
    { method: 'POST', body: { combatId, expectedVersion, operationId: newOperationId() } },
  );
}
