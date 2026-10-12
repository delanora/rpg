import type { SpellCastingTimeKind } from './spells/types.js';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { getMulticlassFeatures, type ClassEntry } from './classes.js';

export type EconomyKind = 'action' | 'bonus-action' | 'reaction';

/** A classificação vem do catálogo do servidor; nunca do payload do cliente. */
export const COMBAT_ACTIONS = {
  dash: { name: 'Disparada', economy: 'action' },
  disengage: { name: 'Desengajar', economy: 'action' },
  dodge: { name: 'Esquivar', economy: 'action' },
  help: { name: 'Ajudar', economy: 'action' },
  hide: { name: 'Esconder', economy: 'action' },
  search: { name: 'Procurar', economy: 'action' },
  'use-object': { name: 'Usar um Objeto', economy: 'action' },
  improvised: { name: 'Outra ação', economy: 'action' },
  ready: { name: 'Preparar', economy: 'action' },
  'execute-ready': { name: 'Executar ação preparada', economy: 'reaction' },
  attack: { name: 'Atacar', economy: 'action' },
  offhand: { name: 'Ataque de mão secundária', economy: 'bonus-action' },
} as const satisfies Record<string, { name: string; economy: EconomyKind }>;

const attackActionSchema = z.object({
  attackActionId: z.string(),
  attacksMade: z.number().int().nonnegative(),
  attacksAllowed: z.number().int().positive(),
});
export const turnEconomySchema = z.object({
  actionsGranted: z.number().int().nonnegative().default(0),
  actionsUsed: z.number().int().nonnegative().default(0),
  bonusActionUsed: z.boolean().default(false),
  reactionAvailable: z.boolean().default(true),
  movementBudget: z.number().nonnegative().default(0),
  movementUsed: z.number().nonnegative().default(0),
  /** Ajuste administrativo em distância real; não é ampliado ao remover condições. */
  movementOverrideBudget: z.number().nonnegative().nullable().default(null),
  attackAction: attackActionSchema.nullable().default(null),
  /** Armas leves usadas em Attack Action: mão secundária exige OUTRA arma. */
  lightWeaponsAttacked: z.array(z.string()).default([]),
  ready: z.object({ trigger: z.string(), intent: z.string() }).nullable().default(null),
});
export type TurnEconomy = z.infer<typeof turnEconomySchema>;

export function economyOf(value: unknown): TurnEconomy {
  return turnEconomySchema.parse(value);
}

/** PHB 2014: Ataque Extra não se soma entre classes; aplica o maior limite. */
export function deriveAttackActionLimit(entries: ClassEntry[]): number {
  const limits: Record<string, number> = {
    'extra-attack': 2, 'extra-attack-2': 3, 'extra-attack-3': 4,
  };
  return getMulticlassFeatures(entries).reduce(
    (limit, feature) => Math.max(limit, limits[feature.id] ?? 1), 1,
  );
}

/** Ponto de extensão para casting time/features futuras sem conjurar magias. */
export function spendEconomy(state: TurnEconomy, kind: EconomyKind): void {
  if (kind === 'action') {
    if (state.actionsUsed >= state.actionsGranted) {
      throw new HttpError('Nenhuma Ação disponível.', 409, 'CONFLICT');
    }
    state.actionsUsed += 1;
  } else if (kind === 'bonus-action') {
    if (state.bonusActionUsed) throw new HttpError('Ação Bônus já utilizada.', 409, 'CONFLICT');
    state.bonusActionUsed = true;
  } else {
    if (!state.reactionAvailable) throw new HttpError('Reação já utilizada.', 409, 'CONFLICT');
    state.reactionAvailable = false;
  }
}

/** Somente o início do PRÓPRIO turno recupera a Reação. */
export function onTurnStart(speed: number): TurnEconomy {
  return economyOf({ actionsGranted: 1, movementBudget: Math.max(0, speed) });
}

/** Não restaura economia ao encerrar; Ready vale até o próximo início próprio. */
export function onTurnEnd(state: TurnEconomy): TurnEconomy {
  return state;
}

export function moveDistance(state: TurnEconomy, distance: number): void {
  if (!Number.isFinite(distance) || distance <= 0 || distance > state.movementBudget - state.movementUsed + 1e-8) {
    throw new HttpError('Distância excede o Movimento disponível.', 409, 'CONFLICT');
  }
  state.movementUsed = Math.min(state.movementBudget, state.movementUsed + distance);
}

export function recordAttack(
  state: TurnEconomy, limit: number, actionId: string, previousActionId?: string,
): void {
  if (previousActionId) {
    const action = state.attackAction;
    if (!action || action.attackActionId !== previousActionId) {
      throw new HttpError('Attack Action não corresponde ao turno atual.', 409, 'CONFLICT');
    }
    // Mudança estrutural da ficha não autoriza continuar usando um limite antigo.
    action.attacksAllowed = limit;
    if (action.attacksMade >= limit) throw new HttpError('Limite de ataques desta Ação atingido.', 409, 'CONFLICT');
    action.attacksMade += 1;
  } else {
    spendEconomy(state, 'action');
    state.attackAction = { attackActionId: actionId, attacksMade: 1, attacksAllowed: limit };
  }
}

/** Lê somente classificação já catalogada; não executa nem gasta magia. */
export function spellCastingEconomy(kind: SpellCastingTimeKind): EconomyKind | null {
  if (kind === 'bonusAction') return 'bonus-action';
  if (kind === 'action' || kind === 'reaction') return kind;
  return null;
}
