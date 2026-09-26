import type { Role } from '@prisma/client';
import type { CharacterDto } from '../modules/characters/characters.dto.js';

/**
 * Contrato central de eventos do Socket.io.
 *
 * Manter os nomes aqui (em vez de strings soltas pelo código) evita erros de
 * digitação e serve de referência única para o frontend.
 *
 * Convenção de nomes: `dominio:acao`
 *
 * Observação: as escritas da ficha acontecem por HTTP (PATCH /api/characters/me),
 * que persiste e então publica `sheet:updated`. O WebSocket é o canal de
 * *notificação*, não de escrita — evita dois caminhos de gravação divergentes.
 */

/** Usuário conectado no momento, usado no relatório de presença. */
export interface OnlineUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

/** Payload de confirmação de conexão, entregue logo após o handshake. */
export interface ConnectionReadyPayload {
  socketId: string;
  connectedAt: string;
  user: {
    userId: string;
    username: string;
    role: Role;
  };
}

/** Lista de quem está online na mesa. */
export interface PresenceUpdatePayload {
  online: OnlineUser[];
}

/**
 * Alteração de ficha publicada em tempo real.
 *
 * Vai para a sala dos mestres e para as sessões do próprio autor. O `userId`
 * e o `username` são carimbados pelo servidor a partir do token — o cliente
 * nunca os informa, então não há como se passar por outro jogador.
 *
 * `changes` traz o patch aplicado; `character` traz a ficha completa já
 * calculada, para o painel do mestre apenas substituir o estado.
 */
export interface SheetUpdatedPayload {
  userId: string;
  username: string;
  characterId: string;
  version: number;
  changes: Record<string, unknown>;
  character: CharacterDto;
  at: string;
}

/** Eventos enviados pelo cliente (frontend) para o servidor. */
export const ClientEvents = {
  /** Entra na sala da mesa para receber os eventos de sessão. */
  TABLE_JOIN: 'table:join',
  /** Sai da sala da mesa. */
  TABLE_LEAVE: 'table:leave',
} as const;

/** Eventos enviados pelo servidor para os clientes. */
export const ServerEvents = {
  /** Confirmação de conexão (com os dados do usuário autenticado). */
  CONNECTION_READY: 'connection:ready',
  /** Erro genérico de tempo real (payload inválido, permissão, etc.). */
  ERROR: 'app:error',
  /** Lista atualizada de quem está online na mesa. */
  PRESENCE_UPDATE: 'presence:update',
  /** Ficha alterada — entregue aos mestres e às sessões do autor. */
  SHEET_UPDATED: 'sheet:updated',
  // Próximas etapas:
  //   combat:started / combat:turn / combat:ended  (Etapa 4)
} as const;

export type ClientEvent = (typeof ClientEvents)[keyof typeof ClientEvents];
export type ServerEvent = (typeof ServerEvents)[keyof typeof ServerEvents];
