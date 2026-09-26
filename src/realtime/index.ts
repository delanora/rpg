import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { corsOrigins } from '../config/env.js';
import { getCurrentPresentation } from '../modules/presentation/presentation.service.js';
import type { AppServer, AppSocket } from '../types/socket.js';
import { socketAuth } from './auth.js';
import { createBroadcaster } from './broadcast.js';
import { ClientEvents, ServerEvents } from './events.js';
import { setBroadcaster } from './hub.js';
import { registerConnection, unregisterConnection } from './presence.js';
import { MASTERS_ROOM, TABLE_ROOM, tableRoom, userRoom } from './rooms.js';

/**
 * Cria a camada de tempo real reaproveitando o mesmo `http.Server` do Express,
 * ou seja, HTTP e WebSocket compartilham a mesma porta (facilita a hospedagem).
 *
 * Responsabilidades desta camada:
 *   1. Autenticar cada conexão por JWT (`socketAuth`).
 *   2. Colocar o socket nas salas certas: mesa, usuário e (se mestre) mestres.
 *   3. Manter e divulgar a presença (quem está online).
 *
 * As escritas de domínio (ficha, combate) acontecem por HTTP e publicam eventos
 * através do `broadcaster`, acessível nos módulos via `getBroadcaster()`.
 */
export function createRealtimeServer(httpServer: HttpServer): AppServer {
  const io: AppServer = new Server(httpServer, {
    cors: {
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    },
    // O frontend ficará em outro domínio na maioria dos provedores.
    transports: ['websocket', 'polling'],
  });

  // Uma única instância, compartilhada com os módulos de domínio via hub.
  const broadcaster = createBroadcaster(io);
  setBroadcaster(broadcaster);

  // Toda conexão precisa de um token válido antes de ser aceita.
  io.use(socketAuth);

  io.on('connection', (socket: AppSocket) => {
    const { userId, username, displayName, role } = socket.data;

    // Salas: mesa (eventos gerais), usuário (eventos das próprias fichas)
    // e, para mestres, a sala exclusiva do painel de controle.
    socket.join(tableRoom(TABLE_ROOM));
    socket.join(userRoom(userId));
    if (role === 'MASTER') {
      socket.join(MASTERS_ROOM);
    }

    const becameOnline = registerConnection({ userId, username, displayName, role }, socket.id);

    socket.emit(ServerEvents.CONNECTION_READY, {
      socketId: socket.id,
      connectedAt: new Date().toISOString(),
      user: { userId, username, role },
    });

    // Quem entra no meio de uma apresentação recebe a imagem já aberta.
    const presentation = getCurrentPresentation();
    if (presentation) {
      socket.emit(ServerEvents.PRESENTATION_SHOWN, { presentation });
    }

    console.log(`[socket] conectado: ${username} (${role}) — ${socket.id}`);
    if (becameOnline) {
      broadcaster.presence();
    }

    socket.on(ClientEvents.TABLE_JOIN, (tableId) => {
      socket.join(tableRoom(tableId ?? TABLE_ROOM));
    });

    socket.on(ClientEvents.TABLE_LEAVE, (tableId) => {
      socket.leave(tableRoom(tableId ?? TABLE_ROOM));
    });

    socket.on('disconnect', (reason) => {
      const becameOffline = unregisterConnection(userId, socket.id);
      console.log(`[socket] desconectado: ${username} (${reason})`);
      if (becameOffline) {
        broadcaster.presence();
      }
    });
  });

  return io;
}
