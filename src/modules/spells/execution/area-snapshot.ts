import { z } from 'zod';
import { parseJson } from '../../shared/json.js';
import { AREA_ORIGIN_INCLUSION_POLICIES, areaShapeSchema, areaShapeSummary } from './area-targeting.js';

/**
 * FASE 6.6J.3 — SNAPSHOT IMUTÁVEL DA ÁREA (gravado no COMMIT).
 *
 * O snapshot guarda o que o SERVIDOR sabia no instante do cast: forma, origem
 * pedida × resolvida, direção, política de inclusão, avaliações por candidato,
 * alvos afetados e a PROVENIÊNCIA de cada um (`authoritative` ou
 * `master-confirmed`). Movimento posterior não reescreve nada.
 */

const entityRefSchema = z.object({ kind: z.string(), id: z.string() });

const areaCandidateSnapshotSchema = z.object({
  targetKey: z.string(),
  kind: z.string(),
  id: z.string(),
  geometry: z.enum(['pass', 'fail', 'unknown']),
  propagation: z.enum(['pass', 'fail', 'unknown']),
  rules: z.enum(['pass', 'fail']),
  affected: z.enum(['pass', 'fail', 'unknown']),
  reasons: z.array(z.string()),
});

export type AreaCandidateSnapshot = z.infer<typeof areaCandidateSnapshotSchema>;

export const areaTargetingSnapshotSchema = z.object({
  kind: z.literal('area'),
  shape: areaShapeSchema,
  origin: z.object({
    definition: z.object({
      kind: z.enum(['self', 'point']),
      rangeFeet: z.number().nullable(),
      requiresSight: z.boolean(),
    }),
    requested: z.object({
      kind: z.enum(['self', 'entity']),
      entity: entityRefSchema.nullable(),
    }),
    resolved: entityRefSchema.nullable(),
    result: z.enum(['pass', 'fail', 'unknown']),
    obstruction: z.enum(['none', 'resolved', 'unknown']),
    rangeResult: z.enum(['pass', 'fail', 'unknown']),
    sightResult: z.enum(['pass', 'fail', 'unknown']),
  }),
  direction: z
    .object({
      kind: z.enum(['toward-entity']),
      target: entityRefSchema,
    })
    .nullable(),
  inclusionPolicy: z.enum(AREA_ORIGIN_INCLUSION_POLICIES),
  includeOrigin: z.boolean(),
  spatialMode: z.enum(['authoritative', 'assisted', 'master-assisted']),
  /** Ordem CANÔNICA (chave `kind:id`), independente da query/UI. */
  candidates: z.array(areaCandidateSnapshotSchema),
  affected: z.array(
    z.object({
      kind: z.string(),
      id: z.string(),
      provenance: z.enum(['authoritative', 'master-confirmed']),
    }),
  ),
  masterDecisions: z.array(
    z.object({ targetKey: z.string(), affected: z.boolean() }),
  ),
  requiredDecisions: z.array(z.string()),
  evaluatedAt: z.string(),
});

export type AreaTargetingSnapshot = z.infer<typeof areaTargetingSnapshotSchema>;

/** Leitura FECHADA: JSON inválido/ausente vira `null` (nunca inventa área). */
export function parseAreaTargetingSnapshot(value: unknown): AreaTargetingSnapshot | null {
  return parseJson(areaTargetingSnapshotSchema, value, null as never) ?? null;
}

/**
 * Resumo SEGURO para o cliente: sem ids internos de obstáculo, sem notas do
 * Mestre e sem a lista completa de candidatos (que pode conter criatura oculta).
 */
export function areaSnapshotSummary(snapshot: AreaTargetingSnapshot) {
  return {
    kind: 'area' as const,
    shape: areaShapeSummary(snapshot.shape),
    origin: {
      requested: snapshot.origin.requested.kind,
      resolved: snapshot.origin.resolved !== null,
      result: snapshot.origin.result,
    },
    direction: snapshot.direction !== null,
    includeOrigin: snapshot.includeOrigin,
    spatialMode: snapshot.spatialMode,
    candidateCount: snapshot.candidates.length,
    affectedCount: snapshot.affected.length,
    requiredDecisions: snapshot.requiredDecisions.length,
  };
}
