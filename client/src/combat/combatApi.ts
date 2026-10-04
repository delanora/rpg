import { api } from '../api';
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

export function nextTurn(): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/next-turn', { method: 'POST' }).then(
    (result) => result.combat,
  );
}

export function resolveAttack(input: {
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
    body: input,
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
