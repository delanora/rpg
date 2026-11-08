import type { CombatPingPayload } from './types';
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
  SpellIntentUpdatedPayload,
} from './events';
import type {
  AttackResolvedPayload,
  CharacterDeletedPayload,
  CombatEndedPayload,
  CombatMovementVisualPayload,
  CombatStartedPayload,
  CombatTurnPayload,
  CombatUpdatedPayload,
  DeathUpdatedPayload,
  EffectsUpdatedPayload,
  MechanicalUpdatedPayload,
  DiceRolledPayload,
  GameConfigPayload,
  MusicStatePayload,
  MusicTracksPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
  PresencePayload,
  RegionCreatedPayload,
  RegionDeletedPayload,
  LongRestRequestUpdatedPayload,
  RegionUpdatedPayload,
  SceneCreatedPayload,
  SceneDeletedPayload,
  SceneUpdatedPayload,
  ShortRestCompletedPayload,
  ShortRestRequestUpdatedPayload,
  TableRollActivePayload,
  TableRollPayload,
} from './types';

/** Mapa de eventos espelhando o backend (src/types/socket.ts). */
export interface ServerToClientEvents {
  'connection:ready': (payload: ConnectionReadyPayload) => void;
  'app:error': (payload: { message: string }) => void;
  'presence:update': (payload: PresencePayload) => void;
  'sheet:updated': (payload: SheetUpdatedPayload) => void;
  'character:deleted': (payload: CharacterDeletedPayload) => void;
  'creature:created': (payload: CreatureCreatedPayload) => void;
  'creature:updated': (payload: CreatureUpdatedPayload) => void;
  'creature:deleted': (payload: CreatureDeletedPayload) => void;
  'region:created': (payload: RegionCreatedPayload) => void;
  'region:updated': (payload: RegionUpdatedPayload) => void;
  'region:deleted': (payload: RegionDeletedPayload) => void;
  'locality:created': (payload: LocalityCreatedPayload) => void;
  'locality:updated': (payload: LocalityUpdatedPayload) => void;
  'locality:deleted': (payload: LocalityDeletedPayload) => void;
  /** Cenas da localidade (6.6L.4.1.1) — só a sala dos Mestres recebe. */
  'scene:created': (payload: SceneCreatedPayload) => void;
  'scene:updated': (payload: SceneUpdatedPayload) => void;
  'scene:deleted': (payload: SceneDeletedPayload) => void;
  'item:created': (payload: ItemCreatedPayload) => void;
  'item:updated': (payload: ItemUpdatedPayload) => void;
  'item:deleted': (payload: ItemDeletedPayload) => void;
  'presentation:shown': (payload: PresentationShownPayload) => void;
  'presentation:closed': (payload: PresentationClosedPayload) => void;
  'game:config': (payload: GameConfigPayload) => void;
  'music:state': (payload: MusicStatePayload) => void;
  'music:tracks': (payload: MusicTracksPayload) => void;
  'combat:ping': (payload: CombatPingPayload) => void;
  'combat:started': (payload: CombatStartedPayload) => void;
  'mechanical:updated': (payload: MechanicalUpdatedPayload) => void;
  /** Efeitos ativos de um alvo (6.5A): já filtrados por papel no servidor. */
  'effects:updated': (payload: EffectsUpdatedPayload) => void;
  /** Ciclo de morte (6.3): dono do personagem e sala dos mestres. */
  'death:updated': (payload: DeathUpdatedPayload) => void;
  'combat:updated': (payload: CombatUpdatedPayload) => void;
  /** Trecho de movimento confirmado (só apresentação; filtrado no servidor). */
  'combat:movement-visual': (payload: CombatMovementVisualPayload) => void;
  'combat:turn': (payload: CombatTurnPayload) => void;
  'combat:ended': (payload: CombatEndedPayload) => void;
  'dice:rolled': (payload: DiceRolledPayload) => void;
  'dice:roll': (payload: TableRollPayload) => void;
  'dice:active': (payload: TableRollActivePayload) => void;
  'combat:attack': (payload: AttackResolvedPayload) => void;
  /** Intenção de conjuração (6.6F): o servidor filtra por papel (dono/Mestre). */
  'spells:intent-updated': (payload: SpellIntentUpdatedPayload) => void;
  'short-rest:request-updated': (payload: ShortRestRequestUpdatedPayload) => void;
  'short-rest:completed': (payload: ShortRestCompletedPayload) => void;
  'long-rest:request-updated': (payload: LongRestRequestUpdatedPayload) => void;
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
