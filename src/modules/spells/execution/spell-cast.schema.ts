import { z } from 'zod';
import { entitySchema } from '../../shared/conditions.js';

/**
 * FASE 6.6A — contrato HTTP do CASTING (apenas prova/administração).
 *
 * A rota genérica é MASTER-only nesta fase: NÃO existe conjuração de PLAYER
 * enquanto slot/Ação/componentes/preparação não forem validados. O cliente
 * envia a INTENÇÃO (magia, caster, alvos e, quando a definição exige, a CD
 * manual de prova); atributo do save, Condition, definição de efeito e ordem
 * do lifecycle são do servidor.
 */
export const spellCastProofSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  spellId: z.string().trim().min(1).max(64),
  caster: entitySchema,
  targets: z.array(entitySchema).min(1).max(3),
  /**
   * CD manual de prova (fallback da 6.6A). Só é usada quando a definição
   * declara `manualSaveDc`; a 6.6B passa a derivá-la do caster.
   */
  dc: z.number().int().min(1).max(30).optional(),
});

export type SpellCastProofInput = z.infer<typeof spellCastProofSchema>;
