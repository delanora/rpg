import { z } from 'zod';

/** Definição do cadastro; o gasto pertence a cada instância do combate. */
export const creatureAbilitySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .refine(
        (id) => !Object.hasOwn(Object.prototype, id) && id !== 'prototype',
      ),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(3000).default(''),
    cost: z.enum(['action', 'bonus-action', 'reaction', 'passive']),
    execution: z
      .enum(['assisted', 'disengage', 'dash', 'dodge'])
      .default('assisted'),
    trigger: z.string().trim().max(500).default(''),
    maxUses: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.cost === 'passive' &&
      (value.execution !== 'assisted' || value.maxUses !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Passivas são consultivas, sem consumo de usos.',
      });
    if (
      value.cost === 'reaction' &&
      (!value.trigger || value.execution !== 'assisted')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Reação assistida exige gatilho e confirmação do Mestre.',
      });
  });
export const creatureAbilitiesSchema = z
  .array(creatureAbilitySchema)
  .max(100)
  .superRefine((items, ctx) => {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Cada habilidade precisa de um identificador único.',
      });
  });
export type CreatureAbility = z.infer<typeof creatureAbilitySchema>;
export function creatureAbilitiesOf(value: unknown): CreatureAbility[] {
  const parsed = creatureAbilitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
export function creatureAbilityUsesOf(value: unknown): Record<string, number> {
  const parsed = z.record(z.number().int().min(0)).safeParse(value);
  return parsed.success ? parsed.data : {};
}

export const CREATURE_ABILITY_COST_LABELS = {
  action: 'Ação',
  'bonus-action': 'Ação bônus',
  reaction: 'Reação',
  passive: 'Passiva',
} as const;
