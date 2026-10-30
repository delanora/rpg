import { api } from './api';
import { createOperationId } from './utils';
import type { MechanicalDto, MechanicalEntity } from './types';
export function fetchMechanicalState(entity: MechanicalEntity): Promise<MechanicalDto> {
  return api<{ mechanical: MechanicalDto }>(`/api/mechanical/${entity.kind}/${entity.id}`).then(result => result.mechanical);
}
/**
 * LEVANTAR-SE (PHB 2014): gasta METADE do deslocamento efetivo e remove SÓ a
 * condição Caído. Não consome Ação. O servidor valida turno, Queda, velocidade
 * efetiva e movimento restante — o cliente nunca calcula o custo.
 */
export function standUp(input: {
  entity: MechanicalEntity;
  expectedVersion: number;
  expectedCombatVersion?: number;
}): Promise<MechanicalDto> {
  return api<{ mechanical: MechanicalDto }>('/api/mechanical/mutate', {
    method: 'POST',
    body: { ...input, action: 'stand', operationId: createOperationId() },
  }).then((result) => result.mechanical);
}

export function mutateMechanicalState(current: MechanicalDto, input: {
  action: 'apply' | 'remove' | 'exhaustion' | 'stand' | 'concentrate' | 'concentrate-end';
  condition?: string; instanceId?: string;
  sourceEntity?: MechanicalEntity; sourceLabel?: string; exhaustionLevel?: number; exhaustionDelta?: number;
  /** Concentração: nome do efeito, visibilidade e id da concentração encerrada. */
  label?: string; visibility?: 'public' | 'private'; concentrationId?: string;
}): Promise<MechanicalDto> {
  return api<{ mechanical: MechanicalDto }>('/api/mechanical/mutate', { method: 'POST', body: {
    ...input, entity: current.entity, expectedVersion: current.version,
    // Helper central: `crypto.randomUUID` não existe fora de contexto seguro.
    ...(current.combat ? { expectedCombatVersion: current.combat.version } : {}), operationId: createOperationId(),
  } }).then(result => result.mechanical);
}
