import type { MechanicalEntity } from '../../shared/conditions.js';
import type { SpatialResult } from './spatial-validation.js';
import type {
  AreaOriginDefinition,
  AreaShapeDefinition,
} from './area-targeting.js';

/**
 * FASE 6.6J.3 — ADAPTADOR ESPACIAL DA ÁREA (boundary arquitetural).
 *
 * O resolvedor de área NÃO calcula geometria: ele pergunta a este provider.
 * Em produção o provider é ASSISTIDO — o projeto não tem coordenadas, então o
 * que não pode ser provado volta `unknown` e o Mestre decide. Testes injetam um
 * provider DETERMINÍSTICO, sem endpoint de cheat.
 *
 * Fatos que o provider assistido PODE provar sem grid:
 *  • a origem `self` é o próprio conjurador (distância 0);
 *  • a entidade-âncora da origem está dentro da própria área quando a forma
 *    inclui o ponto de origem (e fora quando a colocação a exclui);
 *  • propagação de uma entidade para ela mesma não é bloqueada.
 */

/** Origem PEDIDA (intenção) e origem RESOLVIDA (âncora espacial). */
export interface AreaResolvedOrigin {
  requested:
    | { kind: 'self' }
    | { kind: 'entity'; entity: MechanicalEntity };
  /** Âncora concreta da origem (`null` quando nem a âncora é conhecida). */
  resolved: MechanicalEntity | null;
  /** Fato da colocação da origem (conexão/posição), separado de alcance. */
  result: SpatialResult;
  /** `none` = sem obstrução; `resolved` = deslocada ao lado próximo; `unknown`. */
  obstruction: 'none' | 'resolved' | 'unknown';
}

export interface AreaSpatialProvider {
  mode: 'authoritative' | 'assisted';
  resolveOrigin(input: {
    caster: MechanicalEntity;
    origin: AreaOriginDefinition;
    requested: AreaResolvedOrigin['requested'];
    shape: AreaShapeDefinition;
  }): AreaResolvedOrigin;
  evaluateOriginRange(
    caster: MechanicalEntity,
    resolved: MechanicalEntity | null,
    origin: AreaOriginDefinition,
  ): SpatialResult;
  evaluateOriginSight(
    caster: MechanicalEntity,
    resolved: MechanicalEntity | null,
    origin: AreaOriginDefinition,
  ): SpatialResult;
  evaluateMembership(input: {
    origin: MechanicalEntity;
    target: MechanicalEntity;
    shape: AreaShapeDefinition;
    includeOrigin: boolean;
  }): SpatialResult;
  evaluatePropagation(origin: MechanicalEntity, target: MechanicalEntity): SpatialResult;
}

export function sameAreaEntity(a: MechanicalEntity, b: MechanicalEntity): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Provider de PRODUÇÃO: só o que é realmente conhecido.
 *
 * Sem coordenadas, "onde está o ponto pedido" e "quem mais está na forma"
 * permanecem `unknown` — nunca inventamos distância/token center.
 */
export const assistedAreaSpatialProvider: AreaSpatialProvider = {
  mode: 'assisted',
  resolveOrigin({ caster, requested }) {
    if (requested.kind === 'self') {
      return { requested, resolved: caster, result: 'pass', obstruction: 'none' };
    }
    if (sameAreaEntity(requested.entity, caster)) {
      return { requested, resolved: caster, result: 'pass', obstruction: 'none' };
    }
    // A âncora (a criatura escolhida) é conhecida; a POSIÇÃO/obstrução não.
    return { requested, resolved: requested.entity, result: 'unknown', obstruction: 'unknown' };
  },
  evaluateOriginRange(caster, resolved) {
    if (!resolved) return 'unknown';
    // Distância 0 é o único alcance que o sistema prova hoje.
    return sameAreaEntity(caster, resolved) ? 'pass' : 'unknown';
  },
  evaluateOriginSight(caster, resolved) {
    if (!resolved) return 'unknown';
    return sameAreaEntity(caster, resolved) ? 'pass' : 'unknown';
  },
  evaluateMembership({ origin, target, includeOrigin }) {
    // A própria âncora da origem está a distância 0: fato provado.
    if (!sameAreaEntity(origin, target)) return 'unknown';
    return includeOrigin ? 'pass' : 'fail';
  },
  evaluatePropagation(origin, target) {
    return sameAreaEntity(origin, target) ? 'pass' : 'unknown';
  },
};
