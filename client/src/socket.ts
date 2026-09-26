import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';
import type {
  ConnectionReadyPayload,
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  SheetUpdatedPayload,
} from './events';
import type {
  AttackResolvedPayload,
  CombatEndedPayload,
  CombatStartedPayload,
  CombatTurnPayload,
  CombatUpdatedPayload,
  DiceRolledPayload,
  GameConfigPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
  PresencePayload,
  RegionCreatedPayload,
  RegionDeletedPayload,
  RegionUpdatedPayload,
} from './types';

/** Mapa de eventos espelhando o backend (src/types/socket.ts). */
export interface ServerToClientEvents {
  'connection:ready': (payload: ConnectionReadyPayload) => void;
  'app:error': (payload: { message: string }) => void;
  'presence:update': (payload: PresencePayload) => void;
  'sheet:updated': (payload: SheetUpdatedPayload) => void;
  'creature:created': (payload: CreatureCreatedPayload) => void;
  'creature:updated': (payload: CreatureUpdatedPayload) => void;
  'creature:deleted': (payload: CreatureDeletedPayload) => void;
  'region:created': (payload: RegionCreatedPayload) => void;
  'region:updated': (payload: RegionUpdatedPayload) => void;
  'region:deleted': (payload: RegionDeletedPayload) => void;
  'locality:created': (payload: LocalityCreatedPayload) => void;
  'locality:updated': (payload: LocalityUpdatedPayload) => void;
  'locality:deleted': (payload: LocalityDeletedPayload) => void;
  'item:created': (payload: ItemCreatedPayload) => void;
  'item:updated': (payload: ItemUpdatedPayload) => void;
  'item:deleted': (payload: ItemDeletedPayload) => void;
  'presentation:shown': (payload: PresentationShownPayload) => void;
  'presentation:closed': (payload: PresentationClosedPayload) => void;
  'game:config': (payload: GameConfigPayload) => void;
  'combat:started': (payload: CombatStartedPayload) => void;
  'combat:updated': (payload: CombatUpdatedPayload) => void;
  'combat:turn': (payload: CombatTurnPayload) => void;
  'combat:ended': (payload: CombatEndedPayload) => void;
  'dice:rolled': (payload: DiceRolledPayload) => void;
  'combat:attack': (payload: AttackResolvedPayload) => void;
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
