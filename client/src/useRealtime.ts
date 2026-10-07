import { useEffect, useRef, useState } from 'react';
import { createSocket } from './socket';
import type {
  AttackResolvedPayload,
  CharacterDeletedPayload,
  CombatEndedPayload,
  CombatStartedPayload,
  CombatTurnPayload,
  CombatUpdatedPayload,
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  DiceRolledPayload,
  GameConfigPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  MusicStatePayload,
  MusicTracksPayload,
  OnlineUser,
  PresentationClosedPayload,
  PresentationShownPayload,
  RegionCreatedPayload,
  RegionDeletedPayload,
  RegionUpdatedPayload,
  SheetUpdatedPayload,
  ShortRestCompletedPayload,
  ShortRestRequestUpdatedPayload,
  TableRollActivePayload,
  TableRollPayload,
} from './types';

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface RealtimeHandlers {
  onSheetUpdated?: (payload: SheetUpdatedPayload) => void;
  /** O mestre excluiu um personagem junto com a conta do dono. */
  onCharacterDeleted?: (payload: CharacterDeletedPayload) => void;
  onCreatureCreated?: (payload: CreatureCreatedPayload) => void;
  onCreatureUpdated?: (payload: CreatureUpdatedPayload) => void;
  onCreatureDeleted?: (payload: CreatureDeletedPayload) => void;
  onRegionCreated?: (payload: RegionCreatedPayload) => void;
  onRegionUpdated?: (payload: RegionUpdatedPayload) => void;
  onRegionDeleted?: (payload: RegionDeletedPayload) => void;
  onLocalityCreated?: (payload: LocalityCreatedPayload) => void;
  onLocalityUpdated?: (payload: LocalityUpdatedPayload) => void;
  onLocalityDeleted?: (payload: LocalityDeletedPayload) => void;
  onItemCreated?: (payload: ItemCreatedPayload) => void;
  onItemUpdated?: (payload: ItemUpdatedPayload) => void;
  onItemDeleted?: (payload: ItemDeletedPayload) => void;
  onCombatStarted?: (payload: CombatStartedPayload) => void;
  onCombatUpdated?: (payload: CombatUpdatedPayload) => void;
  onCombatTurn?: (payload: CombatTurnPayload) => void;
  onCombatEnded?: (payload: CombatEndedPayload) => void;
  onDiceRolled?: (payload: DiceRolledPayload) => void;
  /** Rolagem da janela de dados (pública para a mesa, privada para o autor). */
  onDiceRoll?: (payload: TableRollPayload) => void;
  /** Alguém abriu (ou fechou) a janela de dados — a faixa do topo do tabuleiro. */
  onDiceActive?: (payload: TableRollActivePayload) => void;
  onAttackResolved?: (payload: AttackResolvedPayload) => void;
  onPresentationShown?: (payload: PresentationShownPayload) => void;
  onPresentationClosed?: (payload: PresentationClosedPayload) => void;
  onGameConfig?: (payload: GameConfigPayload) => void;
  /** Estado da música ambiente mudou (fonte de verdade da sincronia). */
  onMusicState?: (payload: MusicStatePayload) => void;
  /** Catálogo de músicas mudou (upload/remoção pelo mestre). */
  onMusicTracks?: (payload: MusicTracksPayload) => void;
  /** Solicitação coletiva de Descanso Curto criada/alterada (resposta, ready, etc.). */
  onShortRestRequestUpdated?: (payload: ShortRestRequestUpdatedPayload) => void;
  /** O Descanso Curto coletivo terminou (Song of Rest + sessões concluídas). */
  onShortRestCompleted?: (payload: ShortRestCompletedPayload) => void;
}

/**
 * Abre a conexão Socket.io autenticada e entrega os eventos de domínio.
 *
 * Os handlers ficam em uma ref para que mudar de handler não reconecte o
 * socket (a conexão só é criada e encerrada com o componente).
 */
export function useRealtime(handlers: RealtimeHandlers) {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = createSocket();

    socket.on('connect', () => setConnection('online'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));
    socket.on('presence:update', (payload) => setOnline(payload.online));

    socket.on('sheet:updated', (payload) => {
      setLastEventAt(payload.at);
      handlersRef.current.onSheetUpdated?.(payload);
    });

    socket.on('character:deleted', (payload) =>
      handlersRef.current.onCharacterDeleted?.(payload),
    );

    socket.on('creature:created', (payload) => handlersRef.current.onCreatureCreated?.(payload));
    socket.on('creature:updated', (payload) => handlersRef.current.onCreatureUpdated?.(payload));
    socket.on('creature:deleted', (payload) => handlersRef.current.onCreatureDeleted?.(payload));

    socket.on('region:created', (payload) => handlersRef.current.onRegionCreated?.(payload));
    socket.on('region:updated', (payload) => handlersRef.current.onRegionUpdated?.(payload));
    socket.on('region:deleted', (payload) => handlersRef.current.onRegionDeleted?.(payload));

    socket.on('locality:created', (payload) => handlersRef.current.onLocalityCreated?.(payload));
    socket.on('locality:updated', (payload) => handlersRef.current.onLocalityUpdated?.(payload));
    socket.on('locality:deleted', (payload) => handlersRef.current.onLocalityDeleted?.(payload));

    socket.on('item:created', (payload) => handlersRef.current.onItemCreated?.(payload));
    socket.on('item:updated', (payload) => handlersRef.current.onItemUpdated?.(payload));
    socket.on('item:deleted', (payload) => handlersRef.current.onItemDeleted?.(payload));

    socket.on('presentation:shown', (payload) => handlersRef.current.onPresentationShown?.(payload));
    socket.on('presentation:closed', (payload) =>
      handlersRef.current.onPresentationClosed?.(payload),
    );

    socket.on('game:config', (payload) => handlersRef.current.onGameConfig?.(payload));
    socket.on('music:state', (payload) => handlersRef.current.onMusicState?.(payload));
    socket.on('music:tracks', (payload) => handlersRef.current.onMusicTracks?.(payload));

    socket.on('combat:started', (payload) => handlersRef.current.onCombatStarted?.(payload));
    socket.on('combat:updated', (payload) => handlersRef.current.onCombatUpdated?.(payload));
    socket.on('combat:turn', (payload) => handlersRef.current.onCombatTurn?.(payload));
    socket.on('combat:ended', (payload) => handlersRef.current.onCombatEnded?.(payload));
    socket.on('dice:rolled', (payload) => handlersRef.current.onDiceRolled?.(payload));
    socket.on('dice:roll', (payload) => handlersRef.current.onDiceRoll?.(payload));
    socket.on('dice:active', (payload) => handlersRef.current.onDiceActive?.(payload));
    socket.on('combat:attack', (payload) => handlersRef.current.onAttackResolved?.(payload));

    socket.on('short-rest:request-updated', (payload) =>
      handlersRef.current.onShortRestRequestUpdated?.(payload),
    );
    socket.on('short-rest:completed', (payload) =>
      handlersRef.current.onShortRestCompleted?.(payload),
    );

    return () => {
      socket.close();
    };
  }, []);

  return { connection, online, lastEventAt };
}
