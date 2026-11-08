import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { ServerEvents } from '../../../realtime/events.js';
import { economyOf, moveDistance } from '../../shared/action-economy.js';
import { deriveConditionEffects } from '../../shared/conditions.js';
import { deathBlocksActions } from '../../shared/death.js';
import type { CombatActor } from '../combat.service.js';
import { emitCombat, emitMovementVisual, loadCombatById } from '../combat.service.js';
import {
  combatantDeathState,
  combatantEffectiveSpeed,
  combatantMovementEconomy,
  combatantMechanicalState,
  orderCombatants,
  toCombatDto,
  type CombatDto,
  type CombatSourced,
  type CombatantSourced,
} from '../combat.dto.js';
import { parseStoredPosition } from './occupied-space.js';
import { effectiveSizeOf } from './spatial-size.js';
import { effectiveSceneConfigOf, type SpatialPosition2D, type SpatialSize } from './spatial.types.js';
import {
  evaluateMovementPath,
  feetToMeters,
  normalizeSideKey,
  remainingMovementFeet,
  type MovementBlockerCode,
  type MovementDifficultSource,
  type MovementParticipant,
  type MovementPathEvaluation,
  formatMetersPtBr,
} from './spatial-movement.js';
import { walkingMovementTerrain } from './movement-terrain.js';
import {
  opportunityAttackMovementGate,
  type MovementReactionGateResult,
} from './movement-reaction-gate.js';
import {
  openOpportunitiesAtBoundary,
  scanReactionBoundaries,
  scanReactionThreats,
  type ScannedBoundary,
} from './opportunity-openers.js';
import { movementReactionRiskOf, type MovementReactionRisk } from './opportunity-attack.js';

/**
 * FASE 6.6L.3 / 6.6L.3.1 — MOVIMENTO VOLUNTÁRIO SERVER-AUTHORITATIVE.
 *
 * O cliente envia APENAS o caminho pretendido (`combatantId` + `path`). Custo,
 * distância, difficult terrain, crawling, passagem, destino e movimento restante
 * são derivados aqui, do estado atual do combate. O preview é INFORMATIVO: o
 * commit revalida tudo do zero (nunca confia no preview).
 *
 * 6.6L.3.1 — o commit deixou de ser SEMPRE atômico. Quando algum passo faria a
 * criatura SAIR do alcance de um ataque corpo a corpo de um reactor elegível:
 *  • o trecho ANTERIOR a esse passo é consolidado (posição + custo, checkpoint);
 *  • o passo provocador NÃO é aplicado (PHB 2014: a Reação acontece antes);
 *  • o caminho restante e as janelas de Reação são persistidos;
 *  • o movimento só continua quando TODAS as janelas daquele boundary fecharem.
 * Um caminho ILEGAL continua sem commit parcial: a validação é do caminho todo.
 *
 * Fontes reutilizadas (nenhuma segunda contabilidade):
 *  • `turnEconomy.movementBudget/movementUsed` — a MESMA economia da 6.1;
 *  • `effectiveSpeed` — deslocamento efetivo central;
 *  • `deriveConditionEffects(...).prone` — crawling vem do motor de Conditions;
 *  • `moveDistance` — o mesmo consumo de Movimento usado por Ação/Ficha.
 *
 * Unidades: a engine espacial é em PÉS; a economia é em METROS (1,5 m = 5 pés).
 */

export interface MovementCommitInput {
  combatId: string;
  combatantId: string;
  expectedVersion: number;
  operationId: string;
  path: SpatialPosition2D[];
}

/** Breakdown SANITIZADO de um passo (auditoria/snapshot). */
export interface MovementStepAudit {
  index: number;
  position: SpatialPosition2D;
  distanceFeet: number;
  costFeet: number;
  crawling: boolean;
  difficultTerrain: boolean;
  difficultTerrainSources: MovementDifficultSource[];
}

export interface MovementAudit {
  from: SpatialPosition2D | null;
  to: SpatialPosition2D | null;
  totalDistanceFeet: number;
  totalCostFeet: number;
  movementRemainingBeforeFeet: number;
  movementRemainingAfterFeet: number;
  movementMode: 'walking';
  /** Política do Reaction Gate aplicada. */
  reactionPolicy: string;
  /** `true` = commit com a janela de Reação real (pode pausar em reach). */
  playerSafe: boolean;
  steps: MovementStepAudit[];
}

/** Movimento pausado esperando Reação — SEMPRE sanitizado (sem reactor). */
export interface MovementPauseDto {
  combatantId: string;
  combatantName: string;
  /** Quantos passos ainda faltam (inclui o passo provocador). */
  remainingSteps: number;
  /** Janelas abertas neste boundary. */
  opportunities: number;
  /** Existe janela que só o Mestre pode adjudicar (visão/segredo). */
  awaitingMaster: boolean;
}

export interface MovementCommitResult {
  combat: CombatDto;
  movement: MovementAudit;
  pending: MovementPauseDto | null;
  replayed: boolean;
}

/** Diagnóstico de boundary para o PREVIEW (completo só para o Mestre). */
export interface MovementBoundaryDiagnostic {
  stepIndex: number;
  reactorCombatantId: string;
  reactorName: string;
  options: { attackId: string; label: string; reachFeet: number }[];
}

export interface MovementPreviewResult {
  movement: MovementPathEvaluation;
  reaction: {
    risk: MovementReactionRisk;
    /** Vazio para jogador: identidade de reactor nunca vai para o tabuleiro. */
    boundaries: MovementBoundaryDiagnostic[];
    relationUnknown: boolean;
    masterAdjudication: boolean;
  };
}

const MOVEMENT_ERRORS: Record<
  MovementBlockerCode,
  { message: string; status: number }
> = {
  MOVEMENT_NOT_ASSESSED: {
    message: 'A cena não está em modo grid-2d: o movimento espacial não é avaliado.',
    status: 409,
  },
  MOVEMENT_PLACEMENT_REQUIRED: {
    message: 'Posicione o combatente na cena antes de movê-lo.',
    status: 409,
  },
  MOVEMENT_NOT_CANONICAL: {
    message: 'A posição atual não está alinhada ao grid: reposicione antes de mover.',
    status: 409,
  },
  MOVEMENT_OUT_OF_BOUNDS: {
    message: 'O trajeto sai da cena.',
    status: 400,
  },
  MOVEMENT_STEP_NOT_CANONICAL: {
    message: 'Cada passo precisa estar alinhado ao grid do combatente.',
    status: 400,
  },
  MOVEMENT_STEP_NOT_CONTIGUOUS: {
    message: 'Cada passo precisa ser adjacente ao anterior: o servidor não encontra caminho.',
    status: 400,
  },
  MOVEMENT_RELATION_UNKNOWN: {
    message: 'O trajeto cruza outra criatura e a relação entre os lados é desconhecida: o Mestre precisa defini-la.',
    status: 409,
  },
  MOVEMENT_PATH_BLOCKED: {
    message: 'O trajeto cruza uma criatura que não pode ser atravessada.',
    status: 409,
  },
  MOVEMENT_DESTINATION_OCCUPIED: {
    message: 'O movimento não pode terminar no espaço de outra criatura.',
    status: 409,
  },
  MOVEMENT_INSUFFICIENT_REMAINING: {
    message: 'Movimento insuficiente para este trajeto.',
    status: 409,
  },
  MOVEMENT_SPEED_ZERO: {
    message: 'Deslocamento efetivo zero: não é possível se mover.',
    status: 409,
  },
};

/** Atalho mantido para os consumidores do serviço espacial. */
export const effectiveSpeedOf = combatantEffectiveSpeed;

function participantsOf(combat: CombatSourced): MovementParticipant[] {
  return combat.combatants.map((combatant) => ({
    combatantId: combatant.id,
    name: combatant.name,
    position: parseStoredPosition(combatant.spatialPosition),
    size: effectiveSizeOf((combatant.baseSize ?? 'medium') as SpatialSize),
    sideKey: normalizeSideKey(combatant.sideKey ?? null),
  }));
}

/** Economia do turno já reconciliada com o deslocamento efetivo. */
export const movementEconomyOf = combatantMovementEconomy;

/**
 * Avaliação derivada do estado persistido (sem escrita, sem cache). Exportada
 * porque a Retomada do movimento pausado usa EXATAMENTE a mesma validação.
 */
export function evaluateMovementForState(
  combat: CombatSourced,
  combatant: CombatantSourced,
  path: readonly SpatialPosition2D[],
  revealBlockers: boolean,
): MovementPathEvaluation {
  const participants = participantsOf(combat);
  const mover =
    participants.find((item) => item.combatantId === combatant.id) ??
    ({
      combatantId: combatant.id,
      name: combatant.name,
      position: null,
      size: 'medium',
      sideKey: null,
    } satisfies MovementParticipant);
  const economy = movementEconomyOf(combatant);
  return evaluateMovementPath({
    scene: effectiveSceneConfigOf(combat),
    mover,
    others: participants.filter((item) => item.combatantId !== combatant.id),
    path,
    prone: deriveConditionEffects(combatantMechanicalState(combatant)).prone,
    movementRemainingFeet: remainingMovementFeet(
      economy.movementBudget,
      economy.movementUsed,
    ),
    speedZero: effectiveSpeedOf(combatant) <= 0,
    terrain: walkingMovementTerrain,
    revealBlockers,
  });
}

function requireMoveAuthority(actor: CombatActor, combatant: CombatantSourced): void {
  if (actor.role === 'MASTER') return;
  if (combatant.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode mover o seu personagem.', 403);
  }
}

/**
 * Linha do Registro do combate (reusa a MESMA forma do log de economia). Uma
 * linha por TRECHO — nunca uma por quadrado — e sem citar quem bloqueou.
 */
async function appendMovementLog(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  combatant: CombatantSourced,
  message: string,
): Promise<void> {
  const entry = {
    id: randomUUID(),
    actorName: combatant.name,
    message,
    at: new Date().toISOString(),
    action: 'move',
  };
  combat.economyLog = [...toCombatDto(combat, 'MASTER').economyLog, entry].slice(-100);
  await db.combat.update({
    where: { id: combat.id },
    data: { economyLog: combat.economyLog as Prisma.InputJsonValue },
  });
}

function auditOf(
  evaluation: MovementPathEvaluation,
  from: SpatialPosition2D | null,
  remainingBefore: number,
  remainingAfter: number,
  gate: Extract<MovementReactionGateResult, { status: 'clear' }>,
): MovementAudit {
  return {
    from,
    to: evaluation.destination,
    totalDistanceFeet: evaluation.totalDistanceFeet,
    totalCostFeet: evaluation.totalCostFeet,
    movementRemainingBeforeFeet: remainingBefore,
    movementRemainingAfterFeet: remainingAfter,
    movementMode: 'walking',
    reactionPolicy: gate.policy,
    playerSafe: gate.playerSafe,
    steps: evaluation.steps.map((step) => ({
      index: step.index,
      position: step.position,
      distanceFeet: step.distanceFeet,
      costFeet: step.costFeet,
      crawling: step.crawling,
      difficultTerrain: step.difficultTerrain,
      difficultTerrainSources: step.difficultTerrainSources,
    })),
  };
}

/** Soma de um TRECHO do caminho já avaliado (prefixo até o boundary). */
function segmentTotals(steps: MovementPathEvaluation['steps']): {
  distanceFeet: number;
  costFeet: number;
  destination: SpatialPosition2D | null;
} {
  const distanceFeet = Math.round(steps.reduce((sum, step) => sum + step.distanceFeet, 0) * 100) / 100;
  const costFeet = Math.round(steps.reduce((sum, step) => sum + step.costFeet, 0) * 100) / 100;
  const last = steps[steps.length - 1];
  return {
    distanceFeet,
    costFeet,
    destination: last ? { xFeet: last.position.xFeet, yFeet: last.position.yFeet } : null,
  };
}

function clearGate(): Extract<MovementReactionGateResult, { status: 'clear' }> {
  const gate = opportunityAttackMovementGate.evaluate({ moverCombatantId: '', path: [] });
  if (gate.status !== 'clear') {
    throw new HttpError(
      'O motor de Reações não está disponível para este movimento.',
      409,
      'MOVEMENT_REACTION_GATE_UNAVAILABLE',
    );
  }
  return gate;
}

export { clearGate as movementGatePolicy };

export { appendMovementLog as appendMovementSegmentLog };

/**
 * Persiste UM trecho de movimento já avaliado: posição + consumo de Movimento na
 * MESMA transação. Usado pelo commit e pela RETOMADA depois de cada janela.
 */
export async function applyMovementEvaluation(
  db: Prisma.TransactionClient,
  combat: CombatSourced,
  combatant: CombatantSourced,
  evaluation: MovementPathEvaluation,
  options: { log?: boolean } = {},
): Promise<{ remainingBefore: number; remainingAfter: number; destination: SpatialPosition2D | null }> {
  const economy = movementEconomyOf(combatant);
  const remainingBefore = remainingMovementFeet(economy.movementBudget, economy.movementUsed);
  if (evaluation.totalCostFeet > 0) {
    moveDistance(economy, feetToMeters(evaluation.totalCostFeet));
  }
  const remainingAfter = remainingMovementFeet(economy.movementBudget, economy.movementUsed);
  const destination = evaluation.destination ?? parseStoredPosition(combatant.spatialPosition);
  await db.combatant.update({
    where: { id: combatant.id },
    data: {
      spatialPosition: destination as unknown as Prisma.InputJsonValue,
      // Só o gasto volta ao estado nominal; persistir a projeção reaplicaria
      // Exaustão/bônus na próxima leitura e em cada retomada de OA.
      turnEconomy: { ...economyOf(combatant.turnEconomy), movementUsed: economy.movementUsed } as unknown as Prisma.InputJsonValue,
    },
  });
  if (options.log !== false && evaluation.steps.length > 0) {
    await appendMovementLog(
      db,
      combat,
      combatant,
      // 6.6M.3.1.4.3 — INTERNO em PÉS (PHB 2014), APRESENTAÇÃO em METROS.
      `Moveu ${formatMetersPtBr(evaluation.totalDistanceFeet)} (custo ${formatMetersPtBr(
        evaluation.totalCostFeet,
      )}) — restam ${formatMetersPtBr(remainingAfter)}.`,
    );
  }
  return { remainingBefore, remainingAfter, destination };
}

function boundaryDiagnostics(
  boundaries: readonly ScannedBoundary[],
): MovementBoundaryDiagnostic[] {
  return boundaries.map((boundary) => ({
    stepIndex: boundary.stepIndex,
    reactorCombatantId: boundary.reactorCombatantId,
    reactorName: boundary.reactorName,
    options: boundary.options.map((option) => ({
      attackId: option.attackId,
      label: option.label,
      reachFeet: option.reachFeet,
    })),
  }));
}

/**
 * PREVIEW read-only (6.6M.3 consumirá isto). Não grava, não gasta e não gera
 * operação/versão. Mestre vê o diagnóstico completo; o jogador recebe o mesmo
 * resultado sem a identidade de quem bloqueia ou reage (privacidade no servidor).
 */
export async function previewVoluntaryMovement(
  actor: CombatActor,
  combatId: string,
  combatantId: string,
  path: SpatialPosition2D[],
): Promise<MovementPreviewResult> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  const combatant = combat.combatants.find((item) => item.id === combatantId);
  if (!combatant) throw new HttpError('Combatente não encontrado neste combate.', 404);
  requireMoveAuthority(actor, combatant);

  const revealBlockers = actor.role === 'MASTER';
  const movement = evaluateMovementForState(combat, combatant, path, revealBlockers);
  // Risco de Reação: a geometria é a MESMA do commit, mas a resposta do jogador
  // não cita reactor/arma/alcance — só o risco agregado.
  const position = parseStoredPosition(combatant.spatialPosition);
  const scan = scanReactionThreats(combat, combatant, movementEconomyOf(combatant));
  const boundaries = position
    ? scanReactionBoundaries(
        scan,
        { position, size: effectiveSizeOf((combatant.baseSize ?? 'medium') as SpatialSize) },
        path,
      )
    : [];
  return {
    movement,
    reaction: {
      risk: movementReactionRiskOf({
        possible: boundaries.length > 0,
        relationUnknown: scan.relationUnknown,
        awaitingMaster: scan.masterAdjudication,
      }),
      boundaries: revealBlockers ? boundaryDiagnostics(boundaries) : [],
      relationUnknown: scan.relationUnknown,
      masterAdjudication: scan.masterAdjudication,
    },
  };
}

function noOpAudit(
  combatant: CombatantSourced,
  gate: Extract<MovementReactionGateResult, { status: 'clear' }>,
): MovementAudit {
  const economy = movementEconomyOf(combatant);
  const remaining = remainingMovementFeet(economy.movementBudget, economy.movementUsed);
  return {
    from: parseStoredPosition(combatant.spatialPosition),
    to: parseStoredPosition(combatant.spatialPosition),
    totalDistanceFeet: 0,
    totalCostFeet: 0,
    movementRemainingBeforeFeet: remaining,
    movementRemainingAfterFeet: remaining,
    movementMode: 'walking',
    reactionPolicy: gate.policy,
    playerSafe: gate.playerSafe,
    steps: [],
  };
}

/**
 * COMMIT de movimento voluntário.
 *
 * Fluxo: Reaction Gate → (no-op se caminho vazio) → replay idempotente →
 * versão → autoridade/estado de morte/turno → deslocamento efetivo → avaliação
 * do caminho INTEIRO → boundaries de reach → (checkpoint + janela) OU aplicação
 * integral, na MESMA transação → realtime.
 */
export async function commitVoluntaryMovement(
  actor: CombatActor,
  input: MovementCommitInput,
): Promise<MovementCommitResult> {
  /**
   * GATE DE REAÇÃO — antes de qualquer escrita. Movimento voluntário (de QUALQUER
   * papel, inclusive o Mestre movendo um NPC) passa pelo motor real de
   * Opportunity Attack. Placement administrativo continua sendo outro caminho.
   */
  const gateResult = opportunityAttackMovementGate.evaluate({
    moverCombatantId: input.combatantId,
    path: input.path,
  });
  if (gateResult.status !== 'clear') {
    throw new HttpError(
      'Movimento voluntário depende do Reaction Gate, que não está disponível.',
      409,
      'MOVEMENT_REACTION_GATE_UNAVAILABLE',
    );
  }

  // Caminho vazio é NO-OP: nenhuma operação, nenhuma versão nova, nenhum gasto.
  if (input.path.length === 0) {
    const combat = await loadCombatById(input.combatId).catch(() => null);
    if (!combat) throw new HttpError('Combate não encontrado.', 404);
    const combatant = combat.combatants.find((item) => item.id === input.combatantId);
    if (!combatant) throw new HttpError('Combatente não encontrado neste combate.', 404);
    requireMoveAuthority(actor, combatant);
    return {
      combat: toCombatDto(combat, actor.role),
      movement: noOpAudit(combatant, gateResult),
      pending: null,
      replayed: false,
    };
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type: 'voluntary-movement', actor: actor.userId, input }))
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
    const snapshot = operation.snapshot as MovementCommitResult;
    return { ...snapshot, replayed: true };
  };

  const existing = await prisma.combatOperation.findUnique({ where: key });
  if (existing) return replay(existing);

  let result: MovementCommitResult;
  try {
    result = await prisma.$transaction(
      async (db) => {
        const previous = await db.combatOperation.findUnique({ where: key });
        if (previous) return replay(previous);

        // Guarda de versão: dois commits simultâneos do mesmo estado → um só.
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
        const combatant = combat.combatants.find((item) => item.id === input.combatantId);
        if (!combatant) {
          throw new HttpError('Combatente não encontrado neste combate.', 404);
        }
        requireMoveAuthority(actor, combatant);

        // Um movimento PAUSADO bloqueia outro commit do mesmo mover (6.6L.3.1):
        // sem isso ele poderia "contornar" a janela andando de novo.
        const pendingIntent = await db.movementIntent.findFirst({
          where: {
            combatId: input.combatId,
            combatantId: combatant.id,
            status: 'pending-reaction',
          },
          select: { id: true },
        });
        if (pendingIntent) {
          throw new HttpError(
            'Este movimento aguarda a resolução de uma Reação: não é possível iniciar outro.',
            409,
            'MOVEMENT_PENDING_REACTION',
          );
        }

        // Lifecycle existente: morto/pendência de morte não ganha movimento.
        if (deathBlocksActions(combatantDeathState(combatant))) {
          throw new HttpError(
            'Aguardando a resolução do Mestre: este combatente não pode se mover.',
            409,
            'CONFLICT',
          );
        }
        // Movimento voluntário só no PRÓPRIO turno (placement segue separado).
        if (orderCombatants(combat.combatants)[combat.currentIndex]?.id !== combatant.id) {
          throw new HttpError(
            'Movimento voluntário exige o turno do combatente.',
            403,
            'FORBIDDEN',
          );
        }
        if (effectiveSpeedOf(combatant) <= 0) {
          throw new HttpError(
            'Deslocamento efetivo zero: não é possível se mover.',
            409,
            'MOVEMENT_SPEED_ZERO',
          );
        }

        // REVALIDAÇÃO no commit: o preview não é autoridade.
        const evaluation = evaluateMovementForState(combat, combatant, input.path, true);
        if (!evaluation.legal) {
          const blocker = evaluation.blocker!;
          const error = MOVEMENT_ERRORS[blocker.code];
          throw new HttpError(error.message, error.status, blocker.code);
        }
        if (!evaluation.affordable) {
          throw new HttpError(
            `Movimento insuficiente: o trajeto custa ${formatMetersPtBr(
              evaluation.totalCostFeet,
            )} e restam ${formatMetersPtBr(evaluation.movementRemainingFeet)}.`,
            409,
            'MOVEMENT_INSUFFICIENT_REMAINING',
          );
        }

        const remainingBefore = evaluation.movementRemainingFeet;
        const position = parseStoredPosition(combatant.spatialPosition);
        const scan = scanReactionThreats(combat, combatant, movementEconomyOf(combatant));
        const boundaries = position
          ? scanReactionBoundaries(
              scan,
              {
                position,
                size: effectiveSizeOf((combatant.baseSize ?? 'medium') as SpatialSize),
              },
              input.path,
            )
          : [];

        // ---------------------------------------------------------------
        // Caminho SEM boundary de reach: aplica tudo (comportamento da 6.6L.3).
        // ---------------------------------------------------------------
        if (boundaries.length === 0) {
          const applied = await applyMovementEvaluation(db, combat, combatant, evaluation);
          const movement = auditOf(
            evaluation,
            position,
            remainingBefore,
            applied.remainingAfter,
            gateResult,
          );
          const response: MovementCommitResult = {
            combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
            movement,
            pending: null,
            replayed: false,
          };
          await db.combatOperation.create({
            data: {
              combatId: combat.id,
              operationId: input.operationId,
              fingerprint,
              snapshot: response as unknown as Prisma.InputJsonValue,
            },
          });
          return response;
        }

        // ---------------------------------------------------------------
        // CHECKPOINT + JANELA: consolida o trecho ANTERIOR ao passo provocador.
        // O passo que sai do alcance NÃO é aplicado (PHB 2014).
        // ---------------------------------------------------------------
        const boundaryIndex = boundaries[0].stepIndex;
        const prefix = evaluation.steps.slice(0, boundaryIndex);
        const totals = segmentTotals(prefix);
        const economy = movementEconomyOf(combatant);
        if (totals.costFeet > 0) moveDistance(economy, feetToMeters(totals.costFeet));
        const remainingAfter = remainingMovementFeet(economy.movementBudget, economy.movementUsed);
        const checkpoint = totals.destination ?? position;

        await db.combatant.update({
          where: { id: combatant.id },
          data: {
            spatialPosition: checkpoint as unknown as Prisma.InputJsonValue,
            turnEconomy: { ...economyOf(combatant.turnEconomy), movementUsed: economy.movementUsed } as unknown as Prisma.InputJsonValue,
          },
        });
        if (prefix.length > 0) {
          await appendMovementLog(
            db,
            combat,
            combatant,
            `Moveu ${formatMetersPtBr(totals.distanceFeet)} (custo ${formatMetersPtBr(
              totals.costFeet,
            )}) — restam ${formatMetersPtBr(remainingAfter)}. Movimento interrompido: aguardando Reação.`,
          );
        }

        const intent = await db.movementIntent.create({
          data: {
            combatId: combat.id,
            combatantId: combatant.id,
            status: 'pending-reaction',
            checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
            remainingPath: input.path.slice(boundaryIndex) as unknown as Prisma.InputJsonValue,
            committedCostFeet: totals.costFeet,
            committedDistanceFeet: totals.distanceFeet,
            operationId: input.operationId,
            fingerprint,
          },
          select: { id: true },
        });

        // Janelas do boundary: uma por reactor elegível, ordenadas por iniciativa.
        // A varredura usa o MOVER na posição antiga (o passo ainda não aconteceu),
        // e o caminho restante começa no passo provocador.
        const opened = await openOpportunitiesAtBoundary(db, {
          combat,
          intentId: intent.id,
          mover: combatant,
          moverEconomy: economy,
          remainingPath: input.path.slice(boundaryIndex),
        });
        if (!opened) {
          // Nenhuma janela válida (corrida com mudança de estado): consolida o
          // caminho restante para não deixar movimento parado sem motivo.
          await applyMovementEvaluation(
            db,
            combat,
            combatant,
            evaluateMovementForState(combat, combatant, input.path, true),
          );
          const movement = auditOf(
            evaluation,
            position,
            remainingBefore,
            remainingMovementFeet(economy.movementBudget, economy.movementUsed),
            gateResult,
          );
          const response: MovementCommitResult = {
            combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
            movement,
            pending: null,
            replayed: false,
          };
          await db.combatOperation.create({
            data: {
              combatId: combat.id,
              operationId: input.operationId,
              fingerprint,
              snapshot: response as unknown as Prisma.InputJsonValue,
            },
          });
          return response;
        }

        const movement = auditOf(
          { ...evaluation, steps: prefix, totalCostFeet: totals.costFeet, totalDistanceFeet: totals.distanceFeet, destination: checkpoint },
          position,
          remainingBefore,
          remainingAfter,
          gateResult,
        );
        const response: MovementCommitResult = {
          combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
          movement,
          pending: {
            combatantId: combatant.id,
            combatantName: combatant.name,
            remainingSteps: input.path.length - boundaryIndex,
            opportunities: opened.opportunities.length,
            awaitingMaster: opened.opportunities.some(
              (item) => item.visibilityStatus === 'unknown',
            ),
          },
          replayed: false,
        };
        await db.combatOperation.create({
          data: {
            combatId: combat.id,
            operationId: input.operationId,
            fingerprint,
            snapshot: response as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    // Retry concorrente da MESMA operação: quem perdeu devolve o snapshot.
    const previous = await prisma.combatOperation.findUnique({ where: key });
    if (previous) return replay(previous);
    throw error;
  }

  if (result.replayed) {
    return { ...result, replayed: true };
  }
  // Publicação SÓ depois do commit (posição + movimento restante + janelas).
  const committed = await loadCombatById(input.combatId);
  // Apresentação ANTES do estado: espectadores começam a animação na origem e
  // o `combat:updated` que chega em seguida não "teleporta" a peça. A UI tolera
  // as duas ordens.
  emitMovementVisualSegment(
    committed,
    input.combatantId,
    input.operationId,
    result.movement,
    result.pending !== null,
  );
  emitCombat(ServerEvents.COMBAT_UPDATED, toCombatDto(committed, 'MASTER'));
  return { combat: result.combat, movement: result.movement, pending: result.pending, replayed: false };
}

/**
 * Publica o TRECHO VISUAL do movimento confirmado.
 *
 * O trecho vem da AUDITORIA (o que o servidor realmente aplicou): com Reação
 * pendente é o prefixo até o checkpoint, nunca o caminho restante. Entidade
 * `master-only` não gera evento para jogadores.
 */
function emitMovementVisualSegment(
  combat: CombatSourced,
  combatantId: string,
  operationId: string,
  audit: MovementAudit,
  checkpoint: boolean,
): void {
  const combatant = combat.combatants.find((item) => item.id === combatantId);
  if (!combatant || !audit.from || !audit.to) return;
  const path = audit.steps.map((step) => ({
    xFeet: step.position.xFeet,
    yFeet: step.position.yFeet,
  }));
  emitMovementVisual(
    {
      combatId: combat.id,
      combatantId,
      operationId,
      from: { xFeet: audit.from.xFeet, yFeet: audit.from.yFeet },
      path,
      to: { xFeet: audit.to.xFeet, yFeet: audit.to.yFeet },
      version: combat.version,
      checkpoint,
      at: new Date().toISOString(),
    },
    combatant.spatialVisibility ?? 'public',
  );
}

/** Trecho de uma avaliação já feita (prefixo até um boundary de reach). */
export function movementSegmentOf(
  evaluation: MovementPathEvaluation,
  from: number,
  to: number,
): MovementPathEvaluation {
  const steps = evaluation.steps.slice(from, to);
  const totals = segmentTotals(steps);
  return {
    ...evaluation,
    steps,
    totalCostFeet: totals.costFeet,
    totalDistanceFeet: totals.distanceFeet,
    destination: totals.destination,
  };
}
