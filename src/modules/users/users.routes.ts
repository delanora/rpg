import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { listUsers, toPublicUser } from './users.service.js';

export const usersRouter = Router();

/**
 * GET /api/users — lista todos os usuários da mesa.
 * Exclusivo do mestre (base do painel de controle); nunca retorna senhas.
 */
usersRouter.get('/', authenticate, requireRole('MASTER'), async (_req, res) => {
  const users = await listUsers();
  res.json({ users: users.map(toPublicUser) });
});
