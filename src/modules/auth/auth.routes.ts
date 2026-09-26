import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate } from './auth.middleware.js';
import { createSession, loginUser, registerUser } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.schema.js';

export const authRouter = Router();

/**
 * Limita tentativas de cadastro/login para dificultar ataques de força bruta.
 * Como o sistema fica exposto por IP, isso é especialmente importante.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Mais rígido em produção; em desenvolvimento afrouxa para não atrapalhar testes.
  limit: env.NODE_ENV === 'production' ? 30 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente mais tarde.' },
});

/** POST /api/auth/register — cria a conta (jogador ou, com código, mestre). */
authRouter.post('/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const user = await registerUser(parsed.data);
  res.status(201).json(createSession(user));
});

/** POST /api/auth/login — valida credenciais e devolve o token. */
authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const user = await loginUser(parsed.data);
  res.json(createSession(user));
});

/** GET /api/auth/me — dados do usuário autenticado (valida o token). */
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});
