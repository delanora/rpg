import { api } from '../api';
import { createOperationId } from '../utils';
import type { AttackResolvedPayload, CombatDto } from '../types';

/** Ações de combate — todas devolvem o estado atualizado do combate. */

export function fetchActiveCombat(): Promise<CombatDto | null> {
  return api<{ combat: CombatDto | null }>('/api/combat/active').then((result) => result.combat);
}

export interface CombatCreatureEntry {
  creatureId: string;
  quantity: number;
}

/** Inicia o combate na localidade escolhida, com N cópias de cada criatura. */
export function startCombat(input: {
  localityId?: string;
  entries: CombatCreatureEntry[];
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat', {
    method: 'POST',
    body: input,
  }).then((result) => result.combat);
}

/** O jogador rola a própria iniciativa. */
export function rollMyInitiative(): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/initiative', { method: 'POST' }).then(
    (result) => result.combat,
  );
}

/** O mestre rola por um combatente (criatura ou jogador ausente). */
export function rollInitiativeFor(combatantId: string): Promise<CombatDto> {
  return api<{ combat: CombatDto }>(`/api/combat/initiative/${combatantId}`, {
    method: 'POST',
  }).then((result) => result.combat);
}

/**
 * Avança o turno. `skipDeathSave` é a confirmação do MESTRE para pular o Teste
 * contra a Morte obrigatório do turno (o jogador nunca tem essa opção).
 */
export function nextTurn(
  combat: CombatDto,
  options: { skipDeathSave?: boolean } = {},
): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/next-turn', {
    method: 'POST',
    body: { ...operationFor(combat), ...(options.skipDeathSave ? { skipDeathSave: true } : {}) },
  }).then((result) => result.combat);
}

export function resolveAttack(combat: CombatDto, input: {
  attackActionId?: string;
  prepared?: boolean;
  attackId: string;
  targetCombatantId: string;
  attackerCombatantId?: string;
  ammoInventoryId?: string;
  /** Rolagem com vantagem (2d20, mantém o maior). */
  advantage?: boolean;
  /** Rolagem com desvantagem (2d20, mantém o menor); impede o Ataque Furtivo. */
  disadvantage?: boolean;
  /** Confirmação manual: há aliado adjacente ao alvo (habilita o Furtivo). */
  adjacentAlly?: boolean;
}): Promise<{ combat: CombatDto; result: AttackResolvedPayload }> {
  return api<{ combat: CombatDto; result: AttackResolvedPayload }>('/api/combat/attack', {
    method: 'POST',
    body: { ...operationFor(combat), ...input },
  });
}

export function applyManualHp(input: {
  combatantId: string;
  amount: number;
  mode: 'damage' | 'heal';
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/hp', { method: 'POST', body: input }).then(
    (result) => result.combat,
  );
}

export function endCombat(): Promise<void> {
  return api<{ combatId: string }>('/api/combat/end', { method: 'POST' }).then(() => undefined);
}

/**
 * Corpo comum das operações de combate.
 *
 * O `operationId` vem do helper CENTRAL (`createOperationId`): a chamada direta
 * a `crypto.randomUUID()` quebrava em contexto NÃO seguro (HTTP por IP de
 * rede), onde ele é `undefined` — e isso derrubava TODAS as ações de combate.
 */
export function operationFor(combat: CombatDto) {
  return { combatId: combat.id, expectedVersion: combat.version, operationId: createOperationId() };
}
export type EconomyAction =
  | 'dash'
  | 'disengage'
  | 'dodge'
  | 'help'
  | 'hide'
  | 'search'
  | 'use-object'
  | 'improvised'
  | 'ready'
  | 'execute-ready'
  | 'move'
  /** Sabedoria (Medicina) CD 10 para estabilizar outra criatura a 0 PV. */
  | 'stabilize';
export type EconomyAdjustment = 'grant-action' | 'restore-action' | 'restore-bonus' | 'restore-reaction' | 'set-movement';
export function executeEconomyAction(combat: CombatDto, input: {
  combatantId: string; action: EconomyAction; description?: string; trigger?: string; intent?: string; distance?: number;
  /** ESTABILIZAR: quem está a 0 PV (o servidor valida elegibilidade). */
  targetCombatantId?: string;
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/action', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}
export function overrideEconomy(combat: CombatDto, input: {
  combatantId: string; adjustment: EconomyAdjustment; reason: string; remaining?: number;
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/economy/override', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}
