import type { Size2D } from './gridCamera';

/**
 * FASE 6.6M.3.1.4.1 — LIFECYCLE DE ATIVAÇÃO DO GRID.
 *
 * O grid nasce `inactive` (cena assistida: nenhum viewport no DOM) e só passa a
 * aceitar interação quando o bootstrap terminou de verdade. É estado
 * EXCLUSIVAMENTE local: nada aqui vai ao banco, ao DTO ou a uma requisição — a
 * geometria mecânica continua vindo do servidor.
 *
 * • `inactive`     — Grid OFF: sem viewport, sem câmera, sem atalhos;
 * • `initializing` — ativado, mas falta dimensão real do viewport ou o
 *                    enquadramento ainda não foi aplicado. A cena fica oculta e
 *                    SEM interação (nada de nascer no canto e se "consertar");
 * • `ready`        — fit aplicado com viewport e cena válidos: pan, wheel,
 *                    régua, gesto do token e auto-pan valem imediatamente.
 */
export type GridPhase = 'inactive' | 'initializing' | 'ready';

/**
 * Deriva a fase a partir do estado observável.
 *
 * `cameraReady` só é `true` quando um enquadramento REAL foi calculado com
 * viewport > 0 — por isso viewport 0×0 (o grid recém-ativado, antes de o
 * ResizeObserver medir) nunca vira `ready`.
 */
export function gridPhaseOf(input: {
  active: boolean;
  viewport: Size2D;
  scene: Size2D;
  cameraReady: boolean;
}): GridPhase {
  if (!input.active) return 'inactive';
  const measurable = input.viewport.width > 0 && input.viewport.height > 0;
  const sceneSized = input.scene.width > 0 && input.scene.height > 0;
  return measurable && sceneSized && input.cameraReady ? 'ready' : 'initializing';
}
