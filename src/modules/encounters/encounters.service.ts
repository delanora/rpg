import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { z } from 'zod';
import { operation, saveSchema } from './encounters.schema.js';

export async function mutateEncounter(
  id: string,
  actor: string,
  type: 'save' | 'delete',
  input: z.infer<typeof operation> & Partial<z.infer<typeof saveSchema>>,
) {
  if (!id || id.length > 128)
    throw new HttpError('Identificador do encontro inválido.', 400);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ actor, type, input }))
    .digest('hex');
  const key = {
    encounterId_operationId: {
      encounterId: id,
      operationId: input.operationId,
    },
  };
  const replay = (op: { fingerprint: string; snapshot: unknown }) => {
    if (op.fingerprint !== fingerprint)
      throw new HttpError(
        'operationId reutilizado com outro pedido.',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    return op.snapshot;
  };
  try {
    return await prisma.$transaction(async (db) => {
      const previous = await db.preparedEncounterOperation.findUnique({
        where: key,
      });
      if (previous) return replay(previous);
      const existing = await db.preparedEncounter.findUnique({ where: { id } });
      if (type === 'save' && input.preparation) {
        const prep = input.preparation;
        if (prep.sceneId) {
          const scene = await db.scene.findUnique({
            where: { id: prep.sceneId },
          });
          if (
            !scene ||
            (prep.localityId && scene.localityId !== prep.localityId)
          )
            throw new HttpError(
              'Cena não pertence à localidade escolhida.',
              409,
            );
        }
        const creatureIds = [...new Set(prep.entries.map((e) => e.creatureId))];
        if (
          (await db.creature.count({ where: { id: { in: creatureIds } } })) !==
          creatureIds.length
        )
          throw new HttpError(
            'Uma criatura do encontro foi removida. Atualize a seleção.',
            409,
          );
        const characters = prep.characterIds ?? [];
        if (
          (await db.character.count({
            where: { id: { in: characters }, user: { role: 'PLAYER' } },
          })) !== characters.length
        )
          throw new HttpError('Seleção de jogadores inválida.', 409);
      }
      if (existing) {
        const changed = await db.preparedEncounter.updateMany({
          where: { id, version: input.expectedVersion, deletedAt: null },
          data:
            type === 'delete'
              ? { deletedAt: new Date(), version: { increment: 1 } }
              : {
                  name: input.name!,
                  preparation:
                    input.preparation as unknown as Prisma.InputJsonValue,
                  version: { increment: 1 },
                },
        });
        if (!changed.count)
          throw new HttpError(
            'O encontro mudou. Reabra antes de salvar.',
            409,
            'CONFLICT',
          );
      } else {
        if (type === 'delete' || input.expectedVersion !== 0)
          throw new HttpError('Encontro não encontrado.', 404);
        await db.preparedEncounter.create({
          data: {
            id,
            name: input.name!,
            preparation: input.preparation as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const encounter = await db.preparedEncounter.findUniqueOrThrow({
        where: { id },
      });
      const snapshot = JSON.parse(
        JSON.stringify(encounter),
      ) as Prisma.InputJsonValue;
      await db.preparedEncounterOperation.create({
        data: {
          encounterId: id,
          operationId: input.operationId,
          fingerprint,
          snapshot,
        },
      });
      return snapshot;
    });
  } catch (error) {
    const previous = await prisma.preparedEncounterOperation.findUnique({
      where: key,
    });
    if (previous) return replay(previous);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError('O encontro foi criado em outra solicitação. Reabra antes de salvar.', 409, 'CONFLICT');
    throw error;
  }
}
