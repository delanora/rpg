import type {
  CombatantSpatial,
  CreatureSizeLabel,
  OccupiedSpace,
  SpatialPosition,
  SpatialSize,
} from '../../types';

/**
 * FASE 6.6M.1 — MATEMÁTICA DE RENDERIZAÇÃO DO GRID.
 *
 * Tudo aqui é PURO e SÓ de apresentação: converte PÉS (unidade canônica do
 * servidor) para pixels na tela. Nada deste arquivo altera posição, footprint
 * ou qualquer estado mecânico — `pixelsPerCell` nunca entra em request.
 *
 * Convenção herdada da 6.6L.1: `position` é a ÂNCORA (canto mínimo / top-left
 * lógico) do espaço ocupado, `x` cresce à direita e `y` para baixo.
 */

/** Footprint mecânico do PHB 2014 — ESPELHO do domínio do servidor. */
export const SIZE_FOOTPRINT_FEET: Readonly<
  Record<SpatialSize, { widthFeet: number; heightFeet: number }>
> = {
  tiny: { widthFeet: 2.5, heightFeet: 2.5 },
  small: { widthFeet: 5, heightFeet: 5 },
  medium: { widthFeet: 5, heightFeet: 5 },
  large: { widthFeet: 10, heightFeet: 10 },
  huge: { widthFeet: 15, heightFeet: 15 },
  gargantuan: { widthFeet: 20, heightFeet: 20 },
};

/**
 * Ordem canônica do PHB 2014 (menor → maior), usada nos seletores de cadastro.
 */
export const SPATIAL_SIZE_ORDER: readonly SpatialSize[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
];

/**
 * Tamanho canônico → RÓTULO persistido no cadastro de Creature (6.6L.1).
 * O seletor mostra PT-BR, mas envia este rótulo — o servidor valida o enum.
 */
export const CREATURE_SIZE_LABEL_BY_SPATIAL: Readonly<Record<SpatialSize, CreatureSizeLabel>> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};

/** Rótulos de exibição (tooltip/legenda), em PT-BR. */
export const SIZE_LABELS: Readonly<Record<SpatialSize, string>> = {
  tiny: 'Minúsculo',
  small: 'Pequeno',
  medium: 'Médio',
  large: 'Grande',
  huge: 'Enorme',
  gargantuan: 'Colossal',
};

/** Célula base (5 pés) do grid desta fase. */
export const BASE_CELL_SIZE_FEET = 5;

/** Sugestão de cena inicial (o backend tem o mesmo fallback 100×100). */
export const DEFAULT_SCENE_FEET = 100;

/** Zoom apenas visual (nunca mecânico). */
export const DEFAULT_PIXELS_PER_CELL = 44;
export const MIN_PIXELS_PER_CELL = 24;
export const MAX_PIXELS_PER_CELL = 88;

/** Passo de alinhamento do placement: 5 pés (2,5 pés para Tiny). */
export function snapStepFeet(size: SpatialSize): number {
  return size === 'tiny' ? 2.5 : BASE_CELL_SIZE_FEET;
}

/** Alinha uma coordenada em pés ao passo do tamanho, sem alterar a escala. */
export function snapFeet(feet: number, size: SpatialSize): number {
  const step = snapStepFeet(size);
  const snapped = Math.round(feet / step) * step;
  // Evita -0/ruído de ponto flutuante (ex.: 7.500000000000001).
  return Math.max(0, Math.round(snapped * 100) / 100);
}

/** Arredonda para baixo no passo (usado a partir do clique na célula). */
export function floorFeet(feet: number, size: SpatialSize): number {
  const step = snapStepFeet(size);
  return Math.max(0, Math.round(Math.floor(feet / step) * step * 100) / 100);
}

/**
 * FASE 6.6M.3.1.3 / 6.6M.4.1.3 — CÉLULA QUE CONTÉM o ponto (nunca a interseção
 * mais próxima), recebendo o ponteiro CRU.
 *
 * Usada para apontar casas na régua, hover e posicionamento. O arraste de
 * tokens tem outra entrada: `dragFootprintAt` preserva o ponto de pega antes
 * de alinhar a âncora, independentemente do tamanho da criatura.
 *
 * `Math.round` escolheria a célula vizinha antes de o ponteiro cruzar a borda;
 * aqui a âncora é o canto MÍNIMO da célula que contém o ponto (`floor`), o que
 * faz o destaque trocar exatamente na borda. Política de borda determinística:
 * o intervalo de uma célula é fechado à esquerda e aberto à direita, então o
 * ponto na borda direita/inferior já pertence à célula seguinte; um ponto
 * exatamente FORA da cena não seleciona célula nenhuma (nada de clamp visual).
 *
 * A célula também precisa caber o footprint: um token Grande não pode ser
 * ancorado na última coluna de 5 pés. Nesse caso devolve `null` — o chamador
 * mantém o destino anterior em vez de "empurrar" para a célula válida vizinha.
 *
 * Só apresentação/interação: nenhuma legalidade mecânica é decidida aqui.
 */
export function containingCellFeet(
  feet: SpatialPosition,
  size: SpatialSize,
  scene: { widthFeet: number; heightFeet: number },
): SpatialPosition | null {
  const step = snapStepFeet(size);
  if (!Number.isFinite(feet.xFeet) || !Number.isFinite(feet.yFeet)) return null;
  if (feet.xFeet < 0 || feet.yFeet < 0) return null;
  if (feet.xFeet >= scene.widthFeet || feet.yFeet >= scene.heightFeet) return null;
  const xFeet = floorFeet(feet.xFeet, size);
  const yFeet = floorFeet(feet.yFeet, size);
  const footprint = SIZE_FOOTPRINT_FEET[size];
  const maxX = Math.max(0, Math.round((scene.widthFeet - footprint.widthFeet) / step) * step);
  const maxY = Math.max(0, Math.round((scene.heightFeet - footprint.heightFeet) / step) * step);
  if (xFeet > maxX || yFeet > maxY) return null;
  return { xFeet, yFeet };
}

/**
 * 6.6M.3.1.4.3 — ÂNCORA do ghost a partir do HOTSPOT do ponteiro.
 *
 * O CENTRO do footprint fica exatamente sob o cursor: o ponto de pega do
 * clique (`grab`) NÃO sobrevive ao gesto, senão o ghost aparece deslocado do
 * mouse. A âncora continua sendo o canto mínimo (mesma convenção de
 * `position`), apenas recuada meia largura/altura — validada e clampada para
 * nunca sair da cena. Puro: nenhuma regra espacial é decidida aqui.
 */
export function centeredFootprintFeet(
  feet: SpatialPosition,
  size: SpatialSize,
  scene: { widthFeet: number; heightFeet: number },
): SpatialPosition {
  const footprint = SIZE_FOOTPRINT_FEET[size];
  const center = (value: number, span: number, max: number): number => {
    const anchored = value - span / 2;
    return Math.min(Math.max(0, anchored), Math.max(0, max - span));
  };
  return {
    xFeet: center(feet.xFeet, footprint.widthFeet, scene.widthFeet),
    yFeet: center(feet.yFeet, footprint.heightFeet, scene.heightFeet),
  };
}

/** Pés → pixels (somente rendering). */
export function feetToPx(feet: number, cellSizeFeet: number, pixelsPerCell: number): number {
  if (cellSizeFeet <= 0) return 0;
  return (feet / cellSizeFeet) * pixelsPerCell;
}

/** Dimensões em pixels da cena. */
export function scenePixels(
  scene: { widthFeet: number; heightFeet: number },
  cellSizeFeet: number,
  pixelsPerCell: number,
): { width: number; height: number } {
  return {
    width: feetToPx(scene.widthFeet, cellSizeFeet, pixelsPerCell),
    height: feetToPx(scene.heightFeet, cellSizeFeet, pixelsPerCell),
  };
}

/** Retângulo em PIXELS DE CENA (mesma origem 0,0 do plano, mesma escala). */
export interface SceneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 6.6M.4.1.4 — PROJEÇÃO CANÔNICA pés → pixels de cena.
 *
 * É a ÚNICA conversão usada pelos elementos espaciais (token, hover, destino,
 * ghost): mesma origem (canto 0,0 da cena) e mesma escala (`cellSizeFeet` e
 * `pixelsPerCell`). Nenhum elemento espacial faz a conta à mão em outro lugar —
 * projeções paralelas eram o que deixava highlight e footprint com 1–2 px de
 * diferença. Puro: nada aqui decide regra, footprint ou posição.
 */
export function spatialRectToScenePixels(
  rect: { xFeet: number; yFeet: number; widthFeet: number; heightFeet: number },
  cellSizeFeet: number,
  pixelsPerCell: number,
): SceneRect {
  return {
    left: feetToPx(rect.xFeet, cellSizeFeet, pixelsPerCell),
    top: feetToPx(rect.yFeet, cellSizeFeet, pixelsPerCell),
    width: feetToPx(rect.widthFeet, cellSizeFeet, pixelsPerCell),
    height: feetToPx(rect.heightFeet, cellSizeFeet, pixelsPerCell),
  };
}

/** Tamanho visual (px) de um espaço ocupado — sem arredondar Tiny para 1 célula. */
export function occupiedSpacePixels(
  space: OccupiedSpace,
  cellSizeFeet: number,
  pixelsPerCell: number,
): SceneRect {
  return spatialRectToScenePixels(
    {
      xFeet: space.minXFeet,
      yFeet: space.minYFeet,
      widthFeet: space.widthFeet,
      heightFeet: space.heightFeet,
    },
    cellSizeFeet,
    pixelsPerCell,
  );
}

/**
 * Espaço ocupado para RENDERIZAR. Usa o `occupiedSpace` autoritativo do DTO
 * quando existe; se a posição é nula, o combatente é UNPLACED e não tem
 * retângulo (nunca 0,0).
 */
export function renderRect(
  combatant: { spatial: CombatantSpatial | null },
  cellSizeFeet: number,
  pixelsPerCell: number,
): { left: number; top: number; width: number; height: number } | null {
  const space = combatant.spatial?.occupiedSpace;
  if (!space) return null;
  return occupiedSpacePixels(space, cellSizeFeet, pixelsPerCell);
}

/**
 * CÍRCULO INSCRITO no footprint (6.6M.4.1.4): diâmetro = menor lado do espaço
 * ocupado, sem inset.
 *
 * O "respiro" antigo (`min - até 8 px`) encolhia o token dentro da célula
 * (44 px → 36 px) e o retrato deixava de representar o footprint. A borda do
 * `.grid-token-art` usa `box-sizing: border-box`, então o aro cabe DENTRO deste
 * diâmetro e nenhum pixel é somado por fora.
 */
export function tokenArtSize(box: { width: number; height: number }): number {
  const min = Math.min(box.width, box.height);
  return Number.isFinite(min) && min > 0 ? min : 0;
}

/**
 * Combatentes VISÍVEIS no grid: o DTO já filtra os privados (`spatial: null`),
 * então o cliente NUNCA busca uma lista paralela. Aqui só separamos colocados
 * de não colocados.
 */
export function splitByPlacement<T extends { spatial: CombatantSpatial | null }>(
  combatants: T[],
): { placed: T[]; unplaced: T[] } {
  const placed: T[] = [];
  const unplaced: T[] = [];
  for (const combatant of combatants) {
    if (!combatant.spatial) continue;
    if (combatant.spatial.position) placed.push(combatant);
    else unplaced.push(combatant);
  }
  return { placed, unplaced };
}

/** Coordenada (px) → pés, já alinhada ao passo do tamanho escolhido. */
export function pixelToPlacementFeet(
  offsetPx: number,
  cellSizeFeet: number,
  pixelsPerCell: number,
  size: SpatialSize,
): number {
  if (pixelsPerCell <= 0) return 0;
  const feet = (offsetPx / pixelsPerCell) * cellSizeFeet;
  return floorFeet(feet, size);
}

/** Arraste em pés: conserva a pega e alinha o canto do token à grade mais próxima. */
export function dragFootprintAt(
  feet: SpatialPosition,
  grab: SpatialPosition,
  size: SpatialSize,
  scene: { widthFeet: number; heightFeet: number },
): { pointer: SpatialPosition; destination: SpatialPosition | null } {
  const anchor = { xFeet: feet.xFeet - grab.xFeet, yFeet: feet.yFeet - grab.yFeet };
  const step = snapStepFeet(size);
  const snapped = {
    xFeet: Math.round(anchor.xFeet / step) * step,
    yFeet: Math.round(anchor.yFeet / step) * step,
  };
  const footprint = SIZE_FOOTPRINT_FEET[size];
  // Só o desenho é contido na cena; destino inválido nunca vira movimento válido por clamp.
  const pointer = {
    xFeet: Math.max(0, Math.min(anchor.xFeet, scene.widthFeet - footprint.widthFeet)),
    yFeet: Math.max(0, Math.min(anchor.yFeet, scene.heightFeet - footprint.heightFeet)),
  };
  return { pointer, destination: containingCellFeet(snapped, size, scene) };
}
