import { api } from '../api';
import { createOperationId } from '../utils';
import type { CombatPreparation } from './combatApi';
export interface PreparedEncounter {
  id: string;
  name: string;
  version: number;
  preparation: CombatPreparation;
}
export const fetchEncounters = () =>
  api<{ encounters: PreparedEncounter[] }>('/api/encounters').then(
    (r) => r.encounters,
  );
export const saveEncounter = (encounter: PreparedEncounter) =>
  api<{ encounter: PreparedEncounter }>(
    `/api/encounters/${encodeURIComponent(encounter.id)}`,
    {
      method: 'PUT',
      body: {
        name: encounter.name,
        preparation: encounter.preparation,
        expectedVersion: encounter.version,
        operationId: createOperationId(),
      },
    },
  ).then((r) => r.encounter);
export const deleteEncounter = (encounter: PreparedEncounter) =>
  api(`/api/encounters/${encodeURIComponent(encounter.id)}`, {
    method: 'DELETE',
    body: {
      expectedVersion: encounter.version,
      operationId: createOperationId(),
    },
  });
