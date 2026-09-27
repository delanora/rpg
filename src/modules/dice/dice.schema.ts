import { z } from 'zod';

/**
 * Pedido de rolagem da janela de dados.
 *
 * O cliente manda apenas a composição do pool e os modificadores; quem rola é
 * o servidor. O nome de quem rolou nunca vem do corpo — é resolvido a partir do
 * token (e da ficha do usuário).
 */
export const tableRollSchema = z.object({
  /** Cada dado do pool, uma entrada por dado (permite empilhar d6, d6...). */
  dice: z.array(z.object({ sides: z.number().int().min(2).max(1000) })).min(1).max(50),
  advantage: z.boolean().optional(),
  disadvantage: z.boolean().optional(),
  /** Bônus fixo (perícia/salvaguarda) somado ao resultado. */
  bonus: z.number().int().min(-100).max(100).optional(),
  /** Rótulo do teste ("Percepção"); vazio na rolagem livre. */
  label: z.string().trim().max(80).optional(),
  kind: z.enum(['skill', 'save', 'free']).optional(),
  /** Só vale para o mestre; rolagem de jogador é sempre pública. */
  private: z.boolean().optional(),
  /** Identificador do pedido, gerado no cliente (ver DiceRollDto.clientId). */
  clientId: z.string().trim().max(64).optional(),
});

/**
 * Aviso de que a janela de dados abriu (ou fechou).
 *
 * O cliente manda apenas o rótulo do teste e o estado; a identidade (nome e
 * avatar) é resolvida no servidor a partir do token.
 */
export const activeRollSchema = z.object({
  active: z.boolean(),
  label: z.string().trim().max(80).optional(),
  kind: z.enum(['skill', 'save', 'free']).optional(),
  /** Só vale para o mestre; rolagem de jogador é sempre pública. */
  private: z.boolean().optional(),
  /** O tabuleiro montado: a mesa assiste, só o autor interage. */
  pool: z
    .array(
      z.object({
        sides: z.number().int().min(2).max(1000),
        locked: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
  advantage: z.boolean().optional(),
  disadvantage: z.boolean().optional(),
  bonus: z.number().int().min(-100).max(100).optional(),
});

export type TableRollInput = z.infer<typeof tableRollSchema>;
export type ActiveRollInput = z.infer<typeof activeRollSchema>;
