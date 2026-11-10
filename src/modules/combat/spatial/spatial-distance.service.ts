import { evaluateWallPath, evaluateWallSight } from './targeting-walls.js';
import { obstacleDtoOf, type SpatialObstacleShape } from './spatial-obstacle.js';
import { HttpError } from '../../../lib/http-error.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import type { SpatialProvider } from '../../spells/execution/spatial-validation.js';
import {
  assistedAreaSpatialProvider,
  type AreaSpatialProvider,
} from '../../spells/execution/area-spatial.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import type { CombatActor } from '../combat.service.js';
import { loadCombatById } from '../combat.service.js';
import { combatantAttacks, type CombatSourced } from '../combat.dto.js';
import { parseStoredPosition } from './occupied-space.js';
import {
  effectiveSceneConfigOf,
  type SpatialPosition2D,
  type SpatialSceneConfig,
  type SpatialSize,
} from './spatial.types.js';
import {
  SPATIAL_DISTANCE_ALGORITHM,
  bodyDistanceFeet,
  evaluateSpatialDistance,
  isMeasurePointCanonical,
  pointMeasureDistanceFeet,
  pointToBodyDistanceFeet,
  spatialDistanceSnapshot,
  type SpatialBody,
  type SpatialDistanceEvaluation,
  type SpatialDistanceReason,
} from './spatial-distance.js';
import { evaluateRange, type RangeEvaluation } from './spatial-range.js';
import { isSpatiallyVisible } from './spatial-visibility.js';

/**
 * FASE 6.6L.2 — DISTANCE + RANGE PROVIDER (SERVER-AUTHORITATIVE).
 *
 * Traduz o estado espacial persistido (6.6L.1) em distância/alcance para os
 * pipelines REAIS de ataque e magia, e para a leitura de UI da 6.6M.2.
 *
 * Três invariantes:
 *  • a posição vem SEMPRE da INSTÂNCIA do combate (nunca da ficha/template);
 *  • combatente de personagem e a ficha são a MESMA unidade espacial (o alvo
 *    canônico do `loadEntity` continua valendo — nada de contar duas vezes);
 *  • nenhum número é cacheado entre operações: a distância é derivada do estado
 *    atual a cada leitura (movimento/reposicionamento mudam a resposta).
 */

/** Corpo espacial de uma entidade NO COMBATE (posição + tamanho efetivo). */
export interface CombatSpatialIndex {
  combatId: string;
  scene: SpatialSceneConfig;
  bodies: Map<string, SpatialBody>;
  obstacles?: readonly SpatialObstacleShape[] | null;
}

function entityKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Constrói o índice espacial do combate (o combate já vem carregado: nenhuma
 * consulta extra por entidade).
 *
 * Além do id do COMBATENTE, aceita a chave da FICHA (`character:<id>`), porque
 * `loadEntity` canonicaliza combatente de personagem para a ficha. Criatura é
 * mapeada para o TEMPLATE apenas quando existe UMA instância no combate: com
 * duas cópias do mesmo Goblin, "a criatura X" é ambígua e vira `unknown` — nunca
 * a posição de uma cópia escolhida ao acaso.
 */
export function combatSpatialIndex(combat: CombatSourced): CombatSpatialIndex {
  const bodies = new Map<string, SpatialBody>();
  const creatureInstances = new Map<string, number>();
  for (const combatant of combat.combatants) {
    if (combatant.creatureId) {
      creatureInstances.set(
        combatant.creatureId,
        (creatureInstances.get(combatant.creatureId) ?? 0) + 1,
      );
    }
  }
  for (const combatant of combat.combatants) {
    const body: SpatialBody = {
      elevationFeet: combatant.elevationFeet,
      bodyHeightFeet: combatant.bodyHeightFeet,
      position: parseStoredPosition(combatant.spatialPosition),
      size: (combatant.baseSize ?? 'medium') as SpatialSize,
    };
    bodies.set(entityKey('combatant', combatant.id), body);
    if (combatant.characterId) bodies.set(entityKey('character', combatant.characterId), body);
    if (combatant.creatureId && creatureInstances.get(combatant.creatureId) === 1) {
      bodies.set(entityKey('creature', combatant.creatureId), body);
    }
  }
  return { combatId: combat.id, scene: effectiveSceneConfigOf(combat), bodies,
    obstacles: combat.scene ? combat.scene.obstacles?.map(obstacleDtoOf) ?? null : [] };
}

/**
 * Índice do combate por id. `null` quando não há combate/contexto — e aí todo
 * mundo cai no comportamento assistido de antes (nunca FAIL por falta de grid).
 */
export async function combatSpatialIndexById(
  db: Prisma.TransactionClient,
  combatId: string | null,
): Promise<CombatSpatialIndex | null> {
  if (!combatId) return null;
  const combat = await loadCombatById(combatId, db).catch(() => null);
  return combat ? combatSpatialIndex(combat) : null;
}

/** Corpo espacial de uma entidade no índice (`null` = fora do combate). */
export function spatialBodyOf(
  index: CombatSpatialIndex,
  entity: { kind: string; id: string },
): SpatialBody | null {
  return index.bodies.get(entityKey(entity.kind, entity.id)) ?? null;
}

/**
 * Distância entre duas entidades do combate.
 *
 * Mesma entidade → 0 pé (fato geométrico, não "entidade desconhecida").
 * Entidade ausente do índice → `unknown` com motivo (`*-not-in-combat`): nunca
 * 0 pé e nunca falha automática.
 */
export function evaluateEntityDistance(
  index: CombatSpatialIndex | null,
  source: { kind: string; id: string },
  target: { kind: string; id: string },
): SpatialDistanceEvaluation {
  if (!index) return { status: 'not-assessed', reason: 'assisted-mode' };
  const same = source.kind === target.kind && source.id === target.id;
  if (same) {
    if (index.scene.mode !== 'grid-2d') {
      return { status: 'not-assessed', reason: 'assisted-mode' };
    }
    return {
      status: 'known',
      distanceFeet: 0,
      provenance: 'grid-2d',
      algorithm: 'phb-grid-footprint-v1',
    };
  }
  const sourceBody = spatialBodyOf(index, source);
  if (!sourceBody) return { status: 'unknown', reason: 'source-not-in-combat' };
  const targetBody = spatialBodyOf(index, target);
  if (!targetBody) return { status: 'unknown', reason: 'target-not-in-combat' };
  return evaluateSpatialDistance(index.scene, sourceBody, targetBody);
}

/** Distância bruta (pés) entre dois corpos — derivação interna. */
export function bodiesDistanceFeet(
  scene: SpatialSceneConfig,
  source: SpatialBody,
  target: SpatialBody,
): number | null {
  if (scene.mode !== 'grid-2d') return null;
  const evaluation = evaluateSpatialDistance(scene, source, target);
  return evaluation.status === 'known' ? evaluation.distanceFeet : null;
}

/**
 * Provider de alcance do TARGETING de magia (6.6E), alimentado pelo índice.
 *
 * Caminho livre e visão consideram suas flags independentes nas paredes
 * carregadas. Obstruções parciais continuam assistidas. Alcance conhecido não implica
 * visão nem ausência de meia cobertura ou três quartos.
 */
export function gridSpatialProvider(index: CombatSpatialIndex | null): SpatialProvider {
  return {
    evaluateRange(caster, target, rangeFeet) {
      if (caster.kind === target.kind && caster.id === target.id) return 'pass';
      if (rangeFeet === null) return 'pass';
      const distance = evaluateEntityDistance(index, caster, target);
      if (distance.status !== 'known') return 'unknown';
      return distance.distanceFeet <= rangeFeet ? 'pass' : 'fail';
    },
    evaluateClearPath(caster, target) {
      if (!index) return 'unknown';
      return evaluateWallPath(index.scene, spatialBodyOf(index, caster), spatialBodyOf(index, target), index.obstacles).result;
    },
    evaluateSightGeometry(caster, target) {
      if (caster.kind === target.kind && caster.id === target.id) return 'pass';
      if (!index) return 'unknown';
      return evaluateWallSight(index.scene, spatialBodyOf(index, caster), spatialBodyOf(index, target), index.obstacles).result;
    },
    evaluateGroupDistance(_caster, targets, feet) {
      if (targets.length <= 1) return 'pass';
      if (!index) return 'unknown';
      for (let i = 0; i < targets.length; i += 1) {
        for (let j = i + 1; j < targets.length; j += 1) {
          const distance = evaluateEntityDistance(index, targets[i], targets[j]);
          if (distance.status !== 'known') return 'unknown';
          if (distance.distanceFeet > feet) return 'fail';
        }
      }
      return 'pass';
    },
  };
}

/**
 * Provider de ÁREA com alcance até a ORIGEM resolvida (6.6J.3).
 *
 * Só o ALCANCE da origem ganha autoridade de distância. Forma, membership,
 * obstrução e direção continuam no provider ASSISTIDO — membership geométrica é
 * da 6.6L.6, nunca desta fase. Por isso `mode` permanece `assisted`: parte dos
 * fatos ainda depende do Mestre.
 */
export function gridAreaSpatialProvider(index: CombatSpatialIndex | null): AreaSpatialProvider {
  return {
    ...assistedAreaSpatialProvider,
    mode: 'assisted',
    evaluateOriginRange(caster, resolved, origin) {
      if (!resolved) return 'unknown';
      if (caster.kind === resolved.kind && caster.id === resolved.id) return 'pass';
      if (origin.kind !== 'point') return 'unknown';
      const distance = evaluateEntityDistance(index, caster, resolved);
      if (distance.status !== 'known') return 'unknown';
      return distance.distanceFeet <= origin.rangeFeet ? 'pass' : 'fail';
    },
  };
}

/**
 * Quem pode ler a distância de um combatente? (6.6L.3.2)
 *
 * A política é `spatialVisibility`, NÃO o tipo da entidade: um NPC/criatura
 * público participa da consulta normalmente, e um combatente `master-only`
 * (personagem inclusive) responde como "não visível" — nunca um oráculo de
 * existência/posição. Nada de distância, faixa ou identidade oculta.
 */
function canReadDistance(actor: CombatActor, combat: CombatSourced, combatantId: string): boolean {
  if (actor.role === 'MASTER') return true;
  const combatant = combat.combatants.find((item) => item.id === combatantId);
  return combatant ? isSpatiallyVisible(combatant.spatialVisibility) : false;
}

export interface CombatDistanceReading {
  status: SpatialDistanceEvaluation['status'] | 'unknown';
  distanceFeet: number | null;
  provenance: 'grid-2d' | null;
  algorithm: string | null;
  reason: SpatialDistanceReason | 'not-visible' | 'point-not-canonical' | null;
}

const HIDDEN_READING: CombatDistanceReading = {
  status: 'unknown',
  distanceFeet: null,
  provenance: null,
  algorithm: null,
  reason: 'not-visible',
};

/**
 * LEITURA de distância (a 6.6M.2 consumirá isto). É INFORMAÇÃO, nunca autoridade
 * de targeting: ataque e magia recalculam no servidor na execução.
 */
export async function readCombatDistance(
  actor: CombatActor,
  combatId: string,
  fromCombatantId: string,
  toCombatantId: string,
): Promise<{ distance: CombatDistanceReading }> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  const from = combat.combatants.find((item) => item.id === fromCombatantId);
  const to = combat.combatants.find((item) => item.id === toCombatantId);
  if (!from || !to) throw new HttpError('Combatente não encontrado neste combate.', 404);
  if (!canReadDistance(actor, combat, from.id) || !canReadDistance(actor, combat, to.id)) {
    return { distance: HIDDEN_READING };
  }
  const index = combatSpatialIndex(combat);
  const evaluation = evaluateEntityDistance(
    index,
    { kind: 'combatant', id: from.id },
    { kind: 'combatant', id: to.id },
  );
  const snapshot = spatialDistanceSnapshot(evaluation);
  return {
    distance: {
      status: snapshot.status,
      distanceFeet: snapshot.distanceFeet,
      provenance: snapshot.provenance,
      algorithm: snapshot.algorithm,
      reason: snapshot.reason as CombatDistanceReading['reason'],
    },
  };
}

/**
 * FASE 6.6M.3.1 — LEITURA da RÉGUA (ponto ↔ ponto / ponto ↔ combatente).
 *
 * Substitui o fluxo token→token da 6.6M.2 sem criar segundo algoritmo: ponto é
 * uma âncora de grid e o MESMO `max(|dx|,|dy|)` roda aqui. O que muda é a
 * entrada (um ponto qualquer alinhado) e a distância contra FOOTPRINT, nunca
 * contra "centro do token".
 *
 * Privacidade: um extremo em combatente oculto devolve a leitura inteira oculta
 * (`not-visible`) — o jogador não consegue medir via id de `master-only` e
 * portanto não existe oráculo de posição. Ponto→ponto é público por natureza.
 */
export type CombatMeasureEndpoint =
  | { kind: 'point'; position: SpatialPosition2D }
  | { kind: 'combatant'; combatantId: string };

type ResolvedMeasureEndpoint =
  | { kind: 'point'; position: SpatialPosition2D }
  | { kind: 'body'; body: SpatialBody }
  | { kind: 'hidden' };

function unknownReading(
  reason: CombatDistanceReading['reason'],
): CombatDistanceReading {
  return { status: 'unknown', distanceFeet: null, provenance: null, algorithm: null, reason };
}

function resolveMeasureEndpoint(
  actor: CombatActor,
  combat: CombatSourced,
  endpoint: CombatMeasureEndpoint,
): ResolvedMeasureEndpoint {
  if (endpoint.kind === 'point') return { kind: 'point', position: endpoint.position };
  const combatant = combat.combatants.find((item) => item.id === endpoint.combatantId);
  if (!combatant) throw new HttpError('Combatente não encontrado neste combate.', 404);
  if (!canReadDistance(actor, combat, combatant.id)) return { kind: 'hidden' };
  return {
    kind: 'body',
    body: {
      position: parseStoredPosition(combatant.spatialPosition),
      size: (combatant.baseSize ?? 'medium') as SpatialSize,
    },
  };
}

export async function readCombatMeasure(
  actor: CombatActor,
  combatId: string,
  from: CombatMeasureEndpoint,
  to: CombatMeasureEndpoint,
): Promise<{ distance: CombatDistanceReading }> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  const scene = effectiveSceneConfigOf(combat);
  if (scene.mode !== 'grid-2d') {
    return { distance: { ...unknownReading('assisted-mode'), status: 'not-assessed' } };
  }

  const fromResolved = resolveMeasureEndpoint(actor, combat, from);
  const toResolved = resolveMeasureEndpoint(actor, combat, to);
  if (fromResolved.kind === 'hidden' || toResolved.kind === 'hidden') {
    return { distance: { ...HIDDEN_READING } };
  }

  if (fromResolved.kind === 'point' && !isMeasurePointCanonical(fromResolved.position)) {
    return { distance: unknownReading('point-not-canonical') };
  }
  if (toResolved.kind === 'point' && !isMeasurePointCanonical(toResolved.position)) {
    return { distance: unknownReading('point-not-canonical') };
  }

  let feet: number | null = null;
  if (fromResolved.kind === 'point' && toResolved.kind === 'point') {
    feet = pointMeasureDistanceFeet(fromResolved.position, toResolved.position);
  } else if (fromResolved.kind === 'point' && toResolved.kind === 'body') {
    feet = pointToBodyDistanceFeet(fromResolved.position, toResolved.body);
  } else if (fromResolved.kind === 'body' && toResolved.kind === 'point') {
    feet = pointToBodyDistanceFeet(toResolved.position, fromResolved.body);
  } else if (fromResolved.kind === 'body' && toResolved.kind === 'body') {
    const evaluation = evaluateSpatialDistance(scene, fromResolved.body, toResolved.body);
    return { distance: spatialDistanceSnapshot(evaluation) as CombatDistanceReading };
  }

  if (feet === null) {
    return { distance: unknownReading(from.kind === 'point' ? 'target-unplaced' : 'source-unplaced') };
  }
  return {
    distance: {
      status: 'known',
      distanceFeet: feet,
      provenance: 'grid-2d',
      algorithm: SPATIAL_DISTANCE_ALGORITHM,
      reason: null,
    },
  };
}

/** Alcance de uma entidade contra outra, a partir dos corpos do índice. */
export function evaluateEntityRange(
  index: CombatSpatialIndex | null,
  source: { kind: string; id: string },
  target: { kind: string; id: string },
  range: {
    reachFeet?: number | null;
    normalRangeFeet?: number | null;
    longRangeFeet?: number | null;
  },
): RangeEvaluation {
  return evaluateRange({
    distance: evaluateEntityDistance(index, source, target),
    ...range,
  });
}

/**
 * Leitura SANITIZADA de alcance para a UI (6.6M.2).
 *
 * `actionName` é o rótulo da ação que o SERVIDOR resolveu a partir do id
 * estável — nunca o alcance enviado pelo cliente. Alvo não autorizado devolve a
 * leitura inteira oculta (sem distância, faixa, nome ou referência de ação).
 */
export interface CombatRangeReading {
  status: RangeEvaluation['status'];
  distanceFeet: number | null;
  band: RangeEvaluation['band'];
  reachFeet: number | null;
  normalRangeFeet: number | null;
  longRangeFeet: number | null;
  algorithm: string | null;
  actionName: string | null;
  reason: string | null;
}

const HIDDEN_RANGE_READING: CombatRangeReading = {
  status: 'unknown',
  distanceFeet: null,
  band: null,
  reachFeet: null,
  normalRangeFeet: null,
  longRangeFeet: null,
  algorithm: null,
  actionName: null,
  reason: 'not-visible',
};

/**
 * LEITURA de alcance (6.6M.2): a UI nunca decide `distância <= alcance`.
 *
 * O cliente manda só a referência ESTÁVEL da ação que ele já usa no ataque
 * (`weapon:<itemId>`, `thrown:<itemId>`, `offhand:<itemId>`, `unarmed`, id de
 * ataque legado da ficha/criatura). Reach/normal/longo saem do dado estruturado
 * do SERVIDOR; distância, faixa e desvantagem vêm da MESMA `evaluateRange` da
 * execução. Nada é gasto: é leitura pura (sem Ação, espaço, munição ou versão).
 */
export async function readCombatRangePreview(
  actor: CombatActor,
  combatId: string,
  fromCombatantId: string,
  toCombatantId: string,
  attackId: string,
): Promise<{ range: CombatRangeReading }> {
  const combat = await loadCombatById(combatId).catch(() => null);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  const from = combat.combatants.find((item) => item.id === fromCombatantId);
  const to = combat.combatants.find((item) => item.id === toCombatantId);
  if (!from || !to) throw new HttpError('Combatente não encontrado neste combate.', 404);
  // MESMA política da distância: o que o jogador não pode ler fica oculto.
  if (!canReadDistance(actor, combat, from.id) || !canReadDistance(actor, combat, to.id)) {
    return { range: HIDDEN_RANGE_READING };
  }
  const attack = combatantAttacks(from).find((item) => item.id === attackId);
  if (!attack) {
    throw new HttpError(
      'Ataque não encontrado nesta ficha ou criatura.',
      404,
      'ATTACK_NOT_FOUND',
    );
  }
  const evaluation = evaluateEntityRange(
    combatSpatialIndex(combat),
    { kind: 'combatant', id: from.id },
    { kind: 'combatant', id: to.id },
    {
      reachFeet: attack.reachFeet ?? null,
      normalRangeFeet: attack.normalRangeFeet ?? null,
      longRangeFeet: attack.longRangeFeet ?? null,
    },
  );
  return {
    range: {
      status: evaluation.status,
      distanceFeet: evaluation.distanceFeet,
      band: evaluation.band,
      reachFeet: evaluation.reachFeet,
      normalRangeFeet: evaluation.normalRangeFeet,
      longRangeFeet: evaluation.longRangeFeet,
      algorithm: evaluation.algorithm,
      actionName: attack.name,
      reason: evaluation.reason,
    },
  };
}

/** Corpo de uma entidade (`null` quando não está no combate). */
export function bodyForEntity(
  index: CombatSpatialIndex | null,
  entity: MechanicalEntity,
): SpatialBody | null {
  return index ? spatialBodyOf(index, entity) : null;
}

/** Posição da entidade (derivação interna — nunca DTO público). */
export function positionForEntity(
  index: CombatSpatialIndex | null,
  entity: MechanicalEntity,
): SpatialPosition2D | null {
  return bodyForEntity(index, entity)?.position ?? null;
}
