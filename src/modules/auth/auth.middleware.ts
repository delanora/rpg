import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { extractBearerToken, tryVerifyToken } from '../../lib/jwt.js';

/**
 * Exige um token JWT válido no header `Authorization: Bearer <token>`.
 * Em caso de sucesso, anexa os dados do usuário em `req.user`.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  const payload = tryVerifyToken(token);

  if (!payload) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Token ausente ou inválido. Faça login novamente.',
    });
    return;
  }

  req.user = payload;
  next();
}

/**
 * Restringe a rota a determinados papéis. Deve ser usado depois de `authenticate`.
 *
 * Exemplo: `router.get('/', authenticate, requireRole('MASTER'), handler)`.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Não autenticado.' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Seu papel não tem permissão para acessar este recurso.',
      });
      return;
    }

    next();
  };
}
