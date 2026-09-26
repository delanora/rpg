import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';
import type { ConnectionReadyPayload, SheetUpdatedPayload } from './events';
import type { PresencePayload } from './types';

/** Mapa de eventos espelhando o backend (src/types/socket.ts). */
export interface ServerToClientEvents {
  'connection:ready': (payload: ConnectionReadyPayload) => void;
  'app:error': (payload: { message: string }) => void;
  'presence:update': (payload: PresencePayload) => void;
  'sheet:updated': (payload: SheetUpdatedPayload) => void;
}

export interface ClientToServerEvents {
  'table:join': (tableId?: string) => void;
  'table:leave': (tableId?: string) => void;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Conecta sem informar URL: em desenvolvimento o Vite faz proxy de `/socket.io`
 * para o backend, e em produção o Express serve tudo na mesma origem.
 */
export function createSocket(): AppSocket {
  return io({
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
  });
}
