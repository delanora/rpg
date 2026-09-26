import { z } from 'zod';

/**
 * Formato de ataque compartilhado entre fichas de jogador e criaturas.
 *
 * Fica em `shared` porque a Etapa 4 (combate) precisa rolar ataques tanto de
 * personagens quanto de criaturas — o mesmo shape nos dois lados evita
 * conversões e duplicação de código.
 */

/** Tipos de dano do livro básico. */
export const DAMAGE_TYPES = [
  'Cortante',
  'Perfurante',
  'Concussão',
  'Ácido',
  'Frio',
  'Fogo',
  'Elétrico',
  'Necrótico',
  'Veneno',
  'Psíquico',
  'Radiante',
  'Trovão',
  'Força',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export const attackSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'O ataque precisa de um nome.').max(120),
  damage: z.string().trim().max(120).default(''),
  damageType: z.string().trim().max(60).default(''),
  attackBonus: z.number().int().min(-30).max(30).default(0),
  notes: z.string().trim().max(1000).default(''),
});

export type Attack = z.infer<typeof attackSchema>;

/**
 * Lista de resistências ou imunidades a tipos de dano.
 * Restrita aos tipos canônicos para que o combate possa compará-las.
 */
export const damageTypeListSchema = z.array(z.enum(DAMAGE_TYPES)).max(DAMAGE_TYPES.length);
