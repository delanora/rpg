import { z } from 'zod';
import type { MechanicalEntity } from '../../shared/conditions.js';

/**
 * FASE 6.6E — VALIDAÇÃO ESPACIAL ASSISTIDA (tri-state).
 *
 * O projeto NÃO tem grid, coordenadas, paredes nem pathfinding. Inventar uma
 * distância seria pior do que admitir ignorância, então todo check espacial
 * responde:
 *
 *   • `pass`    — o sistema SABE que o requisito está satisfeito;
 *   • `fail`    — o sistema SABE que não está (autoritativo, MASTER não fura);
 *   • `unknown` — não há geometria confiável; o Mestre confirma o requisito.
 *
 * Só `unknown` aceita confirmação manual. Quando existir geometry engine, ela
 * substitui o provider e as definições de magia NÃO mudam.
 *
 * O que NÃO é espacial mora fora daqui: `canSee` mecânico (Invisible/Cego) é
 * regra de estado, não geometria — ele pode produzir `fail` antes desta camada.
 */

export type SpatialResult = 'pass' | 'fail' | 'unknown';

export type SpatialRequirementKind = 'range' | 'clearPath' | 'sight' | 'groupDistance';

/**
 * Confirmação do MESTRE sobre fatos que o servidor não consegue medir.
 *
 * Só `true` conta: o cliente confirma o requisito que o SERVIDOR declarou
 * necessário, nunca escolhe alcance/geometria. Nenhum número de distância é
 * aceito (precisão fictícia).
 */
export const spatialConfirmationSchema = z
  .object({
    withinRange: z.boolean().optional(),
    clearPath: z.boolean().optional(),
    sight: z.boolean().optional(),
    groupDistance: z.boolean().optional(),
  })
  .strict();
export type SpatialConfirmation = z.infer<typeof spatialConfirmationSchema>;

/** Provider mínimo; a futura grid implementa esta interface. */
export interface SpatialProvider {
  evaluateRange(
    caster: MechanicalEntity,
    target: MechanicalEntity,
    rangeFeet: number | null,
  ): SpatialResult;
  evaluateClearPath(caster: MechanicalEntity, target: MechanicalEntity): SpatialResult;
  evaluateSightGeometry(caster: MechanicalEntity, target: MechanicalEntity): SpatialResult;
  evaluateGroupDistance(
    caster: MechanicalEntity,
    targets: readonly MechanicalEntity[],
    feet: number,
  ): SpatialResult;
}

function sameEntity(a: MechanicalEntity, b: MechanicalEntity): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Provider ATUAL: só sabe o que é realmente conhecido.
 *
 * • alvo == conjurador → distância 0 (pass);
 * • demais distâncias, cobertura e linha de visão espacial → `unknown`;
 * • conjunto com 0/1 alvo não tem distância mútua a checar → `pass`.
 */
export const assistedSpatialProvider: SpatialProvider = {
  evaluateRange(caster, target, rangeFeet) {
    if (sameEntity(caster, target)) return 'pass';
    if (rangeFeet === null) return 'pass';
    return 'unknown';
  },
  evaluateClearPath() {
    return 'unknown';
  },
  evaluateSightGeometry() {
    return 'unknown';
  },
  evaluateGroupDistance(_caster, targets) {
    return targets.length <= 1 ? 'pass' : 'unknown';
  },
};

/** Chave da confirmação correspondente a cada requisito. */
export function confirmationKeyOf(kind: SpatialRequirementKind): keyof SpatialConfirmation {
  if (kind === 'range') return 'withinRange';
  if (kind === 'clearPath') return 'clearPath';
  if (kind === 'sight') return 'sight';
  return 'groupDistance';
}

/** Mestre confirmou ESTE requisito? (`false`/ausente = não confirmado). */
export function isConfirmed(
  confirmation: SpatialConfirmation | undefined,
  kind: SpatialRequirementKind,
): boolean {
  return confirmation?.[confirmationKeyOf(kind)] === true;
}
