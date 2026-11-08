import { operation, saveSchema } from './encounters.schema.js';
import { mutateEncounter } from './encounters.service.js';
import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { authenticate, requireRole } from '../auth/auth.middleware.js';

export const encountersRouter = Router();
encountersRouter.use(authenticate, requireRole('MASTER'));
encountersRouter.get('/', async (_req, res) => {
  res.json({
    encounters: await prisma.preparedEncounter.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    }),
  });
});
/** Gravação versionada e idempotente, inclusive criação e exclusão lógica. */
encountersRouter.put('/:id', async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() });
    return;
  }
  res.json({
    encounter: await mutateEncounter(
      String(req.params.id),
      req.user!.sub,
      'save',
      parsed.data,
    ),
  });
});
encountersRouter.delete('/:id', async (req, res) => {
  const parsed = operation.strict().safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() });
    return;
  }
  res.json({
    encounter: await mutateEncounter(
      String(req.params.id),
      req.user!.sub,
      'delete',
      parsed.data,
    ),
  });
});
