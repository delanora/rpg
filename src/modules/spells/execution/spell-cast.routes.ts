import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../config/prisma.js';
import { authenticate, requireRole } from '../../auth/auth.middleware.js';
import { entitySchema } from '../../shared/conditions.js';
import { spellCastProofSchema, spellIntentApprovalSchema } from './spell-cast.schema.js';
import { castProofSpell } from './spell-cast.service.js';
import {
  approveSpellCastIntent,
  cancelSpellCastIntent,
  castSpell,
  denySpellCastIntent,
  listPendingSpellCastIntents,
  type CastOutcome,
} from './spell-intent.service.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import { isExplicitTargeting, spellTargetingSummary } from './spell-targeting.js';
import { listSpellcastingSources } from './spellcasting-profile.service.js';
import { castingResourcesForEntity } from './casting-resource.service.js';
import { castingEconomySummary, castingTurnContext } from './spell-casting-economy.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import {
  repertoireForCharacter,
  savePreparationPlan,
} from './spell-preparation.service.js';
import { castOptionsFor } from './spell-cast-options.service.js';
import { spellcastingSourceRefSchema } from './spellcasting-source.js';
import { spatialConfirmationSchema } from './spatial-validation.js';
import type { EffectActor } from '../../effects/effects.service.js';

/**
 * API de conjuração (Fases 6.6A–6.6F).
 *
 * `POST /cast` é a rota DEFINITIVA e genérica: usa o MESMO serviço para MASTER e
 * PLAYER, com a diferença reduzida a controle do conjurador e à possibilidade de
 * confirmar fatos espaciais. Não existe "PlayerSpellCastService".
 *
 * `POST /cast-proof` continua como wrapper de PROVA (MASTER-only) do mesmo core.
 */
export const spellsRouter = Router();
spellsRouter.use(authenticate);

function actorOf(req: { user?: { sub: string; username: string; role: EffectActor['role'] } }): EffectActor {
  return {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
}

function respondCast(res: Response, outcome: CastOutcome): void {
  if (outcome.kind === 'cast') {
    res.status(outcome.result.replayed ? 200 : 201).json({
      cast: outcome.result.cast,
      effectGroupId: outcome.result.effectGroupId,
      pendingId: outcome.result.pending?.id ?? null,
      pendingIds: outcome.result.pendings.map((pending) => pending.id),
      replayed: outcome.result.replayed,
    });
    return;
  }
  // Intenção: 202 enquanto aguarda o Mestre (NADA foi gasto) e 200 no replay de
  // um estado terminal (denied/cancelled/invalidated/committed).
  res.status(outcome.intent.status === 'pending' ? 202 : 200).json({ intent: outcome.intent });
}

/**
 * GET /api/spells/sources/:entityKind/:entityId — fontes de conjuração do
 * conjurador com os números DERIVADOS (CD/ataque mágico) em modo LEITURA.
 *
 * MASTER-only: alimenta o seletor de fonte do fluxo de prova (multiclasse) e
 * pode revelar a matemática de um statblock, que o jogador não recebe.
 */
spellsRouter.get('/sources/:entityKind/:entityId', requireRole('MASTER'), async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.entityKind, id: req.params.entityId });
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ sources: await listSpellcastingSources(parsed.data) });
});

/**
 * GET /api/spells/resources/:entityKind/:entityId — espaços do caster em LEITURA.
 *
 * MASTER-only: alimenta o seletor do fluxo de prova e permite ver o gasto de um
 * NPC, informação que o jogador não recebe. `remaining`/`max` são DERIVADOS na
 * hora — nunca vêm do cliente.
 */
spellsRouter.get('/resources/:entityKind/:entityId', requireRole('MASTER'), async (req, res) => {
  const parsed = entitySchema.safeParse({ kind: req.params.entityKind, id: req.params.entityId });
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const loaded = await loadEntity(parsed.data);
  const economy = castingEconomySummary(await castingTurnContext(prisma, loaded));
  res.json({ resources: await castingResourcesForEntity(parsed.data), economy });
});

/**
 * GET /api/spells/targeting/:spellId?castAtLevel=N — TARGETING derivado (6.6E).
 *
 * MASTER-only: máximo de alvos do ESPAÇO escolhido, alcance em pés e requisitos
 * espaciais. Nada disso é escolhido no cliente.
 */
spellsRouter.get('/targeting/:spellId', requireRole('MASTER'), async (req, res) => {
  const execution = spellExecutionDefinition(String(req.params.spellId));
  if (!execution) {
    res.status(404).json({ error: 'SPELL_EXECUTION_NOT_IMPLEMENTED' });
    return;
  }
  const raw = req.query.castAtLevel;
  const baseLevel = isExplicitTargeting(execution.targeting)
    ? execution.targeting.targetCount.baseSlotLevel
    : 0;
  const castAtLevel = raw === undefined ? baseLevel : Number(raw);
  if (!Number.isInteger(castAtLevel) || castAtLevel < 0 || castAtLevel > 20) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  res.json({ targeting: spellTargetingSummary(execution.targeting, castAtLevel) });
});

/* -------------------------------------------------------------------------- */
/* 6.6F — REPERTÓRIO e PLANO DE PREPARAÇÃO                                     */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/spells/repertoire/:characterId — repertório POR FONTE (ACTIVE x
 * PLANEJADO, limite manual, candidatas). Dono ou Mestre.
 */
spellsRouter.get('/repertoire/:characterId', async (req, res) => {
  res.json(await repertoireForCharacter(actorOf(req), String(req.params.characterId)));
});

const preparationPlanSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    /** SÓ ids: limite/lista/nível/grimório são derivados no servidor. */
    spellIds: z.array(z.string().trim().min(1).max(64)).max(120),
  })
  .strict();

/**
 * PUT /api/spells/preparation-plan/:characterId/:sourceKind/:sourceId — salva o
 * PLANO de UMA fonte. NÃO altera a preparação ACTIVE (isso é do Descanso Longo).
 */
spellsRouter.put(
  '/preparation-plan/:characterId/:sourceKind/:sourceId',
  async (req, res) => {
    const source = spellcastingSourceRefSchema.safeParse({
      kind: req.params.sourceKind,
      id: req.params.sourceId,
    });
    const parsed = preparationPlanSchema.safeParse(req.body ?? {});
    if (!source.success || !parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        issues: {
          ...(source.success ? {} : source.error.flatten().fieldErrors),
          ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
        },
      });
      return;
    }
    res.json(
      await savePreparationPlan(actorOf(req), String(req.params.characterId), source.data, parsed.data),
    );
  },
);

/* -------------------------------------------------------------------------- */
/* 6.6F — CONJURAÇÃO REAL (PLAYER e MASTER) e INTENÇÕES                        */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/spells/cast-options/:characterId/:spellId — opções de conjuração.
 *
 * Read-only e PLAYER-safe (só o dono, ou o Mestre): fontes que AUTORIZAM a
 * magia, espaços válidos, máximo de alvos por espaço e alvos possíveis. Não cria
 * Intent/SpellCast e não gasta nada — o `POST /cast` revalida tudo.
 */
spellsRouter.get('/cast-options/:characterId/:spellId', async (req, res) => {
  res.json(
    await castOptionsFor(
      actorOf(req),
      String(req.params.characterId),
      String(req.params.spellId),
    ),
  );
});

/**
 * POST /api/spells/cast — conjuração REAL.
 *
 * PLAYER: só o próprio personagem (ficha ou combatente dele); sem poder de
 * confirmação espacial — o que for `unknown` vira INTENÇÃO pendente e a
 * aprovação do Mestre revalida tudo antes do COMMIT.
 * MASTER: mesmo pipeline; pode confirmar o que o servidor não mede.
 */
spellsRouter.post('/cast', async (req, res) => {
  const parsed = spellCastProofSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  respondCast(res, await castSpell(actorOf(req), parsed.data));
});

/** GET /api/spells/intents — fila de confirmação (Mestre vê tudo; jogador o seu). */
spellsRouter.get('/intents', async (req, res) => {
  res.json({ intents: await listPendingSpellCastIntents(actorOf(req)) });
});

const intentApprovalSchema = spellIntentApprovalSchema;

/**
 * POST /api/spells/intents/:id/approve — o Mestre confirma os requisitos
 * espaciais. A aprovação REVALIDA turno, Ação, espaço, fonte, repertório,
 * alvos e visão autoritativa: `fail` conhecido nunca é sobrescrito.
 */
spellsRouter.post('/intents/:id/approve', requireRole('MASTER'), async (req, res) => {
  const parsed = intentApprovalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  respondCast(
    res,
    await approveSpellCastIntent(
      actorOf(req),
      String(req.params.id),
      parsed.data.spatialConfirmation,
      parsed.data.unknownTargetDecisions ?? [],
    ),
  );
});

const intentDenySchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

/** POST /api/spells/intents/:id/deny — terminal, ZERO custo, nenhum cast. */
spellsRouter.post('/intents/:id/deny', requireRole('MASTER'), async (req, res) => {
  const parsed = intentDenySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({
    intent: await denySpellCastIntent(actorOf(req), String(req.params.id), parsed.data.reason ?? null),
  });
});

/** POST /api/spells/intents/:id/cancel — o próprio jogador desiste (zero custo). */
spellsRouter.post('/intents/:id/cancel', async (req, res) => {
  res.json({ intent: await cancelSpellCastIntent(actorOf(req), String(req.params.id)) });
});

/** POST /api/spells/cast-proof — valida, commita e resolve uma conjuração (prova). */
spellsRouter.post('/cast-proof', requireRole('MASTER'), async (req, res) => {
  const parsed = spellCastProofSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const result = await castProofSpell(actorOf(req), parsed.data);
  res.status(result.replayed ? 200 : 201).json({
    cast: result.cast,
    effectGroupId: result.effectGroupId,
    pendingId: result.pending?.id ?? null,
    pendingIds: result.pendings.map((pending) => pending.id),
    replayed: result.replayed,
  });
});
