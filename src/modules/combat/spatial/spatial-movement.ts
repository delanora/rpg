import { movementBlockedByWalls } from './movement-walls.js';
import type { SpatialObstacleShape } from './spatial-obstacle.js';
import { metersToFeet } from '../../shared/weapon-range.js';
import { occupiedSpaceOf, occupiedSpacesOverlap, spaceWithinScene } from './occupied-space.js';
import { alignmentStepFeet, anchorDistanceFeet, isGridAligned } from './spatial-distance.js';
import { effectiveSizeOf } from './spatial-size.js';
import {
  SPATIAL_SIZES,
  type SpatialPosition2D,
  type SpatialSceneConfig,
  type SpatialSize,
} from './spatial.types.js';
import type {
  MovementTerrainProvider,
  MovementTerrainStatus,
} from './movement-terrain.js';

/**
 * FASE 6.6L.3 — MOVIMENTO VOLUNTÁRIO (D&D 5e PHB 2014).
 *
 * Este módulo é PURO: recebe o caminho PRETENDIDO e o estado espacial, e deriva
 * legalidade, custo e dificuldade. Nenhum número de custo, distância, alcance,
 * deslocamento ou "pode passar" vem do cliente — a única entrada do jogador é a
 * sequência de posições (`MovementPath.steps`).
 *
 * REGRAS PHB 2014 preservadas aqui:
 *
 *  • O movimento NÃO é uma "Move Action" única: cada commit consome só o trecho
 *    pedido, então o mesmo turno pode mover → agir → mover de novo (e, no
 *    futuro, mover entre ataques de uma Attack Action). Este módulo nunca marca
 *    "movimento encerrado".
 *  • Cada pé andado pode custar 1, 2 ou 3 pés de recurso: base 1, +1 se
 *    ARRASTANDO-SE (Prone), +1 se o destino do passo é TERRENO DIFÍCIL.
 *    Crawling e difficult terrain são modificadores SEPARADOS e somam entre si.
 *  • Várias fontes de difficult terrain NÃO acumulam: o passo que cruza duas
 *    criaturas continua custando 2×, nunca 3×.
 *  • Espaço de OUTRA criatura é difficult terrain (aliada ou hostil).
 *  • Passar por criatura NÃO hostil é permitido.
 *  • Passar por criatura HOSTIL só é permitido com pelo menos DUAS categorias
 *    de tamanho de diferença (PHB 2014; a regra 2024 NÃO é usada aqui).
 *  • Terminar o movimento voluntário no espaço de outra criatura é proibido,
 *    qualquer que seja o lado ou o tamanho.
 *  • Relação de lado desconhecida NUNCA é adivinhada: o trajeto é recusado até
 *    o Mestre defini-la.
 *
 * O passo usa a granularidade do mover: Small+ anda de 5 em 5 pés (horizontal,
 * vertical e diagonal) e Tiny preserva 2,5 pés. Diagonal custa o mesmo que o
 * passo reto — nunca distância euclidiana.
 *
 * FORA DESTE MÓDULO (fases futuras): pathfinding (o servidor valida o caminho
 * recebido, não procura um), Opportunity Attack/Reaction, terreno ambiental
 * desenhado, squeezing geométrico, voo/natação/escalada e
 * movimento forçado (empurrão, Shove, teleporte, arrastar agarrão).
 */

/** Identidade auditável do algoritmo (mudar a regra muda isto). */
export const SPATIAL_MOVEMENT_ALGORITHM = 'phb-grid-movement-walls-v2';

/**
 * PHB 2014: 1,5 m = 5 pés. O motor de movimento trabalha em PÉS (unidade
 * espacial) e converte só na fronteira com a Action Economy, que é em metros.
 */
export const METERS_PER_FOOT = 0.3;

/** Pé → metro (fronteira com `turnEconomy`), sem ruído de ponto flutuante. */
export function feetToMeters(feet: number): number {
  return Math.round(feet * METERS_PER_FOOT * 100) / 100;
}

/**
 * 6.6M.3.1.4.3 — APRESENTAÇÃO em metros (PT-BR, vírgula decimal).
 *
 * O Obsyrium mostra distância em METROS; a regra (PHB 2014) e todos os campos
 * espaciais persistidos/DTO continuam em PÉS; a economia legada usa METROS.
 * Este formatter usa a MESMA conversão de `feetToMeters` (0,3 m por pé) — nada de segunda tabela — e só existe para o
 * texto do Registro de combate e das mensagens de deslocamento.
 */
export function formatMetersPtBr(feet: number): string {
  const text = feetToMeters(feet)
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',');
  return `${text} m`;
}

/** Movimento restante em PÉS derivado do orçamento em METROS da economia. */
export function remainingMovementFeet(
  budgetMeters: number,
  usedMeters: number,
): number {
  return metersToFeet(Math.max(0, budgetMeters - usedMeters));
}

/** Diferença de categorias exigida para atravessar criatura HOSTIL. */
export const HOSTILE_PASSAGE_SIZE_GAP = 2;

/** Ordem canônica de tamanho: Tiny 0 · Small 1 · Medium 2 … Gargantuan 5. */
export function sizeOrderOf(size: SpatialSize): number {
  const index = SPATIAL_SIZES.indexOf(size);
  return index < 0 ? 2 : index;
}

/** PHB 2014 (não 2024): hostil só é atravessável com ≥ 2 categorias de diferença. */
export function hostilePassageAllowed(
  mover: SpatialSize,
  occupant: SpatialSize,
): boolean {
  return Math.abs(sizeOrderOf(mover) - sizeOrderOf(occupant)) >= HOSTILE_PASSAGE_SIZE_GAP;
}

/** Relação mecânica entre dois lados do encontro. `null` nunca é adivinhado. */
export type MovementRelation = 'same' | 'hostile' | 'unknown';

export function movementRelationOf(
  moverSide: string | null,
  occupantSide: string | null,
): MovementRelation {
  // Neutros não são hostis ao grupo, mas enfrentam o lado hostil nos dois sentidos.
  if (moverSide === 'neutral' || occupantSide === 'neutral') {
    return moverSide === 'enemies' || occupantSide === 'enemies' ? 'hostile' : 'same';
  }
  if (!moverSide || !occupantSide) return 'unknown';
  return moverSide === occupantSide ? 'same' : 'hostile';
}

/** Normalização do lado: aparado, minúsculo e vazio = `null`. */
export function normalizeSideKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 40) : null;
}

/** Corpo de um participante do encontro para a avaliação de movimento. */
export interface MovementParticipant {
  combatantId: string;
  name: string;
  position: SpatialPosition2D | null;
  /** Tamanho EFETIVO (nunca o base da raça). */
  size: SpatialSize;
  /** Lado do ENCONTRO (`Combatant.sideKey`), já normalizado. */
  sideKey: string | null;
}

/** Motivos de recusa. O código é a identidade estável (a mensagem é exibição). */
export type MovementBlockerCode =
  | 'MOVEMENT_NOT_ASSESSED'
  | 'MOVEMENT_PLACEMENT_REQUIRED'
  | 'MOVEMENT_NOT_CANONICAL'
  | 'MOVEMENT_OUT_OF_BOUNDS'
  | 'MOVEMENT_STEP_NOT_CANONICAL'
  | 'MOVEMENT_STEP_NOT_CONTIGUOUS'
  | 'MOVEMENT_RELATION_UNKNOWN'
  | 'MOVEMENT_PATH_BLOCKED'
  | 'MOVEMENT_WALL_BLOCKED'
  | 'MOVEMENT_DESTINATION_OCCUPIED'
  | 'MOVEMENT_INSUFFICIENT_REMAINING'
  | 'MOVEMENT_SPEED_ZERO';

export type MovementDifficultSource = 'creature-space' | 'environmental';

/**
 * Breakdown auditável de UM passo.
 *
 * `passesThroughCombatantIds` é DIAGNÓSTICO do Mestre: quem vê como jogador
 * recebe a lista vazia (a identidade de criatura oculta nunca vaza).
 */
export interface MovementStepEvaluation {
  index: number;
  position: SpatialPosition2D;
  distanceFeet: number;
  costFeet: number;
  crawling: boolean;
  difficultTerrain: boolean;
  difficultTerrainSources: MovementDifficultSource[];
  passesThroughCombatantIds: string[];
}

export interface MovementEvaluationBlocker {
  code: MovementBlockerCode;
  stepIndex: number | null;
  combatantId: string | null;
  combatantName: string | null;
}

export interface MovementPathEvaluation {
  status: 'ok' | 'blocked' | 'not-assessed';
  /** Geometricamente legal (independente de haver movimento sobrando). */
  legal: boolean;
  /** Legal E pago pelo movimento restante. */
  affordable: boolean;
  movementMode: 'walking';
  totalDistanceFeet: number;
  totalCostFeet: number;
  movementRemainingFeet: number;
  destination: SpatialPosition2D | null;
  steps: MovementStepEvaluation[];
  blocker: MovementEvaluationBlocker | null;
  algorithm: typeof SPATIAL_MOVEMENT_ALGORITHM;
  reason: string | null;
}

export interface MovementEvaluationInput {
  scene: SpatialSceneConfig;
  mover: MovementParticipant;
  /** Todos os OUTROS combatentes colocados (a engine ignora os sem posição). */
  others: readonly MovementParticipant[];
  /** Primeiro passo é a primeira posição pretendida (não repete a atual). */
  path: readonly SpatialPosition2D[];
  /** Caído (Prone) → arrastar-se (crawling). Vem do motor de Conditions. */
  prone: boolean;
  movementRemainingFeet: number;
  /** Deslocamento EFETIVO zero (Agarrado/Contido/Exaustão 5+...). */
  speedZero?: boolean;
  terrain: MovementTerrainProvider;
  /** Geometria autoritativa da cena; ausência só existe em cenas legadas. */
  obstacles?: readonly SpatialObstacleShape[];
  /** `true` só para o Mestre: identidade do bloqueador no diagnóstico. */
  revealBlockers: boolean;
}

function precise(value: number): number {
  return Math.round(value * 100) / 100;
}

function blockerOf(
  code: MovementBlockerCode,
  stepIndex: number | null,
  occupant: MovementParticipant | null,
  reveal: boolean,
): MovementEvaluationBlocker {
  return {
    code,
    stepIndex,
    // Privacidade: para o jogador o bloqueador é ANÔNIMO (nunca id/nome).
    combatantId: reveal ? (occupant?.combatantId ?? null) : null,
    combatantName: reveal ? (occupant?.name ?? null) : null,
  };
}

function notAssessed(
  code: MovementBlockerCode,
  reason: string,
  movementRemainingFeet: number,
): MovementPathEvaluation {
  return {
    status: 'not-assessed',
    legal: false,
    affordable: false,
    movementMode: 'walking',
    totalDistanceFeet: 0,
    totalCostFeet: 0,
    movementRemainingFeet,
    destination: null,
    steps: [],
    blocker: { code, stepIndex: null, combatantId: null, combatantName: null },
    algorithm: SPATIAL_MOVEMENT_ALGORITHM,
    reason,
  };
}

/**
 * Avalia o caminho INTEIRO antes de qualquer escrita: um passo ilegal recusa o
 * segmento completo (nunca commit parcial). O caminho vazio é no-op (legal, sem
 * custo e sem destino) — quem chama decide não gravar nada.
 */
export function evaluateMovementPath(
  input: MovementEvaluationInput,
): MovementPathEvaluation {
  const { mover, scene, movementRemainingFeet: remaining } = input;

  if (scene.mode !== 'grid-2d') {
    return notAssessed('MOVEMENT_NOT_ASSESSED', 'assisted-mode', remaining);
  }
  if (!mover.position) {
    return notAssessed('MOVEMENT_PLACEMENT_REQUIRED', 'mover-unplaced', remaining);
  }
  if (!isGridAligned(mover.position, mover.size)) {
    return notAssessed('MOVEMENT_NOT_CANONICAL', 'mover-not-canonical', remaining);
  }
  if (input.path.length === 0) {
    return {
      status: 'ok',
      legal: true,
      affordable: true,
      movementMode: 'walking',
      totalDistanceFeet: 0,
      totalCostFeet: 0,
      movementRemainingFeet: remaining,
      destination: null,
      steps: [],
      blocker: null,
      algorithm: SPATIAL_MOVEMENT_ALGORITHM,
      reason: 'empty-path',
    };
  }

  // Deslocamento efetivo zero bloqueia movimento voluntário (PHB 2014). A
  // derivação vem de `effectiveSpeed` — aqui não há segunda conta de Speed.
  if (input.speedZero) {
    return {
      status: 'blocked',
      legal: false,
      affordable: false,
      movementMode: 'walking',
      totalDistanceFeet: 0,
      totalCostFeet: 0,
      movementRemainingFeet: remaining,
      destination: null,
      steps: [],
      blocker: {
        code: 'MOVEMENT_SPEED_ZERO',
        stepIndex: null,
        combatantId: null,
        combatantName: null,
      },
      algorithm: SPATIAL_MOVEMENT_ALGORITHM,
      reason: 'speed-zero',
    };
  }

  const stepSize = alignmentStepFeet(mover.size);
  const occupants = input.others.filter(
    (candidate) =>
      candidate.combatantId !== mover.combatantId && candidate.position !== null,
  );
  const steps: MovementStepEvaluation[] = [];
  let cursor = mover.position;
  let totalDistance = 0;
  let totalCost = 0;

  for (let index = 0; index < input.path.length; index += 1) {
    const position = input.path[index];
    const fail = (
      code: MovementBlockerCode,
      occupant: MovementParticipant | null = null,
    ): MovementPathEvaluation => ({
      status: 'blocked',
      legal: false,
      affordable: false,
      movementMode: 'walking',
      totalDistanceFeet: precise(totalDistance),
      totalCostFeet: precise(totalCost),
      movementRemainingFeet: remaining,
      destination: null,
      steps,
      blocker: blockerOf(code, index, occupant, input.revealBlockers),
      algorithm: SPATIAL_MOVEMENT_ALGORITHM,
      reason: code.toLowerCase(),
    });

    // 1. Grid canônico do mover (Small+ 5 pés · Tiny 2,5 pés).
    if (!isGridAligned(position, mover.size)) {
      return fail('MOVEMENT_STEP_NOT_CANONICAL');
    }

    // 2. Passo contíguo: delta por eixo 0 ou 1 passo, nunca teleporte.
    const deltaX = Math.abs(position.xFeet - cursor.xFeet);
    const deltaY = Math.abs(position.yFeet - cursor.yFeet);
    const axisOk = (delta: number) =>
      delta === 0 || Math.abs(delta - stepSize) < 1e-9;
    if (!axisOk(deltaX) || !axisOk(deltaY) || (deltaX === 0 && deltaY === 0)) {
      return fail('MOVEMENT_STEP_NOT_CONTIGUOUS');
    }

    // 3. Distância PHB-grid do passo (diagonal = mesmo custo do passo reto).
    const distanceFeet = anchorDistanceFeet(cursor, position);

    // 4. Espaço ocupado do passo precisa caber inteiro na cena.
    const space = occupiedSpaceOf(position, mover.size);
    if (!space || !spaceWithinScene(space, scene)) {
      return fail('MOVEMENT_OUT_OF_BOUNDS');
    }

    // Colisão no espaço varrido, não no centro nem apenas na posição final.
    if (movementBlockedByWalls(cursor, position, mover.size, input.obstacles ?? [])) {
      return fail('MOVEMENT_WALL_BLOCKED');
    }

    // 5. Quem é interceptado neste passo (overlap real de espaços ocupados).
    const overlapping = occupants.filter((occupant) => {
      const occupantSpace = occupiedSpaceOf(
        occupant.position,
        effectiveSizeOf(occupant.size),
      );
      return occupantSpace !== null && occupiedSpacesOverlap(space, occupantSpace);
    });

    // 6. Destino final: proibido terminar sobre QUALQUER outra criatura,
    //    independentemente de lado ou tamanho (PHB 2014).
    if (index === input.path.length - 1 && overlapping.length > 0) {
      return fail('MOVEMENT_DESTINATION_OCCUPIED', overlapping[0]);
    }

    // 7. Passagem intermediária: não hostil passa; hostil exige ≥ 2 tamanhos;
    //    relação desconhecida recusa (nunca assume aliado nem inimigo).
    for (const occupant of overlapping) {
      const relation = movementRelationOf(mover.sideKey, occupant.sideKey);
      if (relation === 'unknown') {
        return fail('MOVEMENT_RELATION_UNKNOWN', occupant);
      }
      if (
        relation === 'hostile' &&
        !hostilePassageAllowed(mover.size, effectiveSizeOf(occupant.size))
      ) {
        return fail('MOVEMENT_PATH_BLOCKED', occupant);
      }
    }

    // 8. Difficult terrain: qualquer fonte → +1 pé por pé. Fontes NÃO somam.
    const terrainStatus: MovementTerrainStatus = input.terrain.difficultAt(
      position,
      mover.size,
    );
    const difficultTerrainSources: MovementDifficultSource[] = [];
    if (overlapping.length > 0) difficultTerrainSources.push('creature-space');
    if (terrainStatus === 'difficult') difficultTerrainSources.push('environmental');
    const difficultTerrain = difficultTerrainSources.length > 0;

    // 9. Custo do passo: base + crawling (Prone) + difficult (uma vez cada).
    const crawling = input.prone;
    const costFeet = precise(
      distanceFeet * (1 + (crawling ? 1 : 0) + (difficultTerrain ? 1 : 0)),
    );

    steps.push({
      index,
      position: { xFeet: position.xFeet, yFeet: position.yFeet },
      distanceFeet,
      costFeet,
      crawling,
      difficultTerrain,
      difficultTerrainSources,
      passesThroughCombatantIds: input.revealBlockers
        ? overlapping.map((occupant) => occupant.combatantId)
        : [],
    });

    totalDistance = precise(totalDistance + distanceFeet);
    totalCost = precise(totalCost + costFeet);
    cursor = position;
  }

  return {
    status: 'ok',
    legal: true,
    // Fronteira inclusiva: gastar exatamente o movimento restante é válido.
    affordable: totalCost <= remaining + 1e-9,
    movementMode: 'walking',
    totalDistanceFeet: totalDistance,
    totalCostFeet: totalCost,
    movementRemainingFeet: remaining,
    destination: { xFeet: cursor.xFeet, yFeet: cursor.yFeet },
    steps,
    blocker: null,
    algorithm: SPATIAL_MOVEMENT_ALGORITHM,
    reason: null,
  };
}
