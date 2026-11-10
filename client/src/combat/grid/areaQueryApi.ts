import { api } from '../../api';
import type { GridAreaQuery } from '../../../../src/modules/combat/spatial/area-membership';
export type AreaReading = {
  combatantId: string;
  targetKey: string;
  decisionSource?: 'authoritative' | 'master-confirmed' | null;
  name: string;
  geometry: 'pass' | 'fail' | 'unknown';
  propagation: 'pass' | 'fail' | 'unknown';
  affected: 'pass' | 'fail' | 'unknown';
  reasons: string[];
};
export type AreaQueryResult = {
  combatId: string;
  combatVersion: number;
  candidates: AreaReading[];
};
export function queryGridArea(combatId: string, input: GridAreaQuery) {
  return api<AreaQueryResult>(`/api/combat/${combatId}/spatial/area-query`, {
    method: 'POST',
    body: input,
  });
}
