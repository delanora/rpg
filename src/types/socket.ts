import type { Role } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import type {
  ConnectionReadyPayload,
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  PresenceUpdatePayload,
  SheetUpdatedPayload,
} from '../realtime/events.js';

/**
 * Mapa de eventos servidor → cliente, usado pelos genéricos `Server`/`Socket`
 * do Socket.io. As chaves devem espelhar `ServerEvents` (realtime/events.ts),
 * que é a fonte de verdade em tempo de execução.
 */
export interface ServerToClientEvents {
  'connection:ready': (payload: ConnectionReadyPayload) => void;
  'app:error': (payload: { message: string }) => void;
  'presence:update': (payload: PresenceUpdatePayload) => void;
  'sheet:updated': (payload: SheetUpdatedPayload) => void;
  'creature:created': (payload: CreatureCreatedPayload) => void;
  'creature:updated': (payload: CreatureUpdatedPayload) => void;
  'creature:deleted': (payload: CreatureDeletedPayload) => void;
}

/** Mapa de eventos cliente → servidor. Deve espelhar `ClientEvents`. */
export interface ClientToServerEvents {
  'table:join': (tableId?: string) => void;
  'table:leave': (tableId?: string) => void;
}

/**
 * Dados anexados a cada socket após a autenticação.
 * Preenchidos pelo middleware em `realtime/auth.ts`.
 */
export interface SocketData {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
