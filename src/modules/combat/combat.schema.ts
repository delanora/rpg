import { creatureAreaPlacementSchema } from '../shared/creature-abilities.js';
import { spellcastingSourceRefSchema } from '../spells/execution/spellcasting-source.js';
import { castingResourceRefSchema } from '../spells/execution/casting-resource.js';
import { z } from 'zod';
import { SPATIAL_MODES, spatialPositionSchema } from './spatial/spatial.types.js';
import { SPATIAL_VISIBILITIES } from './spatial/spatial-visibility.js';

/**
 * Entrada do botão "COMBATE": o mestre escolhe a localidade e quantas cópias
 * de cada criatura entram na luta. Cada unidade vira um combatente próprio.
 */
export const startCombatSchema = z.object({
  characterIds: z.array(z.string().min(1)).max(30).optional(),
  characterPositions: z.array(z.object({ characterId: z.string().min(1), position: spatialPositionSchema })).max(30).default([]),
  localityId: z.string().min(1).optional(),
  /**
   * CENA ESPACIAL da localidade (6.6L.4.1.1). Opcional: combate sem cena usa o
   * comportamento legado (`Combat.spatialConfig`). O servidor valida que a cena
   * existe e pertence à localidade informada.
   */
  sceneId: z.string().min(1).optional(),
  entries: z
    .array(
      z.object({
        creatureId: z.string().min(1),
        quantity: z.number().int().min(1).max(30),
        disposition: z.enum(['hostile', 'neutral', 'allied']).optional(),
        positions: z.array(spatialPositionSchema.nullable()).max(30).optional(),
        spatialVisibilities: z.array(z.enum(['public', 'master-only'])).max(30).optional(),
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
  multiattackId: z.string().min(1).max(100).optional(),
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
   * Confirmação explícita do jogador (a adjacência não é derivada da grade): há um
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
  extraCombatantId: z.string().min(1).optional(),
});
export type NextTurnInput = z.infer<typeof nextTurnSchema>;

export const economyOverrideSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  adjustment: z.enum(['grant-action', 'restore-action', 'restore-bonus', 'restore-reaction', 'restore-movement', 'set-movement']),
  remaining: z.number().nonnegative().max(9999).optional(),
  reason: z.string().trim().max(500).default(''),
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

/**
 * FASE 6.6M.3.1 — MEDIÇÃO point↔point (RÉGUA).
 *
 * Leitura PURA: o cliente manda apenas a INTENÇÃO dos dois extremos. Ponto é
 * coordenada em pés já alinhada (só a UI pode arredondar); combatente é id
 * estável. Nenhum custo, alcance ou distância viaja do cliente.
 */
export const spatialMeasureEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), position: spatialPositionSchema }).strict(),
  z.object({ kind: z.literal('combatant'), combatantId: z.string().min(1) }).strict(),
]);

export const spatialMeasureSchema = z
  .object({ from: spatialMeasureEndpointSchema, to: spatialMeasureEndpointSchema })
  .strict();

export type SpatialMeasureInput = z.infer<typeof spatialMeasureSchema>;

/*
 * 6.6L.4.1 — Obstáculos espaciais (paredes).
 *
 * Os schemas das paredes migraram para `modules/scenes/scenes.schema.ts` na
 * 6.6L.4.1.1: o OWNER estrutural passou a ser a CENA da localidade, não o
 * combate. A geometria e as validações são exatamente as mesmas.
 */

/* -------------------------------------------------------------------------- */
/* 6.6L.3 — Movimento voluntário e lado do encontro                            */
/* -------------------------------------------------------------------------- */

/**
 * Caminho pretendido: SÓ posições, passo a passo (o servidor não faz
 * pathfinding nem aceita "de A para Z"). Custo, distância, difficult terrain e
 * passagem NUNCA são aceitos do cliente. O limite é sanidade de payload, não
 * regra de jogo (o custo real limita na avaliação).
 */
export const movementPathSchema = z.array(spatialPositionSchema).max(200);

/** Preview read-only: sem `expectedVersion`/`operationId` porque não muta. */
export const movementPreviewSchema = z
  .object({
    combatantId: z.string().min(1),
    path: movementPathSchema,
  })
  .strict();

/** Commit: o caminho vazio é aceito como NO-OP (sem operação/versão nova). */
export const movementCommitSchema = z
  .object({
    combatantId: z.string().min(1),
    path: movementPathSchema,
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

/**
 * Lado do encontro (hostilidade explícita). `null` = relação desconhecida.
 * Normalizado no serviço (aparado, minúsculo, vazio → `null`).
 */
export const combatantSidePatchSchema = z
  .object({
    sideKey: z.string().trim().max(40).nullable(),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* 6.6L.3.2 — Visibilidade espacial por instância                             */
/* -------------------------------------------------------------------------- */

/**
 * Projeção ESPACIAL de UM combatente (`public` | `master-only`). MASTER-only no
 * serviço; o valor é um enum FECHADO — nunca aceita texto livre e não carrega
 * posição/tamanho/imagem junto.
 */
export const combatantSpatialVisibilitySchema = z
  .object({
    spatialVisibility: z.enum(SPATIAL_VISIBILITIES),
    expectedVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(128),
  })
  .strict();

export type CombatantSpatialVisibilityPatch = z.infer<typeof combatantSpatialVisibilitySchema>;

/* -------------------------------------------------------------------------- */
/* 6.6L.3.1 — Reaction Gate / Opportunity Attack                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolver a janela com UM ataque: o cliente envia só o `attackId` oferecido
 * pelo servidor. Bônus, alcance, dano e CA NUNCA vêm do cliente.
 */
export const opportunityAttackPayloadSchema = combatOperationSchema
  .extend({ attackId: z.string().min(1).max(160) })
  .strict();

/** Recusar ("não reagir"): não gasta a Reação. */
export const opportunityDecisionSchema = combatOperationSchema.strict();

/** Adjudicação de VISÃO pelo Mestre (só janelas `unknown`). */
export const opportunityVisibilitySchema = combatOperationSchema
  .extend({ visible: z.boolean() })
  .strict();

export type OpportunityAttackPayload = z.infer<typeof opportunityAttackPayloadSchema>;
export type OpportunityDecisionPayload = z.infer<typeof opportunityDecisionSchema>;
export type OpportunityVisibilityPayload = z.infer<typeof opportunityVisibilitySchema>;

export type MovementPreviewInput = z.infer<typeof movementPreviewSchema>;
export type MovementCommitPayload = z.infer<typeof movementCommitSchema>;
export type CombatantSidePatch = z.infer<typeof combatantSidePatchSchema>;

export type CombatOperationInput = z.infer<typeof combatOperationSchema>;
export type EconomyActionInput = z.infer<typeof economyActionSchema>;
export type EconomyOverrideInput = z.infer<typeof economyOverrideSchema>;

export const combatPingSchema = z.object({ position: spatialPositionSchema }).strict();

export const addParticipantsSchema = combatOperationSchema.extend({
  characterIds: startCombatSchema.shape.characterIds.default([]),
  characterPositions: startCombatSchema.shape.characterPositions,
  entries: startCombatSchema.shape.entries,
}).strict();
export const removeParticipantSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
}).strict();

export type AddParticipantsInput = z.infer<typeof addParticipantsSchema>;
export type RemoveParticipantInput = z.infer<typeof removeParticipantSchema>;

export const creatureAreaPreviewSchema = z.object({
  combatantId: z.string().min(1),
  abilityId: z.string().min(1),
  placement: creatureAreaPlacementSchema,
}).strict();

/** Habilidade cadastrada: custo e efeito nunca vêm do pedido. */
export const creatureAbilityUseSchema = combatOperationSchema.extend({
  combatantId: z.string().min(1),
  abilityId: z.string().min(1),
  areaPlacement: creatureAreaPlacementSchema.optional(),
  mode: z.enum(['use', 'restore', 'cancel-multiattack']).default('use'),
  confirmed: z.boolean().default(false),
}).strict();

export const hostilityDecisionSchema = combatOperationSchema.extend({
  promptId: z.string().min(1),
  hostile: z.boolean(),
  selectedIds: z.array(z.string().min(1)).max(500).default([]),
}).superRefine((input, ctx) => {
  if (input.hostile && input.selectedIds.length === 0) ctx.addIssue({ code: 'custom', message: 'Selecione os envolvidos.' });
  if (new Set(input.selectedIds).size !== input.selectedIds.length) ctx.addIssue({ code: 'custom', message: 'Não repita participantes.' });
  if (!input.hostile && input.selectedIds.length) ctx.addIssue({ code: 'custom', message: 'Manter relação não recebe envolvidos.' });
});

export const duelRequestSchema = combatOperationSchema.extend({
  requesterId: z.string().min(1),
  challengedId: z.string().min(1),
});
export const duelDecisionSchema = combatOperationSchema.extend({
  duelId: z.string().min(1),
  decision: z.enum(['accept', 'decline', 'cancel', 'end']),
});

export const opportunitySpellSchema = combatOperationSchema.extend({
  spell: z.object({spellId: z.string().min(1).max(64), spellcastingSource: spellcastingSourceRefSchema, castingResource: castingResourceRefSchema.optional()}).strict(),
}).strict();
