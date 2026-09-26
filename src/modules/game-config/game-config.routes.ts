import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { getGameConfig, setLevelUpUnlocked } from './game-config.service.js';

export const gameConfigRouter = Router();

gameConfigRouter.use(authenticate);

const levelUpUnlockSchema = z.object({ unlocked: z.boolean() });

/** GET /api/game — configuração atual da mesa (usada ao abrir a ficha). */
gameConfigRouter.get('/', (_req, res) => {
  void getGameConfig()
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/** POST /api/game/level-up — o mestre libera/bloqueia o Level Up da mesa. */
gameConfigRouter.post('/level-up', requireRole('MASTER'), (req, res) => {
  const parsed = levelUpUnlockSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  void setLevelUpUnlocked(parsed.data.unlocked)
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});
