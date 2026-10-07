import { z } from 'zod';
import { operationIdSchema } from '../characters/characters.schema.js';

/**
 * Schemas da solicitação COLETIVA de Descanso Curto.
 *
 * Todas as operações carregam `operationId` (a chave idempotente, reaproveitada
 * do módulo de fichas) — um reenvio devolve o resultado original em vez de
 * criar/responder/forçar de novo.
 */

/** Id de uma solicitação coletiva (cuid do banco). */
const shortRestRequestIdSchema = z
  .string()
  .trim()
  .min(1, 'Informe a solicitação de descanso.')
  .max(60);

/** Criação da solicitação. A lista de convidados é decidida pelo SERVIDOR. */
export const createShortRestRequestSchema = z.object({
  operationId: operationIdSchema,
});

export type CreateShortRestRequestInput = z.infer<typeof createShortRestRequestSchema>;

/** Resposta de um participante: aceitar ou recusar (alterável enquanto PENDING). */
export const respondShortRestRequestSchema = z.object({
  response: z.enum(['ACCEPTED', 'DECLINED']),
  operationId: operationIdSchema,
});

export type RespondShortRestRequestInput = z.infer<typeof respondShortRestRequestSchema>;

/** Ação do mestre sobre a solicitação (forçar aprovação ou cancelar). */
export const shortRestRequestActionSchema = z.object({
  operationId: operationIdSchema,
});

export type ShortRestRequestActionInput = z.infer<typeof shortRestRequestActionSchema>;

/** Id vindo da rota (`:requestId`). */
export { shortRestRequestIdSchema };
