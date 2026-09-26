import { z } from 'zod';
import { imageSchema, type ImageRef } from '../shared/images.js';

/**
 * Imagem já armazenada, referenciada pela URL pública em `/uploads/...`.
 * O formato é compartilhado com as regiões (ver `shared/images.ts`).
 */
export const localityImageSchema = imageSchema;

export type LocalityImage = ImageRef;

const localityFields = z.object({
  name: z.string().trim().min(1, 'A localidade precisa de um nome.').max(120),
  description: z.string().max(20000),
  images: z.array(localityImageSchema).max(20),
  /** Região dona da localidade (as criaturas ficam presas à localidade). */
  regionId: z.string().trim().min(1, 'Escolha a região da localidade.'),
});

/** Criação: nome e região obrigatórios; descrição e imagens opcionais. */
export const createLocalitySchema = z.object({
  name: z.string().trim().min(1, 'A localidade precisa de um nome.').max(120),
  description: z.string().max(20000).optional(),
  images: z.array(localityImageSchema).max(20).optional(),
  regionId: z.string().trim().min(1, 'Escolha a região da localidade.'),
});

/** Edição: aceita qualquer subconjunto de campos (inclusive trocar de região). */
export const updateLocalitySchema = localityFields.partial();

/** Pastas de upload aceitas (espelha src/lib/uploads.ts). */
export const uploadFolderSchema = z.enum(['localities', 'creatures', 'characters', 'items']);

/** Upload de imagem: data URL + nome amigável + pasta de destino opcional. */
export const uploadImageSchema = z.object({
  dataUrl: z.string().min(1, 'Envie uma imagem.'),
  name: z.string().trim().max(200).optional(),
  folder: uploadFolderSchema.optional(),
});

export type CreateLocalityInput = z.infer<typeof createLocalitySchema>;
export type UpdateLocalityInput = z.infer<typeof updateLocalitySchema>;
