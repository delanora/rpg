import type { Prisma } from '@prisma/client';
import { HttpError } from '../../../lib/http-error.js';
import { loadEntity, type LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import {
  isConfirmed,
  type SpatialConfirmation,
  type SpatialRequirementKind,
} from './spatial-validation.js';
import {
  originInclusionPolicyOf,
  validateAreaPlacement,
  type AreaPlacement,
  type AreaTargetingDefinition,
} from './area-targeting.js';
import {
  areaCandidateEvaluation,
  applyAreaDecisions,
  assertAreaDecisionsValid,
  assertAreaResolutionComplete,
  canonicalTargetKey,
  sortAreaCandidates,
  type AreaCandidateEvaluation,
  type AreaUnknownDecision,
} from './area-evaluation.js';
import {
  assistedAreaSpatialProvider,
  sameAreaEntity,
  type AreaResolvedOrigin,
  type AreaSpatialProvider,
} from './area-spatial.js';
import type { AreaTargetingSnapshot } from './area-snapshot.js';

/**
 * FASE 6.6J.3 — RESOLVEDOR DE ÁREA.
 *
 * Responsabilidades (e SÓ elas):
 *  • enumerar os CANDIDATOS reais da cena (instâncias do combate, nunca o
 *    template solto do bestiário);
 *  • validar a colocação contra a definição (forma/origem/direção/inclusão);
 *  • perguntar ao provider espacial `pass`/`fail`/`unknown` por candidato;
 *  • aplicar as decisões do Mestre APENAS em `unknown`;
 *  • devolver os alvos afetados + o snapshot imutável.
 *
 * NÃO rola dados, NÃO cria salvaguardas, NÃO mexe em HP e NÃO conhece nome de
 * magia. A criação das pendências continua no pipeline de conjuração (6.6J.2).
 */

export interface AreaResolution {
  snapshot: AreaTargetingSnapshot;
  affected: LoadedEntity[];
  /** `unknown` que o Mestre precisa decidir (vazio quando tudo é conhecido). */
  requiredDecisions: string[];
  /** Fatos da ORIGEM que o Mestre precisa confirmar (range/sight/origin). */
  requiredConfirmations: SpatialRequirementKind[];
}

export interface ResolveAreaInput {
  db: Prisma.TransactionClient;
  targeting: AreaTargetingDefinition;
  placement: AreaPlacement;
  caster: LoadedEntity;
  /** Contexto de combate ATIVO; fora dele não há candidatos enumeráveis. */
  combatId: string | null;
  castAtLevel: number;
  provider?: AreaSpatialProvider;
  confirmation?: SpatialConfirmation;
  decisions?: readonly AreaUnknownDecision[];
  /**
   * `true` = não falhar com `unknown`/`incomplete`; devolver o que falta para o
   * Mestre (fluxo de INTENÇÃO). `fail` autoritativo continua rejeitando sempre.
   */
  deferUnknown?: boolean;
}

function fail(message: string, code: string, details?: Record<string, unknown>): never {
  throw new HttpError(message, 409, code, details);
}

/**
 * CANDIDATOS da cena.
 *
 * Em combate ativo: as INSTÂNCIAS de combatente (personagem → ficha, criatura →
 * instância). Fora do combate não existe roster espacial autoritativo — o
 * resolvedor recusa em vez de assumir "zero alvos".
 */
export async function areaCandidatesFor(
  db: Prisma.TransactionClient,
  combatId: string | null,
): Promise<LoadedEntity[]> {
  if (!combatId) {
    throw new HttpError(
      'Não há combate ativo para enumerar as criaturas de uma área.',
      409,
      'AREA_CONTEXT_UNSUPPORTED',
    );
  }
  const combat = await db.combat.findUnique({
    where: { id: combatId },
    select: { status: true, combatants: { select: { id: true } } },
  });
  if (!combat || combat.status === 'ENDED') {
    throw new HttpError(
      'O combate desta área não está ativo.',
      409,
      'AREA_CONTEXT_UNSUPPORTED',
    );
  }
  const loaded: LoadedEntity[] = [];
  for (const combatant of combat.combatants) {
    // Combatente de personagem é canonicalizado para a FICHA pelo `loadEntity`;
    // criatura/NPC mantém a INSTÂNCIA (cópias do mesmo template não colapsam).
    const entity = await loadEntity({ kind: 'combatant', id: combatant.id }, db).catch(
      () => null,
    );
    if (entity) loaded.push(entity);
  }
  const byKey = new Map<string, LoadedEntity>();
  for (const item of loaded) {
    byKey.set(canonicalTargetKey(item.entity.kind, item.entity.id), item);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, item]) => item);
}

function resolverProvider(provider: AreaSpatialProvider | undefined): AreaSpatialProvider {
  return provider ?? assistedAreaSpatialProvider;
}

function originDefinitionSnapshot(targeting: AreaTargetingDefinition) {
  return {
    kind: targeting.origin.kind,
    rangeFeet: targeting.origin.kind === 'point' ? targeting.origin.rangeFeet : null,
    requiresSight: targeting.origin.kind === 'point' ? targeting.origin.requiresSight : false,
  };
}

function requestedOriginRef(placement: AreaPlacement): AreaResolvedOrigin['requested'] {
  return placement.requestedOrigin.kind === 'self'
    ? { kind: 'self' }
    : { kind: 'entity', entity: placement.requestedOrigin.entity };
}

/**
 * Resolve a ÁREA (read-only). Chamado no VALIDATE e revalidado no COMMIT —
 * nunca reaproveitar um conjunto de alvos calculado "alguns segundos antes".
 */
export async function resolveAreaTargets(input: ResolveAreaInput): Promise<AreaResolution> {
  const { targeting, placement, caster, db } = input;
  const provider = resolverProvider(input.provider);
  const deferUnknown = input.deferUnknown === true;
  const shape = targeting.area.shape;
  const policy = originInclusionPolicyOf(shape);

  validateAreaPlacement(targeting, placement);

  // Origem `self` não aceita âncora de outra criatura: a regra é da FORMA, não
  // do cliente.
  if (
    targeting.origin.kind === 'self' &&
    placement.requestedOrigin.kind === 'entity' &&
    !sameAreaEntity(placement.requestedOrigin.entity, caster.entity)
  ) {
    throw new HttpError(
      'A origem desta forma de área é o próprio conjurador.',
      400,
      'AREA_ORIGIN_INVALID',
    );
  }

  const requested = requestedOriginRef(placement);
  const resolvedOrigin = provider.resolveOrigin({
    caster: caster.entity,
    origin: targeting.origin,
    requested,
    shape,
  });

  const requiredConfirmations: SpatialRequirementKind[] = [];
  const missingConfirmations: { kind: SpatialRequirementKind; code: string }[] = [];
  const originFact = (result: string, kind: SpatialRequirementKind, failCode: string, requiredCode: string) => {
    if (result === 'fail') fail('A origem da área não satisfaz esta magia.', failCode);
    if (result === 'pass') return;
    if (!isConfirmed(input.confirmation, kind)) {
      missingConfirmations.push({ kind, code: requiredCode });
      return;
    }
  };
  originFact(
    resolvedOrigin.result,
    'origin',
    'AREA_ORIGIN_INVALID',
    'AREA_ORIGIN_CONFIRMATION_REQUIRED',
  );
  const rangeResult = provider.evaluateOriginRange(
    caster.entity,
    resolvedOrigin.resolved,
    targeting.origin,
  );
  originFact(rangeResult, 'range', 'AREA_ORIGIN_OUT_OF_RANGE', 'AREAS_ORIGIN_RANGE_CONFIRMATION_REQUIRED');
  const sightResult =
    targeting.origin.kind === 'point' && targeting.origin.requiresSight
      ? provider.evaluateOriginSight(caster.entity, resolvedOrigin.resolved, targeting.origin)
      : 'pass';
  originFact(sightResult, 'sight', 'AREA_ORIGIN_NOT_VISIBLE', 'AREA_ORIGIN_SIGHT_CONFIRMATION_REQUIRED');

  if (missingConfirmations.length > 0 && !deferUnknown) {
    throw new HttpError(
      'Falta a confirmação espacial do Mestre para a origem desta área.',
      409,
      missingConfirmations[0].code,
      { required: missingConfirmations.map((item) => item.kind) },
    );
  }
  requiredConfirmations.push(...missingConfirmations.map((item) => item.kind));

  // Direção: só é REQUISITO para cone/linha; nas demais é ignorada.
  const direction =
    placement.direction !== undefined
      ? {
          kind: 'toward-entity' as const,
          target: placement.direction.entity,
        }
      : null;
  if (direction && resolvedOrigin.resolved && sameAreaEntity(direction.target, resolvedOrigin.resolved)) {
    throw new HttpError(
      'A direção da área precisa apontar para longe da origem.',
      400,
      'AREA_DIRECTION_INVALID',
    );
  }

  const includeOrigin =
    policy === 'included' ? true : policy === 'excluded' ? false : placement.includeOrigin === true;

  const candidates = await areaCandidatesFor(db, input.combatId);
  const evaluations: AreaCandidateEvaluation[] = sortAreaCandidates(
    candidates.map((candidate) => {
      const target = candidate.entity;
      const membership = resolvedOrigin.resolved
        ? provider.evaluateMembership({
            origin: resolvedOrigin.resolved,
            target,
            shape,
            includeOrigin,
          })
        : 'unknown';
      const propagation = resolvedOrigin.resolved
        ? provider.evaluatePropagation(resolvedOrigin.resolved, target)
        : 'unknown';
      return areaCandidateEvaluation({
        targetKey: canonicalTargetKey(target.kind, target.id),
        kind: target.kind,
        id: target.id,
        geometry: membership,
        propagation,
        reasons: [],
      });
    }),
  );

  const decisions = input.decisions ?? [];
  const decisionOutcome = applyAreaDecisions(evaluations, decisions);
  assertAreaDecisionsValid(decisionOutcome);
  if (!deferUnknown) assertAreaResolutionComplete(decisionOutcome);

  const byKey = new Map(
    candidates.map((candidate) => [
      canonicalTargetKey(candidate.entity.kind, candidate.entity.id),
      candidate,
    ]),
  );
  const affected = decisionOutcome.affectedKeys
    .map((key) => byKey.get(key))
    .filter((item): item is LoadedEntity => item !== undefined);

  const anyConfirmed = decisionOutcome.provenance.size > 0 &&
    [...decisionOutcome.provenance.values()].some((value) => value === 'master-confirmed');
  const snapshot: AreaTargetingSnapshot = {
    kind: 'area',
    shape,
    origin: {
      definition: originDefinitionSnapshot(targeting),
      requested:
        requested.kind === 'self'
          ? { kind: 'self', entity: null }
          : { kind: 'entity', entity: requested.entity },
      resolved: resolvedOrigin.resolved
        ? { kind: resolvedOrigin.resolved.kind, id: resolvedOrigin.resolved.id }
        : null,
      result: resolvedOrigin.result,
      obstruction: resolvedOrigin.obstruction,
      rangeResult,
      sightResult,
    },
    direction: direction
      ? {
          kind: direction.kind,
          target: { kind: direction.target.kind, id: direction.target.id },
        }
      : null,
    inclusionPolicy: policy,
    includeOrigin,
    spatialMode: anyConfirmed
      ? 'master-assisted'
      : provider.mode === 'authoritative'
        ? 'authoritative'
        : 'assisted',
    candidates: evaluations.map((evaluation) => ({
      targetKey: evaluation.targetKey,
      kind: evaluation.kind,
      id: evaluation.id,
      geometry: evaluation.geometry,
      propagation: evaluation.propagation,
      rules: evaluation.rules,
      affected: evaluation.affected,
      reasons: evaluation.reasons,
    })),
    affected: affected.map((item) => ({
      kind: item.entity.kind,
      id: item.entity.id,
      provenance: decisionOutcome.provenance.get(
        canonicalTargetKey(item.entity.kind, item.entity.id),
      ) ?? 'authoritative',
    })),
    masterDecisions: decisions.map((decision) => ({ ...decision })),
    requiredDecisions: decisionOutcome.missing,
    evaluatedAt: new Date().toISOString(),
  };

  return {
    snapshot,
    affected,
    requiredDecisions: decisionOutcome.missing,
    requiredConfirmations,
  };
}

/** Alvo canônico de uma decisão (`kind:id`). */
export function areaDecisionKey(entity: MechanicalEntity): string {
  return canonicalTargetKey(entity.kind, entity.id);
}
