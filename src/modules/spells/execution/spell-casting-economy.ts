import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { economyOf, spendEconomy, type EconomyKind } from '../../shared/action-economy.js';
import type { SpellCastingTimeKind } from '../../shared/spells/types.js';
import { orderCombatants } from '../../combat/combat.dto.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';

/**
 * FASE 6.6D — CASTING TIME & ACTION ECONOMY.
 *
 * Traduz o CASTING TIME (catálogo/execução) para o custo da Action Economy
 * canônica (`shared/action-economy.ts`). Não cria uma segunda economia: lê e
 * consome `Combatant.turnEconomy` com o helper de domínio `spendEconomy`.
 *
 * A identidade de turno é `Combat.turnSequence` (monotônico, incrementado
 * SÓ quando um turno é realmente ativado). `Combat.version` muda por qualquer
 * operação e NÃO serve como identidade de turno.
 *
 * Regra de Bonus Action (PHB 2014): conjurar com Bonus Action impede qualquer
 * outra spell no MESMO turno, exceto um cantrip de 1 Ação. NÃO existe a regra
 * fictícia de "uma magia de nível por turno": duas Action leveled com Action
 * Surge são permitidas. A restrição é derivada do HISTÓRICO de SpellCasts
 * committed naquele `combatId + turnSequence`, nunca de flags no personagem.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface PriorSpellCast {
  spellLevel: number;
  castingTime: 'action' | 'bonus-action' | 'reaction';
}

/** Traduz o casting time tipado para o custo da economia (erro se não suportado). */
export function castingEconomyFor(kind: SpellCastingTimeKind): EconomyKind {
  if (kind === 'action') return 'action';
  if (kind === 'bonusAction') return 'bonus-action';
  if (kind === 'reaction') return 'reaction';
  // 1 minuto/1 hora/etc. NÃO é uma Action: nunca fingir que é.
  throw new HttpError(
    'Este tempo de conjuração ainda não é executável mecanicamente.',
    409,
    'SPELL_CASTING_TIME_NOT_IMPLEMENTED',
  );
}

/**
 * Política pura da spell de Bonus Action (PHB 2014). Devolve o código de erro
 * ou `null` quando permitido.
 *
 * • candidato Bonus Action → todos os casts anteriores do turno precisam ser
 *   Action cantrip (nível 0). Reaction anterior também bloqueia.
 * • já houve Bonus Action no turno → só Action cantrip passa (inclusive com
 *   Action Surge, que NÃO autoriza leveled spell depois).
 */
export function bonusActionSpellViolation(
  prior: readonly PriorSpellCast[],
  candidate: PriorSpellCast,
): string | null {
  const restricted = prior.some((item) => item.castingTime === 'bonus-action');

  if (candidate.castingTime === 'bonus-action') {
    const clean = prior.every(
      (item) => item.castingTime === 'action' && item.spellLevel === 0,
    );
    return clean ? null : 'BONUS_ACTION_SPELL_RESTRICTION';
  }

  if (restricted && !(candidate.castingTime === 'action' && candidate.spellLevel === 0)) {
    return 'BONUS_ACTION_SPELL_RESTRICTION';
  }
  return null;
}

export interface CastingTurnContext {
  combatId: string;
  combatantId: string;
  /** Versão da linha do combatente (guarda otimista do consumo). */
  combatantVersion: number;
  turnSequence: number;
  activeCombatantId: string | null;
  isCasterTurn: boolean;
  actionsGranted: number;
  actionsUsed: number;
  bonusActionUsed: boolean;
  reactionAvailable: boolean;
}

/**
 * Contexto de turno do CONJURADOR em combate ATIVO (`null` = fora de combate).
 *
 * Usa a canonicalização existente do `loadEntity` (personagem → combatente,
 * instância → ela mesma). Criatura-template só entra em combate como instância.
 */
export async function castingTurnContext(
  db: Db,
  caster: LoadedEntity,
): Promise<CastingTurnContext | null> {
  const combatRef = caster.combat;
  if (!combatRef || combatRef.status !== 'ACTIVE') return null;

  const combat = await db.combat.findUnique({
    where: { id: combatRef.id },
    include: { combatants: true },
  });
  if (!combat || combat.status !== 'ACTIVE') return null;

  // O contexto só precisa da ORDEM (iniciativa/desempate), que já é a regra
  // canônica; as relações de ficha não são carregadas aqui de propósito.
  const ordered = orderCombatants(combat.combatants as never);
  const active = ordered[combat.currentIndex] ?? null;
  const combatant = combat.combatants.find((item) => item.id === combatRef.combatantId);
  if (!combatant) return null;
  const economy = economyOf(combatant.turnEconomy);

  return {
    combatId: combat.id,
    combatantId: combatant.id,
    combatantVersion: combatant.mechanicalVersion,
    turnSequence: combat.turnSequence,
    activeCombatantId: active?.id ?? null,
    isCasterTurn: active?.id === combatant.id,
    actionsGranted: economy.actionsGranted,
    actionsUsed: economy.actionsUsed,
    bonusActionUsed: economy.bonusActionUsed,
    reactionAvailable: economy.reactionAvailable,
  };
}

/** Casts que REALMENTE atingiram o COMMIT naquele turno (por caster). */
export async function committedCastsOnTurn(
  db: Db,
  context: Pick<CastingTurnContext, 'combatId' | 'turnSequence' | 'combatantId'>,
): Promise<PriorSpellCast[]> {
  const rows = await db.spellCast.findMany({
    where: {
      combatId: context.combatId,
      turnSequence: context.turnSequence,
      combatantId: context.combatantId,
    },
    select: { spellLevel: true, castingTimeKind: true },
  });
  return rows.flatMap((row) => {
    // O CATÁLOGO usa camelCase (`bonusAction`) e a Action Economy usa
    // kebab-case (`bonus-action`). Sem normalizar, a magia de Ação Bônus some do
    // histórico do turno e a policy PHB 2014 deixa passar uma segunda magia de
    // nível. Aceitar as duas formas também cobre casts gravados antes do fix.
    const castingTime =
      row.castingTimeKind === 'bonusAction' || row.castingTimeKind === 'bonus-action'
        ? 'bonus-action'
        : row.castingTimeKind === 'action' || row.castingTimeKind === 'reaction'
          ? row.castingTimeKind
          : null;
    if (!castingTime) return [];
    return [{ spellLevel: row.spellLevel ?? 0, castingTime }];
  });
}

/**
 * VALIDATE (read-only): pode conjurar agora?
 *
 * Reação exige autorização interna de uma oportunidade server-authoritative.
 * Conjuração comum não pode se promover a Reação nem ignorar o turno.
 */
export function assertCastingEconomy(
  context: CastingTurnContext | null,
  cost: EconomyKind,
  prior: readonly PriorSpellCast[],
  candidate: PriorSpellCast,
  reactionAuthorized = false,
): void {
  if (cost === 'reaction' && !context) {
    throw new HttpError(
      'Não há uma oportunidade de Reação válida para esta conjuração.',
      409,
      'SPELL_REACTION_NOT_AVAILABLE',
    );
  }
  if (!context) return;

  if (cost === 'reaction' && reactionAuthorized) {
    if (!context.reactionAvailable) throw new HttpError('Reação já utilizada.', 409, 'REACTION_UNAVAILABLE');
    const violation = bonusActionSpellViolation(prior, candidate);
    if (violation) throw new HttpError('Uma magia de Ação Bônus impede esta conjuração no mesmo turno.', 409, violation);
    return;
  }
  if (cost === 'reaction') {
    // A rota comum não recebe autorização de oportunidade: nunca liberar.
    throw new HttpError(
      'Esta conjuração não possui uma oportunidade de Reação autorizada.',
      409,
      'SPELL_REACTION_NOT_AVAILABLE',
    );
  }

  if (!context.isCasterTurn) {
    throw new HttpError(
      'Não é o turno do conjurador.',
      409,
      'SPELL_CAST_OUT_OF_TURN',
    );
  }

  if (cost === 'action' && context.actionsUsed >= context.actionsGranted) {
    throw new HttpError('Nenhuma Ação disponível.', 409, 'SPELL_ACTION_UNAVAILABLE');
  }
  if (cost === 'bonus-action' && context.bonusActionUsed) {
    throw new HttpError('Ação Bônus já utilizada.', 409, 'SPELL_BONUS_ACTION_UNAVAILABLE');
  }

  const violation = bonusActionSpellViolation(prior, candidate);
  if (violation) {
    throw new HttpError(
      'Uma magia de Ação Bônus neste turno só permite, depois, um cantrip de 1 Ação.',
      409,
      violation,
    );
  }
}

export interface EconomySnapshot {
  cost: EconomyKind;
  spentAt: Date;
}

/**
 * COMMIT: revalida dentro da transação e consome a economia, com guarda de
 * versão (a corrida de duas conjurações com UMA Ação tem só um vencedor).
 */
export async function commitCastingEconomy(
  db: Prisma.TransactionClient,
  context: CastingTurnContext,
  cost: EconomyKind,
  reactionAuthorized = false,
): Promise<EconomySnapshot> {
  const unavailableCode = cost === 'reaction' ? 'REACTION_UNAVAILABLE' : cost === 'action' ? 'SPELL_ACTION_UNAVAILABLE' : 'SPELL_BONUS_ACTION_UNAVAILABLE';
  const combatant = await db.combatant.findUnique({
    where: { id: context.combatantId },
    include: { combat: { include: { combatants: true } } },
  });
  if (!combatant || combatant.combat.status !== 'ACTIVE') {
    throw new HttpError('O combate não está mais ativo.', 409, 'SPELL_CAST_OUT_OF_TURN');
  }
  const economy = economyOf(combatant.turnEconomy);
  const ordered = orderCombatants(combatant.combat.combatants as never);
  const active = ordered[combatant.combat.currentIndex] ?? null;
  if (
    combatant.combat.turnSequence !== context.turnSequence ||
    (!(reactionAuthorized && cost === 'reaction') && active?.id !== combatant.id)
  ) {
    throw new HttpError('O turno mudou durante a conjuração.', 409, 'SPELL_CAST_OUT_OF_TURN');
  }

  try {
    spendEconomy(economy, cost);
  } catch {
    const code = unavailableCode;
    throw new HttpError('A economia de turno não está mais disponível.', 409, code);
  }

  const written = await db.combatant.updateMany({
    where: { id: combatant.id, mechanicalVersion: combatant.mechanicalVersion },
    data: {
      turnEconomy: economy as unknown as Prisma.InputJsonValue,
      mechanicalVersion: { increment: 1 },
    },
  });
  if (!written.count) {
    throw new HttpError(
      'O estado do turno mudou durante a conjuração; nada foi consumido.',
      409,
      unavailableCode,
    );
  }
  await db.combat.update({
    where: { id: combatant.combatId },
    data: { version: { increment: 1 } },
  });
  return { cost, spentAt: new Date() };
}

/** Resumo seguro para o painel do Mestre (nunca exposto a PLAYER). */
export function castingEconomySummary(context: CastingTurnContext | null) {
  if (!context) return { inCombat: false, isCasterTurn: true, actionAvailable: true, bonusActionAvailable: true };
  return {
    inCombat: true,
    isCasterTurn: context.isCasterTurn,
    actionAvailable: context.actionsUsed < context.actionsGranted,
    bonusActionAvailable: !context.bonusActionUsed,
  };
}
