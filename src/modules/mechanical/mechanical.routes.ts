import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { entitySchema } from '../shared/conditions.js';
import { mechanicalMutationSchema } from './mechanical.schema.js';
import { getMechanicalState, mutateMechanicalState } from './mechanical.service.js';
export const mechanicalRouter = Router();
mechanicalRouter.use(authenticate);
mechanicalRouter.get('/:kind/:id', async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.kind, id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  const actor = { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
  res.json({ mechanical: await getMechanicalState(actor, parsed.data) });
});
mechanicalRouter.post('/mutate', async (req, res) => {
  const parsed = mechanicalMutationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  const actor = { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
  res.json(await mutateMechanicalState(actor, parsed.data));
});
