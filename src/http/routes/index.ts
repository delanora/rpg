import { Router } from 'express';
import { authRouter } from '../../modules/auth/auth.routes.js';
import { charactersRouter } from '../../modules/characters/characters.routes.js';
import { usersRouter } from '../../modules/users/users.routes.js';
import { healthRouter } from './health.js';

/**
 * Roteador raiz da API (montado em `/api`).
 * As rotas de domínio são registradas aqui conforme as etapas avançam:
 *   /api/creatures   (Etapa 3)
 *   /api/combat      (Etapa 4)
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/characters', charactersRouter);
