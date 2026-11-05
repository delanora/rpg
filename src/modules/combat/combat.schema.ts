import { z } from 'zod';
import { SPATIAL_MODES, spatialPositionSchema } from './spatial/spatial.types.js';

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
  /**
   * Modificadores OPCIONAIS escolhidos no painel de ataque (6.5G): apenas IDs
   * oferecidos pelo servidor. Revalidados no momento do ataque (efeito pode ter
   * terminado entre a renderização e o clique).
   */
  selectedEffectModifiers: z.array(z.string().min(1).max(160)).max(20).optional(),
  /**
   * 6.6J.5.1 — adjudicação de COBERTURA pelo Mestre (fluxo assistido).
   *
   * O cliente envia só o NÍVEL pedido para UM alvo; o servidor deriva bônus,
   * CA situacional e proveniência. PLAYER é recusado no service (403) e um
   * nível divergente de fato autoritativo vira 409 `COVER_DECISION_NOT_ALLOWED`.
   */
  coverConfirmation: z
    .object({
      targetKey: z.string().trim().min(1).max(200),
      level: z.enum(['none', 'half', 'three-quarters', 'total']),
    })
    .strict()
    .optional(),
});

/**
 * USAR ITEM em combate: o cliente manda só a INTENÇÃO (item + alvo). O
 * servidor valida controle/turno, gasta a Ação, consome a unidade e aplica o
 * efeito automatizado — sem confiar em quantidade, alvo ou custo do cliente.
 */
export const useItemSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  itemInventoryId: z.string().min(1),
  /** Sem alvo = usa em si mesmo. */
  targetCombatantId: z.string().min(1).optional(),
});
export type UseItemInput = z.infer<typeof useItemSchema>;

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
  action: z.enum([
    'dash',
    'disengage',
    'dodge',
    'help',
    'hide',
    'search',
    'use-object',
    'improvised',
    'ready',
    'execute-ready',
    'move',
    // SABEDORIA (MEDICINA) CD 10 para estabilizar outra criatura a 0 PV.
    'stabilize',
  ]),
  description: z.string().trim().max(500).optional(),
  targetCombatantId: z.string().min(1).optional(),
  trigger: z.string().trim().min(1).max(500).optional(),
  intent: z.string().trim().min(1).max(500).optional(),
  distance: z.number().positive().max(9999).optional(),
}).superRefine((input, ctx) => {
  if (input.action === 'ready' && (!input.trigger || !input.intent)) ctx.addIssue({ code: 'custom', message: 'Informe gatilho e intenção.' });
  if (input.action === 'improvised' && !input.description) ctx.addIssue({ code: 'custom', message: 'Descreva a ação improvisada.' });
  if (input.action === 'move' && !input.distance) ctx.addIssue({ code: 'custom', message: 'Informe a distância em metros.' });
  if (input.action === 'stabilize' && !input.targetCombatantId) ctx.addIssue({ code: 'custom', message: 'Escolha quem estabilizar.' });
});

/**
 * Avanço de turno. `skipDeathSave` é a CONFIRMAÇÃO do Mestre para avançar sem o
 * Teste contra a Morte obrigatório daquele turno — sem ela, o servidor recusa e
 * o cliente abre a confirmação.
 */
export const nextTurnSchema = combatOperationSchema.extend({
  skipDeathSave: z.boolean().optional(),
});
export type NextTurnInput = z.infer<typeof nextTurnSchema>;

export const economyOverrideSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  adjustment: z.enum(['grant-action', 'restore-action', 'restore-bonus', 'restore-reaction', 'set-movement']),
  remaining: z.number().nonnegative().max(9999).optional(),
  reason: z.string().trim().min(1).max(500),
}).superRefine((input, ctx) => {
  if (input.adjustment === 'set-movement' && input.remaining === undefined) ctx.addIssue({ code: 'custom', message: 'Informe o Movimento restante.' });
});
/* -------------------------------------------------------------------------- */
/* 6.6L.1 — Espaço da cena e placement                                        */
/* -------------------------------------------------------------------------- */

/**
 * Configuração da cena. Só o MASTER; `cellSizeFeet` é FIXO em 5 (grid base) e
 * não é aceito do cliente. `grid-2d` exige as duas dimensões; `assisted` pode
 * só trocar o modo (preserva as dimensões atuais).
 */
export const spatialConfigPatchSchema = z
  .object({
    mode: z.enum(SPATIAL_MODES),
    widthFeet: z.number().finite().min(5).max(100_000).optional(),
    heightFeet: z.number().finite().min(5).max(100_000).optional(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.mode === 'grid-2d' && (input.widthFeet === undefined || input.heightFeet === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Informe largura e altura da cena em pés.' });
    }
  });

/**
 * Placement/unplace de UM combatente. `size`/`occupiedSpace`/distância NÃO são
 * aceitos: o servidor deriva tudo do tamanho canônico e das dimensões da cena.
 */
export const spatialPositionPatchSchema = z
  .object({
    position: spatialPositionSchema.nullable(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

export type SpatialConfigPatch = z.infer<typeof spatialConfigPatchSchema>;
export type SpatialPositionPatch = z.infer<typeof spatialPositionPatchSchema>;

export type CombatOperationInput = z.infer<typeof combatOperationSchema>;
export type EconomyActionInput = z.infer<typeof economyActionSchema>;
export type EconomyOverrideInput = z.infer<typeof economyOverrideSchema>;
