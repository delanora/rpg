import type { AppServer } from '../types/socket.js';
import { ServerEvents, type ServerEvent } from './events.js';
import { getOnlineUsers } from './presence.js';
import { MASTERS_ROOM, tableRoom, userRoom } from './rooms.js';

/**
 * API de emissão de eventos usada pelos módulos de domínio.
 *
 * Existe para que a Etapa 2 (fichas) e a Etapa 4 (combate) não precisem
 * conhecer as salas nem o `io` diretamente — só chamar `broadcaster.toMasters(...)`.
 */
export interface Broadcaster {
  /** Envia para todas as sessões de um usuário específico. */
  toUser(userId: string, event: ServerEvent, payload: unknown): void;
  /** Envia apenas para os mestres conectados (painel de controle). */
  toMasters(event: ServerEvent, payload: unknown): void;
  /** Envia para todos os conectados na mesa. */
  toTable(event: ServerEvent, payload: unknown): void;
  /** Envia para a mesa exceto os mestres (visão dos jogadores). */
  toPlayers(event: ServerEvent, payload: unknown): void;
  /**
   * Derruba todas as conexões de um usuário.
   *
   * Usado quando a conta dele deixa de existir (exclusão de personagem pelo
   * mestre): o token continua válido até expirar, então a conexão precisa ser
   * encerrada à força.
   */
  disconnectUser(userId: string): void;
  /** Reenvia a lista atualizada de usuários online. */
  presence(): void;
}

export function createBroadcaster(io: AppServer): Broadcaster {
  /**
   * O `emit` do Socket.io é tipado estaticamente por evento; como aqui o nome
   * do evento é dinâmico, usamos um cast pontual e documentado.
   */
  const emitTo = (room: string, event: ServerEvent, payload: unknown): void => {
    (io.to(room) as unknown as { emit: (event: string, payload: unknown) => void }).emit(
      event,
      payload,
    );
  };

  /** Emite para uma sala excluindo outra (ex.: mesa sem os mestres). */
  const emitToExcept = (
    room: string,
    exceptRoom: string,
    event: ServerEvent,
    payload: unknown,
  ): void => {
    (
      io.to(room).except(exceptRoom) as unknown as {
        emit: (event: string, payload: unknown) => void;
      }
    ).emit(event, payload);
  };

  return {
    toUser: (userId, event, payload) => emitTo(userRoom(userId), event, payload),
    toMasters: (event, payload) => emitTo(MASTERS_ROOM, event, payload),
    toTable: (event, payload) => emitTo(tableRoom(), event, payload),
    toPlayers: (event, payload) => emitToExcept(tableRoom(), MASTERS_ROOM, event, payload),
    disconnectUser: (userId) => {
      io.in(userRoom(userId)).disconnectSockets(true);
    },
    presence: () =>
      emitTo(tableRoom(), ServerEvents.PRESENCE_UPDATE, { online: getOnlineUsers() }),
  };
}
