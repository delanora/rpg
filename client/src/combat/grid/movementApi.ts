import { api } from '../../api';
import type { CombatDto, MovementCommitResponse, MovementPreviewResponse, SpatialPosition } from '../../types';

/**
 * FASE 6.6M.3 — BOUNDARY do movimento voluntário.
 *
 * A UI manda apenas INTENÇÃO: `combatantId` + `path` (âncoras passo a passo).
 * Custo, distância, difficult terrain, crawling, ocupação, saldo e Reaction
 * Gate NUNCA viajam do cliente — o servidor deriva tudo (6.6L.3/3.1). O commit
 * usa o endpoint real e devolve o `CombatDto` autoritativo.
 *
 * `operationId` vem de QUEM CHAMA (um por tentativa confirmada), para retry da
 * mesma tentativa reusar a mesma chave. Este módulo não gera id algum.
 */

export function previewMovement(
  combatId: string,
  input: { combatantId: string; path: readonly SpatialPosition[] },
): Promise<MovementPreviewResponse> {
  return api<MovementPreviewResponse>(
    `/api/combat/${encodeURIComponent(combatId)}/spatial/movement-preview`,
    {
      method: 'POST',
      body: { combatantId: input.combatantId, path: input.path },
    },
  );
}

export function commitMovement(
  combat: Pick<CombatDto, 'id' | 'version'>,
  input: { combatantId: string; path: readonly SpatialPosition[]; operationId: string },
): Promise<MovementCommitResponse> {
  return api<MovementCommitResponse>(
    `/api/combat/${encodeURIComponent(combat.id)}/spatial/movement`,
    {
      method: 'POST',
      body: {
        combatantId: input.combatantId,
        path: input.path,
        expectedVersion: combat.version,
        operationId: input.operationId,
      },
    },
  );
}
