import { z } from 'zod';
import { damageTypeListSchema } from '../shared/attacks.js';
import { ABILITY_KEYS, type AbilityKey } from '../shared/dnd5e.js';

/**
 * Validação das raças PERSONALIZADAS do mestre (Prompt 2.10).
 *
 * Bem mais simples que o catálogo fixo: os traços são TEXTO LIVRE (sem
 * `mechanicalEffect` estruturado) e não há sub-raças. Os campos que a ficha
 * realmente aplica — atributos, deslocamento, visão no escuro, resistências —
 * seguem os mesmos formatos do resto do sistema.
 */

/** Chave de atributo (strength/dexterity/…). */
export const abilityKeySchema = z.custom<AbilityKey>(
  (value) => typeof value === 'string' && (ABILITY_KEYS as readonly string[]).includes(value),
  { message: 'Atributo desconhecido.' },
);

/** Incremento fixo de atributo ([{ ability, amount }]). */
export const abilityScoreIncreaseSchema = z.object({
  ability: abilityKeySchema,
  /** Pode ser negativo (raças que reduzem um atributo). */
  amount: z.number().int().min(-5).max(5),
});

/** Traço em texto livre. */
export const customRaceTraitSchema = z.object({
  name: z.string().trim().min(1, 'O traço precisa de um nome.').max(120),
  description: z.string().trim().max(20000),
});

export const customRaceSizeSchema = z.enum(['Small', 'Medium']);

/** Campos editáveis de uma raça personalizada. */
const customRaceFields = z.object({
  name: z.string().trim().min(1, 'A raça precisa de um nome.').max(120),
  description: z.string().trim().max(20000),
  abilityScoreIncrease: z.array(abilityScoreIncreaseSchema).max(6),
  /** Deslocamento em metros (7,5 / 9 / 10,5…). */
  speed: z.number().min(0).max(60),
  size: customRaceSizeSchema,
  /** Visão no escuro em metros (0 = sem). */
  darkvision: z.number().min(0).max(120),
  /** Tipos de dano resistidos, pelos 13 canônicos. */
  damageResistances: damageTypeListSchema,
  /** Idiomas conhecidos (texto). */
  languages: z.array(z.string().trim().min(1).max(60)).max(20),
  /** Quantos idiomas à escolha a raça concede. */
  bonusLanguageChoices: z.number().int().min(0).max(5),
  traits: z.array(customRaceTraitSchema).max(30),
});

/** Criação: só o nome é obrigatório. */
export const createCustomRaceSchema = z.object({
  name: z.string().trim().min(1, 'A raça precisa de um nome.').max(120),
  description: z.string().trim().max(20000).optional(),
  abilityScoreIncrease: z.array(abilityScoreIncreaseSchema).max(6).optional(),
  speed: z.number().min(0).max(60).optional(),
  size: customRaceSizeSchema.optional(),
  darkvision: z.number().min(0).max(120).optional(),
  damageResistances: damageTypeListSchema.optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  bonusLanguageChoices: z.number().int().min(0).max(5).optional(),
  traits: z.array(customRaceTraitSchema).max(30).optional(),
});

/** Edição: aceita qualquer subconjunto de campos. */
export const updateCustomRaceSchema = customRaceFields.partial();

export type CreateCustomRaceInput = z.infer<typeof createCustomRaceSchema>;
export type UpdateCustomRaceInput = z.infer<typeof updateCustomRaceSchema>;
