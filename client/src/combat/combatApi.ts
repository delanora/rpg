import type { CreatureAreaPlacement } from '../../../src/modules/shared/creature-abilities';
import { api } from '../api';
import { createOperationId } from '../utils';
import type { SpatialPosition, AttackResolvedPayload, CombatDto, CombatUsableItem, DiceRollDto } from '../types';

/** Ações de combate — todas devolvem o estado atualizado do combate. */

export function fetchActiveCombat(): Promise<CombatDto | null> {
  return api<{ combat: CombatDto | null }>('/api/combat/active').then((result) => result.combat);
}

export interface CombatCreatureEntry {
  disposition?: 'hostile' | 'neutral' | 'allied';
  creatureId: string;
  quantity: number;
  spatialVisibilities?: ('public' | 'master-only')[];
  positions?: ({ xFeet: number; yFeet: number } | null)[];
}

/** Inicia o combate na localidade escolhida, com N cópias de cada criatura. */
export interface CombatPreparation {
  characterIds?: string[];
  characterPositions?: { characterId: string; position: { xFeet: number; yFeet: number } }[];
  localityId?: string;
  sceneId?: string;
  entries: CombatCreatureEntry[];
}
export function startCombat(input: CombatPreparation): Promise<CombatDto> {
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
  options: { skipDeathSave?: boolean; skipLegendary?: boolean; extraCombatantId?: string } = {},
): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/next-turn', {
    method: 'POST',
    body: { ...operationFor(combat), ...options },
  }).then((result) => result.combat);
}

export function resolveAttack(combat: CombatDto, input: {
  attackActionId?: string;
  multiattackId?: string;
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
  /** IDs dos modificadores OPCIONAIS oferecidos pelo servidor (6.5G). */
  selectedEffectModifiers?: string[];
}): Promise<{ combat: CombatDto; result: AttackResolvedPayload }> {
  return api<{ combat: CombatDto; result: AttackResolvedPayload }>('/api/combat/attack', {
    method: 'POST',
    body: { ...operationFor(combat), ...input },
  });
}

/**
 * Itens USÁVEIS do combatente (poções/consumíveis com saldo). A rota é
 * autorizada no servidor: Mestre ou dono do personagem; inventário de NPC
 * nunca chega a jogador.
 */
export function fetchCombatItems(combatantId: string): Promise<CombatUsableItem[]> {
  return api<{ items: CombatUsableItem[] }>(
    `/api/combat/items/${encodeURIComponent(combatantId)}`,
  ).then((result) => result.items);
}

/** Usar um consumível: o servidor gasta a Ação, consome a unidade e aplica. */
export function useCombatItem(
  combat: CombatDto,
  input: { combatantId: string; itemInventoryId: string; targetCombatantId?: string },
): Promise<{ combat: CombatDto; healing: { total: number } | null }> {
  return api<{ combat: CombatDto; healing: { total: number } | null }>(
    '/api/combat/use-item',
    { method: 'POST', body: { ...operationFor(combat), ...input } },
  );
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

/**
 * TESTE DE CONCENTRAÇÃO de uma criatura/NPC: o Mestre escolhe AO ROLAR se o
 * teste é público ou privado. O servidor é dono do CD, do bônus e do resultado.
 * O jogador usa a bandeja existente (`kind: 'concentration'`).
 */
export function rollConcentrationSaveAsMaster(input: {
  entity: { kind: 'character' | 'creature' | 'combatant'; id: string };
  pendingConcentrationSaveId: string;
  visibility: 'public' | 'private';
}): Promise<DiceRollDto> {
  return api<{ roll: DiceRollDto }>('/api/dice/roll', {
    method: 'POST',
    body: {
      kind: 'concentration',
      dice: [{ sides: 20 }],
      ...input,
    },
  }).then((result) => result.roll);
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
export function operationFor(combat: Pick<CombatDto, 'id' | 'version'>) {
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
export type EconomyAdjustment = 'grant-action' | 'restore-action' | 'restore-bonus' | 'restore-reaction' | 'restore-movement' | 'set-movement';
export function executeEconomyAction(combat: CombatDto, input: {
  combatantId: string; action: EconomyAction; description?: string; trigger?: string; intent?: string; distance?: number;
  /** ESTABILIZAR: quem está a 0 PV (o servidor valida elegibilidade). */
  targetCombatantId?: string;
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/action', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}
export function overrideEconomy(combat: CombatDto, input: {
  combatantId: string; adjustment: EconomyAdjustment; reason?: string; remaining?: number;
}): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/economy/override', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}

/** Ajuste explícito do lado do encontro, com versão e idempotência existentes. */
export function setCombatantSide(combat: CombatDto, combatantId: string, sideKey: string | null): Promise<CombatDto> {
  const {expectedVersion, operationId} = operationFor(combat);
  return api<{combat: CombatDto}>(`/api/combat/${combat.id}/combatants/${combatantId}/side`, {
    method: 'PATCH', body: { expectedVersion, operationId, sideKey },
  }).then(result => result.combat);
}

export function addCombatParticipants(combat: CombatDto, entries: CombatCreatureEntry[], characterIds: string[] = [], characterPositions: {characterId: string; position: SpatialPosition}[] = []): Promise<CombatDto> {
 return api<{combat: CombatDto}>('/api/combat/participants/add', {method:'POST', body:{...operationFor(combat),entries,characterIds,characterPositions}}).then(r=>r.combat);
}
export function removeCombatParticipant(combat: CombatDto, combatantId: string): Promise<CombatDto> {
 return api<{combat: CombatDto}>('/api/combat/participants/remove', {method:'POST', body:{...operationFor(combat),combatantId}}).then(r=>r.combat);
}

export function useCreatureAbility(combat: Pick<CombatDto,'id'|'version'>, input: { combatantId: string; abilityId: string; areaPlacement?:CreatureAreaPlacement; operationId?:string; mode?: 'use' | 'restore' | 'cancel-multiattack'; confirmed?: boolean }): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/creature-ability', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}

export function decideAttackHostility(combat: CombatDto, input: { promptId: string; hostile: boolean; selectedIds: string[] }): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/hostility/decision', { method: 'POST', body: { ...operationFor(combat), ...input } }).then(result => result.combat);
}

export function fetchCombatDuels(combatId: string): Promise<import('../types').CombatDuelDto[]> {
  return api<{ duels: import('../types').CombatDuelDto[] }>(`/api/combat/${encodeURIComponent(combatId)}/duels`).then(result => result.duels);
}
export function requestCombatDuel(combat: CombatDto, requesterId: string, challengedId: string): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/duels/request', { method: 'POST', body: { ...operationFor(combat), requesterId, challengedId } }).then(result => result.combat);
}
export function decideCombatDuel(combat: CombatDto, duelId: string, decision: 'accept' | 'decline' | 'cancel' | 'end'): Promise<CombatDto> {
  return api<{ combat: CombatDto }>('/api/combat/duels/decision', { method: 'POST', body: { ...operationFor(combat), duelId, decision } }).then(result => result.combat);
}

export function useLegendaryAction(combat:Pick<CombatDto,'id'|'version'>,input:{windowId:string;combatantId:string;abilityId:string;targetCombatantId?:string;areaPlacement?:import('../../../src/modules/shared/creature-abilities').CreatureAreaPlacement;operationId?:string;confirmed?:boolean}):Promise<CombatDto> {
 return api<{combat:CombatDto}>('/api/combat/legendary/use',{method:'POST',body:{...operationFor(combat),...input}}).then(result=>result.combat);
}
export function passLegendaryAction(combat:CombatDto,windowId:string,combatantId:string):Promise<CombatDto> {
 return api<{combat:CombatDto}>('/api/combat/legendary/pass',{method:'POST',body:{...operationFor(combat),windowId,combatantId}}).then(result=>result.combat);
}
export function setLegendarySurprise(combat:CombatDto,combatantId:string,surprised:boolean):Promise<CombatDto> {
 return api<{combat:CombatDto}>('/api/combat/legendary/surprise',{method:'POST',body:{...operationFor(combat),combatantId,surprised}}).then(result=>result.combat);
}
