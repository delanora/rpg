import type { Role } from '@prisma/client';
import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createLongRestRequestSchema,
  forceCompleteLongRestSchema,
  longRestRequestActionSchema,
  longRestRequestIdSchema,
  respondLongRestRequestSchema,
  setCampSupplyContributionSchema,
  setHitDiceRecoverySchema,
  setLongRestReadySchema,
} from './long-rest.schema.js';
import {
  abortLongRestRequest,
  cancelLongRestRequest,
  createLongRestRequest,
  forceApproveLongRestRequest,
  forceCompleteLongRest,
  getOpenLongRestRequest,
  respondToLongRestRequest,
  setCampSupplyContribution,
  setHitDiceRecovery,
  setLongRestReady,
  type Actor,
} from './long-rest.service.js';

export const longRestRouter = Router();

/**
 * Extrai o autor da requisição (sempre do token/banco, jamais do corpo). O
 * `role` acompanha porque a RESPOSTA tem visibilidade por papel (a nota do
 * override é privada do Mestre).
 */
function actorFrom(req: {
  user?: { sub: string; username: string; displayName: string; role: Role };
}): Actor {
  return {
    userId: req.user!.sub,
    username: req.user!.username,
    displayName: req.user!.displayName,
    role: req.user!.role,
  };
}

/** Devolve 400 no mesmo formato das demais rotas. */
function validationError(res: Response, issues: unknown): void {
  res.status(400).json({ error: 'VALIDATION_ERROR', issues });
}

/**
 * GET /api/rest/long/request — solicitação coletiva aberta.
 *
 * Devolve a única solicitação PENDING ou, se já aprovada, a que está EM
 * ANDAMENTO (APPROVED) — ou `null`. Serve para quem entra na página depois do
 * pedido: o evento `long-rest:request-updated` cobre as mudanças ao vivo; esta
 * leitura recupera o estado atual.
 */
longRestRouter.get('/long/request', authenticate, async (_req, res) => {
  res.json({ request: await getOpenLongRestRequest() });
});

/**
 * POST /api/rest/long/request — solicita um Descanso Longo coletivo.
 *
 * Só PLAYER (e com ficha). A lista de convidados é congelada pelo servidor
 * (jogadores conectados com ficha) e o solicitante entra já como ACCEPTED.
 * Retorna 409 quando já existe uma solicitação aguardando resposta.
 */
longRestRouter.post('/long/request', authenticate, async (req, res) => {
  const parsed = createLongRestRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.status(201).json(await createLongRestRequest(actorFrom(req), parsed.data));
});

/**
 * POST /api/rest/long/:requestId/respond — aceita ou recusa o descanso.
 *
 * Só um participante responde, e só enquanto a solicitação está PENDING (a
 * resposta pode ser trocada). Mestre não participa.
 */
longRestRouter.post('/long/:requestId/respond', authenticate, async (req, res) => {
  const id = longRestRequestIdSchema.safeParse(req.params.requestId);
  const parsed = respondLongRestRequestSchema.safeParse(req.body ?? {});
  if (!id.success) {
    validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
    return;
  }
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.json(await respondToLongRestRequest(actorFrom(req), id.data, parsed.data));
});

/**
 * POST /api/rest/long/:requestId/force-approve — mestre força o início.
 *
 * PENDING vira não participante (DECLINED, fechado pelo mestre) e só os ACCEPTED
 * ganham sessão. Sem nenhum ACCEPTED → CANCELLED / NO_PARTICIPANTS.
 */
longRestRouter.post(
  '/long/:requestId/force-approve',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = longRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = longRestRequestActionSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await forceApproveLongRestRequest(actorFrom(req), id.data, parsed.data));
  },
);

/**
 * PUT /api/rest/long/:requestId/camp-supplies — contribui com recursos de
 * acampamento (mecânica OPCIONAL). Só um participante ACCEPTED com sessão
 * ACTIVE, com item do PRÓPRIO inventário. `quantity = 0` remove a contribuição.
 * A seleção reserva a quantidade (nada é consumido nesta etapa).
 */
longRestRouter.put('/long/:requestId/camp-supplies', authenticate, async (req, res) => {
  const id = longRestRequestIdSchema.safeParse(req.params.requestId);
  const parsed = setCampSupplyContributionSchema.safeParse(req.body ?? {});
  if (!id.success) {
    validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
    return;
  }
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.json(await setCampSupplyContribution(actorFrom(req), id.data, parsed.data));
});

/**
 * POST /api/rest/long/:requestId/ready — marca/desmarca "pronto para descansar".
 *
 * Só participante ACCEPTED com sessão ACTIVE. Recursos de acampamento
 * insuficientes NÃO impedem o ready; quando o ÚLTIMO participante fica pronto e
 * os suprimentos permitem, o Descanso Longo conclui na mesma chamada (a resposta
 * traz `completion`).
 */
longRestRouter.post('/long/:requestId/ready', authenticate, async (req, res) => {
  const id = longRestRequestIdSchema.safeParse(req.params.requestId);
  const parsed = setLongRestReadySchema.safeParse(req.body ?? {});
  if (!id.success) {
    validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
    return;
  }
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.json(await setLongRestReady(actorFrom(req), id.data, parsed.data));
});

/**
 * PUT /api/rest/long/:requestId/hit-dice — escolhe os Dados de Vida a recuperar.
 *
 * Só participante ACCEPTED com sessão ACTIVE. A escolha é persistida na sessão e
 * aplicada apenas na conclusão do descanso (em multiclasse o jogador decide os
 * tipos — o PHB não tem prioridade automática).
 */
longRestRouter.put('/long/:requestId/hit-dice', authenticate, async (req, res) => {
  const id = longRestRequestIdSchema.safeParse(req.params.requestId);
  const parsed = setHitDiceRecoverySchema.safeParse(req.body ?? {});
  if (!id.success) {
    validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
    return;
  }
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.json(await setHitDiceRecovery(actorFrom(req), id.data, parsed.data));
});

/**
 * POST /api/rest/long/:requestId/force-complete — mestre conclui o descanso.
 *
 * Sem `campSupplyOverride`, ignora só o `ready` faltante e continua respeitando
 * os recursos de acampamento (409 `CAMP_SUPPLIES_INSUFFICIENT` com
 * `required`/`contributed`/`remaining` quando faltam). Com `campSupplyOverride`,
 * o mestre declara a exceção narrativa e o descanso conclui — os suprimentos
 * existentes seguem sendo consumidos e a exceção fica registrada.
 */
longRestRouter.post(
  '/long/:requestId/force-complete',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = longRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = forceCompleteLongRestSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await forceCompleteLongRest(actorFrom(req), id.data, parsed.data));
  },
);

/**
 * POST /api/rest/long/:requestId/abort — mestre ABORTA um descanso em andamento.
 *
 * Só vale para APPROVED: encerra as sessões ACTIVE (CANCELLED) e cancela a
 * solicitação (`cancelReason: ABORTED`), liberando as reservas de acampamento.
 * Para uma solicitação PENDING o mestre usa `/cancel`.
 */
longRestRouter.post(
  '/long/:requestId/abort',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = longRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = longRestRequestActionSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await abortLongRestRequest(actorFrom(req), id.data, parsed.data));
  },
);

/**
 * POST /api/rest/long/:requestId/cancel — mestre cancela a solicitação.
 *
 * PENDING → CANCELLED, sem criar sessões nem alterar respostas já dadas.
 */
longRestRouter.post(
  '/long/:requestId/cancel',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = longRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = longRestRequestActionSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await cancelLongRestRequest(actorFrom(req), id.data, parsed.data));
  },
);
