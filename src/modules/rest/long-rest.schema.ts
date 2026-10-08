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

/**
 * Contribuição de RECURSO DE ACAMPAMENTO de UMA pilha do próprio inventário
 * (mecânica opcional). `quantity = 0` REMOVE a contribuição. O cliente NUNCA
 * envia valor/subtotal: o servidor deriva tudo.
 */
export const setCampSupplyContributionSchema = z.object({
  /** Id da entrada do inventário do PRÓPRIO personagem (não é o id do catálogo). */
  inventoryItemId: z.string().trim().min(1, 'Informe o item.').max(120),
  /** Quantidade a reservar (0 remove). */
  quantity: z.number().int().min(0).max(1_000_000),
  operationId: operationIdSchema,
});

export type SetCampSupplyContributionInput = z.infer<typeof setCampSupplyContributionSchema>;

/** Id vindo da rota (`:requestId`). */
export { longRestRequestIdSchema };
