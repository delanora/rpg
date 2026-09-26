/**
 * Helpers de nomes de salas (rooms) do Socket.io.
 *
 * Centralizar aqui garante que servidor e clientes usem exatamente o mesmo
 * identificador de sala — a origem mais comum de bugs de tempo real.
 *
 * Projeto de mesa única: a sala principal é a `TABLE_ROOM`. O `tableId`
 * permite, no futuro, suportar mais de uma mesa sem refatoração.
 */

export const TABLE_ROOM = 'table:main';

/** Sala exclusiva dos usuários com papel MASTER. */
export const MASTERS_ROOM = 'role:masters';

/** Sala principal da mesa — todos os conectados (jogadores + mestre). */
export function tableRoom(tableId: string = TABLE_ROOM): string {
  return tableId;
}

/**
 * Sala individual de um usuário — todas as sessões/abas dele entram aqui.
 * É por onde o usuário recebe eventos das próprias fichas.
 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Sala do combate em andamento — turnos e HP sincronizados (Etapa 4). */
export function combatRoom(tableId: string = TABLE_ROOM): string {
  return `combat:${tableId}`;
}
