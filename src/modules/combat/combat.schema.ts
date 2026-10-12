import { z } from 'zod';

/**
 * Entrada do botão "COMBATE": o mestre escolhe a localidade e quantas cópias
 * de cada criatura entram na luta. Cada unidade vira um combatente próprio.
 */
export const startCombatSchema = z.object({
  localityId: z.string().min(1).optional(),
  entries: z
    .array(
      z.object({
        creatureId: z.string().min(1),
        quantity: z.number().int().min(1).max(30),
      }),
    )
    .max(100)
    .default([]),
});

/**
 * Rolagem de ataque.
 *
 * Sem `attackerCombatantId`, o atacante é o personagem do próprio solicitante.
 * Com ele (somente o mestre), qualquer combatente pode atacar.
 */
export const combatOperationSchema = z.object({
  combatId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
});

export const attackSchema = combatOperationSchema.extend({
  attackActionId: z.string().min(1).optional(),
  prepared: z.boolean().optional(),
  targetCombatantId: z.string().min(1),
  attackId: z.string().min(1),
  attackerCombatantId: z.string().min(1).optional(),
  /**
   * Pilha de munição escolhida na ficha (opcional). Sem ela o servidor usa a
   * pilha SEM bônus mágico primeiro e, depois, a de menor bônus.
   */
  ammoInventoryId: z.string().min(1).optional(),
  /** Ataque rolado com vantagem: rola 2d20 e mantém o maior. */
  advantage: z.boolean().optional(),
  /**
   * Ataque rolado com desvantagem: rola 2d20 e mantém o menor. Impede o Ataque
   * Furtivo, mesmo com aliado adjacente.
   */
  disadvantage: z.boolean().optional(),
  /**
   * Confirmação explícita do jogador (não há grid/posição no sistema): há um
   * aliado adjacente ao alvo. Substitui a condição de vantagem no Ataque
   * Furtivo. Só é considerada para personagens com a feature.
   */
  adjacentAlly: z.boolean().optional(),
});

/** Dano/cura manual aplicado pelo mestre. */
export const manualHpSchema = z.object({
  combatantId: z.string().min(1),
  amount: z.number().int().min(1).max(9999),
  mode: z.enum(['damage', 'heal']),
});

export type StartCombatInput = z.infer<typeof startCombatSchema>;
export type AttackInput = z.infer<typeof attackSchema>;
export type ManualHpInput = z.infer<typeof manualHpSchema>;

export const economyActionSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  action: z.enum(['dash', 'disengage', 'dodge', 'help', 'hide', 'search', 'use-object', 'improvised', 'ready', 'execute-ready', 'move']),
  description: z.string().trim().max(500).optional(),
  targetCombatantId: z.string().min(1).optional(),
  trigger: z.string().trim().min(1).max(500).optional(),
  intent: z.string().trim().min(1).max(500).optional(),
  distance: z.number().positive().max(9999).optional(),
}).superRefine((input, ctx) => {
  if (input.action === 'ready' && (!input.trigger || !input.intent)) ctx.addIssue({ code: 'custom', message: 'Informe gatilho e intenção.' });
  if (input.action === 'improvised' && !input.description) ctx.addIssue({ code: 'custom', message: 'Descreva a ação improvisada.' });
  if (input.action === 'move' && !input.distance) ctx.addIssue({ code: 'custom', message: 'Informe a distância em metros.' });
});

export const economyOverrideSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  adjustment: z.enum(['grant-action', 'restore-action', 'restore-bonus', 'restore-reaction', 'set-movement']),
  remaining: z.number().nonnegative().max(9999).optional(),
  reason: z.string().trim().min(1).max(500),
}).superRefine((input, ctx) => {
  if (input.adjustment === 'set-movement' && input.remaining === undefined) ctx.addIssue({ code: 'custom', message: 'Informe o Movimento restante.' });
});
export type CombatOperationInput = z.infer<typeof combatOperationSchema>;
export type EconomyActionInput = z.infer<typeof economyActionSchema>;
export type EconomyOverrideInput = z.infer<typeof economyOverrideSchema>;
