import { spatialPositionSchema } from '../combat/spatial/spatial.types.js';
import { areaUnknownDecisionSchema } from '../spells/execution/spell-cast.schema.js';
import { areaShapeSchema } from '../spells/execution/area-targeting.js';
import { DAMAGE_TYPES } from './attacks.js';
import { z } from 'zod';

export const creatureAreaPlacementSchema=z.object({definitionFingerprint:z.string().length(64).optional(),origin:spatialPositionSchema,angle:z.number().finite().min(-Math.PI*2).max(Math.PI*2).default(0),decisions:z.array(areaUnknownDecisionSchema).max(1000).optional()}).strict();
export type CreatureAreaPlacement=z.infer<typeof creatureAreaPlacementSchema>;
export const creatureAreaDefinitionSchema=z.object({
 shape:areaShapeSchema,
 rangeFeet:z.number().finite().min(0).max(2000).default(0),
 saveAbility:z.enum(['strength','dexterity','constitution','intelligence','wisdom','charisma']),
 dc:z.number().int().min(1).max(40),
 onSuccess:z.enum(['half','none']).default('half'),
 damage:z.array(z.object({type:z.enum(DAMAGE_TYPES),dice:z.object({count:z.number().int().min(1).max(100),sides:z.union([z.literal(4),z.literal(6),z.literal(8),z.literal(10),z.literal(12),z.literal(20)])}).strict()}).strict()).min(1).max(5),
}).strict();
export type CreatureAreaDefinition=z.infer<typeof creatureAreaDefinitionSchema>;
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
      .enum(['assisted', 'disengage', 'dash', 'dodge', 'war-caster', 'area-save-damage'])
      .default('assisted'),
    area: creatureAreaDefinitionSchema.optional(),
    trigger: z.string().trim().max(500).default(''),
    maxUses: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if(value.execution==='area-save-damage'&&(!value.area||!['action','bonus-action'].includes(value.cost)))ctx.addIssue({code:'custom',message:'Área com dano exige uma Ação/Ação bônus e forma, CD e dano cadastrados.'});
    if (
      value.cost === 'passive' &&
      (!['assisted', 'war-caster'].includes(value.execution) || value.maxUses !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Passivas não consomem usos; selecione uma execução passiva suportada.',
      });
    if (value.execution === 'war-caster' && value.cost !== 'passive') ctx.addIssue({code: 'custom', message: 'Conjurador de Guerra exige uma habilidade passiva.'});
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
