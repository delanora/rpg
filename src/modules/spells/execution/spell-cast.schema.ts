import { z } from 'zod';
import { entitySchema } from '../../shared/conditions.js';
import { spellcastingSourceRefSchema } from './spellcasting-source.js';
import { castingResourceRefSchema } from './casting-resource.js';

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
  targets: z.array(entitySchema).min(1).max(3),
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
});

export type SpellCastProofInput = z.infer<typeof spellCastProofSchema>;
