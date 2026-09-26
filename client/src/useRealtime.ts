import { useEffect, useRef, useState } from 'react';
import { createSocket } from './socket';
import type {
  AttackResolvedPayload,
  CombatEndedPayload,
  CombatStartedPayload,
  CombatTurnPayload,
  CombatUpdatedPayload,
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  DiceRolledPayload,
  OnlineUser,
  SheetUpdatedPayload,
} from './types';

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface RealtimeHandlers {
  onSheetUpdated?: (payload: SheetUpdatedPayload) => void;
  onCreatureCreated?: (payload: CreatureCreatedPayload) => void;
  onCreatureUpdated?: (payload: CreatureUpdatedPayload) => void;
  onCreatureDeleted?: (payload: CreatureDeletedPayload) => void;
  onCombatStarted?: (payload: CombatStartedPayload) => void;
  onCombatUpdated?: (payload: CombatUpdatedPayload) => void;
  onCombatTurn?: (payload: CombatTurnPayload) => void;
  onCombatEnded?: (payload: CombatEndedPayload) => void;
  onDiceRolled?: (payload: DiceRolledPayload) => void;
  onAttackResolved?: (payload: AttackResolvedPayload) => void;
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

    socket.on('creature:created', (payload) => handlersRef.current.onCreatureCreated?.(payload));
    socket.on('creature:updated', (payload) => handlersRef.current.onCreatureUpdated?.(payload));
    socket.on('creature:deleted', (payload) => handlersRef.current.onCreatureDeleted?.(payload));

    socket.on('combat:started', (payload) => handlersRef.current.onCombatStarted?.(payload));
    socket.on('combat:updated', (payload) => handlersRef.current.onCombatUpdated?.(payload));
    socket.on('combat:turn', (payload) => handlersRef.current.onCombatTurn?.(payload));
    socket.on('combat:ended', (payload) => handlersRef.current.onCombatEnded?.(payload));
    socket.on('dice:rolled', (payload) => handlersRef.current.onDiceRolled?.(payload));
    socket.on('combat:attack', (payload) => handlersRef.current.onAttackResolved?.(payload));

    return () => {
      socket.close();
    };
  }, []);

  return { connection, online, lastEventAt };
}
