import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { entitySchema } from '../shared/conditions.js';
import { createEffectSchema, endEffectSchema } from './effects.schema.js';
import { createEffect, endEffect, listEffectsForTarget } from './effects.service.js';

/**
 * FASE 6.5A — API própria dos Effects.
 *
 * Módulo separado (e não dentro de `/api/mechanical`) porque o efeito tem
 * lifecycle PRÓPRIO e será consumido por Spell Engine, Features e Itens. O
 * actor vem sempre do token; o servidor resolve nomes e valida ids/posse.
 */
export const effectsRouter = Router();
effectsRouter.use(authenticate);

/** GET /api/effects/:entityKind/:entityId — efeitos ATIVOS do alvo. */
effectsRouter.get('/:entityKind/:entityId', async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.entityKind, id: req.params.entityId });
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const actor = {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
  res.json({ effects: await listEffectsForTarget(actor, parsed.data) });
});

/** POST /api/effects — criação MANUAL de um efeito (só MASTER). */
effectsRouter.post('/', requireRole('MASTER'), async (req, res) => {
  const parsed = createEffectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const actor = {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
  const result = await createEffect(actor, parsed.data);
  res.status(result.replayed ? 200 : 201).json(result);
});

/** POST /api/effects/:id/end — encerramento manual (só MASTER). */
effectsRouter.post('/:id/end', requireRole('MASTER'), async (req, res) => {
  const parsed = endEffectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const actor = {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
  res.json(await endEffect(actor, String(req.params.id), parsed.data));
});
