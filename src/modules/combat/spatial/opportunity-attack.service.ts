import { combatantsAreHostile } from '../hostility.js';
import { combatantCanReact } from '../combat.dto.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { ServerEvents } from '../../../realtime/events.js';
import { economyOf } from '../../shared/action-economy.js';
import { deriveConditionEffects } from '../../shared/conditions.js';
import { deathBlocksActions } from '../../shared/death.js';
import type { CombatActor } from '../combat.service.js';
import {
  appendEconomyLog,
  emitCombat,
  emitMovementVisual,
  loadCombatById,
  resolveAttack,
} from '../combat.service.js';
import {
  combatantDeathState,
  combatantMechanicalState,
  toCombatDto,
  type CombatDto,
  type CombatSourced,
  type CombatantSourced,
} from '../combat.dto.js';
import { parseStoredPosition } from './occupied-space.js';
import { effectiveSizeOf } from './spatial-size.js';
import type { SpatialPosition2D, SpatialSize } from './spatial.types.js';
import {
  applyMovementEvaluation,
  movementEconomyOf,
  movementSegmentOf,
  evaluateMovementForState,
  appendMovementSegmentLog,
  type MovementPauseDto,
} from './spatial-movement.service.js';
import {
  openOpportunitiesAtBoundary,
  opportunityAttackProfilesOf,
  scanReactionBoundaries,
  scanReactionThreats,
} from './opportunity-openers.js';
import {
  canConfirmOpportunityVisibility,
  type OpportunityOption,
  type OpportunityVisibilityStatus,
} from './opportunity-attack.js';

/**
 * FASE 6.6L.3.1 — REACTION GATE / OPPORTUNITY ATTACK (PHB 2014).
 *
 * Não existe um segundo motor de Reação: a janela é a MESMA estrutura
 * `ReactionOpportunity` do contrato do cliente, agora persistida e
 * server-authoritative, e o ataque usa o resolver ÚNICO de `resolveAttack`
 * (com a Reação no lugar da Ação), dentro da MESMA transação.
 *
 * Fluxo de produto:
 *   mover tenta andar → trecho até o boundary é pago → o passo que sairia do
 *   alcance NÃO acontece → janelas abertas (uma por reactor, em ordem de
 *   iniciativa) → o dono escolhe um ataque válido ou recusa → a Reação é gasta
 *   só ao atacar → o ataque resolve ANTES de sair do alcance → o estado do mover
 *   é revalidado → o movimento continua até o próximo boundary ou o destino.
 *
 * Regras preservadas:
 *  • janela só com lado HOSTIL conhecido, Reação disponível, reactor capaz de
 *    agir e capaz de VER o mover; `unknown` nunca vira nada por omissão;
 *  • reach é POR ATAQUE (nunca raio de ameaça global) e só corpo a corpo;
 *  • entrar no alcance NÃO provoca nada (Polearm Master é futuro);
 *  • recusar NÃO gasta a Reação; atacar gasta; uma Reação por recuperação;
 *  • Disengage suprime a janela do movimento daquele combatente;
 *  • UMA janela actionable por vez; várias na fila, na ordem da iniciativa;
 *  • nada expira por timeout: sem resposta, o movimento fica pausado;
 *  • o Mestre pode recusar administrativamente para destravar a mesa.
 */

const opportunityOptionsSchema = z.array(
  z.object({
    id: z.string(),
    attackId: z.string(),
    label: z.string(),
    description: z.string(),
    reachFeet: z.number(),
  }),
);

export interface ReactionOpportunityDto {
  id: string;
  kind: 'opportunity-attack';
  combatId: string;
  movementIntentId: string | null;
  moverCombatantId: string;
  moverName: string;
  reactorCombatantId: string;
  reactorName: string;
  trigger: string;
  boundaryIndex: number;
  reachFeet: number;
  status: 'pending' | 'resolved' | 'declined' | 'cancelled';
  visibilityStatus: OpportunityVisibilityStatus;
  visibilityConfirmedBy: string | null;
  orderIndex: number;
  options: OpportunityOption[];
  /** Só a PRIMEIRA janela pendente do boundary pode ser resolvida. */
  actionable: boolean;
  /** Quem recebe uma pergunta; leitura administrativa não implica pedir reação. */
  responseKind: 'reaction' | 'visibility' | null;
  resolution: unknown;
  createdAt: string;
}

export interface ReactionOpportunitiesReadModel {
  combatId: string;
  combatVersion: number;
  opportunities: ReactionOpportunityDto[];
  /** Movimento pausado que o espectador precisa conhecer (sanitizado). */
  movement: MovementPauseDto | null;
}

function optionsOf(raw: unknown): OpportunityOption[] {
  const parsed = opportunityOptionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function statusOf(value: string): ReactionOpportunityDto['status'] {
  if (value === 'resolved' || value === 'declined' || value === 'cancelled') return value;
  return 'pending';
}

function visibilityOf(value: string): OpportunityVisibilityStatus {
  if (value === 'known-not-visible' || value === 'unknown') return value;
  return 'known-visible';
}

function triggerOf(moverName: string, reactorName: string): string {
  return `${moverName} está saindo do seu alcance. Reagir com um ataque corpo a corpo?`;
}

function dtoOf(
  row: {
    id: string;
    combatId: string;
    movementIntentId: string | null;
    moverCombatantId: string;
    reactorCombatantId: string;
    kind: string;
    status: string;
    boundaryIndex: number;
    reachFeet: number;
    options: unknown;
    visibilityStatus: string;
    visibilityConfirmedBy: string | null;
    orderIndex: number;
    resolution: unknown;
    createdAt: Date;
  },
  names: { moverName: string; reactorName: string },
  actionable: boolean,
  responseKind: ReactionOpportunityDto['responseKind'],
): ReactionOpportunityDto {
  return {
    id: row.id,
    kind: 'opportunity-attack',
    combatId: row.combatId,
    movementIntentId: row.movementIntentId,
    moverCombatantId: row.moverCombatantId,
    moverName: names.moverName,
    reactorCombatantId: row.reactorCombatantId,
    reactorName: names.reactorName,
    trigger: triggerOf(names.moverName, names.reactorName),
    boundaryIndex: row.boundaryIndex,
    reachFeet: row.reachFeet,
    status: statusOf(row.status),
    visibilityStatus: visibilityOf(row.visibilityStatus),
    visibilityConfirmedBy: row.visibilityConfirmedBy,
    orderIndex: row.orderIndex,
    options: optionsOf(row.options),
    actionable,
    responseKind,
    resolution: row.resolution ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function nameOf(combat: CombatSourced, combatantId: string): string {
  return combat.combatants.find((item) => item.id === combatantId)?.name ?? 'Criatura';
}

function requireMaster(actor: CombatActor): void {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o mestre pode adjudicar esta Reação.', 403);
  }
}

/** Dono do reactor OU Mestre (item 61/62/63). */
function requireReactionAuthority(
  actor: CombatActor,
  reactor: CombatantSourced | undefined,
): void {
  if (actor.role === 'MASTER') return;
  if (!reactor || reactor.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode resolver a Reação do seu personagem.', 403);
  }
}

function pauseDtoOf(
  combat: CombatSourced,
  intent: { combatantId: string; remainingPath: unknown },
  options: { opportunities: number; awaitingMaster: boolean },
): MovementPauseDto {
  const remaining = Array.isArray(intent.remainingPath) ? intent.remainingPath.length : 0;
  return {
    combatantId: intent.combatantId,
    combatantName: nameOf(combat, intent.combatantId),
    remainingSteps: remaining,
    opportunities: options.opportunities,
    awaitingMaster: options.awaitingMaster,
  };
}

interface PendingRow {
  id: string;
  reactorCombatantId: string;
  orderIndex: number;
  visibilityStatus: string;
}

/** A PRIMEIRA janela pendente do intent é a única actionable (item 67). */
function actionableIdOf(rows: readonly PendingRow[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort(
    (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
  )[0].id;
}

/**
 * READ MODEL (item 73): o estado da janela é reconstruível por HTTP + banco.
 * O jogador recebe SÓ as janelas do próprio personagem (e nunca as de NPC/
 * criatura); o Mestre recebe o diagnóstico completo.
 */
export async function reactionOpportunitiesForCombat(
  actor: CombatActor,
  combatId: string,
): Promise<ReactionOpportunitiesReadModel> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);

  const [rows, intents] = await Promise.all([
    prisma.reactionOpportunity.findMany({
      where: { combatId, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }],
      take: 60,
    }),
    prisma.movementIntent.findMany({
      where: { combatId, status: 'pending-reaction' },
      orderBy: [{ createdAt: 'asc' }],
      take: 20,
    }),
  ]);

  const pendingByReactor = rows.map((row) => ({
    id: row.id,
    reactorCombatantId: row.reactorCombatantId,
    orderIndex: row.orderIndex,
    visibilityStatus: row.visibilityStatus,
  }));

  const visibleRows =
    actor.role === 'MASTER'
      ? rows
      : rows.filter(
          (row) =>
            row.reactorUserId === actor.userId &&
            row.visibilityStatus === 'known-visible',
        );
  const actionable = actionableIdOf(pendingByReactor);
  const responseFor = (row: typeof rows[number]): ReactionOpportunityDto['responseKind'] => {
    if (row.id !== actionable) return null;
    if (actor.role !== 'MASTER') return 'reaction';
    if (row.visibilityStatus === 'unknown') return 'visibility';
    const reactor = combat.combatants.find(unit => unit.id === row.reactorCombatantId);
    return reactor && reactor.kind !== 'CHARACTER' ? 'reaction' : null;
  };


  // Movimento pausado: o Mestre vê todos; o jogador só o do próprio personagem,
  // e o motivo "aguardando o Mestre" nunca cita reactor/arma/posição (item 75).
  const ownIntent =
    actor.role === 'MASTER'
      ? intents[0]
      : intents.find((intent) => {
          const combatant = combat.combatants.find((item) => item.id === intent.combatantId);
          return combatant?.ownerUserId === actor.userId;
        });
  let movement: MovementPauseDto | null = null;
  if (ownIntent) {
    const intentRows = rows.filter((row) => row.movementIntentId === ownIntent.id);
    movement = pauseDtoOf(combat, ownIntent, {
      opportunities: intentRows.length,
      // "Aguardando o Mestre" = existe janela que ESTE espectador não resolve:
      // reactor de NPC/criatura (Mestre) ou visão pendente de adjudicação. Nunca
      // diz quem é, nem com qual arma/alcance (item 75).
      awaitingMaster: intentRows.some(
        (row) =>
          row.visibilityStatus === 'unknown' ||
          (actor.role !== 'MASTER' && row.reactorUserId !== actor.userId),
      ),
    });
  }

  return {
    combatId,
    combatVersion: combat.version,
    opportunities: visibleRows.map((row) =>
      dtoOf(
        row,
        {
          moverName: nameOf(combat, row.moverCombatantId),
          reactorName: nameOf(combat, row.reactorCombatantId),
        },
        row.id === actionable,
        responseFor(row),
      ),
    ),
    movement,
  };
}

/* -------------------------------------------------------------------------- */
/* CICLO DE VIDA DO INTENT                                                    */
/* -------------------------------------------------------------------------- */

async function pendingRowsOf(
  db: Prisma.TransactionClient,
  intentId: string,
): Promise<PendingRow[]> {
  const rows = await db.reactionOpportunity.findMany({
    where: { movementIntentId: intentId, status: 'pending' },
    select: { id: true, reactorCombatantId: true, orderIndex: true, visibilityStatus: true },
  });
  return rows;
}

/** Cancela janelas pendentes do intent (nunca deixa a mesa travada). */
async function cancelRemainingOpportunities(
  db: Prisma.TransactionClient,
  intentId: string,
  reason: string,
): Promise<void> {
  await db.reactionOpportunity.updateMany({
    where: { movementIntentId: intentId, status: 'pending' },
    data: {
      status: 'cancelled',
      resolvedAt: new Date(),
      resolution: { kind: 'cancelled', reason },
    },
  });
}

/**
 * O mover ainda consegue continuar andando? (itens 44/45)
 *
 * A Reação pode ter mudado QUALQUER coisa: PV, morte, Condições. A checagem é
 * refeita no estado real — inclusive o 0 PV que ainda NÃO virou `deathState`
 * (personagem Inconsciente com Testes contra a Morte pendentes). Sem isso a
 * retomada abriria novas janelas para quem já está caído.
 */
function interruptedReasonOf(mover: CombatantSourced): string | null {
  if (deathBlocksActions(combatantDeathState(mover))) return 'mover-cannot-continue';
  const hp = mover.character
    ? mover.character.hpCurrent
    : (mover.hpCurrent ?? mover.creature?.hpCurrent ?? 0);
  if (hp <= 0) return 'mover-cannot-continue';
  if (!deriveConditionEffects(combatantMechanicalState(mover)).canAct) {
    return 'mover-cannot-continue';
  }
  return null;
}

function pathOf(raw: unknown): SpatialPosition2D[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { xFeet: number; yFeet: number } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { xFeet?: unknown }).xFeet === 'number' &&
        typeof (item as { yFeet?: unknown }).yFeet === 'number',
    )
    .map((item) => ({ xFeet: item.xFeet, yFeet: item.yFeet }));
}

/**
 * RETOMADA do movimento pausado (item 44/46/68).
 *
 * Só roda quando NENHUMA janela do boundary continua pendente. Revalida tudo
 * (vida, condições, deslocamento, posição, ocupação, caminho) do estado ATUAL e:
 *  • sem novo boundary → aplica o restante e conclui;
 *  • com novo boundary → aplica o trecho até ele e abre as novas janelas;
 *  • mover incapaz / caminho inválido → interrompe, sem inventar posição.
 */
/**
 * Trecho de movimento aplicado pela RETOMADA (após as Reações fecharem).
 *
 * Serve só para a apresentação (6.6M.3.1.4): quem estava esperando vê a peça
 * retomar do checkpoint, e o trecho termina no próximo checkpoint quando outra
 * janela abre.
 */
export interface ContinuationSegment {
  combatantId: string;
  from: SpatialPosition2D;
  path: SpatialPosition2D[];
  to: SpatialPosition2D;
  checkpoint: boolean;
}

async function continueOrPause(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  intentId: string,
  onSegment?: (segment: ContinuationSegment) => void,
): Promise<{ pending: MovementPauseDto | null; defeated: boolean }> {
  const intent = await db.movementIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.status !== 'pending-reaction') {
    return { pending: null, defeated: false };
  }
  const pending = await pendingRowsOf(db, intentId);
  const mover = combat.combatants.find((item) => item.id === intent.combatantId);

  // 6.6L.3.1 — o mover pode ter sido derrubado pela Reação que acabou de
  // resolver. ANTES de olhar a fila, revalidar a capacidade: se ele não pode
  // mais andar, as janelas restantes daquele boundary são canceladas (item 115)
  // e o movimento termina — nunca abrir Reação inútil contra quem caiu.
  const blockedNow = mover ? interruptedReasonOf(mover) : 'mover-missing';
  if (blockedNow) {
    await cancelRemainingOpportunities(db, intentId, blockedNow);
    await db.movementIntent.update({
      where: { id: intentId },
      data: { status: 'interrupted', reason: blockedNow },
    });
    if (mover) {
      await appendMovementSegmentLog(
        db,
        combat,
        mover,
        'Movimento interrompido: não é possível continuar.',
      );
    }
    return { pending: null, defeated: true };
  }

  if (pending.length > 0) {
    return {
      pending: pauseDtoOf(combat, intent, {
        opportunities: pending.length,
        awaitingMaster: pending.some((row) => row.visibilityStatus === 'unknown'),
      }),
      defeated: false,
    };
  }

  const remaining = pathOf(intent.remainingPath);
  if (!mover || remaining.length === 0) {
    await db.movementIntent.update({
      where: { id: intentId },
      data: { status: 'interrupted', reason: 'mover-missing' },
    });
    await cancelRemainingOpportunities(db, intentId, 'mover-missing');
    return { pending: null, defeated: true };
  }

  // Um único passo (o provocador) já foi validado no commit, mas o caminho
  // restante é revalidado INTEIRO agora: nada de andar metade e falhar depois.
  const evaluation = evaluateMovementForState(combat, mover, remaining, true);
  if (!evaluation.legal || !evaluation.affordable) {
    await db.movementIntent.update({
      where: { id: intentId },
      data: { status: 'interrupted', reason: evaluation.blocker?.code ?? 'MOVEMENT_INSUFFICIENT_REMAINING' },
    });
    await cancelRemainingOpportunities(db, intentId, 'movement-invalid');
    await appendMovementSegmentLog(
      db,
      combat,
      mover,
      'Movimento interrompido antes de continuar: o caminho não é mais válido.',
    );
    return { pending: null, defeated: true };
  }

  const position = parseStoredPosition(mover.spatialPosition);
  const scan = scanReactionThreats(combat, mover, movementEconomyOf(mover));
  const boundaries = position
    ? scanReactionBoundaries(
        scan,
        { position, size: effectiveSizeOf((mover.baseSize ?? 'medium') as SpatialSize) },
        remaining,
      ).filter((boundary) => boundary.stepIndex > 0)
    : [];
  const next = boundaries[0];

  if (!next) {
    await applyMovementEvaluation(db, combat, mover, evaluation);
    onSegment?.({
      combatantId: mover.id,
      from: position ?? { xFeet: 0, yFeet: 0 },
      path: evaluation.steps.map((step) => step.position),
      to: evaluation.destination ?? position ?? { xFeet: 0, yFeet: 0 },
      checkpoint: false,
    });
    await db.movementIntent.update({
      where: { id: intentId },
      data: {
        status: 'committed',
        remainingPath: [] as unknown as Prisma.InputJsonValue,
        checkpoint: (evaluation.destination ?? position) as unknown as Prisma.InputJsonValue,
        committedCostFeet: intent.committedCostFeet + evaluation.totalCostFeet,
        committedDistanceFeet: intent.committedDistanceFeet + evaluation.totalDistanceFeet,
      },
    });
    return { pending: null, defeated: false };
  }

  // Trecho até o próximo boundary; o passo provocador fica para depois da janela.
  const prefix = movementSegmentOf(evaluation, 0, next.stepIndex);
  await applyMovementEvaluation(db, combat, mover, prefix);
  const checkpoint = prefix.destination ?? position;
  const nextPath = remaining.slice(next.stepIndex);
  await db.movementIntent.update({
    where: { id: intentId },
    data: {
      remainingPath: nextPath as unknown as Prisma.InputJsonValue,
      checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
      committedCostFeet: intent.committedCostFeet + prefix.totalCostFeet,
      committedDistanceFeet: intent.committedDistanceFeet + prefix.totalDistanceFeet,
    },
  });

  const movedMover = { ...mover, spatialPosition: checkpoint };
  const opened = await openOpportunitiesAtBoundary(db, {
    combat,
    intentId,
    mover: movedMover,
    moverEconomy: economyOf(movedMover.turnEconomy),
    remainingPath: nextPath,
  });
  if (!opened) {
    // Nenhuma janela válida após a revalidação: conclui o restante.
    const restEvaluation = evaluateMovementForState(
      { ...combat, combatants: combat.combatants.map((item) => (item.id === mover.id ? movedMover : item)) },
      movedMover,
      nextPath,
      true,
    );
    if (restEvaluation.legal && restEvaluation.affordable) {
      await applyMovementEvaluation(db, combat, movedMover, restEvaluation);
      await db.movementIntent.update({
        where: { id: intentId },
        data: { status: 'committed', remainingPath: [] as unknown as Prisma.InputJsonValue },
      });
      // Prefixo + restante são contíguos e o caminho inteiro foi autorizado:
      // um ÚNICO trecho visual, sem parar no meio.
      onSegment?.({
        combatantId: mover.id,
        from: position ?? { xFeet: 0, yFeet: 0 },
        path: [
          ...prefix.steps.map((step) => step.position),
          ...restEvaluation.steps.map((step) => step.position),
        ],
        to: restEvaluation.destination ?? checkpoint ?? { xFeet: 0, yFeet: 0 },
        checkpoint: false,
      });
      return { pending: null, defeated: false };
    }
    onSegment?.({
      combatantId: mover.id,
      from: position ?? { xFeet: 0, yFeet: 0 },
      path: prefix.steps.map((step) => step.position),
      to: checkpoint ?? { xFeet: 0, yFeet: 0 },
      checkpoint: false,
    });
    return { pending: null, defeated: false };
  }

  onSegment?.({
    combatantId: mover.id,
    from: position ?? { xFeet: 0, yFeet: 0 },
    path: prefix.steps.map((step) => step.position),
    to: checkpoint ?? { xFeet: 0, yFeet: 0 },
    checkpoint: true,
  });

  return {
    pending: pauseDtoOf(combat, { combatantId: mover.id, remainingPath: nextPath }, {
      opportunities: opened.opportunities.length,
      awaitingMaster: opened.opportunities.some((row) => row.visibilityStatus === 'unknown'),
    }),
    defeated: false,
  };
}

/* -------------------------------------------------------------------------- */
/* RESOLUÇÃO                                                                  */
/* -------------------------------------------------------------------------- */

export interface OpportunityResolutionInput {
  expectedVersion: number;
  operationId: string;
  attackId: string;
}

export interface OpportunitySettlement {
  opportunityId: string;
  attackId: string;
  hit: boolean;
  critical: boolean;
  damageRolled: number;
  status: 'resolved';
  pending: MovementPauseDto | null;
  moverDefeated: boolean;
}

export interface OpportunityResolutionResult {
  combat: CombatDto;
  result: Awaited<ReturnType<typeof resolveAttack>>['result'];
  reaction: OpportunitySettlement;
}

/**
 * Validação AUTORITATIVA da janela, dentro da transação do ataque e ANTES de
 * gastar Reação/rolar dados.
 */
async function assertOpportunityActionable(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  actor: CombatActor,
  opportunityId: string,
  attackId: string,
): Promise<{ mover: CombatantSourced; reactor: CombatantSourced }> {
  const row = await db.reactionOpportunity.findUnique({ where: { id: opportunityId } });
  if (!row || row.combatId !== combat.id) {
    throw new HttpError('Oportunidade de Reação não encontrada.', 404);
  }
  if (row.status !== 'pending') {
    throw new HttpError(
      'Esta Oportunidade já foi resolvida.',
      409,
      'OPPORTUNITY_NOT_PENDING',
    );
  }
  const reactor = combat.combatants.find((item) => item.id === row.reactorCombatantId);
  const mover = combat.combatants.find((item) => item.id === row.moverCombatantId);
  if (!reactor || !mover) {
    throw new HttpError(
      'A criatura da Reação não está mais no combate.',
      409,
      'OPPORTUNITY_REACTOR_MISSING',
    );
  }
  requireReactionAuthority(actor, reactor);
  if (!combatantsAreHostile(reactor, mover)) throw new HttpError('A relação mudou: esta criatura não é mais hostil ao alvo.', 409, 'OPPORTUNITY_RELATION_CHANGED');
  if (row.visibilityStatus === 'unknown') {
    throw new HttpError(
      'O Mestre precisa adjudicar a visão antes desta Reação.',
      409,
      'OPPORTUNITY_VISIBILITY_UNKNOWN',
    );
  }
  if (row.visibilityStatus === 'known-not-visible') {
    throw new HttpError(
      'Esta criatura não consegue ver o alvo: a Reação não existe.',
      409,
      'OPPORTUNITY_NOT_VISIBLE',
    );
  }
  const pending = await pendingRowsOf(db, row.movementIntentId ?? '');
  if (actionableIdOf(pending) !== row.id) {
    throw new HttpError(
      'Outra Reação deste movimento precisa ser resolvida antes.',
      409,
      'OPPORTUNITY_NOT_ACTIONABLE',
    );
  }
  const options = optionsOf(row.options);
  if (!options.some((option) => option.attackId === attackId)) {
    throw new HttpError(
      'Este ataque não é uma opção válida nesta janela.',
      400,
      'OPPORTUNITY_OPTION_INVALID',
    );
  }
  // Revalida o perfil do ataque AGORA: alcance continua sendo por ataque.
  const profile = opportunityAttackProfilesOf(reactor).find(
    (item) => item.attackId === attackId,
  );
  if (!profile) {
    throw new HttpError(
      'O ataque escolhido não pode mais ser usado nesta Reação.',
      409,
      'OPPORTUNITY_OPTION_INVALID',
    );
  }
  if (!economyOf(reactor.turnEconomy).reactionAvailable) {
    throw new HttpError('Reação já utilizada.', 409, 'REACTION_UNAVAILABLE');
  }
  if (!combatantCanReact(reactor)) {
    throw new HttpError(
      'Condição impede realizar Reações.',
      409,
      'REACTION_UNAVAILABLE',
    );
  }
  return { mover, reactor };
}

/** RESOLVE a janela com UM ataque corpo a corpo (mesmo resolver do ataque). */
export async function resolveOpportunityAttack(
  actor: CombatActor,
  combatId: string,
  opportunityId: string,
  input: OpportunityResolutionInput,
): Promise<OpportunityResolutionResult> {
  const row = await prisma.reactionOpportunity.findUnique({ where: { id: opportunityId } });
  if (!row || row.combatId !== combatId) {
    throw new HttpError('Oportunidade de Reação não encontrada.', 404);
  }

  /** Trecho aplicado pela retomada — publicado só DEPOIS do commit. */
  let continuation: ContinuationSegment | null = null;
  const response = await resolveAttack<OpportunitySettlement>(
    actor,
    {
      combatId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      attackerCombatantId: row.reactorCombatantId,
      targetCombatantId: row.moverCombatantId,
      attackId: input.attackId,
    },
    {
      operationType: 'opportunity-attack',
      // Consome a REAÇÃO, nunca Ação/Ação Bônus; fora do próprio turno é válido.
      forcedReaction: true,
      beforeAttack: async ({ db, combat }) => {
        await assertOpportunityActionable(db, combat, actor, opportunityId, input.attackId);
      },
      onResolved: async ({ db, hit, critical, damageRolled }) => {
        // O combate é relido DENTRO da transação: o ataque pode ter derrubado o
        // mover a 0 PV, e a Retomada precisa do estado real, não do snapshot.
        const latest = await loadCombatById(combatId, db);
        const reactor = latest.combatants.find(
          (item) => item.id === row.reactorCombatantId,
        );
        const mover = latest.combatants.find((item) => item.id === row.moverCombatantId);
        await db.reactionOpportunity.update({
          where: { id: opportunityId },
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolution: {
              kind: 'attack',
              attackId: input.attackId,
              hit,
              critical,
              damage: damageRolled,
              by: actor.username,
            },
          },
        });
        if (reactor) {
          await appendEconomyLog(
            db,
            latest,
            reactor,
            `Ataque de Oportunidade contra ${mover?.name ?? 'o alvo'} — ${hit ? (critical ? 'ACERTO CRÍTICO' : 'acerto') : 'erro'} (${damageRolled} de dano).`,
            'opportunity-attack',
          );
        }
        const outcome = row.movementIntentId
          ? await continueOrPause(db, latest, row.movementIntentId, (segment) => {
              continuation = segment;
            })
          : { pending: null, defeated: false };
        return {
          opportunityId,
          attackId: input.attackId,
          hit,
          critical,
          damageRolled,
          status: 'resolved' as const,
          pending: outcome.pending,
          moverDefeated: outcome.defeated,
        };
      },
    },
  );

  if (continuation) {
    await publishContinuationVisual(combatId, continuation, input.operationId);
  }
  return {
    combat: response.combat,
    result: response.result,
    reaction: response.reaction as OpportunitySettlement,
  };
}

/* -------------------------------------------------------------------------- */
/* RECUSA E ADJUDICAÇÃO                                                       */
/* -------------------------------------------------------------------------- */

export interface OpportunityDeclineInput {
  expectedVersion: number;
  operationId: string;
}

export interface OpportunityDeclineResult {
  combat: CombatDto;
  opportunityId: string;
  status: 'declined' | 'cancelled';
  /** Motivo auditável (recusa do dono, do Mestre ou visão negada). */
  reason: 'declined' | 'master-declined' | 'not-visible';
  pending: MovementPauseDto | null;
  replayed: boolean;
}

interface DeclineOperation {
  combatId: string;
  expectedVersion: number;
  operationId: string;
  opportunityId: string;
  /** `decline` = dono/Mestre; `visibility` = adjudicação do Mestre. */
  kind: 'decline' | 'visibility';
  visible?: boolean;
}

/**
 * Transação de uma operação que NÃO é ataque (recusar/adjudicar). Mesmo padrão
 * das demais operações de combate: fingerprint + replay, versão esperada e
 * publicação só depois do commit.
 */
async function runOpportunityOperation(
  actor: CombatActor,
  input: DeclineOperation,
  apply: (
    db: Prisma.TransactionClient,
    combat: CombatSourced,
    /** Recebe o trecho aplicado pela retomada (apresentação, pós-commit). */
    onSegment: (segment: ContinuationSegment) => void,
  ) => Promise<Omit<OpportunityDeclineResult, 'replayed'>>,
): Promise<OpportunityDeclineResult> {
  let continuation: ContinuationSegment | null = null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type: `opportunity-${input.kind}`, actor: actor.userId, input }))
    .digest('hex');
  const key = {
    combatId_operationId: { combatId: input.combatId, operationId: input.operationId },
  };
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) {
      throw new HttpError(
        'operationId reutilizado com outro payload/autor.',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return { ...(operation.snapshot as OpportunityDeclineResult), replayed: true };
  };

  const existing = await prisma.combatOperation.findUnique({ where: key });
  if (existing) return replay(existing);

  let result: OpportunityDeclineResult;
  try {
    result = await prisma.$transaction(
      async (db) => {
        const previous = await db.combatOperation.findUnique({ where: key });
        if (previous) return replay(previous);
        const changed = await db.combat.updateMany({
          where: { id: input.combatId, status: 'ACTIVE', version: input.expectedVersion },
          data: { version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          throw new HttpError(
            'Combate mudou ou não está ativo. Atualize e tente novamente.',
            409,
            'CONFLICT',
          );
        }
        const combat = await loadCombatById(input.combatId, db);
        const response = await apply(db, combat, (segment) => {
          continuation = segment;
        });
        await db.combatOperation.create({
          data: {
            combatId: combat.id,
            operationId: input.operationId,
            fingerprint,
            snapshot: { ...response, replayed: false } as unknown as Prisma.InputJsonValue,
          },
        });
        return { ...response, replayed: false };
      },
      { timeout: 20000 },
    );
  } catch (error) {
    const previous = await prisma.combatOperation.findUnique({ where: key });
    if (previous) return replay(previous);
    throw error;
  }

  if (result.replayed) return result;
  if (continuation) {
    await publishContinuationVisual(input.combatId, continuation, input.operationId);
  }
  emitCombat(
    ServerEvents.COMBAT_UPDATED,
    toCombatDto(await loadCombatById(input.combatId), 'MASTER'),
  );
  return result;
}

/**
 * Publica o trecho aplicado pela RETOMADA do movimento (depois da transação).
 *
 * Entidade `master-only` continua restrita à sala dos Mestres: a animação nunca
 * vira oráculo de posição de criatura escondida.
 */
async function publishContinuationVisual(
  combatId: string,
  segment: ContinuationSegment,
  operationId: string,
): Promise<void> {
  const combat = await loadCombatById(combatId);
  const combatant = combat.combatants.find((item) => item.id === segment.combatantId);
  if (!combatant) return;
  emitMovementVisual(
    {
      combatId,
      combatantId: segment.combatantId,
      operationId,
      from: segment.from,
      path: segment.path,
      to: segment.to,
      version: combat.version,
      checkpoint: segment.checkpoint,
      at: new Date().toISOString(),
    },
    combatant.spatialVisibility ?? 'public',
  );
}

/**
 * "NÃO REAGIR": fecha SÓ a janela atual, SEM gastar a Reação (item 59). Como a
 * Reação continua disponível, um boundary posterior com alcance maior ainda pode
 * abrir uma nova janela.
 */
export async function declineOpportunity(
  actor: CombatActor,
  combatId: string,
  opportunityId: string,
  input: OpportunityDeclineInput,
): Promise<OpportunityDeclineResult> {
  return runOpportunityOperation(
    actor,
    { combatId, opportunityId, kind: 'decline', ...input },
    async (db, combat, onSegment) => {
      const row = await db.reactionOpportunity.findUnique({ where: { id: opportunityId } });
      if (!row || row.combatId !== combatId) {
        throw new HttpError('Oportunidade de Reação não encontrada.', 404);
      }
      if (row.status !== 'pending') {
        throw new HttpError(
          'Esta Oportunidade já foi resolvida.',
          409,
          'OPPORTUNITY_NOT_PENDING',
        );
      }
      const reactor = combat.combatants.find((item) => item.id === row.reactorCombatantId);
      requireReactionAuthority(actor, reactor);
      const master = actor.role === 'MASTER' && reactor?.ownerUserId !== actor.userId;
      if (!master) {
        const pending = await pendingRowsOf(db, row.movementIntentId ?? '');
        if (actionableIdOf(pending) !== row.id) {
          throw new HttpError(
            'Outra Reação deste movimento precisa ser resolvida antes.',
            409,
            'OPPORTUNITY_NOT_ACTIONABLE',
          );
        }
      }
      const reason = master ? 'master-declined' : 'declined';
      await db.reactionOpportunity.update({
        where: { id: opportunityId },
        data: {
          status: 'declined',
          resolvedAt: new Date(),
          resolution: { kind: reason, by: actor.username },
        },
      });
      if (reactor) {
        await appendEconomyLog(
          db,
          combat,
          reactor,
          master
            ? `Mestre ${actor.username} recusou o Ataque de Oportunidade de ${reactor.name} (nenhuma Reação gasta).`
            : `${reactor.name} recusou o Ataque de Oportunidade (nenhuma Reação gasta).`,
          'opportunity-declined',
        );
      }
      const outcome = row.movementIntentId
        ? await continueOrPause(db, combat, row.movementIntentId, onSegment)
        : { pending: null, defeated: false };
      return {
        combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
        opportunityId,
        status: 'declined' as const,
        reason,
        pending: outcome.pending,
      };
    },
  );
}

/**
 * ADJUDICAÇÃO DE VISÃO pelo Mestre (item 27/121/122).
 *
 * Só uma janela `unknown` pode ser confirmada. `known-not-visible` é fato
 * autoritativo e NUNCA vira visível por confirmação manual.
 */
export async function confirmOpportunityVisibility(
  actor: CombatActor,
  combatId: string,
  opportunityId: string,
  input: OpportunityDeclineInput & { visible: boolean },
): Promise<OpportunityDeclineResult> {
  requireMaster(actor);
  return runOpportunityOperation(
    actor,
    { ...input, combatId, opportunityId, kind: 'visibility' },
    async (db, combat, onSegment) => {
      const row = await db.reactionOpportunity.findUnique({ where: { id: opportunityId } });
      if (!row || row.combatId !== combatId) {
        throw new HttpError('Oportunidade de Reação não encontrada.', 404);
      }
      if (row.status !== 'pending') {
        throw new HttpError(
          'Esta Oportunidade já foi resolvida.',
          409,
          'OPPORTUNITY_NOT_PENDING',
        );
      }
      if (!canConfirmOpportunityVisibility(visibilityOf(row.visibilityStatus))) {
        throw new HttpError(
          'A visão desta janela já é um fato autoritativo: não pode ser sobrescrita.',
          409,
          'OPPORTUNITY_VISIBILITY_FINAL',
        );
      }
      const reactor = combat.combatants.find((item) => item.id === row.reactorCombatantId);
      if (input.visible) {
        await db.reactionOpportunity.update({
          where: { id: opportunityId },
          data: {
            visibilityStatus: 'known-visible',
            visibilityConfirmedBy: actor.username,
          },
        });
        if (reactor) {
          await appendEconomyLog(
            db,
            combat,
            reactor,
            `Mestre ${actor.username} confirmou que ${reactor.name} VÊ o alvo que está saindo do alcance.`,
            'opportunity-visibility',
          );
        }
        return {
          combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
          opportunityId,
          status: 'declined' as const,
          reason: 'declined',
          pending: null,
        };
      }

      await db.reactionOpportunity.update({
        where: { id: opportunityId },
        data: {
          status: 'cancelled',
          resolvedAt: new Date(),
          resolution: { kind: 'not-visible', by: actor.username },
        },
      });
      if (reactor) {
        await appendEconomyLog(
          db,
          combat,
          reactor,
          `Mestre ${actor.username} confirmou que ${reactor.name} NÃO vê o alvo: nenhuma Reação.`,
          'opportunity-visibility',
        );
      }
      const outcome = row.movementIntentId
        ? await continueOrPause(db, combat, row.movementIntentId, onSegment)
        : { pending: null, defeated: false };
      return {
        combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
        opportunityId,
        status: 'cancelled' as const,
        reason: 'not-visible',
        pending: outcome.pending,
      };
    },
  );
}


/** Encerrar consentimento invalida só as oportunidades desse par e retoma pelo motor existente. */
export async function cancelDuelOpportunities(db: Prisma.TransactionClient, combatId: string, a: string, b: string): Promise<void> {
  const rows = await db.reactionOpportunity.findMany({ where: { combatId, status: 'pending', OR: [
    { reactorCombatantId: a, moverCombatantId: b }, { reactorCombatantId: b, moverCombatantId: a },
  ] } });
  if (!rows.length) return;
  await db.reactionOpportunity.updateMany({ where: { id: { in: rows.map(row => row.id) }, status: 'pending' }, data: { status: 'cancelled', resolvedAt: new Date(), resolution: { kind: 'cancelled', reason: 'duel-ended' } } });
  for (const intentId of new Set(rows.map(row => row.movementIntentId).filter((id): id is string => !!id))) {
    await continueOrPause(db, await loadCombatById(combatId, db), intentId);
  }
}
