import { prisma } from '../config/prisma.js';
import { tryVerifyToken } from '../lib/jwt.js';
import type { AppSocket } from '../types/socket.js';

/**
 * Autentica a conexão WebSocket antes de ela ser aceita.
 *
 * O token pode vir em `socket.handshake.auth.token` (padrão do Socket.io,
 * usado pelo frontend) ou em `?token=` na query string (útil para testar
 * com ferramentas de linha de comando). Se for inválido, a conexão é recusada.
 *
 * Como no HTTP, a conta também é conferida no banco: um token de conta
 * excluída pelo mestre não abre mais socket nenhum.
 */
export async function socketAuth(socket: AppSocket, next: (err?: Error) => void): Promise<void> {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;

  const token =
    typeof authToken === 'string'
      ? authToken
      : typeof queryToken === 'string'
        ? queryToken
        : undefined;

  const payload = tryVerifyToken(token);

  if (!payload) {
    next(new Error('UNAUTHORIZED'));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true, role: true },
    });

    if (!user) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    socket.data.userId = user.id;
    socket.data.username = user.username;
    socket.data.displayName = user.displayName;
    socket.data.role = user.role;

    next();
  } catch (error) {
    console.error('[socket] falha ao validar a conta na conexão:', error);
    next(new Error('UNAUTHORIZED'));
  }
}
