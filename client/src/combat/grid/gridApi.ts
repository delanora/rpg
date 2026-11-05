import { api } from '../../api';
import { createOperationId } from '../../utils';
import type {
  CombatDto,
  SpatialDistanceResponse,
  SpatialMeasureEndpoint,
  SpatialMeasureResponse,
  SpatialPosition,
  SpatialRangePreviewResponse,
  SpatialVisibility,
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
 * 6.6M.3.1 — RÉGUA: leitura PURA entre dois extremos (ponto ou combatente).
 *
 * Sem `operationId`, sem `expectedVersion` e sem nenhuma intenção mecânica: o
 * cliente manda só os extremos alinhados e o servidor devolve a distância do
 * MESMO algoritmo da 6.6L.2. O React nunca calcula nem converte a medida.
 */
export function measureSpatial(
  combatId: string,
  from: SpatialMeasureEndpoint,
  to: SpatialMeasureEndpoint,
): Promise<SpatialMeasureResponse> {
  return api<SpatialMeasureResponse>(
    `/api/combat/${encodeURIComponent(combatId)}/spatial/measure`,
    { method: 'POST', body: { from, to } },
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

/**
 * 6.6L.3.2 — VISIBILIDADE ESPACIAL do combatente (só MASTER).
 *
 * O cliente manda apenas o valor do enum + versão/operação; posição, tamanho,
 * imagem e stats nunca viajam juntos. Não é placement: não gasta Movimento.
 */
export function setSpatialVisibility(
  combat: Pick<CombatDto, 'id' | 'version'>,
  combatantId: string,
  spatialVisibility: SpatialVisibility,
): Promise<CombatDto> {
  return api<{ combat: CombatDto }>(
    `/api/combat/${combat.id}/combatants/${encodeURIComponent(combatantId)}/spatial-visibility`,
    {
      method: 'PATCH',
      body: { spatialVisibility, expectedVersion: combat.version, operationId: createOperationId() },
    },
  ).then((result) => result.combat);
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
