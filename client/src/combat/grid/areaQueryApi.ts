import type {
  CreatureAreaPlacement,
  CreatureAreaDefinition,
} from '../../../../src/modules/shared/creature-abilities';
import { api } from '../../api';
import type { GridAreaQuery } from '../../../../src/modules/combat/spatial/area-membership';
export type AreaReading = {
  combatantId: string;
  targetKey: string;
  overrideAllowed?: boolean;
  decisionSource?:
    'authoritative' | 'master-confirmed' | 'default-elevation' | null;
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
  area?: CreatureAreaDefinition;
  definitionFingerprint?: string;
};
export function queryGridArea(combatId: string, input: GridAreaQuery) {
  return api<AreaQueryResult>(`/api/combat/${combatId}/spatial/area-query`, {
    method: 'POST',
    body: input,
  });
}

export function queryCreatureArea(
  combatId: string,
  combatantId: string,
  abilityId: string,
  placement: CreatureAreaPlacement,
) {
  return api<AreaQueryResult>(`/api/combat/${combatId}/creature-area-preview`, {
    method: 'POST',
    body: { combatantId, abilityId, placement },
  });
}
