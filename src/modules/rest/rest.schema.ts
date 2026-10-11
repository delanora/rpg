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

/**
 * Marca/desmarca "pronto para finalizar" (só participante ACCEPTED, com o
 * descanso coletivo já aprovado e ainda em andamento).
 */
export const setShortRestReadySchema = z.object({
  ready: z.boolean(),
  operationId: operationIdSchema,
});

export type SetReadyInput = z.infer<typeof setShortRestReadySchema>;

/**
 * Override EXPLÍCITO do MESTRE sobre o lifecycle dos efeitos ativos num
 * descanso (5.3D.2).
 *
 * `preserve` mantém um efeito que o lifecycle encerraria; `end` encerra um que o
 * lifecycle preservaria. Só as rotas de force-complete do MESTRE aceitam este
 * campo — o PLAYER usa as rotas de `ready`, que têm outro schema e não o
 * carregam (não há como o jogador burlar o lifecycle).
 */
export const activeEffectRestOverrideSchema = z.object({
  preserve: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  end: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export type ActiveEffectRestOverrideInput = z.infer<typeof activeEffectRestOverrideSchema>;

/** Ação do mestre sobre a solicitação (forçar aprovação/cancelar/concluir). */
export const shortRestRequestActionSchema = z.object({
  operationId: operationIdSchema,
  activeEffectOverrides: activeEffectRestOverrideSchema.optional(),
});

export type ShortRestRequestActionInput = z.infer<typeof shortRestRequestActionSchema>;

/** Id vindo da rota (`:requestId`). */
export { shortRestRequestIdSchema };
