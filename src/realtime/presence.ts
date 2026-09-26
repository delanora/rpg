import type { OnlineUser } from './events.js';

/**
 * Controle de presença em memória.
 *
 * Um mesmo usuário pode ter várias abas abertas, então mapeamos
 * `userId -> conjunto de socketIds`. O usuário só é considerado offline
 * quando a última conexão dele cai.
 *
 * Suficiente para um único processo (uma mesa). Se um dia houver mais de uma
 * instância, isso migraria para um adaptador do Socket.io (ex.: Redis).
 */
const socketsByUser = new Map<string, Set<string>>();
const usersByUserId = new Map<string, OnlineUser>();

/** Registra uma conexão. Retorna `true` se o usuário acabou de ficar online. */
export function registerConnection(user: OnlineUser, socketId: string): boolean {
  const sockets = socketsByUser.get(user.userId) ?? new Set<string>();
  const wasOffline = sockets.size === 0;

  sockets.add(socketId);
  socketsByUser.set(user.userId, sockets);
  usersByUserId.set(user.userId, user);

  return wasOffline;
}

/** Remove uma conexão. Retorna `true` se o usuário acabou de ficar offline. */
export function unregisterConnection(userId: string, socketId: string): boolean {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return false;

  sockets.delete(socketId);
  if (sockets.size > 0) return false;

  socketsByUser.delete(userId);
  usersByUserId.delete(userId);
  return true;
}

/** Lista de usuários online, ordenada por nome de usuário. */
export function getOnlineUsers(): OnlineUser[] {
  return [...usersByUserId.values()].sort((a, b) => a.username.localeCompare(b.username));
}
