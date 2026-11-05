import { api } from '../../api';
import { createOperationId } from '../../utils';
import type { CombatDto, SpatialPosition } from '../../types';

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
