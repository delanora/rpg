import { z } from 'zod';
import { entitySchema } from '../shared/conditions.js';
import { effectConditionListSchema, effectModifierListSchema } from './effect-modifiers.js';

/**
 * FASE 6.5A — contrato da Generic Effect Engine (SÓ a fundação).
 *
 * Um `EffectInstance` registra que uma origem mecânica está produzindo
 * consequências sobre UM alvo. Ele **não** é Condition, não é Concentração e
 * não aplica modificadores nesta fase: modificadores (6.5B), Conditions (6.5C)
 * e duração (6.7) virão depois, consumindo esta tabela.
 *
 * As colunas são String no banco (não enum do Postgres) para a engine crescer
 * sem migration a cada fonte nova; o contrato tipado fica AQUI, validado por
 * Zod na borda HTTP.
 */
export const effectSourceTypeSchema = z.enum([
  'manual',
  'spell',
  'feature',
  'item',
  'condition',
  'system',
]);
export type EffectSourceType = z.infer<typeof effectSourceTypeSchema>;

export const effectStatusSchema = z.enum(['active', 'ended']);
export type EffectStatus = z.infer<typeof effectStatusSchema>;

export const effectVisibilitySchema = z.enum(['public', 'private']);
export type EffectVisibility = z.infer<typeof effectVisibilitySchema>;

/**
 * Por que o efeito terminou. Enum MÍNIMA e extensível — sem inventar regra de
 * duração/dispel nesta fase.
 *
 * 6.5D acrescentou `source-removed`/`target-removed` (remoção ESTRUTURAL da
 * entidade, não morte). `group`/`source-ended`/`target-invalid` continuam
 * aceitos para não invalidar o histórico já gravado — `endReason` é auditoria
 * e NUNCA decide como a limpeza é feita.
 */
export const effectEndReasonSchema = z.enum([
  'manual',
  'group',
  'concentration',
  'duration',
  'dispel',
  'source-removed',
  'source-ended',
  'target-removed',
  'target-invalid',
  'replaced',
  'system',
]);
export type EffectEndReason = z.infer<typeof effectEndReasonSchema>;

/**
 * Criação de efeito manual (MASTER). Nomes de origem/alvo NÃO vêm do cliente:
 * o servidor resolve os dois a partir dos ids (e do token, no caso de `createdBy`).
 *
 * `groupId` é opcional de propósito: a MESMA aplicação em vários alvos
 * compartilha o grupo (Bless em três personagens = três instâncias + um grupo),
 * o que permite encerrar tudo junto (Concentração/dispel) sem perder a remoção
 * individual.
 */
export const createEffectSchema = z.object({
  /** Idempotência: retry com o mesmo id devolve a MESMA instância. */
  operationId: z.string().trim().min(1).max(128),
  /** Nome humano do efeito. Nunca decide regra mecânica. */
  label: z.string().trim().min(1).max(80),
  target: entitySchema,
  visibility: effectVisibilitySchema.default('public'),
  sourceType: effectSourceTypeSchema.default('manual'),
  /** Id lógico da origem (cast, item usado, feature). Opcional nesta fase. */
  sourceId: z.string().trim().max(128).optional(),
  /** Entidade responsável (Cleric que lançou Bless, Bárbaro da Fúria...). */
  sourceEntity: entitySchema.optional(),
  groupId: z.string().trim().max(128).optional(),
  /** Identificador mecânico separado do label ("spell.bless"). */
  definitionId: z.string().trim().max(128).optional(),
  /**
   * MODIFICADORES mecânicos (6.5B). Só o Mestre os envia, e o servidor valida
   * cada um com a união discriminada de `effect-modifiers.ts`. Nada de JSON
   * livre: quantidade, dados e valores têm limites no schema.
   */
  modifiers: effectModifierListSchema.default([]),
  /**
   * CONDITIONS que o efeito aplica (6.5C). Só MASTER envia; usa o MESMO
   * `conditionSchema` do domínio (nada de enum paralelo) e tem limite duro.
   */
  conditions: effectConditionListSchema.default([]),
});
export type CreateEffectInput = z.infer<typeof createEffectSchema>;

/** Encerramento pelo Mestre: idempotente por natureza (ended → ended). */
export const endEffectSchema = z.object({
  operationId: z.string().trim().min(1).max(128).optional(),
  reason: effectEndReasonSchema.optional(),
});
export type EndEffectInput = z.infer<typeof endEffectSchema>;

/** Leitura por alvo (a chave polimórfica vem da URL). */
export const effectTargetSchema = entitySchema;

/**
 * FASE 6.5G — aplicação CONTROLADA de Bless (ferramenta de prova do Mestre).
 *
 * Não é a Spell Execution Engine: sem slot, Ação, alcance, componentes ou
 * preparação. O cliente manda apenas o caster e até 3 alvos; o servidor valida
 * existência, canonicaliza e rejeita duplicados.
 */
export const applyBlessSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  caster: entitySchema,
  targets: z.array(entitySchema).min(1).max(3),
});
export type ApplyBlessInput = z.infer<typeof applyBlessSchema>;
