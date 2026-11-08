import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { api } from '../../api';
import type { CombatPingPayload, SpatialPosition } from '../../types';

const listeners = new Set<(ping: CombatPingPayload) => void>();
/** O evento do servidor é a única entrada visual, inclusive para quem marcou. */
export function publishGridPing(ping: CombatPingPayload): void {
  for (const listener of listeners) listener(ping);
}

function editable(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

type BoardEvent = MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>;

export function useGridPing(options: {
  combatId: string; enabled: boolean;
  positionAt: (x: number, y: number) => SpatialPosition | null;
  widthFeet: number; heightFeet: number;
  onStart: () => void; onError: (message: string) => void;
}) {
  const live = useRef(options); live.current = options;
  const alt = useRef(false);
  const intercepted = useRef(false);
  const pointerHeld = useRef(false);
  const [holdingAlt, setHoldingAlt] = useState(false);
  const [pings, setPings] = useState<CombatPingPayload[]>([]);
  const lastSent = useRef(0);

  useEffect(() => {
    setPings([]);
    if (!options.enabled) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const receive = (ping: CombatPingPayload) => {
      if (ping.combatId !== options.combatId || timers.has(ping.id)) return;
      // Limite de apresentação: um fluxo intenso não acumula elementos/timers.
      if (timers.size >= 32) {
        const oldest = timers.keys().next().value!;
        clearTimeout(timers.get(oldest)); timers.delete(oldest);
        setPings(current => current.filter(item => item.id !== oldest));
      }
      setPings(current => [...current, ping]);
      timers.set(ping.id, setTimeout(() => {
        timers.delete(ping.id);
        setPings(current => current.filter(item => item.id !== ping.id));
      }, 3000));
    };
    listeners.add(receive);
    return () => { listeners.delete(receive); timers.forEach(clearTimeout); };
  }, [options.combatId, options.enabled]);

  useEffect(() => {
    const reset = () => { alt.current = false; setHoldingAlt(false); intercepted.current = false; pointerHeld.current = false; };
    reset();
    if (!options.enabled) return;
    const down = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || event.getModifierState('AltGraph') || editable(event.target)) return;
      event.preventDefault();
      if (!alt.current) live.current.onStart();
      alt.current = true; setHoldingAlt(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Alt') { alt.current = false; setHoldingAlt(false); }
    };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      reset(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', visibility);
    };
  }, [options.enabled, options.combatId]);

  const onBoard = (event: BoardEvent) => event.target instanceof Element && Boolean(event.target.closest('.grid-plane'));
  const pressed = (event: BoardEvent) => options.enabled && !event.getModifierState('AltGraph') && (alt.current || event.altKey);
  const stop = (event: BoardEvent) => { event.preventDefault(); event.stopPropagation(); };
  const block = (event: BoardEvent) => {
    if (intercepted.current || (pressed(event) && onBoard(event))) stop(event);
  };
  return {
    holdingAlt, alt, pings,
    capture: {
      onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
        intercepted.current = false; pointerHeld.current = false;
        if (!pressed(event) || !onBoard(event) || event.button !== 0) return;
        stop(event); intercepted.current = true; pointerHeld.current = true;
        live.current.onStart();
        const position = live.current.positionAt(event.clientX, event.clientY);
        if (!position || position.xFeet < 0 || position.yFeet < 0 ||
          position.xFeet > options.widthFeet || position.yFeet > options.heightFeet) return;
        const now = performance.now();
        if (lastSent.current && now - lastSent.current < 300) return;
        lastSent.current = now;
        const combatId = options.combatId;
        void api<CombatPingPayload>(`/api/combat/${encodeURIComponent(combatId)}/spatial/ping`, {
          method: 'POST', body: { position },
        }).catch((error: unknown) => {
          if (live.current.combatId === combatId && live.current.enabled) {
            live.current.onError(error instanceof Error ? error.message : 'Não foi possível marcar o ponto.');
          }
        });
      },
      onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (pointerHeld.current || (pressed(event) && onBoard(event))) stop(event);
      },
      onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => { block(event); pointerHeld.current = false; },
      onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => { block(event); pointerHeld.current = false; },
      onClickCapture: block,
      onDoubleClickCapture: block,
      onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => { if (pressed(event) && onBoard(event)) stop(event); },
    },
  };
}
