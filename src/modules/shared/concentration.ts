import { z } from 'zod';

/**
 * CONCENTRAÇÃO (PHB 2014, p. 203) — estado mecânico PRÓPRIO.
 *
 * Não é uma Condition: sobrevive fora do combate, tem identidade (`id`) e
 * substitui a anterior quando uma nova começa. O estado mora no
 * `mechanicalState` da entidade (ficha/criatura/instância de combate), que já é
 * o dono de Conditions e Exaustão — nada de segunda fonte de verdade.
 *
 * `visibility` decide o que os JOGADORES veem: efeitos manuais do Mestre podem
 * ser privados (nome do efeito oculto, save oculto).
 */
export const concentrationSourceTypeSchema = z.enum(['manual', 'spell', 'effect', 'feature']);

export const concentrationStateSchema = z.object({
  id: z.string().min(1),
  /** Nome visível do efeito ("Bless", "Segurar Pessoa", "Ritual da mesa"). */
  label: z.string().trim().min(1).max(80),
  /** Origem: hoje só `manual` é criada; spell/effect/feature ficam prontas. */
  sourceType: concentrationSourceTypeSchema.default('manual'),
  sourceId: z.string().max(128).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  startedAt: z.string(),
  /** Quem iniciou (uuid do usuário), nunca o nome do corpo da requisição. */
  startedBy: z.string().optional(),
});
export type ConcentrationState = z.infer<typeof concentrationStateSchema>;

/**
 * Teste de concentração PENDENTE, derivado de UM evento de dano.
 *
 * Fica no estado (persistido) — não em React, não em memória do processo: um
 * refresh/reconnect mantém a pendência. `eventId` vem do evento de dano, então
 * repetir a mesma operação não cria um segundo teste.
 */
export const concentrationSaveSchema = z.object({
  id: z.string().min(1),
  /** Concentração que este teste pode encerrar (save antigo não atinge a nova). */
  concentrationId: z.string().min(1),
  /** Sem teto: 40 de dano = CD 20, 500 de dano = CD 250 (morte instantânea). */
  dc: z.number().int().min(10),
  /** Dano FINAL recebido no evento (0 nunca gera pendência). */
  damage: z.number().int().nonnegative(),
  /** Id do evento de dano — idempotência contra retry/republicação. */
  eventId: z.string().min(1),
  sourceName: z.string().max(80).optional(),
  at: z.string(),
});
export type ConcentrationSave = z.infer<typeof concentrationSaveSchema>;

/**
 * CD do teste de concentração: `max(10, floor(dano / 2))`, exatamente o PHB.
 *
 * 1..21 de dano → CD 10; 22 → 11; 40 → 20. Nunca usa o dano bruto anterior às
 * resistências: quem chama já passa o dano FINAL aplicado.
 */
export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(Math.max(0, damage) / 2));
}

/** Rótulo único do teste (bandeja de dados e registro de combate). */
export function concentrationSaveLabel(dc: number): string {
  return `Concentração (Constituição) — CD ${dc}`;
}
