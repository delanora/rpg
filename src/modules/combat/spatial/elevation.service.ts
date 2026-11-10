import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { type CombatActor, loadCombatById } from '../combat.service.js';
import { orderCombatants, toCombatDto } from '../combat.dto.js';
import { runSpatialOperation } from './spatial-scene.service.js';
import {
  commitVoluntaryMovement,
  evaluateMovementForState,
} from './spatial-movement.service.js';
import { movementPathSchema } from '../combat.schema.js';
import { elevationDecisionRequired, surfaceElevation } from './elevation.js';
import { effectiveSceneConfigOf } from './spatial.types.js';
import { parseStoredPosition } from './occupied-space.js';

const operation = {
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
};
export const verticalPatchSchema = z
  .object({
    ...operation,
    elevationFeet: z.number().finite().min(-10_000).max(10_000).nullable(),
    bodyHeightFeet: z.number().finite().positive().max(2000).nullable(),
  })
  .strict();
export const elevationRequestSchema = z
  .object({
    ...operation,
    combatantId: z.string().min(1),
    path: movementPathSchema.min(1),
  })
  .strict();
export const elevationDecisionSchema = z
  .object({
    ...operation,
    approve: z.boolean(),
    additionalCostFeet: z
      .number()
      .finite()
      .nonnegative()
      .max(10_000)
      .default(0),
  })
  .strict();

export async function setVertical(
  actor: CombatActor,
  combatId: string,
  combatantId: string,
  input: z.infer<typeof verticalPatchSchema>,
) {
  if (actor.role !== 'MASTER')
    throw new HttpError('Apenas o Mestre altera alturas.', 403);
  return runSpatialOperation(
    actor,
    { ...input, combatId, combatantId },
    'spatial-vertical',
    async (db, combat) => {
      if (!combat.combatants.some((c) => c.id === combatantId))
        throw new HttpError('Combatente não encontrado.', 404);
      if (
        await db.movementIntent.findFirst({
          where: { combatId, combatantId, status: 'pending-reaction' },
          select: { id: true },
        })
      )
        throw new HttpError(
          'Resolva a reação pendente antes de alterar a altura.',
          409,
          'MOVEMENT_PENDING_REACTION',
        );
      await db.combatant.update({
        where: { id: combatantId },
        data: {
          elevationFeet: input.elevationFeet,
          bodyHeightFeet: input.bodyHeightFeet,
        },
      });
      return {
        combat: toCombatDto(await loadCombatById(combatId, db), actor.role),
      };
    },
  );
}

export async function requestElevation(
  actor: CombatActor,
  combatId: string,
  input: z.infer<typeof elevationRequestSchema>,
) {
  return runSpatialOperation(
    actor,
    { ...input, combatId },
    'elevation-request',
    async (db, combat) => {
      const mover = combat.combatants.find((c) => c.id === input.combatantId);
      if (!mover) throw new HttpError('Combatente não encontrado.', 404);
      if (actor.role !== 'MASTER' && mover.ownerUserId !== actor.userId)
        throw new HttpError(
          'Você só pode solicitar seu próprio movimento.',
          403,
        );
      if (
        combat.status !== 'ACTIVE' ||
        orderCombatants(combat.combatants)[combat.currentIndex]?.id !== mover.id
      )
        throw new HttpError(
          'O movimento exige o turno do combatente.',
          409,
          'CONFLICT',
        );
      const evaluation = evaluateMovementForState(
        combat,
        mover,
        input.path,
        true,
      );
      if (!evaluation.legal || !evaluation.affordable)
        throw new HttpError(
          'O trajeto não é válido ou não há movimento suficiente.',
          409,
          'CONFLICT',
        );
      const scene = effectiveSceneConfigOf(combat);
      const origin = parseStoredPosition(mover.spatialPosition);
      const level =
        mover.elevationFeet ??
        (origin
          ? surfaceElevation(scene, origin, mover.baseSize ?? 'medium')
          : null);
      if (
        !elevationDecisionRequired(
          scene,
          origin,
          mover.baseSize ?? 'medium',
          input.path,
          level,
        )
      )
        throw new HttpError(
          'Este trajeto não precisa de decisão de desnível.',
          409,
          'CONFLICT',
        );
      // Uma intenção por token/turno: nova solicitação substitui a anterior, sem reaplicar movimento.
      await db.elevationRequest.updateMany({
        where: { combatId, combatantId: mover.id, status: 'pending' },
        data: { status: 'superseded' },
      });
      await db.elevationRequest.create({
        data: {
          combatId,
          combatantId: mover.id,
          requesterId: actor.userId,
          turnSequence: combat.turnSequence ?? 0,
          origin: {
            position: origin,
            elevationFeet: level,
          } as unknown as Prisma.InputJsonValue,
          path: input.path as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        combat: toCombatDto(await loadCombatById(combatId, db), actor.role),
      };
    },
  );
}

export async function elevationRequestsFor(
  actor: CombatActor,
  combatId: string,
) {
  const combat = await loadCombatById(combatId);
  if (actor.role !== 'MASTER')
    throw new HttpError('Apenas o Mestre consulta as travessias.', 403);
  if (combat.status !== 'ACTIVE') return [];
  const requests = await prisma.elevationRequest.findMany({
    where: {
      combatId,
      status: 'pending',
      turnSequence: combat.turnSequence ?? 0,
    },
    orderBy: { createdAt: 'asc' },
  });
  return requests.flatMap((request) => {
    const mover = combat.combatants.find((c) => c.id === request.combatantId);
    if (!mover) return [];
    return [
      {
        id: request.id,
        combatantId: mover.id,
        name: mover.name,
        path: movementPathSchema.parse(request.path),
        origin: request.origin,
      },
    ];
  });
}

export async function decideElevation(
  actor: CombatActor,
  combatId: string,
  requestId: string,
  input: z.infer<typeof elevationDecisionSchema>,
) {
  if (actor.role !== 'MASTER')
    throw new HttpError('Apenas o Mestre decide a travessia.', 403);
  const request = await prisma.elevationRequest.findUnique({
    where: { id: requestId },
  });
  if (!request || request.combatId !== combatId)
    throw new HttpError('Solicitação não encontrada.', 404);
  if (input.approve)
    return commitVoluntaryMovement(actor, {
      combatId,
      combatantId: request.combatantId,
      path: movementPathSchema.parse(request.path),
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      elevationApproval: {
        requestId,
        additionalCostFeet: input.additionalCostFeet,
      },
    });
  return runSpatialOperation(
    actor,
    { ...input, combatId, elevationRequestId: requestId },
    'elevation-deny',
    async (db, combat) => {
      await db.elevationRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'denied' },
      });
      return {
        combat: toCombatDto(await loadCombatById(combatId, db), actor.role),
      };
    },
  );
}
