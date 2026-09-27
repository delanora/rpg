import { Router, type Request } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { activeRollSchema, tableRollSchema } from './dice.schema.js';
import {
  clearDiceHistory,
  getActiveRoll,
  getDiceHistory,
  rollTableDice,
  setActiveRoll,
  type DiceActor,
} from './dice.service.js';

/** Autor da requisição, sempre carimbado a partir do token (nunca do corpo). */
function actor(req: Request): DiceActor {
  return {
    userId: req.user!.sub,
    username: req.user!.username,
    displayName: req.user!.displayName,
    role: req.user!.role,
  };
}

export const diceRouter = Router();

diceRouter.use(authenticate);

/** GET /api/dice/active — quem está com a janela de dados aberta. */
diceRouter.get('/active', (_req, res) => {
  res.json({ activeRoll: getActiveRoll() });
});

/**
 * GET /api/dice/history — histórico das rolagens da sessão.
 * Exclusivo do mestre (o log lateral do painel).
 */
diceRouter.get('/history', requireRole('MASTER'), (_req, res) => {
  res.json({ rolls: getDiceHistory() });
});

/** DELETE /api/dice/history — zera o log lateral do mestre. */
diceRouter.delete('/history', requireRole('MASTER'), (_req, res) => {
  clearDiceHistory();
  res.status(204).end();
});

/**
 * POST /api/dice/active — avisa a mesa que a janela de dados abriu (ou fechou).
 *
 * Quem está rolando vê a janela; o resto da mesa vê a faixa no topo do
 * tabuleiro. Rolagem privada do mestre não é divulgada.
 */
diceRouter.post('/active', async (req, res) => {
  const parsed = activeRollSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const activeRoll = await setActiveRoll(actor(req), parsed.data);

  res.json({ activeRoll });
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

  const roll = await rollTableDice(actor(req), parsed.data);

  res.status(201).json({ roll });
});
