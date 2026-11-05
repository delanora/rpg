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
import type { CombatSourced } from '../combat.dto.js';
import { parseStoredPosition } from './occupied-space.js';
import {
  spatialSceneOf,
  type SpatialPosition2D,
  type SpatialSceneConfig,
  type SpatialSize,
} from './spatial.types.js';
import {
  bodyDistanceFeet,
  evaluateSpatialDistance,
  spatialDistanceSnapshot,
  type SpatialBody,
  type SpatialDistanceEvaluation,
  type SpatialDistanceReason,
} from './spatial-distance.js';
import { evaluateRange, type RangeEvaluation } from './spatial-range.js';

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
      position: parseStoredPosition(combatant.spatialPosition),
      size: (combatant.baseSize ?? 'medium') as SpatialSize,
    };
    bodies.set(entityKey('combatant', combatant.id), body);
    if (combatant.characterId) bodies.set(entityKey('character', combatant.characterId), body);
    if (combatant.creatureId && creatureInstances.get(combatant.creatureId) === 1) {
      bodies.set(entityKey('creature', combatant.creatureId), body);
    }
  }
  return { combatId: combat.id, scene: spatialSceneOf(combat.spatialConfig), bodies };
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
  return bodyDistanceFeet(source, target);
}

/**
 * Provider de alcance do TARGETING de magia (6.6E), alimentado pelo índice.
 *
 * `clearPath`/`sight` geométricos continuam `unknown`: a 6.6L.2 NÃO implementa
 * linha de visão nem obstáculos. Alcance conhecido NÃO implica `canSee` nem
 * ausência de cobertura (Cover segue separado, na 6.6J.5).
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
    evaluateClearPath() {
      return 'unknown';
    },
    evaluateSightGeometry() {
      return 'unknown';
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
 * Quem pode ler a distância de um combatente?
 *
 * Criatura/NPC tem posição PRIVADA do Mestre (6.6L.1): para o jogador a resposta
 * é a mesma de "não colocado" — nunca um oráculo de existência/posição.
 */
function canReadDistance(actor: CombatActor, combat: CombatSourced, combatantId: string): boolean {
  if (actor.role === 'MASTER') return true;
  return combat.combatants.find((item) => item.id === combatantId)?.kind === 'CHARACTER';
}

export interface CombatDistanceReading {
  status: SpatialDistanceEvaluation['status'] | 'unknown';
  distanceFeet: number | null;
  provenance: 'grid-2d' | null;
  algorithm: string | null;
  reason: SpatialDistanceReason | 'not-visible' | null;
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
