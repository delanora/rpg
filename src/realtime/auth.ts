import { tryVerifyToken } from '../lib/jwt.js';
import type { AppSocket } from '../types/socket.js';

/**
 * Autentica a conexão WebSocket antes de ela ser aceita.
 *
 * O token pode vir em `socket.handshake.auth.token` (padrão do Socket.io,
 * usado pelo frontend) ou em `?token=` na query string (útil para testar
 * com ferramentas de linha de comando). Se for inválido, a conexão é recusada.
 */
export function socketAuth(socket: AppSocket, next: (err?: Error) => void): void {
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

  socket.data.userId = payload.sub;
  socket.data.username = payload.username;
  socket.data.displayName = payload.displayName;
  socket.data.role = payload.role;

  next();
}
