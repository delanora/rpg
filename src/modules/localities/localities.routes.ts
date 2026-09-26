import { Router } from 'express';
import { saveDataUrlImage } from '../../lib/uploads.js';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createLocalitySchema,
  updateLocalitySchema,
  uploadImageSchema,
} from './localities.schema.js';
import {
  createLocality,
  deleteLocality,
  getLocality,
  listLocalities,
  updateLocality,
} from './localities.service.js';

export const localitiesRouter = Router();

/** Localidades são conteúdo exclusivo do mestre. */
localitiesRouter.use(authenticate, requireRole('MASTER'));

/** GET /api/localities — lista em ordem alfabética. */
localitiesRouter.get('/', async (_req, res) => {
  res.json({ localities: await listLocalities() });
});

/** GET /api/localities/:id — uma localidade. */
localitiesRouter.get('/:id', async (req, res) => {
  res.json({ locality: await getLocality(req.params.id) });
});

/** POST /api/localities — cadastra uma localidade. */
localitiesRouter.post('/', async (req, res) => {
  const parsed = createLocalitySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ locality: await createLocality(parsed.data) });
});

/** PATCH /api/localities/:id — edição parcial. */
localitiesRouter.patch('/:id', async (req, res) => {
  const parsed = updateLocalitySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ locality: await updateLocality(req.params.id, parsed.data) });
});

/** DELETE /api/localities/:id — remove uma localidade e suas imagens. */
localitiesRouter.delete('/:id', async (req, res) => {
  await deleteLocality(req.params.id);
  res.status(204).end();
});

// --- Uploads -----------------------------------------------------------------

export const uploadsRouter = Router();

/** Uploads também são exclusivos do mestre. */
uploadsRouter.use(authenticate, requireRole('MASTER'));

/** POST /api/uploads/image — recebe uma data URL e devolve a URL pública. */
uploadsRouter.post('/image', async (req, res) => {
  const parsed = uploadImageSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const image = await saveDataUrlImage(parsed.data.dataUrl, parsed.data.name ?? '');
  res.status(201).json({ image });
});
