import { z } from 'zod';
import { startCombatSchema } from '../combat/combat.schema.js';

export const operation = z.object({
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
});
export const saveSchema = operation
  .extend({
    name: z.string().trim().min(1).max(120),
    preparation: startCombatSchema,
  })
  .strict();
