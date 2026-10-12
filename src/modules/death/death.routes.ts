import type { Role } from '@prisma/client';
import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { entitySchema } from '../shared/conditions.js';
import {
  deathMutationSchema,
  deathRelentlessSchema,
  deathResolveSchema,
  deathStabilizeSchema,
} from './death.schema.js';
import {
  answerRelentless,
  getDeathState,
  overrideDeath,
  resolveDeathPending,
  stabilizeTarget,
  type DeathActor,
} from './death.service.js';

export const deathRouter = Router();

deathRouter.use(authenticate);

/** O autor vem SEMPRE do token, nunca do corpo da requisição. */
function actor(req: { user?: { sub: string; username: string; role: Role } }): DeathActor {
  return { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
}

/** GET /api/death/:kind/:id — ciclo de morte de uma entidade (Mestre ou dono). */
deathRouter.get('/:kind/:id', async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.kind, id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ death: await getDeathState(actor(req), parsed.data) });
});

/** POST /api/death/resolve — decisão do MESTRE sobre a morte pendente. */
deathRouter.post('/resolve', async (req, res) => {
  const parsed = deathResolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await resolveDeathPending(actor(req), parsed.data));
});

/** POST /api/death/override — administração explícita do Mestre (tudo logado). */
deathRouter.post('/override', async (req, res) => {
  const parsed = deathMutationSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await overrideDeath(actor(req), parsed.data));
});

/** POST /api/death/stabilize — API genérica de estabilização (Medicine futura). */
deathRouter.post('/stabilize', async (req, res) => {
  const parsed = deathStabilizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await stabilizeTarget(actor(req), parsed.data));
});

/** POST /api/death/relentless — resposta à oferta da Resistência Implacável. */
deathRouter.post('/relentless', async (req, res) => {
  const parsed = deathRelentlessSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await answerRelentless(actor(req), parsed.data));
});
