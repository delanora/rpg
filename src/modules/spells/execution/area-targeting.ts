import { z } from 'zod';
import { HttpError } from '../../../lib/http-error.js';
import { entitySchema } from '../../shared/conditions.js';

/**
 * FASE 6.6J.3 — ÁREA DE EFEITO (contrato puro).
 *
 * Uma magia de área NÃO recebe a lista de criaturas atingidas: ela declara uma
 * FORMA, uma ORIGEM e uma POLÍTICA de afetados, e o SERVIDOR deriva quem está
 * dentro. O cliente escolhe apenas ONDE a área começa (e em que direção, quando
 * a forma exige) — nunca raio, comprimento, largura, altura, forma ou alvos.
 *
 * Unidade canônica: PÉS (a conversão para metros é só apresentação).
 *
 * PHB 2014 tem CINCO formas: esfera, cone, cubo, cilindro e linha. Formas do
 * modelo de 2024 ficam de fora. Cada forma tem semântica própria — nunca
 * reduzir todas a "raio".
 */

const dimensionSchema = z.number().finite().positive().max(2000);

export const AREA_SHAPE_KINDS = ['sphere', 'cone', 'cube', 'cylinder', 'line'] as const;
export type AreaShapeKind = (typeof AREA_SHAPE_KINDS)[number];

/**
 * As cinco formas do PHB 2014. O raio/comprimento/aresta/altura pertencem à
 * DEFINIÇÃO da magia: o cliente nunca os envia.
 */
export const areaShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sphere'), radiusFeet: dimensionSchema }).strict(),
  z.object({ kind: z.literal('cone'), lengthFeet: dimensionSchema }).strict(),
  z.object({ kind: z.literal('cube'), sizeFeet: dimensionSchema }).strict(),
  z
    .object({
      kind: z.literal('cylinder'),
      radiusFeet: dimensionSchema,
      heightFeet: dimensionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('line'),
      lengthFeet: dimensionSchema,
      widthFeet: dimensionSchema,
    })
    .strict(),
]);
export type AreaShapeDefinition = z.infer<typeof areaShapeSchema>;

/** Política de inclusão do PONTO DE ORIGEM (PHB 2014). */
export const AREA_ORIGIN_INCLUSION_POLICIES = ['included', 'excluded', 'caster-choice'] as const;
export type AreaOriginInclusionPolicy = (typeof AREA_ORIGIN_INCLUSION_POLICIES)[number];

/**
 * Esfera e cilindro incluem o ponto de origem; cone, cubo e linha deixam o
 * conjurador escolher. A regra mora AQUI (helper central), nunca espalhada por
 * services.
 */
export function originInclusionPolicyOf(shape: AreaShapeDefinition): AreaOriginInclusionPolicy {
  if (shape.kind === 'sphere' || shape.kind === 'cylinder') return 'included';
  return 'caster-choice';
}

/** Cone e linha precisam de direção; esfera, cubo e cilindro não. */
export function shapeRequiresDirection(shape: AreaShapeDefinition): boolean {
  return shape.kind === 'cone' || shape.kind === 'line';
}

/** Resumo SEGURO (apresentação/UI) — dimensões fixas da definição. */
export function areaShapeSummary(shape: AreaShapeDefinition) {
  switch (shape.kind) {
    case 'sphere':
      return { kind: shape.kind, radiusFeet: shape.radiusFeet };
    case 'cone':
      return { kind: shape.kind, lengthFeet: shape.lengthFeet };
    case 'cube':
      return { kind: shape.kind, sizeFeet: shape.sizeFeet };
    case 'cylinder':
      return {
        kind: shape.kind,
        radiusFeet: shape.radiusFeet,
        heightFeet: shape.heightFeet,
      };
    case 'line':
      return { kind: shape.kind, lengthFeet: shape.lengthFeet, widthFeet: shape.widthFeet };
  }
}

/**
 * ORIGEM da área. `self` = o conjurador (cone/linha a partir dele); `point` =
 * um ponto escolhido a até `rangeFeet`. A DISTÂNCIA DA ORIGEM é um conceito
 * separado das DIMENSÕES da forma (uma esfera de 20 ft pode ser centrada a 150
 * ft do conjurador).
 */
export const areaOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(),
  z
    .object({
      kind: z.literal('point'),
      rangeFeet: dimensionSchema,
      requiresSight: z.boolean(),
    })
    .strict(),
]);
export type AreaOriginDefinition = z.infer<typeof areaOriginSchema>;

/**
 * Direção da área SEM coordenadas: "a partir da origem, na direção desta
 * criatura". É uma intenção espacial legítima sem inventar eixos/graus.
 */
export const areaDirectionSchema = z
  .object({
    kind: z.literal('toward-entity'),
    entity: entitySchema,
  })
  .strict();
export type AreaDirection = z.infer<typeof areaDirectionSchema>;

/**
 * COLOCAÇÃO pedida pelo cliente. Só o que é escolha legítima: origem, direção e
 * (quando a forma permite) incluir o ponto de origem. Nada de raio/forma/alvos.
 */
export const areaPlacementSchema = z
  .object({
    requestedOrigin: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('self') }).strict(),
      z.object({ kind: z.literal('entity'), entity: entitySchema }).strict(),
    ]),
    direction: areaDirectionSchema.optional(),
    includeOrigin: z.boolean().optional(),
  })
  .strict();
export type AreaPlacement = z.infer<typeof areaPlacementSchema>;

/** Política de afetados desta fundação: TODAS as criaturas válidas. */
export const areaAffectedPolicySchema = z
  .object({ kind: z.literal('all-valid-creatures') })
  .strict();
export type AreaAffectedPolicy = z.infer<typeof areaAffectedPolicySchema>;

/** Definição de targeting de uma magia de ÁREA. */
export const areaTargetingDefinitionSchema = z
  .object({
    kind: z.literal('area'),
    origin: areaOriginSchema,
    area: z
      .object({
        shape: areaShapeSchema,
        affects: areaAffectedPolicySchema,
      })
      .strict(),
  })
  .strict();
export type AreaTargetingDefinition = z.infer<typeof areaTargetingDefinitionSchema>;

function invalid(message: string, code: string): never {
  throw new HttpError(message, 400, code);
}

/**
 * Valida a COLOCAÇÃO contra a definição (puro, sem I/O).
 *
 *  • forma que inclui a origem NÃO aceita `includeOrigin` (nem `false`, que o
 *    PHB não permite, nem `true`, que seria redundante);
 *  • cone/linha exigem direção;
 *  • demais formas não exigem direção (e não inventamos requisito falso).
 */
export function validateAreaPlacement(
  targeting: AreaTargetingDefinition,
  placement: AreaPlacement,
): void {
  const shape = targeting.area.shape;
  const policy = originInclusionPolicyOf(shape);
  if (placement.includeOrigin !== undefined && policy !== 'caster-choice') {
    invalid(
      'Esta forma não permite escolher se o ponto de origem é incluído.',
      'AREA_ORIGIN_INCLUSION_INVALID',
    );
  }
  if (shapeRequiresDirection(shape) && !placement.direction) {
    invalid('Esta forma de área exige uma direção.', 'AREA_DIRECTION_REQUIRED');
  }
  if (placement.direction && placement.requestedOrigin.kind === 'self') {
    // Direção a partir da origem: "na direção de X" exige X diferente da
    // própria origem? A checagem forte é semântica (mesma entidade) e acontece
    // no resolvedor; aqui só garantimos forma estrutural.
    return;
  }
}

/** Resumo SEGURO do targeting de área (read-model; nada aqui decide regra). */
export function areaTargetingSummary(targeting: AreaTargetingDefinition, castAtLevel: number) {
  return {
    kind: targeting.kind,
    castAtLevel,
    shape: areaShapeSummary(targeting.area.shape),
    origin: targeting.origin,
    inclusionPolicy: originInclusionPolicyOf(targeting.area.shape),
    requiresDirection: shapeRequiresDirection(targeting.area.shape),
    affects: targeting.area.affects.kind,
    /** A quantidade de alvos é DERIVADA da cena — não existe `maxTargets`. */
    targetCount: null,
  };
}
