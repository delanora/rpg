import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { createRegionSchema, updateRegionSchema } from './regions.schema.js';
import {
  createRegion,
  deleteRegion,
  getRegion,
  listRegions,
  updateRegion,
} from './regions.service.js';

export const regionsRouter = Router();

/** Regiões são conteúdo exclusivo do mestre (como as localidades). */
regionsRouter.use(authenticate, requireRole('MASTER'));

/** GET /api/regions — lista em ordem alfabética. */
regionsRouter.get('/', async (_req, res) => {
  res.json({ regions: await listRegions() });
});

/** GET /api/regions/:id — uma região. */
regionsRouter.get('/:id', async (req, res) => {
  res.json({ region: await getRegion(req.params.id) });
});

/** POST /api/regions — cadastra uma região. */
regionsRouter.post('/', async (req, res) => {
  const parsed = createRegionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ region: await createRegion(parsed.data) });
});

/** PATCH /api/regions/:id — edição parcial. */
regionsRouter.patch('/:id', async (req, res) => {
  const parsed = updateRegionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ region: await updateRegion(req.params.id, parsed.data) });
});

/** DELETE /api/regions/:id — remove a região e as localidades dentro dela. */
regionsRouter.delete('/:id', async (req, res) => {
  await deleteRegion(req.params.id);
  res.status(204).end();
});
