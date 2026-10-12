import { api } from './api';
import type { MechanicalDto, MechanicalEntity } from './types';
export function fetchMechanicalState(entity: MechanicalEntity): Promise<MechanicalDto> {
  return api<{ mechanical: MechanicalDto }>(`/api/mechanical/${entity.kind}/${entity.id}`).then(result => result.mechanical);
}
export function mutateMechanicalState(current: MechanicalDto, input: {
  action: 'apply' | 'remove' | 'exhaustion' | 'stand'; condition?: string; instanceId?: string;
  sourceEntity?: MechanicalEntity; sourceLabel?: string; exhaustionLevel?: number; exhaustionDelta?: number;
}): Promise<MechanicalDto> {
  return api<{ mechanical: MechanicalDto }>('/api/mechanical/mutate', { method: 'POST', body: {
    ...input, entity: current.entity, expectedVersion: current.version,
    ...(current.combat ? { expectedCombatVersion: current.combat.version } : {}), operationId: crypto.randomUUID(),
  } }).then(result => result.mechanical);
}
