import { z } from 'zod';
import { operationIdSchema } from '../characters/characters.schema.js';
import {
  CAMP_SUPPLY_OVERRIDE_NOTE_MAX,
  CAMP_SUPPLY_OVERRIDE_TYPES,
} from '../shared/camp-supplies.js';

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

/**
 * Marca/desmarca "pronto para descansar" (PASSO 2).
 *
 * Ready significa apenas "terminei minhas decisões pessoais": NÃO é aprovação
 * mecânica e recursos de acampamento insuficientes não impedem o ready.
 */
export const setLongRestReadySchema = z.object({
  ready: z.boolean(),
  operationId: operationIdSchema,
});

export type SetLongRestReadyInput = z.infer<typeof setLongRestReadySchema>;

/**
 * Seleção dos Dados de Vida a recuperar: mapa face → quantidade.
 * Só as faces do PHB (d6, d8, d10, d12); a VALIDAÇÃO contra o uso real e a cota
 * do descanso é do servidor (a ficha é a fonte de verdade).
 */
export const hitDiceRecoverySelectionSchema = z.record(
  z.enum(['6', '8', '10', '12']),
  z.number().int().min(0).max(1000),
);

export const setHitDiceRecoverySchema = z.object({
  /** `{}` (ou só zeros) é permitido: o jogador não precisa recuperar o máximo. */
  selection: hitDiceRecoverySelectionSchema.default({}),
  operationId: operationIdSchema,
});

export type SetHitDiceRecoveryInput = z.infer<typeof setHitDiceRecoverySchema>;

/**
 * Exceção NARRATIVA do mestre (`campSupplyOverride`) — deliberada e registrada.
 *
 * `enabled: false` equivale a não haver exceção. A `note` é OPCIONAL e curta: a
 * justificativa dá contexto à mesa, não vira formulário burocrático.
 */
export const campSupplyOverrideSchema = z.object({
  enabled: z.boolean().default(true),
  type: z.enum(CAMP_SUPPLY_OVERRIDE_TYPES),
  note: z
    .string()
    .trim()
    .max(
      CAMP_SUPPLY_OVERRIDE_NOTE_MAX,
      `A anotação da exceção pode ter no máximo ${CAMP_SUPPLY_OVERRIDE_NOTE_MAX} caracteres.`,
    )
    .optional(),
});

/**
 * Conclusão forçada pelo MESTRE. Sem `campSupplyOverride`, o force-complete
 * NORMAL continua respeitando os recursos de acampamento (só ignora o `ready`
 * que falta). Só o mestre alcança esta rota.
 */
export const forceCompleteLongRestSchema = z.object({
  operationId: operationIdSchema,
  campSupplyOverride: campSupplyOverrideSchema.optional(),
});

export type ForceCompleteLongRestInput = z.infer<typeof forceCompleteLongRestSchema>;

/** Id vindo da rota (`:requestId`). */
export { longRestRequestIdSchema };
