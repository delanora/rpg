import { z } from 'zod';
import { entitySchema } from '../../shared/conditions.js';
import { spellcastingSourceRefSchema } from './spellcasting-source.js';
import { castingResourceRefSchema } from './casting-resource.js';
import { spatialConfirmationSchema } from './spatial-validation.js';
import { areaPlacementSchema } from './area-targeting.js';

/**
 * FASE 6.6A/6.6B — contrato HTTP do CASTING (apenas prova/administração).
 *
 * A rota genérica é MASTER-only nesta fase: NÃO existe conjuração de PLAYER
 * enquanto slot/Ação/componentes/preparação não forem validados. O cliente
 * envia a INTENÇÃO (magia, caster, alvos e, no multiclasse, QUAL fonte de
 * conjuração); atributo do save, CD, bônus de ataque, Condition, definição de
 * efeito e ordem do lifecycle são do SERVIDOR.
 *
 * Não há campo de CD: desde a 6.6B ela é derivada do perfil de conjuração
 * (personagem) ou vem do statblock (criatura).
 */
export const spellCastProofSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  spellId: z.string().trim().min(1).max(64),
  caster: entitySchema,
  // O limite REAL depende da magia + `castAtLevel` (derivado do espaço); o teto
  // do schema é só uma barreira de entrada. O servidor revalida pelo targeting.
  // 6.6J.3: em magias de ÁREA este campo fica VAZIO — a lista de atingidos é
  // derivada no servidor e enviá-la é erro (`AREA_TARGETS_CLIENT_SUPPLIED`).
  targets: z.array(entitySchema).max(12).default([]),
  /**
   * 6.6J.3: COLOCAÇÃO da área. Só origem/direção/inclusão do ponto de origem —
   * forma, dimensões, alcance e atingidos pertencem à definição/servidor.
   */
  areaPlacement: areaPlacementSchema.optional(),
  /**
   * Fonte de conjuração escolhida. Obrigatória só quando o caster tem MAIS de
   * uma; o servidor revalida a posse e ignora qualquer número enviado.
   */
  spellcastingSource: spellcastingSourceRefSchema.optional(),
  /**
   * Espaço a gastar (6.6C). Obrigatório só quando há MAIS de um compatível;
   * `level` vira o `castAtLevel` do cast. O cliente nunca envia remaining/max e
   * nunca escolhe um nível abaixo do nível da magia.
   */
  castingResource: castingResourceRefSchema.optional(),
  /**
   * Confirmação ESPACIAL do Mestre (6.6E). Só para requisitos que o servidor
   * declarou necessários e não consegue medir (alcance/cobertura/visão). Nunca
   * contém distância numérica e NUNCA sobrescreve um `fail` autoritativo.
   */
  spatialConfirmation: spatialConfirmationSchema.optional(),
})
  // Campos desconhecidos são RECUSADOS: o cliente não pode mandar raio/forma,
  // lista de atingidos nem resultado espacial.
  .strict();

export type SpellCastProofInput = z.infer<typeof spellCastProofSchema>;

/**
 * 6.6J.3 — decisão do MESTRE sobre um candidato cuja área é `unknown`.
 * Chave canônica `kind:id`; NUNCA substitui a lista inteira de atingidos.
 */
export const areaUnknownDecisionSchema = z
  .object({
    targetKey: z.string().trim().min(1).max(200),
    affected: z.boolean(),
  })
  .strict();

/** Aprovação de intenção: confirmações espaciais + decisões de `unknown`. */
export const spellIntentApprovalSchema = z
  .object({
    spatialConfirmation: spatialConfirmationSchema.optional(),
    unknownTargetDecisions: z.array(areaUnknownDecisionSchema).max(64).optional(),
  })
  .strict();
