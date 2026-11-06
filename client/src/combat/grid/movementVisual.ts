import { useEffect, useRef, useState } from 'react';
import type { CombatMovementVisualPayload, SpatialPosition, SpatialSize } from '../../types';
import { feetToPx, SIZE_FOOTPRINT_FEET } from './gridMath';

/**
 * FASE 6.6M.3.1.4 — ANIMAÇÃO DE MOVIMENTO (UMA primitive para TODOS).
 *
 * Regra: todo movimento MECÂNICO confirmado usa esta mesma camada, não importa
 * se a intenção nasceu de Direct Drag ou de Measure-to-Move. O operador também
 * consome o EVENTO do servidor (`combat:movement-visual`) — não existe um
 * segundo caminho "anima pela resposta HTTP".
 *
 * APRESENTAÇÃO, nunca estado: o DTO continua sendo a posição verdadeira. A
 * caixa animada é só o desenho entre os anchors que o SERVIDOR autorizou; ao
 * terminar, o token volta a renderizar a posição autoritativa.
 */

/** Caixa desenhada (px de cena) de um token em trânsito. */
export interface MovementVisualRect {
  combatantId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MovementVisualPlan {
  combatantId: string;
  points: { left: number; top: number }[];
  width: number;
  height: number;
  durationMs: number;
}

/** ~90 ms por anchor, com piso e teto curtos: peça desliza, combate não trava. */
export const MOVEMENT_STEP_MS = 90;
export const MOVEMENT_MIN_MS = 120;
export const MOVEMENT_MAX_MS = 900;

/**
 * Truque óbvio de acessibilidade: quem pediu menos movimento não recebe
 * animação nenhuma (a posição autoritativa aparece direto).
 */
export function movementMotionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Traduz o trecho AUTORIZADO em um plano de animação.
 *
 * O caminho exibido é exatamente o do payload (o servidor só manda o que
 * aplicou; com Reação pendente é o checkpoint, nunca o resto do trajeto).
 */
export function planMovementVisual(input: {
  combatantId: string;
  from: SpatialPosition;
  path: readonly SpatialPosition[];
  to: SpatialPosition;
  size: SpatialSize;
  cellSizeFeet: number;
  pixelsPerCell: number;
}): MovementVisualPlan | null {
  const geometry = { cellSizeFeet: input.cellSizeFeet, pixelsPerCell: input.pixelsPerCell };
  const anchors: SpatialPosition[] = [input.from, ...input.path];
  const endIndex = anchors.findIndex(
    (anchor) => anchor.xFeet === input.to.xFeet && anchor.yFeet === input.to.yFeet,
  );
  const traversed = endIndex >= 0 ? anchors.slice(0, endIndex + 1) : [...anchors, input.to];
  if (traversed.length < 2) return null;

  const points = traversed.map((anchor) => ({
    left: feetToPx(anchor.xFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
    top: feetToPx(anchor.yFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
  }));

  const footprint = SIZE_FOOTPRINT_FEET[input.size] ?? SIZE_FOOTPRINT_FEET.medium;
  const width = feetToPx(
    footprint.widthFeet,
    geometry.cellSizeFeet,
    geometry.pixelsPerCell,
  );
  const height = feetToPx(
    footprint.heightFeet,
    geometry.cellSizeFeet,
    geometry.pixelsPerCell,
  );
  const steps = points.length - 1;
  const durationMs = Math.min(
    MOVEMENT_MAX_MS,
    Math.max(MOVEMENT_MIN_MS, steps * MOVEMENT_STEP_MS),
  );
  return { combatantId: input.combatantId, points, width, height, durationMs };
}

/** Posição interpolada ao longo do plano, por progresso linear (0..1). */
export function movementPointAt(plan: MovementVisualPlan, progress: number): {
  left: number;
  top: number;
} {
  const points = plan.points;
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index];
    return Math.abs(point.left - previous.left) + Math.abs(point.top - previous.top);
  });
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const clamped = Math.min(1, Math.max(0, progress));
  if (total <= 0) return points[points.length - 1];
  let remaining = clamped * total;
  let index = 0;
  while (index < lengths.length - 1 && remaining > lengths[index]) {
    remaining -= lengths[index];
    index += 1;
  }
  const ratio = lengths[index] === 0 ? 0 : Math.min(1, remaining / lengths[index]);
  const from = points[index];
  const to = points[index + 1] ?? from;
  return {
    left: from.left + (to.left - from.left) * ratio,
    top: from.top + (to.top - from.top) * ratio,
  };
}

/* -------------------------------------------------------------------------- */
/* BARRA DE EVENTOS (Socket.io → grid)                                         */
/* -------------------------------------------------------------------------- */

/**
 * O evento chega numa página (dono único do socket) e o grid pode estar longe
 * na árvore. Um barramento de módulo evita props atravessando a ficha inteira —
 * mesmo padrão já usado pelos eventos de conjuração.
 */
type MovementVisualListener = (payload: CombatMovementVisualPayload) => void;
const listeners = new Set<MovementVisualListener>();

export function publishMovementVisual(payload: CombatMovementVisualPayload): void {
  for (const listener of listeners) listener(payload);
}

export function subscribeMovementVisual(listener: MovementVisualListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */
/* HOOK                                                                        */
/* -------------------------------------------------------------------------- */

export interface MovementVisualState {
  visualRect: MovementVisualRect | null;
  /**
   * Executa o trecho. `operationId` deduplica: a mesma operação nunca anima
   * duas vezes (HTTP do operador + evento do socket, replay, reconnect).
   */
  play: (payload: CombatMovementVisualPayload, size: SpatialSize, geometry: {
    cellSizeFeet: number;
    pixelsPerCell: number;
  }) => void;
  cancel: () => void;
  /**
   * Chamado quando o estado autoritativo muda: se a versão recebida é a MESMA
   * da animação em curso, ela continua; se é outra (alguém mudou o combate no
   * meio), o estado novo vence e a animação para.
   */
  syncVersion: (version: number) => void;
}

export function useMovementVisual(): MovementVisualState {
  const [visualRect, setVisualRect] = useState<MovementVisualRect | null>(null);
  const frame = useRef(0);
  const animationVersion = useRef<number | null>(null);
  const playedOperations = useRef<Set<string>>(new Set());

  const cancel = (): void => {
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    animationVersion.current = null;
    setVisualRect(null);
  };

  const play: MovementVisualState['play'] = (payload, size, geometry) => {
    if (!movementMotionAllowed()) return;
    const key = `${payload.operationId}:${payload.from.xFeet},${payload.from.yFeet}->${payload.to.xFeet},${payload.to.yFeet}`;
    if (playedOperations.current.has(key)) return;
    playedOperations.current.add(key);
    // A memória de dedupe não precisa crescer sem limite numa sessão longa.
    if (playedOperations.current.size > 64) {
      const [oldest] = playedOperations.current;
      playedOperations.current.delete(oldest);
    }

    const plan = planMovementVisual({
      combatantId: payload.combatantId,
      from: payload.from,
      path: payload.path,
      to: payload.to,
      size,
      cellSizeFeet: geometry.cellSizeFeet,
      pixelsPerCell: geometry.pixelsPerCell,
    });
    if (!plan) return;

    window.cancelAnimationFrame(frame.current);
    animationVersion.current = payload.version;
    // A ORIGEM entra no mesmo lote de render: nenhum frame no destino antes de
    // começar a deslizar.
    setVisualRect({
      combatantId: plan.combatantId,
      left: plan.points[0].left,
      top: plan.points[0].top,
      width: plan.width,
      height: plan.height,
    });

    const startedAt = window.performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / plan.durationMs);
      const point = movementPointAt(plan, progress);
      setVisualRect({
        combatantId: plan.combatantId,
        left: point.left,
        top: point.top,
        width: plan.width,
        height: plan.height,
      });
      if (progress < 1) {
        frame.current = window.requestAnimationFrame(tick);
        return;
      }
      frame.current = 0;
      animationVersion.current = null;
      setVisualRect(null);
    };
    frame.current = window.requestAnimationFrame(tick);
  };

  const syncVersion = (version: number): void => {
    const current = animationVersion.current;
    if (current === null || current === version) return;
    cancel();
  };

  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);

  return { visualRect, play, cancel, syncVersion };
}
