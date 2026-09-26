import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { presentImageSchema } from './presentation.schema.js';
import { closePresentation, getCurrentPresentation, presentImage } from './presentation.service.js';

export const presentationRouter = Router();

presentationRouter.use(authenticate);

/** GET /api/presentation — apresentação em andamento (para recarregar a tela). */
presentationRouter.get('/', (_req, res) => {
  res.json({ presentation: getCurrentPresentation() });
});

/**
 * POST /api/presentation — o mestre mostra uma imagem para a mesa inteira.
 * O nome de quem apresentou vem do token, nunca do corpo da requisição.
 */
presentationRouter.post('/', requireRole('MASTER'), (req, res) => {
  const parsed = presentImageSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const presentation = presentImage(parsed.data, req.user?.displayName ?? 'Mestre');
  res.status(201).json({ presentation });
});

/** POST /api/presentation/close — o mestre fecha a imagem na tela de todos. */
presentationRouter.post('/close', requireRole('MASTER'), (_req, res) => {
  closePresentation();
  res.status(204).end();
});
