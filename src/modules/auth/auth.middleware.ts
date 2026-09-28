import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../config/prisma.js';
import { extractBearerToken, tryVerifyToken } from '../../lib/jwt.js';

/**
 * Exige um token JWT válido no header `Authorization: Bearer <token>`.
 * Em caso de sucesso, anexa os dados do usuário em `req.user`.
 *
 * O token não basta por si só: ele continua válido até expirar, então a conta é
 * conferida no banco a cada requisição. É o que faz uma conta excluída pelo
 * mestre (exclusão de personagem) perder o acesso na hora, em vez de seguir
 * navegando com um JWT antigo. Os dados do usuário passam a vir do banco, de
 * modo que uma mudança de papel também vale sem novo login.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  const payload = tryVerifyToken(token);

  if (!payload) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Token ausente ou inválido. Faça login novamente.',
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true, role: true },
    });

    if (!user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Esta conta não existe mais. Faça login novamente.',
      });
      return;
    }

    req.user = {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
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
