import { elevationCellsSchema } from '../combat/spatial/elevation.js';
import { z } from 'zod';
import { SPATIAL_MODES, spatialPositionSchema } from '../combat/spatial/spatial.types.js';

/**
 * FASE 6.6L.4.1.1 — Entradas da API de CENA ESPACIAL.
 *
 * O cliente manda só INTENÇÃO (nome, modo/dimensões em PÉS, imagem de fundo,
 * geometria da parede) + `expectedVersion`/`operationId`. Tamanho de célula,
 * pixels, metros e qualquer valor derivado NUNCA vêm do payload.
 */

const sceneNameSchema = z.string().trim().min(1, 'A cena precisa de um nome.').max(120);

/**
 * Configuração estrutural em PÉS. Dimensões são opcionais e mescladas com o
 * valor atual: criar uma cena `grid-2d` sem dimensões usa o padrão do projeto.
 * `cellSizeFeet` é FIXO (5 pés) e por isso não é aceito do cliente.
 */
export const sceneSpatialConfigSchema = z
  .object({
    elevationCells: elevationCellsSchema.optional(),
    mode: z.enum(SPATIAL_MODES),
    widthFeet: z.number().finite().min(5).max(100_000).optional(),
    heightFeet: z.number().finite().min(5).max(100_000).optional(),
  })
  .strict();

/**
 * Imagem de fundo OPCIONAL. Nesta fase é só uma REFERÊNCIA (`/uploads/...`):
 * o sistema de upload já existente grava o arquivo e a edição visual da cena
 * pertence à fase seguinte. `null` limpa a imagem.
 */
const sceneBackgroundSchema = z.string().trim().max(500).nullable();

export const createSceneSchema = z
  .object({
    name: sceneNameSchema,
    spatialConfig: sceneSpatialConfigSchema.optional(),
    backgroundImageUrl: sceneBackgroundSchema.optional(),
  })
  .strict();

/**
 * PATCH da cena. `expectedVersion` protege contra escrita velha e
 * `operationId` dá idempotência (retry devolve o mesmo snapshot) — o mesmo
 * padrão já usado no combate, sem um segundo engine de concorrência.
 */
export const updateSceneSchema = z
  .object({
    name: sceneNameSchema.optional(),
    spatialConfig: sceneSpatialConfigSchema.optional(),
    backgroundImageUrl: sceneBackgroundSchema.optional(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasChange =
      input.name !== undefined ||
      input.spatialConfig !== undefined ||
      input.backgroundImageUrl !== undefined;
    if (!hasChange) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nada para alterar.' });
    }
  });

export const deleteSceneSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

/**
 * PAREDES — mesmos schemas da 6.6L.4.1, agora sob a CENA (o owner estrutural
 * mudou; a geometria e as flags são exatamente as mesmas). `kind` só aceita
 * `wall` nesta fase.
 */
export const spatialObstacleCreateSchema = z
  .object({
    kind: z.literal('wall').optional(),
    start: spatialPositionSchema,
    end: spatialPositionSchema,
    blocksMovement: z.boolean().optional(),
    blocksSight: z.boolean().optional(),
    blocksTargeting: z.boolean().optional(),
    coverLevel: z.enum(['none', 'half', 'three-quarters', 'total']).optional(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

export const spatialObstaclePatchSchema = z
  .object({
    start: spatialPositionSchema.optional(),
    end: spatialPositionSchema.optional(),
    blocksMovement: z.boolean().optional(),
    blocksSight: z.boolean().optional(),
    blocksTargeting: z.boolean().optional(),
    coverLevel: z.enum(['none', 'half', 'three-quarters', 'total']).optional(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasChange =
      input.start !== undefined ||
      input.end !== undefined ||
      input.blocksMovement !== undefined ||
      input.blocksSight !== undefined || input.blocksTargeting !== undefined || input.coverLevel !== undefined;
    if (!hasChange) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nada para alterar.' });
    }
  });

export const spatialObstacleDeleteSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

export type CreateScenePayload = z.infer<typeof createSceneSchema>;
export type UpdateScenePayload = z.infer<typeof updateSceneSchema>;
export type DeleteScenePayload = z.infer<typeof deleteSceneSchema>;
export type SpatialObstacleCreatePayload = z.infer<typeof spatialObstacleCreateSchema>;
export type SpatialObstaclePatchPayload = z.infer<typeof spatialObstaclePatchSchema>;
export type SpatialObstacleDeletePayload = z.infer<typeof spatialObstacleDeleteSchema>;


/** Um traçado é salvo em uma transação; nenhum segmento fica pela metade. */
export const spatialObstacleBatchSchema = z.object({
  walls: z.array(z.object({
    start: spatialPositionSchema, end: spatialPositionSchema,
    blocksMovement: z.boolean().default(true), blocksSight: z.boolean().default(true), blocksTargeting: z.boolean().optional(),
    coverLevel: z.enum(['none', 'half', 'three-quarters', 'total']).optional(),
  }).strict()).min(1).max(200),
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
}).strict();
