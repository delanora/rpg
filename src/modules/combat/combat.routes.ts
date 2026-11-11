import { areaVisualSchema, shareAreaVisual } from './spatial/area-visual.service.js';
import { previewCreatureArea } from './creature-area.service.js';
import { gridAreaQuerySchema } from './spatial/area-membership.js';
import { queryCombatArea } from './spatial/area-query.service.js';
import { verticalPatchSchema, elevationRequestSchema, elevationDecisionSchema, setVertical, requestElevation, elevationRequestsFor, decideElevation } from './spatial/elevation.service.js';
import { HttpError } from '../../lib/http-error.js';
import { opportunitySpellSchema } from './combat.schema.js';
import { castOpportunitySpell } from './spatial/war-caster.service.js';
import { duelRequestSchema, duelDecisionSchema } from './combat.schema.js';
import { requestCombatDuel, decideCombatDuel, combatDuelsFor } from './combat.service.js';
import { hostilityDecisionSchema } from './combat.schema.js';
import { decideAttackHostility } from './combat.service.js';
import { creatureAbilityUseSchema, creatureAreaPreviewSchema } from './combat.schema.js';
import { useCreatureAbility } from './combat.service.js';
import { addParticipantsSchema, removeParticipantSchema } from './combat.schema.js';
import { addCombatParticipants, removeCombatParticipant } from './combat.service.js';
import { rateLimit } from 'express-rate-limit';
import { combatPingSchema } from './combat.schema.js';
import { sendCombatPing } from './spatial/spatial-ping.service.js';
import type { Role } from '@prisma/client';
import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  attackSchema, manualHpSchema, startCombatSchema, useItemSchema,
  combatOperationSchema, economyActionSchema, economyOverrideSchema, nextTurnSchema,
  spatialConfigPatchSchema, spatialPositionPatchSchema, spatialMeasureSchema,
  movementCommitSchema, movementPreviewSchema, combatantSidePatchSchema,
  opportunityAttackPayloadSchema, opportunityDecisionSchema, opportunityVisibilitySchema,
  combatantSpatialVisibilitySchema,
} from './combat.schema.js';
import {
  setCombatantSideKey,
  setCombatantSpatialPosition,
  setCombatantSpatialVisibility,
  updateSpatialScene,
} from './spatial/spatial-scene.service.js';
import {
  commitVoluntaryMovement,
  previewVoluntaryMovement,
} from './spatial/spatial-movement.service.js';
import {
  readCombatDistance,
  readCombatMeasure,
  readCombatRangePreview,
} from './spatial/spatial-distance.service.js';
import {
  confirmOpportunityVisibility,
  declineOpportunity,
  reactionOpportunitiesForCombat,
  resolveOpportunityAttack,
} from './spatial/opportunity-attack.service.js';
import { resolutionRequestsForCombat } from './resolution-requests.js';
import {
  executeEconomyAction,
  overrideEconomy,
  applyManualHp,
  endCombat,
  getActiveCombat,
  listCombatItems,
  nextTurn,
  resolveAttack,
  rollInitiative,
  startCombat,
  useCombatItem,
  type CombatActor,
} from './combat.service.js';

export const combatRouter = Router();

const pingLimiter = rateLimit({ windowMs: 5000, limit: 12,
  keyGenerator: (req) => req.user!.sub,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Aguarde um instante antes de marcar outro ponto.' } });

combatRouter.post('/:combatId/spatial/ping', authenticate, pingLimiter, async (req, res) => {
  const parsed = combatPingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() }); return; }
  res.json(await sendCombatPing(String(req.params.combatId), parsed.data.position, req.user!));
});

const areaVisualLimiter = rateLimit({ windowMs: 5000, limit: 40,
  keyGenerator: req => req.user!.sub,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Aguarde um instante para atualizar a área.' } });
combatRouter.post('/:combatId/spatial/area-visual', authenticate, requireRole('MASTER'), areaVisualLimiter, async (req, res) => {
  const parsed=areaVisualSchema.safeParse(req.body);
  if(!parsed.success) { res.status(400).json({error:'VALIDATION_ERROR',issues:parsed.error.flatten()}); return; }
  res.json(await shareAreaVisual(String(req.params.combatId),parsed.data,req.user!));
});

/** O autor vem sempre do token, nunca do corpo da requisição. */
function actorFrom(req: { user?: { sub: string; username: string; role: Role } }): CombatActor {
  return { userId: req.user!.sub, username: req.user!.username, role: req.user!.role };
}

/**
 * GET /api/combat/:combatId/resolution-requests — cards ATIVOS do registro
 * lateral (6.6I).
 *
 * Read-model: as salvaguardas de magia vêm de `PendingEffectSave` e o Teste
 * contra a Morte é DERIVADO do estado + turno (nunca persistido como card). O
 * servidor filtra por papel/posse antes de responder.
 */
combatRouter.get('/:combatId/resolution-requests', authenticate, async (req, res) => {
  res.json(await resolutionRequestsForCombat(actorFrom(req), String(req.params.combatId)));
});

/**
 * PATCH /api/combat/:combatId/spatial-config — MASTER configura a cena.
 *
 * `assisted` → `grid-2d` é ação EXPLÍCITA do Mestre; voltar para `assisted`
 * NÃO apaga posições (elas só deixam de ser fonte espacial autoritativa para
 * os providers futuros). PLAYER é recusado no serviço.
 */
combatRouter.patch('/:combatId/spatial-config', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = spatialConfigPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const { expectedVersion, operationId, ...config } = parsed.data;
  res.json(
    await updateSpatialScene(actorFrom(req), {
      combatId: String(req.params.combatId),
      expectedVersion,
      operationId,
      ...config,
    }),
  );
});

/**
 * PAREDES (6.6L.4.1.1): o CRUD estrutural saiu do combate.
 *
 * Dono agora é a CENA da localidade — `/api/scenes/:sceneId/spatial/obstacles`.
 * As rotas antigas foram removidas (não tinham consumidor visual) para não
 * perpetuar ownership incorreto; o combate só PROJETA `spatial`/`obstacles`.
 */

/**
 * PATCH /api/combat/:combatId/combatants/:combatantId/spatial-position —
 * MASTER posiciona (ou remove a posição de) um combatente. É SETUP: não gasta
 * Movimento/Ação, não dispara Reação e não altera a iniciativa.
 */
combatRouter.patch(
  '/:combatId/combatants/:combatantId/spatial-position',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const parsed = spatialPositionPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await setCombatantSpatialPosition(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.combatantId),
        parsed.data,
      ),
    );
  },
);

/**
 * GET /api/combat/:combatId/spatial/distance?fromCombatantId=&toCombatantId=
 *
 * LEITURA server-authoritative da distância PHB-grid entre dois combatentes
 * (a 6.6M.2 consome isto em vez de recalcular no React). Não é autoridade de
 * targeting: ataque/magia recalculam na execução. Criatura/NPC tem posição
 * privada do Mestre — o jogador recebe `unknown/not-visible`, nunca um oráculo.
 */
combatRouter.get('/:combatId/spatial/distance', authenticate, async (req, res) => {
  res.json(
    await readCombatDistance(
      actorFrom(req),
      String(req.params.combatId),
      String(req.query.fromCombatantId ?? ''),
      String(req.query.toCombatantId ?? ''),
    ),
  );
});

/**
 * POST /api/combat/:combatId/spatial/measure — RÉGUA (6.6M.3.1).
 *
 * Leitura PURA de ponto↔ponto / ponto↔combatente. O corpo traz só os dois
 * extremos; o servidor aplica o MESMO algoritmo `max(|dx|,|dy|)` da 6.6L.2 e a
 * MESMA política de privacidade (combatente oculto → leitura oculta). Não é
 * POST de intenção mecânica: não gasta Ação, não grava, não versiona.
 */
combatRouter.post('/:combatId/spatial/measure', authenticate, async (req, res) => {
  const parsed = spatialMeasureSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(
    await readCombatMeasure(
      actorFrom(req),
      String(req.params.combatId),
      parsed.data.from,
      parsed.data.to,
    ),
  );
});

/**
 * GET /api/combat/:combatId/spatial/range-preview
 *   ?fromCombatantId=&toCombatantId=&attackId=
 *
 * LEITURA de alcance para o feedback visual (6.6M.2). O cliente manda apenas o
 * id estável da ação; o SERVIDOR resolve reach/normal/longo da arma/ataque e
 * classifica `in-range | long-range | out-of-range | unknown`. Nada é gasto
 * (leitura pura) e a política de privacidade é a MESMA da distância.
 */
combatRouter.get('/:combatId/spatial/range-preview', authenticate, async (req, res) => {
  res.json(
    await readCombatRangePreview(
      actorFrom(req),
      String(req.params.combatId),
      String(req.query.fromCombatantId ?? ''),
      String(req.query.toCombatantId ?? ''),
      String(req.query.attackId ?? ''),
    ),
  );
});

/**
 * POST /api/combat/:combatId/spatial/movement-preview — PREVIEW read-only do
 * movimento voluntário.
 *
 * O corpo traz APENAS `combatantId` + `path` (posições passo a passo). O
 * servidor deriva legalidade, custo, difficult terrain, crawling, passagem e
 * movimento restante. Não grava, não gasta e não gera operação/versão. Mestre vê
 * o diagnóstico completo; o jogador recebe o bloqueador SEM identidade.
 */
combatRouter.post('/:combatId/spatial/movement-preview', authenticate, async (req, res) => {
  const parsed = movementPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(
    await previewVoluntaryMovement(
      actorFrom(req),
      String(req.params.combatId),
      parsed.data.combatantId,
      parsed.data.path,
    ),
  );
});

/**
 * POST /api/combat/:combatId/spatial/movement — COMMIT server-authoritative.
 *
 * Revalida o caminho inteiro (o preview não é autoridade), consome
 * `movementRemaining`, grava a posição e publica `combat:updated` na MESMA
 * transação lógica. A rota NÃO é restrita por papel de propósito: quem barra o
 * jogador é o Reaction Gate no serviço (Opportunity Attacks ainda não existem)
 * — liberar movimento antes dele permitiria sair do alcance de inimigos.
 */
combatRouter.patch('/:combatId/combatants/:combatantId/spatial-height', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = verticalPatchSchema.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors}); return;}
  const input = parsed.data;
  res.json(await setVertical(actorFrom(req), String(req.params.combatId), String(req.params.combatantId), input));
});
combatRouter.post('/:combatId/spatial/elevation-requests', authenticate, async (req, res) => {
  const parsed = elevationRequestSchema.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors}); return;}
  res.json(await requestElevation(actorFrom(req), String(req.params.combatId), parsed.data));
});
combatRouter.get('/:combatId/spatial/elevation-requests', authenticate, requireRole('MASTER'), async (req, res) => {
  res.json({requests: await elevationRequestsFor(actorFrom(req), String(req.params.combatId))});
});
combatRouter.post('/:combatId/spatial/elevation-requests/:requestId', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = elevationDecisionSchema.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors}); return;}
  res.json(await decideElevation(actorFrom(req), String(req.params.combatId), String(req.params.requestId), parsed.data));
});

combatRouter.post('/:combatId/spatial/movement', authenticate, async (req, res) => {
  const parsed = movementCommitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(
    await commitVoluntaryMovement(actorFrom(req), {
      combatId: String(req.params.combatId),
      ...parsed.data,
    }),
  );
});

/**
 * PATCH /api/combat/:combatId/combatants/:combatantId/side — MASTER define o
 * LADO do combatente (hostilidade explícita do encontro).
 *
 * Só o Mestre escreve lado: o jogador nunca envia `hostile`/`team`. O valor vive
 * na instância do combate (nem ficha nem template) e `null` significa relação
 * desconhecida — o motor de movimento recusa atravessar sem essa decisão.
 */
combatRouter.patch(
  '/:combatId/combatants/:combatantId/side',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const parsed = combatantSidePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await setCombatantSideKey(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.combatantId),
        parsed.data,
      ),
    );
  },
);

/**
 * PATCH /api/combat/:combatId/combatants/:combatantId/spatial-visibility —
 * MASTER oculta/revela a PRESENÇA ESPACIAL de UM combatente (6.6L.3.2).
 *
 * Não altera mecânica: um ocupante `master-only` continua bloqueando passagem,
 * gerando difficult terrain e provocando Opportunity Attack. Também não altera
 * autoridade/ownership — NPC público continua controlado pelo Mestre. O
 * jogador é recusado no serviço (403) e não existe listagem de entidades
 * ocultas para ele.
 */
combatRouter.patch(
  '/:combatId/combatants/:combatantId/spatial-visibility',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const parsed = combatantSpatialVisibilitySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await setCombatantSpatialVisibility(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.combatantId),
        parsed.data,
      ),
    );
  },
);

/**
 * GET /api/combat/:combatId/reaction-opportunities — READ MODEL da janela de
 * Reação (6.6L.3.1).
 *
 * O estado vive no BANCO: refresh, reconnect e restart reconstroem a janela por
 * aqui. O SERVIDOR filtra por espectador — o jogador recebe só as oportunidades
 * do próprio personagem (nunca as de NPC/criatura) e, quando o próprio movimento
 * está pausado por um reactor oculto, só o aviso sanitizado de que aguarda o
 * Mestre.
 */
combatRouter.get('/:combatId/reaction-opportunities', authenticate, async (req, res) => {
  res.json(
    await reactionOpportunitiesForCombat(actorFrom(req), String(req.params.combatId)),
  );
});

/**
 * POST /api/combat/:combatId/reaction-opportunities/:opportunityId/attack —
 * resolve a janela com UM ataque corpo a corpo.
 *
 * Só o dono do reactor (ou o Mestre) resolve; a Reação é gasta na MESMA
 * transação do ataque, o ataque resolve ANTES de o mover sair do alcance e o
 * movimento continua (ou termina) na mesma operação.
 */
combatRouter.post(
  '/:combatId/reaction-opportunities/:opportunityId/attack',
  authenticate,
  async (req, res) => {
    const parsed = opportunityAttackPayloadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await resolveOpportunityAttack(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.opportunityId),
        {
          expectedVersion: parsed.data.expectedVersion,
          operationId: parsed.data.operationId,
          attackId: parsed.data.attackId,
        },
      ),
    );
  },
);

/**
 * POST /api/combat/:combatId/reaction-opportunities/:opportunityId/decline —
 * "não reagir": fecha SÓ esta janela e NÃO gasta a Reação.
 */
combatRouter.post(
  '/:combatId/reaction-opportunities/:opportunityId/decline',
  authenticate,
  async (req, res) => {
    const parsed = opportunityDecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await declineOpportunity(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.opportunityId),
        parsed.data,
      ),
    );
  },
);

/**
 * POST /api/combat/:combatId/reaction-opportunities/:opportunityId/visibility —
 * MASTER adjudica a visão de uma janela `unknown`. Um fato `known-not-visible`
 * NUNCA pode ser sobrescrito para visível.
 */
combatRouter.post(
  '/:combatId/reaction-opportunities/:opportunityId/visibility',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const parsed = opportunityVisibilitySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json(
      await confirmOpportunityVisibility(
        actorFrom(req),
        String(req.params.combatId),
        String(req.params.opportunityId),
        parsed.data,
      ),
    );
  },
);

/** GET /api/combat/active — estado do combate em andamento (ou null). */
combatRouter.get('/active', authenticate, async (req, res) => {
  res.json({ combat: await getActiveCombat(actorFrom(req).role) });
});

/** POST /api/combat — botão "COMBATE": inicia o combate com as criaturas escolhidas. */
combatRouter.post('/', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = startCombatSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ combat: await startCombat(actorFrom(req), parsed.data) });
});

/** POST /api/combat/initiative — o jogador rola a própria iniciativa. */
combatRouter.post('/initiative', authenticate, async (req, res) => {
  res.json({ combat: await rollInitiative(actorFrom(req)) });
});

/** POST /api/combat/initiative/:combatantId — o mestre rola por qualquer combatente. */
combatRouter.post('/initiative/:combatantId', authenticate, requireRole('MASTER'), async (req, res) => {
  res.json({ combat: await rollInitiative(actorFrom(req), String(req.params.combatantId)) });
});

/**
 * POST /api/combat/next-turn — avança o turno. O mestre a qualquer momento;
 * o jogador só encerra o próprio turno (verificado no serviço).
 */
combatRouter.post('/next-turn', authenticate, async (req, res) => {
  const parsed = nextTurnSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ combat: await nextTurn(actorFrom(req), parsed.data) });
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

/**
 * GET /api/combat/items/:combatantId — itens USÁVEIS do combatente (poções e
 * consumíveis com saldo) para o seletor compacto de "Usar Item". O servidor
 * autoriza Mestre OU dono do personagem; o inventário de NPC nunca vai para
 * jogador.
 */
combatRouter.get('/items/:combatantId', authenticate, async (req, res) => {
  res.json({ items: await listCombatItems(actorFrom(req), String(req.params.combatantId)) });
});

/** POST /api/combat/use-item — usa um consumível durante o turno (1 Ação). */
combatRouter.post('/use-item', authenticate, async (req, res) => {
  const parsed = useItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await useCombatItem(actorFrom(req), parsed.data));
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

combatRouter.post('/action', authenticate, async (req, res) => {
  const parsed = economyActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await executeEconomyAction(actorFrom(req), parsed.data));
});

combatRouter.post('/economy/override', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = economyOverrideSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json(await overrideEconomy(actorFrom(req), parsed.data));
});

combatRouter.post('/participants/add', authenticate, requireRole('MASTER'), async (req, res) => {
 const parsed = addParticipantsSchema.safeParse(req.body);
 if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() }); return; }
 res.json(await addCombatParticipants(actorFrom(req), parsed.data));
});
combatRouter.post('/participants/remove', authenticate, requireRole('MASTER'), async (req, res) => {
 const parsed = removeParticipantSchema.safeParse(req.body);
 if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() }); return; }
 res.json(await removeCombatParticipant(actorFrom(req), parsed.data));
});

combatRouter.post('/creature-ability', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = creatureAbilityUseSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  res.json(await useCreatureAbility(actorFrom(req), parsed.data));
});

combatRouter.post('/hostility/decision', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = hostilityDecisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  res.json(await decideAttackHostility(actorFrom(req), parsed.data));
});

combatRouter.get('/:combatId/duels', authenticate, async (req, res) => { res.json(await combatDuelsFor(actorFrom(req), String(req.params.combatId))); });
combatRouter.post('/duels/request', authenticate, async (req, res) => {
  const parsed = duelRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  res.json(await requestCombatDuel(actorFrom(req), parsed.data));
});
combatRouter.post('/duels/decision', authenticate, async (req, res) => {
  const parsed = duelDecisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors }); return; }
  res.json(await decideCombatDuel(actorFrom(req), parsed.data));
});

combatRouter.post('/:combatId/reaction-opportunities/:opportunityId/spell', authenticate, async (req, res) => {
  const parsed = opportunitySpellSchema.safeParse(req.body ?? {});
  if (!parsed.success) {res.status(400).json({error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors}); return;}
  if (parsed.data.combatId !== String(req.params.combatId)) throw new HttpError('Combate divergente.', 400, 'VALIDATION_ERROR');
  res.json(await castOpportunitySpell(actorFrom(req), String(req.params.combatId), String(req.params.opportunityId), parsed.data));
});

/** Consulta de geometria de área: somente leitura e somente Mestre. */
combatRouter.post('/:combatId/spatial/area-query', authenticate, requireRole('MASTER'), async(req,res)=>{
 const parsed=gridAreaQuerySchema.safeParse(req.body??{});
 if(!parsed.success){res.status(400).json({error:'VALIDATION_ERROR',issues:parsed.error.flatten()});return;}
 res.json(await queryCombatArea(actorFrom(req),String(req.params.combatId),parsed.data));
});

/** Consulta privada: o cadastro fornece forma, dimensões e salvaguarda. */
combatRouter.post('/:combatId/creature-area-preview', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = creatureAreaPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten() });
    return;
  }
  res.json(await previewCreatureArea(actorFrom(req), String(req.params.combatId), parsed.data.combatantId, parsed.data.abilityId, parsed.data.placement));
});
