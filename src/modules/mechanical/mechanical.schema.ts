import { z } from 'zod';
import { conditionSchema, entitySchema } from '../shared/conditions.js';
export const mechanicalMutationSchema = z.object({
  entity: entitySchema, expectedVersion: z.number().int().nonnegative(), operationId: z.string().min(1).max(128),
  expectedCombatVersion: z.number().int().nonnegative().optional(),
  action: z.enum(['apply', 'remove', 'exhaustion', 'stand']),
  condition: conditionSchema.optional(), instanceId: z.string().min(1).optional(),
  sourceEntity: entitySchema.optional(), sourceLabel: z.string().trim().min(1).max(200).optional(),
  sourceType: z.string().trim().max(100).optional(), sourceId: z.string().max(128).optional(),
  exhaustionLevel: z.number().int().min(0).max(6).optional(),
  exhaustionDelta: z.number().int().min(-1).max(1).optional(),
  reason: z.string().trim().max(500).optional(),
}).superRefine((input, ctx) => {
  if (input.action === 'apply' && !input.condition) ctx.addIssue({ code: 'custom', message: 'Informe a condição.' });
  if (input.action === 'remove' && !input.instanceId) ctx.addIssue({ code: 'custom', message: 'Informe a instância a remover.' });
  if (input.action === 'exhaustion' && (input.exhaustionLevel === undefined) === (input.exhaustionDelta === undefined)) ctx.addIssue({ code: 'custom', message: 'Informe nível OU incremento de Exaustão.' });
});
export type MechanicalMutationInput = z.infer<typeof mechanicalMutationSchema>;
