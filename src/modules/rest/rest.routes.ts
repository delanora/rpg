import { Router, type Response } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createShortRestRequestSchema,
  respondShortRestRequestSchema,
  shortRestRequestActionSchema,
  shortRestRequestIdSchema,
} from './rest.schema.js';
import {
  cancelShortRestRequest,
  createShortRestRequest,
  forceApproveShortRestRequest,
  getOpenShortRestRequest,
  respondToShortRestRequest,
  type Actor,
} from './rest.service.js';

export const restRouter = Router();

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
 * GET /api/rest/short/request — solicitação coletiva aguardando resposta.
 *
 * Devolve a única solicitação PENDING (ou `null`). Serve para quem entra na
 * página depois do pedido: o evento `short-rest:request-updated` cobre as
 * mudanças ao vivo; esta leitura recupera o estado atual.
 */
restRouter.get('/short/request', authenticate, async (_req, res) => {
  res.json({ request: await getOpenShortRestRequest() });
});

/**
 * POST /api/rest/short/request — solicita um Descanso Curto coletivo.
 *
 * Só PLAYER (e com ficha). A lista de convidados é congelada pelo servidor
 * (jogadores conectados com ficha) e o solicitante entra já como ACCEPTED.
 * Retorna 409 quando já existe uma solicitação aguardando resposta.
 */
restRouter.post('/short/request', authenticate, async (req, res) => {
  const parsed = createShortRestRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.status(201).json(await createShortRestRequest(actorFrom(req), parsed.data));
});

/**
 * POST /api/rest/short/:requestId/respond — aceita ou recusa o descanso.
 *
 * Só um participante responde, e só enquanto a solicitação está PENDING (a
 * resposta pode ser trocada). Mestre não participa.
 */
restRouter.post('/short/:requestId/respond', authenticate, async (req, res) => {
  const id = shortRestRequestIdSchema.safeParse(req.params.requestId);
  const parsed = respondShortRestRequestSchema.safeParse(req.body ?? {});
  if (!id.success) {
    validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
    return;
  }
  if (!parsed.success) {
    validationError(res, parsed.error.flatten().fieldErrors);
    return;
  }

  res.json(await respondToShortRestRequest(actorFrom(req), id.data, parsed.data));
});

/**
 * POST /api/rest/short/:requestId/force-approve — mestre força o início.
 *
 * PENDING vira não participante (DECLINED, fechado pelo mestre) e só os ACCEPTED
 * ganham sessão. Sem nenhum ACCEPTED → CANCELLED / NO_PARTICIPANTS.
 */
restRouter.post(
  '/short/:requestId/force-approve',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = shortRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = shortRestRequestActionSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await forceApproveShortRestRequest(actorFrom(req), id.data, parsed.data));
  },
);

/**
 * POST /api/rest/short/:requestId/cancel — mestre cancela a solicitação.
 *
 * PENDING → CANCELLED, sem criar sessões nem alterar respostas já dadas.
 */
restRouter.post(
  '/short/:requestId/cancel',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    const id = shortRestRequestIdSchema.safeParse(req.params.requestId);
    const parsed = shortRestRequestActionSchema.safeParse(req.body ?? {});
    if (!id.success) {
      validationError(res, { requestId: id.error.issues.map((issue) => issue.message) });
      return;
    }
    if (!parsed.success) {
      validationError(res, parsed.error.flatten().fieldErrors);
      return;
    }

    res.json(await cancelShortRestRequest(actorFrom(req), id.data, parsed.data));
  },
);
