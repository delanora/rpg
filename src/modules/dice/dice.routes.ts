import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { tableRollSchema } from './dice.schema.js';
import { getDiceHistory, rollTableDice } from './dice.service.js';

export const diceRouter = Router();

diceRouter.use(authenticate);

/**
 * GET /api/dice/history — histórico das rolagens da sessão.
 * Exclusivo do mestre (o log lateral do painel).
 */
diceRouter.get('/history', requireRole('MASTER'), (_req, res) => {
  res.json({ rolls: getDiceHistory() });
});

/**
 * POST /api/dice/roll — rola o pool da janela de dados.
 *
 * Vale para rolagem livre, de perícia e de salvaguarda. As rolagens de jogador
 * são sempre públicas; só o mestre pode marcar como privada.
 */
diceRouter.post('/roll', async (req, res) => {
  const parsed = tableRollSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const roll = await rollTableDice(
    {
      userId: req.user!.sub,
      username: req.user!.username,
      displayName: req.user!.displayName,
      role: req.user!.role,
    },
    parsed.data,
  );

  res.status(201).json({ roll });
});
