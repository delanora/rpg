import { z } from 'zod';
import { operationIdSchema } from '../characters/characters.schema.js';

/**
 * Schemas da solicitação COLETIVA de Descanso Longo.
 *
 * Todas as operações carregam `operationId` (a chave idempotente, reaproveitada
 * do módulo de fichas) — um reenvio devolve o resultado original em vez de
 * criar/responder/forçar de novo.
 */

/** Id de uma solicitação coletiva de Descanso Longo (cuid do banco). */
const longRestRequestIdSchema = z
  .string()
  .trim()
  .min(1, 'Informe a solicitação de descanso.')
  .max(60);

/** Criação da solicitação. A lista de convidados é decidida pelo SERVIDOR. */
export const createLongRestRequestSchema = z.object({
  operationId: operationIdSchema,
});

export type CreateLongRestRequestInput = z.infer<typeof createLongRestRequestSchema>;

/** Resposta de um participante: aceitar ou recusar (alterável enquanto PENDING). */
export const respondLongRestRequestSchema = z.object({
  response: z.enum(['ACCEPTED', 'DECLINED']),
  operationId: operationIdSchema,
});

export type RespondLongRestRequestInput = z.infer<typeof respondLongRestRequestSchema>;

/** Ação do mestre sobre a solicitação (forçar aprovação ou cancelar). */
export const longRestRequestActionSchema = z.object({
  operationId: operationIdSchema,
});

export type LongRestRequestActionInput = z.infer<typeof longRestRequestActionSchema>;

/** Id vindo da rota (`:requestId`). */
export { longRestRequestIdSchema };
