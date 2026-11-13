import { spatialPositionSchema } from '../combat/spatial/spatial.types.js';
import { areaUnknownDecisionSchema } from '../spells/execution/spell-cast.schema.js';
import { areaShapeSchema } from '../spells/execution/area-targeting.js';
import { conditionSchema } from './conditions.js';
import { DAMAGE_TYPES } from './attacks.js';
import { z } from 'zod';

export const creatureAreaPlacementSchema=z.object({selectedTargetKeys:z.array(z.string().min(1)).max(1000).optional(),definitionFingerprint:z.string().length(64).optional(),origin:spatialPositionSchema,angle:z.number().finite().min(-Math.PI*2).max(Math.PI*2).default(0),decisions:z.array(areaUnknownDecisionSchema).max(1000).optional()}).strict();
export type CreatureAreaPlacement=z.infer<typeof creatureAreaPlacementSchema>;
export const creatureAreaDefinitionSchema=z.object({
 conditions:z.array(conditionSchema).max(15).optional(),
 shape:areaShapeSchema,
 rangeFeet:z.number().finite().min(0).max(2000).default(0),
 saveAbility:z.enum(['strength','dexterity','constitution','intelligence','wisdom','charisma']),
 dc:z.number().int().min(1).max(40),
 onSuccess:z.enum(['half','none']).default('half'),
 damage:z.array(z.object({type:z.enum(DAMAGE_TYPES),dice:z.object({count:z.number().int().min(1).max(100),sides:z.union([z.literal(4),z.literal(6),z.literal(8),z.literal(10),z.literal(12),z.literal(20)])}).strict()}).strict()).min(0).max(5),
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
    cost: z.enum(['action', 'bonus-action', 'reaction', 'passive', 'legendary']),
    execution: z
      .enum(['assisted', 'disengage', 'dash', 'dodge', 'war-caster', 'area-save-damage', 'multiattack', 'legendary-attack'])
      .default('assisted'),
    area: creatureAreaDefinitionSchema.optional(),
    multiattack: z.array(z.object({attackId:z.string().min(1).max(160),count:z.number().int().min(1).max(20)}).strict()).min(1,'Selecione os ataques que compõem a habilidade.').max(20,'A composição aceita até 20 tipos de ataque.').optional(),
    legendaryCost: z.number().int().min(1).max(20).optional(),
    legendaryAttackId: z.string().min(1).max(160).optional(),
    trigger: z.string().trim().max(500).default(''),
    recharge: z.object({ minimum: z.number().int().min(1).max(6) }).strict().optional(),
    maxUses: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if(value.cost==='legendary' && (!value.legendaryCost || !['assisted','legendary-attack','area-save-damage'].includes(value.execution) || value.maxUses!==null || value.recharge))
      ctx.addIssue({code:'custom',message:'Ação Lendária exige custo no saldo próprio e execução assistida, ataque cadastrado ou área com salvaguarda.'});
    if(value.execution==='legendary-attack' && (value.cost!=='legendary'||!value.legendaryAttackId))
      ctx.addIssue({code:'custom',message:'Selecione o ataque da Ação Lendária.'});
    if (value.execution === 'multiattack') {
      const entries=value.multiattack ?? [];
      const total=entries.reduce((sum,item)=>sum+item.count,0);
      if(value.cost !== 'action' || total<2 || total>20 || new Set(entries.map(item=>item.attackId)).size!==entries.length)
        ctx.addIssue({code:'custom',message:'Ataques Múltiplos exige uma Ação e entre 2 e 20 ataques, sem linhas repetidas.'});
    }
    if (value.recharge && (value.cost === 'passive' || value.maxUses !== 1))
      ctx.addIssue({ code: 'custom', message: 'Recarga em 1d6 exige uma habilidade ativa com um único uso.' });
    if(value.execution==='area-save-damage'&&(!value.area||!['action','bonus-action','legendary'].includes(value.cost)))ctx.addIssue({code:'custom',message:'Salvaguarda em área exige custo ativo, forma, CD e dano ou condição.'});
    if(value.execution==='area-save-damage'&&value.area&&!value.area.damage.length&&!value.area.conditions?.length)ctx.addIssue({code:'custom',message:'Configure pelo menos um dano ou condição na falha.'});
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
  legendary: 'Ação Lendária',
} as const;

/** Uma tentativa por habilidade gasta; a transação do turno controla a ocorrência. */
export function rechargeCreatureAbilities(
  definitions: unknown,
  state: unknown,
  rollD6: () => number,
) {
  const uses = { ...creatureAbilityUsesOf(state) };
  const results: { abilityId: string; name: string; minimum: number; roll: number; restored: boolean }[] = [];
  for (const ability of creatureAbilitiesOf(definitions)) {
    if (!ability.recharge || (uses[ability.id] ?? 0) === 0) continue;
    const roll = rollD6();
    const restored = roll >= ability.recharge.minimum;
    if (restored) uses[ability.id] = 0;
    results.push({ abilityId: ability.id, name: ability.name, minimum: ability.recharge.minimum, roll, restored });
  }
  return { uses, results };
}

export function creatureRechargeLabel(minimum: number): string {
  return minimum === 6 ? 'Recarga 6' : `Recarga ${minimum}–6`;
}
