import { METERS_PER_FOOT } from './combat/grid/distanceFormat';

/**
 * FASE 6.6M.4.1 — UNIDADES DA CENA.
 *
 * A ENGINE e o banco trabalham em PÉS (PHB 2014); a interface do Obsyrium fala
 * METROS. A conversão vive SÓ aqui: nenhum componente multiplica por fator
 * mágico nem divide por 3,28084.
 *
 * Fator canônico do projeto: 0,3 m por pé — 5 pés = 1,5 m exatos, 20 pés = 6 m,
 * 30 pés = 9 m. Reaproveita `METERS_PER_FOOT` da régua do combate para não
 * existirem DUAS verdades de conversão na mesma interface.
 */
export const SCENE_METERS_PER_FOOT = METERS_PER_FOOT;

/** Célula do grid (PÉS). Fixa nesta fase — o servidor também fixa 5. */
export const SCENE_CELL_FEET = 5;


/** Passo de arredondamento aceito pelo engine: 2,5 pés (Tiny) e 5 pés. */
const SNAP_FEET = 2.5;

const METERS_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Pés → metros, no mesmo arredondamento do formatador (0,75 / 1,5 / 9). */
export function feetToMeters(feet: number): number {
  if (!Number.isFinite(feet)) return 0;
  return Math.round(feet * SCENE_METERS_PER_FOOT * 100) / 100;
}

/**
 * Metros → pés. O valor digitado é SNAPADO para o passo que o engine aceita
 * (2,5 / 5 pés), então 6 m continua 20 pés e 4,5 m continua 15 pés. O limite
 * mínimo de cena (5 pés) é aplicado no formulário, não na conversão: converter
 * não é validar.
 */
export function metersToFeet(meters: number): number {
  if (!Number.isFinite(meters)) return 0;
  const feet = Math.round(meters / SCENE_METERS_PER_FOOT);
  return Math.max(0, Math.round(feet / SNAP_FEET) * SNAP_FEET);
}

/** "30 m" · "4,5 m" — sempre a partir de um valor do servidor EM PÉS. */
export function formatSceneMeters(feet: number): string {
  return `${METERS_FORMAT.format(feetToMeters(feet))} m`;
}

/** "100 pés" — leitura secundária, para o Mestre conferir o valor persistido. */
export function formatSceneFeet(feet: number): string {
  return `${METERS_FORMAT.format(feet)} pés`;
}

const SQUARES_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/**
 * Quadrados de `SCENE_CELL_FEET` contidos em uma dimensão em PÉS.
 *
 * Derivado SEMPRE da dimensão já snapada do engine (5 pés → 1, 20 → 4,
 * 100 → 20), nunca de pixels: a contagem da UI tem que ser a mesma que o
 * servidor usa em Movement, alcance e paredes.
 */
export function squaresInFeet(feet: number): number {
  if (!Number.isFinite(feet) || feet <= 0) return 0;
  return feet / SCENE_CELL_FEET;
}

/** Quadrados a partir do valor DIGITADO em metros (passa pelo snap canônico). */
export function squaresInMeters(meters: number): number {
  return squaresInFeet(metersToFeet(meters));
}

/** "20 quadrados de 1,5 m" — informação derivada, nunca input. */
export function gridSquaresLabel(feet: number): string {
  const squares = squaresInFeet(feet);
  const noun = squares === 1 ? 'quadrado' : 'quadrados';
  return `${SQUARES_FORMAT.format(squares)} ${noun} de ${formatSceneMeters(SCENE_CELL_FEET)}`;
}
