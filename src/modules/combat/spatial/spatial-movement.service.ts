import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { ServerEvents } from '../../../realtime/events.js';
import { economyOf, moveDistance } from '../../shared/action-economy.js';
import {
  deriveConditionEffects,
  effectiveSpeed,
  reconcileMovement,
} from '../../shared/conditions.js';
import { deathBlocksActions } from '../../shared/death.js';
import type { CombatActor } from '../combat.service.js';
import { emitCombat, loadCombatById } from '../combat.service.js';
import {
  combatantDeathState,
  combatantMechanicalState,
  orderCombatants,
  toCombatDto,
  type CombatDto,
  type CombatSourced,
  type CombatantSourced,
} from '../combat.dto.js';
import { parseStoredPosition } from './occupied-space.js';
import { effectiveSizeOf } from './spatial-size.js';
import {
  spatialSceneOf,
  type SpatialPosition2D,
  type SpatialSize,
} from './spatial.types.js';
import {
  evaluateMovementPath,
  feetToMeters,
  normalizeSideKey,
  remainingMovementFeet,
  type MovementBlockerCode,
  type MovementDifficultSource,
  type MovementParticipant,
  type MovementPathEvaluation,
} from './spatial-movement.js';
import { walkingMovementTerrain } from './movement-terrain.js';
import {
  administrativeMovementGate,
  unavailableMovementGate,
} from './movement-reaction-gate.js';

/**
 * FASE 6.6L.3 — MOVIMENTO VOLUNTÁRIO SERVER-AUTHORITATIVE.
 *
 * O cliente envia APENAS o caminho pretendido (`combatantId` + `path`). Custo,
 * distância, difficult terrain, crawling, passagem, destino e movimento restante
 * são derivados aqui, do estado atual do combate. O preview é INFORMATIVO: o
 * commit revalida tudo do zero (nunca confia no preview).
 *
 * Fontes reutilizadas (nenhuma segunda contabilidade):
 *  • `turnEconomy.movementBudget/movementUsed` — a MESMA economia de turno da
 *    6.1 (Dash e ajuste do Mestre já entram por ela);
 *  • `effectiveSpeed` — deslocamento efetivo central (speed-flat de Efeitos,
 *    multiplicadores de Exaustão e zero override de Condições);
 *  • `deriveConditionEffects(...).prone` — crawling vem do motor de Conditions;
 *  • `moveDistance` — o mesmo consumo de Movimento usado por Ação/Ficha.
 *
 * Unidades: a engine espacial é em PÉS; a economia de turno é em METROS. A
 * conversão (1,5 m = 5 pés) acontece só na fronteira, sem arredondar o saldo.
 *
 * Atomicidade: posição, `turnEconomy` e o registro da operação entram na MESMA
 * transação, com guarda de `version`. Retry com o mesmo `operationId` devolve o
 * snapshot (não move de novo); payload diferente → 409.
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
  /** Política do Reaction Gate aplicada (6.6L.3.1 substitui o provider). */
  reactionPolicy: string;
  /** `false` = este commit NÃO pode ser liberado a jogador. */
  playerSafe: boolean;
  steps: MovementStepAudit[];
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

function baseSpeedOf(combatant: CombatantSourced): number {
  return Math.max(0, combatant.character?.speed ?? combatant.creature?.speed ?? 0);
}

/** Deslocamento EFETIVO central — nunca recalculado localmente. */
function effectiveSpeedOf(combatant: CombatantSourced): number {
  return effectiveSpeed(
    baseSpeedOf(combatant),
    combatantMechanicalState(combatant),
    combatant.effectModifiers?.speedBonus ?? 0,
  );
}

function participantsOf(combat: CombatSourced): MovementParticipant[] {
  return combat.combatants.map((combatant) => ({
    combatantId: combatant.id,
    name: combatant.name,
    position: parseStoredPosition(combatant.spatialPosition),
    size: effectiveSizeOf((combatant.baseSize ?? 'medium') as SpatialSize),
    sideKey: normalizeSideKey(combatant.sideKey ?? null),
  }));
}

/** Avaliação derivada do estado persistido (sem escrita, sem cache). */
function evaluateFor(
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
  const economy = reconcileMovement(
    economyOf(combatant.turnEconomy),
    baseSpeedOf(combatant),
    effectiveSpeedOf(combatant),
  );
  return evaluateMovementPath({
    scene: spatialSceneOf(combat.spatialConfig),
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
 * PREVIEW read-only (6.6M.3 consumirá isto). Não grava, não gasta e não gera
 * operação/versão. Mestre vê o diagnóstico completo; o jogador recebe o mesmo
 * resultado sem a identidade de quem bloqueia (privacidade no servidor).
 */
export async function previewVoluntaryMovement(
  actor: CombatActor,
  combatId: string,
  combatantId: string,
  path: SpatialPosition2D[],
): Promise<{ movement: MovementPathEvaluation }> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  const combatant = combat.combatants.find((item) => item.id === combatantId);
  if (!combatant) throw new HttpError('Combatente não encontrado neste combate.', 404);
  requireMoveAuthority(actor, combatant);
  return {
    movement: evaluateFor(combat, combatant, path, actor.role === 'MASTER'),
  };
}

function noOpAudit(combatant: CombatantSourced): MovementAudit {
  const economy = reconcileMovement(
    economyOf(combatant.turnEconomy),
    baseSpeedOf(combatant),
    effectiveSpeedOf(combatant),
  );
  const remaining = remainingMovementFeet(economy.movementBudget, economy.movementUsed);
  return {
    from: parseStoredPosition(combatant.spatialPosition),
    to: parseStoredPosition(combatant.spatialPosition),
    totalDistanceFeet: 0,
    totalCostFeet: 0,
    movementRemainingBeforeFeet: remaining,
    movementRemainingAfterFeet: remaining,
    movementMode: 'walking',
    reactionPolicy: 'administrative-no-reaction',
    playerSafe: false,
    steps: [],
  };
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
  policy: string,
  playerSafe: boolean,
): MovementAudit {
  return {
    from,
    to: evaluation.destination,
    totalDistanceFeet: evaluation.totalDistanceFeet,
    totalCostFeet: evaluation.totalCostFeet,
    movementRemainingBeforeFeet: remainingBefore,
    movementRemainingAfterFeet: remainingAfter,
    movementMode: 'walking',
    reactionPolicy: policy,
    playerSafe,
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

/**
 * COMMIT de movimento voluntário.
 *
 * Fluxo: Reaction Gate → (no-op se caminho vazio) → replay idempotente →
 * versão → autoridade/estado de morte/turno → deslocamento efetivo → avaliação
 * do caminho INTEIRO → consumo de movimento + posição na MESMA transação →
 * realtime. Qualquer passo ilegal recusa o trecho completo: nunca há commit
 * parcial.
 */
export async function commitVoluntaryMovement(
  actor: CombatActor,
  input: MovementCommitInput,
): Promise<{ combat: CombatDto; movement: MovementAudit; replayed: boolean }> {
  /**
   * GATE DE REAÇÃO — antes de qualquer escrita. O Mestre opera com política
   * administrativa explícita; o jogador NÃO tem movimento voluntário enquanto
   * Opportunity Attacks não existirem (liberar permitiria sair do alcance de
   * inimigos de graça). Trocar o provider é a 6.6L.3.1.
   */
  const gate = actor.role === 'MASTER' ? administrativeMovementGate : unavailableMovementGate;
  const gateResult = gate.evaluate({
    moverCombatantId: input.combatantId,
    path: input.path,
  });
  if (gateResult.status !== 'clear') {
    throw new HttpError(
      'Movimento voluntário de jogador depende do Reaction Gate (Opportunity Attacks ainda não são resolvidas). O Mestre pode mover administrativamente.',
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
      movement: noOpAudit(combatant),
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
    const snapshot = operation.snapshot as { combat: CombatDto; movement: MovementAudit };
    return { ...snapshot, replayed: true };
  };

  const existing = await prisma.combatOperation.findUnique({ where: key });
  if (existing) return replay(existing);

  let result: { combat: CombatDto; movement: MovementAudit; replayed?: boolean };
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
        const speed = effectiveSpeedOf(combatant);
        if (speed <= 0) {
          throw new HttpError(
            'Deslocamento efetivo zero: não é possível se mover.',
            409,
            'MOVEMENT_SPEED_ZERO',
          );
        }

        // REVALIDAÇÃO no commit: o preview não é autoridade.
        const evaluation = evaluateFor(combat, combatant, input.path, true);
        if (!evaluation.legal) {
          const blocker = evaluation.blocker!;
          const error = MOVEMENT_ERRORS[blocker.code];
          throw new HttpError(error.message, error.status, blocker.code);
        }
        if (!evaluation.affordable) {
          throw new HttpError(
            `Movimento insuficiente: o trajeto custa ${evaluation.totalCostFeet} pés e restam ${evaluation.movementRemainingFeet} pés.`,
            409,
            'MOVEMENT_INSUFFICIENT_REMAINING',
          );
        }

        const economy = reconcileMovement(
          economyOf(combatant.turnEconomy),
          baseSpeedOf(combatant),
          speed,
        );
        const remainingBefore = remainingMovementFeet(
          economy.movementBudget,
          economy.movementUsed,
        );
        // Consumo em METROS na MESMA economia do turno (nada de segundo saldo).
        moveDistance(economy, feetToMeters(evaluation.totalCostFeet));
        const remainingAfter = remainingMovementFeet(
          economy.movementBudget,
          economy.movementUsed,
        );

        await db.combatant.update({
          where: { id: combatant.id },
          data: {
            spatialPosition: evaluation.destination as unknown as Prisma.InputJsonValue,
            turnEconomy: economy as unknown as Prisma.InputJsonValue,
          },
        });
        await appendMovementLog(
          db,
          combat,
          combatant,
          `Moveu ${evaluation.totalDistanceFeet} pés (custo ${evaluation.totalCostFeet} pés) — restam ${remainingAfter} pés.`,
        );

        const movement = auditOf(
          evaluation,
          parseStoredPosition(combatant.spatialPosition),
          remainingBefore,
          remainingAfter,
          gateResult.policy,
          gateResult.playerSafe,
        );
        const response = {
          combat: toCombatDto(await loadCombatById(combat.id, db), actor.role),
          movement,
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
      { timeout: 15000 },
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
  // Publicação SÓ depois do commit (posição + movimento restante).
  emitCombat(
    ServerEvents.COMBAT_UPDATED,
    toCombatDto(await loadCombatById(input.combatId), 'MASTER'),
  );
  return { combat: result.combat, movement: result.movement, replayed: false };
}
