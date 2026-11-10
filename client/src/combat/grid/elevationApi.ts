import { api } from '../../api';
import type { CombatDto, SpatialPosition } from '../../types';
export async function requestElevation(
  combat: Pick<CombatDto, 'id' | 'version'>,
  combatantId: string,
  path: SpatialPosition[],
  operationId: string,
): Promise<CombatDto> {
  const result = await api<{ combat: CombatDto }>(
    `/api/combat/${combat.id}/spatial/elevation-requests`,
    {
      method: 'POST',
      body: { combatantId, path, expectedVersion: combat.version, operationId },
    },
  );
  return result.combat;
}
