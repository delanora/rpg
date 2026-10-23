import { z } from 'zod';
import { entitySchema } from '../shared/conditions.js';

/**
 * Entradas do ciclo de morte (Fase 6.3).
 *
 * O cliente manda apenas a INTENÇÃO (entidade, versão esperada, chave de
 * idempotência e a decisão). Quem é o autor, o que o PHB indicou e o resultado
 * de qualquer rolagem são resolvidos no SERVIDOR.
 */
const base = {
  entity: entitySchema,
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
  reason: z.string().trim().max(300).optional(),
};

/**
 * Corpo comum a todas as operações de morte (sem a decisão/ação): a rota
 * `/api/death/stabilize` é genérica e NÃO carrega `action` — o alvo é o próprio
 * caminho. Serve hoje ao Mestre e, depois, a Medicine/Spare the Dying.
 */
export const deathStabilizeSchema = z.object({ ...base });

/** Decisão do Mestre sobre uma pendência de morte. */
export const deathResolveSchema = z.object({
  ...base,
  decision: z.enum([
    'confirm-death',
    'narrative-1hp',
    'fall-to-zero',
    'roll-death-saves',
    // "Deixar estabilizado": 0 PV, vivo, Inconsciente, contadores zerados.
    'leave-stabilized',
  ]),
});

/** Override administrativo do Mestre (contadores, estabilizar, ressuscitar). */
export const deathMutationSchema = z.object({
  ...base,
  action: z.enum([
    'add-success',
    'remove-success',
    'add-failure',
    'remove-failure',
    'stabilize',
    'leave-stabilized',
    'unstabilize',
    'confirm-death',
    'narrative-1hp',
    'keep-at-zero',
    'death-saves',
    'revive',
  ]),
});

/** Resposta do jogador à oferta da Resistência Implacável. */
export const deathRelentlessSchema = z.object({
  ...base,
  answer: z.enum(['use', 'decline']),
});

export type DeathResolveInput = z.infer<typeof deathResolveSchema>;
export type DeathMutationInput = z.infer<typeof deathMutationSchema>;
export type DeathRelentlessInput = z.infer<typeof deathRelentlessSchema>;
export type DeathStabilizeInput = z.infer<typeof deathStabilizeSchema>;
