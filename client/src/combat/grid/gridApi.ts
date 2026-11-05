import { api } from '../../api';
import { createOperationId } from '../../utils';
import type {
  CombatDto,
  SpatialDistanceResponse,
  SpatialPosition,
  SpatialRangePreviewResponse,
} from '../../types';

/**
 * FASE 6.6M.1 — API do grid.
 *
 * A UI NÃO é autoridade espacial: só envia INTENÇÃO (modo/dimensões/posição) ao
 * endpoint real da 6.6L.1 e adota o `CombatDto` devolvido pelo servidor.
 * `pixelsPerCell`, zoom e `occupiedSpace` nunca entram na requisição.
 */

export function updateSpatialScene(
  combat: Pick<CombatDto, 'id' | 'version'>,
  input: { mode: 'assisted' | 'grid-2d'; widthFeet?: number; heightFeet?: number },
): Promise<CombatDto> {
  return api<{ combat: CombatDto }>(`/api/combat/${combat.id}/spatial-config`, {
    method: 'PATCH',
    body: { expectedVersion: combat.version, operationId: createOperationId(), ...input },
  }).then((result) => result.combat);
}

/**
 * 6.6M.2 — LEITURAS de distância/alcance.
 *
 * São GETs puros: sem `operationId`, sem `expectedVersion` e sem `signal` de
 * intenção mecânica. O cliente manda apenas IDs estáveis — o servidor devolve a
 * distância PHB-grid e a classificação de alcance já prontas. É por isso que o
 * React nunca recalcula nada a partir de centros/`occupiedSpace`.
 */
export function getSpatialDistance(
  combatId: string,
  fromCombatantId: string,
  toCombatantId: string,
): Promise<SpatialDistanceResponse> {
  const query = new URLSearchParams({ fromCombatantId, toCombatantId });
  return api<SpatialDistanceResponse>(
    `/api/combat/${encodeURIComponent(combatId)}/spatial/distance?${query.toString()}`,
  );
}

/**
 * Alcance a partir de uma AÇÃO existente (`attackId` estável do painel de
 * ataque). O servidor resolve a arma/ataque, o reach e os alcances; o cliente
 * manda apenas identificadores, nunca distância/alcance como número.
 */
export function getSpatialRangePreview(
  combatId: string,
  fromCombatantId: string,
  toCombatantId: string,
  attackId: string,
): Promise<SpatialRangePreviewResponse> {
  const query = new URLSearchParams({ fromCombatantId, toCombatantId, attackId });
  return api<SpatialRangePreviewResponse>(
    `/api/combat/${encodeURIComponent(combatId)}/spatial/range-preview?${query.toString()}`,
  );
}

export function setSpatialPosition(
  combat: Pick<CombatDto, 'id' | 'version'>,
  combatantId: string,
  position: SpatialPosition | null,
): Promise<CombatDto> {
  return api<{ combat: CombatDto }>(
    `/api/combat/${combat.id}/combatants/${encodeURIComponent(combatantId)}/spatial-position`,
    {
      method: 'PATCH',
      body: { position, expectedVersion: combat.version, operationId: createOperationId() },
    },
  ).then((result) => result.combat);
}
