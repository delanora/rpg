import { z } from 'zod';
import { imageSchema } from '../shared/images.js';

const regionFields = z.object({
  name: z.string().trim().min(1, 'A região precisa de um nome.').max(120),
  description: z.string().max(20000),
  /** Anotações livres do mestre sobre a região. */
  notes: z.string().max(20000),
  images: z.array(imageSchema).max(20),
});

/** Criação: só o nome é obrigatório. */
export const createRegionSchema = z.object({
  name: z.string().trim().min(1, 'A região precisa de um nome.').max(120),
  description: z.string().max(20000).optional(),
  notes: z.string().max(20000).optional(),
  images: z.array(imageSchema).max(20).optional(),
});

/** Edição: aceita qualquer subconjunto de campos. */
export const updateRegionSchema = regionFields.partial();

export type CreateRegionInput = z.infer<typeof createRegionSchema>;
export type UpdateRegionInput = z.infer<typeof updateRegionSchema>;
