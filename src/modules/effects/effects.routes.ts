import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { entitySchema } from '../shared/conditions.js';
import {
  applyBlessSchema,
  applyHoldPersonSchema,
  createEffectSchema,
  endEffectSchema,
  manualEffectTriggerSchema,
} from './effects.schema.js';
import { createEffect, endEffect, listEffectsForTarget, type EffectActor } from './effects.service.js';
import { applyBless } from './bless.service.js';
import {
  applyHoldPerson,
  cancelPendingEffectSave,
  listPendingEffectSaves,
} from './hold-person.service.js';
import { declinePendingEffectSave, fireEffectTurnTrigger } from './turn-trigger.service.js';
import { expireEffectByDuration } from '../spells/execution/effect-duration.service.js';

/** Autor do pedido, sempre do token (nunca do corpo). */
function actorOf(req: { user?: { sub: string; username: string; role: 'MASTER' | 'PLAYER' } }): EffectActor {
  return { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
}

/**
 * FASE 6.5A — API própria dos Effects.
 *
 * Módulo separado (e não dentro de `/api/mechanical`) porque o efeito tem
 * lifecycle PRÓPRIO e será consumido por Spell Engine, Features e Itens. O
 * actor vem sempre do token; o servidor resolve nomes e valida ids/posse.
 */
export const effectsRouter = Router();
effectsRouter.use(authenticate);

/**
 * GET /api/effects/pending/:entityKind/:entityId — aplicações aguardando
 * salvaguarda (6.5H). O servidor aplica a privacidade; nenhuma consequência
 * mecânica existe ainda.
 */
effectsRouter.get('/pending/:entityKind/:entityId', async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.entityKind, id: req.params.entityId });
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ pending: await listPendingEffectSaves(actorOf(req), parsed.data) });
});

/** POST /api/effects/pending/:id/cancel — cancela a aplicação antes do save. */
effectsRouter.post('/pending/:id/cancel', requireRole('MASTER'), async (req, res) => {
  res.json({ pending: await cancelPendingEffectSave(actorOf(req), String(req.params.id)) });
});

/**
 * POST /api/effects/hold-person — APLICAÇÃO CONTROLADA (só MASTER, 6.5H).
 *
 * Ferramenta de prova da engine: NÃO é conjuração de jogador. Cria apenas a
 * pendência de salvaguarda de Sabedoria; o Effect/Paralyzed/Concentração só
 * nascem na FALHA do save, resolvida pelo pipeline real de dados.
 */
effectsRouter.post('/hold-person', requireRole('MASTER'), async (req, res) => {
  const parsed = applyHoldPersonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await applyHoldPerson(actorOf(req), parsed.data);
  res.status(result.replayed ? 200 : 201).json(result);
});

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

/**
 * POST /api/effects/bless — APLICAÇÃO CONTROLADA de Bless (só MASTER).
 *
 * Ferramenta de prova da engine (6.5G): NÃO é conjuração de jogador, não gasta
 * Ação/slot e não valida alcance/componentes. Cria o grupo, uma instância por
 * alvo e a concentração do caster no mesmo motor existente.
 */
effectsRouter.post('/bless', requireRole('MASTER'), async (req, res) => {
  const parsed = applyBlessSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const actor = {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
  const result = await applyBless(actor, parsed.data);
  res.status(result.replayed ? 200 : 201).json(result);
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

/**
 * POST /api/effects/pending-saves/:id/decline — RECUSA de salvaguarda OPCIONAL
 * (Fase 6.6H). Só `phase = 'ongoing'` + `optional`: o efeito continua ativo e o
 * próximo turno oferece nova oportunidade. Recusar não é falhar.
 */
effectsRouter.post('/pending-saves/:id/decline', async (req, res) => {
  res.json({ pending: await declinePendingEffectSave(actorOf(req), String(req.params.id)) });
});

/**
 * POST /api/effects/:id/expire — expiração de DURAÇÃO pelo Mestre (6.6H).
 *
 * Fora de combate é o único caminho (não existe world clock nem timer real); em
 * combate o processador automático usa o MESMO lifecycle. Não cria um segundo
 * Effect engine.
 */
effectsRouter.post('/:id/expire', requireRole('MASTER'), async (req, res) => {
  res.json(await expireEffectByDuration(actorOf(req), String(req.params.id)));
});

/**
 * POST /api/effects/:id/triggers/:triggerKey/fire — disparo MANUAL do trigger
 * de turno (6.6H), para quando não há turno de combate aplicável.
 */
effectsRouter.post('/:id/triggers/:triggerKey/fire', requireRole('MASTER'), async (req, res) => {
  const parsed = manualEffectTriggerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({
    pending: await fireEffectTurnTrigger(
      actorOf(req),
      String(req.params.id),
      String(req.params.triggerKey),
      parsed.data.operationId,
    ),
  });
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
