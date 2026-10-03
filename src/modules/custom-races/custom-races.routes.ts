import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { createCustomRaceSchema, updateCustomRaceSchema } from './custom-races.schema.js';
import {
  createCustomRace,
  deleteCustomRace,
  getCustomRace,
  listCustomRaces,
  updateCustomRace,
} from './custom-races.service.js';

export const customRacesRouter = Router();

customRacesRouter.use(authenticate);

/**
 * As raças personalizadas são visíveis a todos (o jogador precisa consultá-las
 * no compêndio); a gestão (criar/editar/remover) é do mestre.
 */
customRacesRouter.get('/', async (_req, res) => {
  res.json({ customRaces: await listCustomRaces() });
});

customRacesRouter.get('/:id', async (req, res) => {
  res.json({ customRace: await getCustomRace(String(req.params.id)) });
});

customRacesRouter.post('/', requireRole('MASTER'), async (req, res) => {
  const parsed = createCustomRaceSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ customRace: await createCustomRace(parsed.data) });
});

customRacesRouter.patch('/:id', requireRole('MASTER'), async (req, res) => {
  const parsed = updateCustomRaceSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ customRace: await updateCustomRace(String(req.params.id), parsed.data) });
});

customRacesRouter.delete('/:id', requireRole('MASTER'), async (req, res) => {
  await deleteCustomRace(String(req.params.id));
  res.status(204).end();
});
