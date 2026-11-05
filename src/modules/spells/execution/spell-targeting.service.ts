import type { Prisma } from '@prisma/client';
import { HttpError } from '../../../lib/http-error.js';
import { isHumanoidEntity } from '../../shared/creature-types.js';
import { canSee } from '../../shared/vision.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import {
  maximumTargets,
  targetingRangeFeet,
  type ExplicitSpellTargetingDefinition,
  type SpellTargetFilter,
} from './spell-targeting.js';
import type { AreaTargetingSnapshot } from './area-snapshot.js';
import {
  assistedSpatialProvider,
  isConfirmed,
  type SpatialConfirmation,
  type SpatialProvider,
  type SpatialRequirementKind,
  type SpatialResult,
} from './spatial-validation.js';

/**
 * FASE 6.6E — TARGETING SERVICE.
 *
 * Responsabilidades (e SÓ elas):
 *  • normalizar/canonicalizar os alvos (o `loadEntity` já resolve
 *    combatente→ficha, então o MESMO personagem nunca conta duas vezes);
 *  • detectar duplicidade;
 *  • validar quantidade (min..máximo DERIVADO de `castAtLevel`);
 *  • aplicar filtros declarados pela magia (tipo de criatura);
 *  • exigir visão MECÂNICA quando a definição pede;
 *  • consumir a validação espacial tri-state + confirmação do Mestre;
 *  • produzir o SNAPSHOT imutável da validação.
 *
 * NÃO resolve espaço de magia, Action Economy, saves nem Effects — isso é do
 * `spell-cast.service` e do finalizer de resolução.
 */

export interface TargetingConstraintSnapshot {
  kind: SpatialRequirementKind;
  result: SpatialResult;
  confirmed: boolean;
}

export type TargetingValidationMode = 'automatic' | 'master-confirmed' | 'mixed';

/** Snapshot gravado no SpellCast: mudanças futuras não reescrevem o passado. */
export interface TargetingSnapshot {
  targetKind: ExplicitSpellTargetingDefinition['kind'];
  rangeFeet: number | null;
  maxTargets: number;
  targetCount: number;
  requiresSight: boolean;
  requiresClearPath: boolean;
  validationMode: TargetingValidationMode;
  constraints: TargetingConstraintSnapshot[];
  filters: string[];
  /**
   * Requisitos que o servidor NÃO sabe medir e ninguém confirmou ainda (6.6F).
   * Só existe quando a validação rodou em modo DEFERIDO (conjuração de PLAYER):
   * com o Mestre no fluxo, `unknown` sem confirmação já falha na hora.
   */
  requiredConfirmations: SpatialRequirementKind[];
  /**
   * 6.6L.2 — distância usada por alvo, SANITIZADA (pés/faixa, nunca
   * coordenadas). Ausente quando o cast não roda com estado espacial conhecido.
   */
  distances?: {
    targetKey: string;
    status: 'known' | 'unknown' | 'not-assessed';
    distanceFeet: number | null;
    provenance: 'grid-2d' | null;
    algorithm: string | null;
  }[];
  /**
   * 6.6J.4: ASSIGNMENTS de ataque múltiplo (índice → alvo), preservando ordem e
   * repetição. Ausente em magias de alvo explícito comum e nos casts antigos.
   */
  attackAssignments?: { index: number; target: { kind: string; id: string } }[];
}

/**
 * Snapshot de targeting GRAVADO no cast: a validação de alvos explícitos (6.6E)
 * ou o snapshot de ÁREA (6.6J.3), discriminado por `kind`.
 */
export type SpellTargetingSnapshot = TargetingSnapshot | AreaTargetingSnapshot;

export interface ValidateTargetingInput {
  db: Prisma.TransactionClient;
  targeting: ExplicitSpellTargetingDefinition;
  caster: LoadedEntity;
  targets: readonly LoadedEntity[];
  castAtLevel: number;
  confirmation?: SpatialConfirmation;
  /**
   * `true` = não falhar em `unknown` sem confirmação; devolver o requisito como
   * PENDENTE. É o modo do pré-COMMIT de PLAYER: o pedido vira intenção e o
   * Mestre confirma depois, sem gastar nada. `fail` autoritativo continua
   * rejeitando sempre — confirmação não sobrescreve impossibilidade conhecida.
   */
  deferUnknown?: boolean;
  /** Injetável para a futura grid; o padrão é o provider assistido. */
  provider?: SpatialProvider;
}

function fail(message: string, code: string): never {
  throw new HttpError(message, 409, code);
}

/** Identidade CANÔNICA de um alvo (o `loadEntity` já canonicalizou). */
export function targetingKey(entity: MechanicalEntity): string {
  return `${entity.kind}:${entity.id}`;
}

/** Descrição estável do filtro (auditoria/snapshot; nunca decide regra). */
export function filterKeyOf(filter: SpellTargetFilter): string {
  return `${filter.kind}:${filter.value}`;
}

async function assertFilters(
  db: Prisma.TransactionClient,
  filters: readonly SpellTargetFilter[],
  targets: readonly LoadedEntity[],
): Promise<void> {
  for (const filter of filters) {
    if (filter.kind !== 'creature-type') continue;
    for (const target of targets) {
      // Reutiliza a MESMA checagem de tipo já provada pela 6.5H — nunca uma
      // segunda taxonomia paralela.
      if (filter.value === 'humanoid' && !(await isHumanoidEntity(target.entity, db))) {
        fail('Um dos alvos não é uma criatura válida para esta magia.', 'SPELL_TARGET_TYPE_INVALID');
      }
    }
  }
}

function assertMechanicalSight(caster: LoadedEntity, targets: readonly LoadedEntity[]): void {
  for (const target of targets) {
    // `canSee` mecânico conhece Invisible/Cego/etc. Se ele diz que NÃO vê, o
    // Mestre não pode confirmar por cima: é impossibilidade conhecida.
    if (!canSee(caster.state, target.state)) {
      fail('O conjurador não consegue ver um dos alvos.', 'SPELL_TARGET_NOT_VISIBLE');
    }
  }
}

interface RequirementOutcome {
  kind: SpatialRequirementKind;
  result: SpatialResult;
  confirmed: boolean;
}

function resolveRequirement(
  kind: SpatialRequirementKind,
  result: SpatialResult,
  confirmation: SpatialConfirmation | undefined,
  failCode: string,
  requiredCode: string,
  deferUnknown: boolean,
): RequirementOutcome {
  if (result === 'fail') {
    fail('Um dos alvos não satisfaz um requisito espacial desta magia.', failCode);
  }
  if (result === 'pass') return { kind, result, confirmed: false };
  // UNKNOWN: sem confirmação explícita do Mestre o cast não acontece.
  if (!isConfirmed(confirmation, kind)) {
    if (deferUnknown) return { kind, result, confirmed: false };
    fail('Falta a confirmação espacial do Mestre para esta conjuração.', requiredCode);
  }
  return { kind, result, confirmed: true };
}

/**
 * VALIDATE do targeting (read-only). Devolve o snapshot que o COMMIT grava.
 *
 * Ordem: quantidade → filtros → visão mecânica → requisitos espaciais. Nenhuma
 * consequência (slot/Ação/Concentração) é tocada aqui.
 */
export async function validateTargeting(input: ValidateTargetingInput): Promise<TargetingSnapshot> {
  const { targeting, caster, targets, castAtLevel, db } = input;
  const provider = input.provider ?? assistedSpatialProvider;
  const deferUnknown = input.deferUnknown === true;
  const maxTargets = maximumTargets(targeting, castAtLevel);

  if (targets.length < targeting.minTargets) {
    throw new HttpError(
      'Esta magia exige pelo menos um alvo.',
      400,
      'SPELL_TARGET_REQUIRED',
    );
  }
  if (targets.length > maxTargets) {
    throw new HttpError(
      `Esta conjuração aceita no máximo ${maxTargets} alvo(s) neste espaço.`,
      400,
      'SPELL_TARGET_COUNT_INVALID',
      { maxTargets, targetCount: targets.length, castAtLevel },
    );
  }

  if (!targeting.allowSelf) {
    for (const target of targets) {
      if (targetingKey(target.entity) === targetingKey(caster.entity)) {
        fail('Esta magia não pode ter o conjurador como alvo.', 'SPELL_TARGET_INVALID');
      }
    }
  }

  await assertFilters(db, targeting.filters, targets);
  if (targeting.requiresSight) assertMechanicalSight(caster, targets);

  const rangeFeet = targetingRangeFeet(targeting);
  const constraints: RequirementOutcome[] = [];

  // Alcance: cada alvo precisa caber no alcance declarado.
  let rangeResult: SpatialResult = 'pass';
  for (const target of targets) {
    const result = provider.evaluateRange(caster.entity, target.entity, rangeFeet);
    if (result === 'fail') rangeResult = 'fail';
    else if (result === 'unknown' && rangeResult === 'pass') rangeResult = 'unknown';
  }
  constraints.push(
    resolveRequirement(
      'range',
      rangeResult,
      input.confirmation,
      'SPELL_TARGET_OUT_OF_RANGE',
      'SPELL_TARGET_RANGE_CONFIRMATION_REQUIRED',
      deferUnknown,
    ),
  );

  if (targeting.requiresSight) {
    let sightResult: SpatialResult = 'pass';
    for (const target of targets) {
      const result = provider.evaluateSightGeometry(caster.entity, target.entity);
      if (result === 'fail') sightResult = 'fail';
      else if (result === 'unknown' && sightResult === 'pass') sightResult = 'unknown';
    }
    constraints.push(
      resolveRequirement(
        'sight',
        sightResult,
        input.confirmation,
        'SPELL_TARGET_NOT_VISIBLE',
        'SPELL_TARGET_SIGHT_CONFIRMATION_REQUIRED',
        deferUnknown,
      ),
    );
  }

  if (targeting.requiresClearPath) {
    let clearResult: SpatialResult = 'pass';
    for (const target of targets) {
      const result = provider.evaluateClearPath(caster.entity, target.entity);
      if (result === 'fail') clearResult = 'fail';
      else if (result === 'unknown' && clearResult === 'pass') clearResult = 'unknown';
    }
    constraints.push(
      resolveRequirement(
        'clearPath',
        clearResult,
        input.confirmation,
        'SPELL_TARGET_INVALID',
        'SPELL_TARGET_CLEAR_PATH_CONFIRMATION_REQUIRED',
        deferUnknown,
      ),
    );
  }

  const mutual = targeting.groupConstraints.find(
    (constraint) => constraint.kind === 'mutual-distance',
  );
  if (mutual && mutual.kind === 'mutual-distance') {
    const result = provider.evaluateGroupDistance(
      caster.entity,
      targets.map((target) => target.entity),
      mutual.feet,
    );
    constraints.push(
      resolveRequirement(
        'groupDistance',
        result,
        input.confirmation,
        'SPELL_TARGET_INVALID',
        'SPELL_TARGET_GROUP_CONFIRMATION_REQUIRED',
        deferUnknown,
      ),
    );
  }

  const automatic = constraints.filter((item) => item.result === 'pass' && !item.confirmed).length;
  const confirmed = constraints.filter((item) => item.confirmed).length;
  const validationMode: TargetingValidationMode =
    confirmed === 0 ? 'automatic' : automatic === 0 ? 'master-confirmed' : 'mixed';

  return {
    targetKind: targeting.kind,
    rangeFeet,
    maxTargets,
    targetCount: targets.length,
    requiresSight: targeting.requiresSight,
    requiresClearPath: targeting.requiresClearPath,
    validationMode,
    constraints,
    filters: targeting.filters.map(filterKeyOf),
    requiredConfirmations: constraints
      .filter((item) => item.result === 'unknown' && !item.confirmed)
      .map((item) => item.kind),
  };
}
