import type { Role } from '@prisma/client';
import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { attackSchema, manualHpSchema, startCombatSchema } from './combat.schema.js';
import {
  applyManualHp,
  endCombat,
  getActiveCombat,
  nextTurn,
  resolveAttack,
  rollInitiative,
  startCombat,
  type CombatActor,
} from './combat.service.js';

export const combatRouter = Router();

/** O autor vem sempre do token, nunca do corpo da requisição. */
function actorFrom(req: { user?: { sub: string; username: string; role: Role } }): CombatActor {
  return { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
}

/** GET /api/combat/active — estado do combate em andamento (ou null). */
combatRouter.get('/active', authenticate, async (_req, res) => {
  res.json({ combat: await getActiveCombat() });
});

/** POST /api/combat — botão "COMBATE": inicia o combate com as criaturas escolhidas. */
combatRouter.post('/', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = startCombatSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ combat: await startCombat(parsed.data) });
});

/** POST /api/combat/initiative — o jogador rola a própria iniciativa. */
combatRouter.post('/initiative', authenticate, async (req, res) => {
  res.json({ combat: await rollInitiative(actorFrom(req)) });
});

/** POST /api/combat/initiative/:combatantId — o mestre rola por qualquer combatente. */
combatRouter.post('/initiative/:combatantId', authenticate, requireRole('MASTER'), async (req, res) => {
  res.json({ combat: await rollInitiative(actorFrom(req), String(req.params.combatantId)) });
});

/** POST /api/combat/next-turn — avança o turno (mestre). */
combatRouter.post('/next-turn', authenticate, requireRole('MASTER'), async (req, res) => {
  res.json({ combat: await nextTurn(actorFrom(req)) });
});

/** POST /api/combat/attack — rola um ataque contra um alvo do combate. */
combatRouter.post('/attack', authenticate, async (req, res) => {
  const parsed = attackSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.json(await resolveAttack(actorFrom(req), parsed.data));
});

/** POST /api/combat/hp — dano/cura manual do mestre. */
combatRouter.post('/hp', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = manualHpSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.json({ combat: await applyManualHp(actorFrom(req), parsed.data) });
});

/** POST /api/combat/end — encerra o modo de combate (mestre). */
combatRouter.post('/end', authenticate, requireRole('MASTER'), async (req, res) => {
  res.json(await endCombat(actorFrom(req)));
});
