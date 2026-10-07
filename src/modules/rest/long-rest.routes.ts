import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createLongRestRequestSchema,
  longRestRequestActionSchema,
  longRestRequestIdSchema,
  respondLongRestRequestSchema,
} from './long-rest.schema.js';
import {
  cancelLongRestRequest,
  createLongRestRequest,
  forceApproveLongRestRequest,
  getOpenLongRestRequest,
  respondToLongRestRequest,
  type Actor,
} from './long-rest.service.js';

export const longRestRouter = Router();

/** Extrai o autor da requisição (sempre do token, jamais do corpo). */
function actorFrom(req: {
  user?: { sub: string; username: string; displayName: string };
}): Actor {
  return {
    userId: req.user!.sub,
    username: req.user!.username,
    displayName: req.user!.displayName,
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
