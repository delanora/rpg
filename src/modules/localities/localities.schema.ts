import { z } from 'zod';

/** Imagem já armazenada, referenciada pela URL pública em `/uploads/...`. */
export const localityImageSchema = z.object({
  url: z.string().trim().min(1).max(500),
  name: z.string().trim().max(200).default(''),
});

const localityFields = z.object({
  name: z.string().trim().min(1, 'A localidade precisa de um nome.').max(120),
  description: z.string().max(20000),
  images: z.array(localityImageSchema).max(20),
});

/** Criação: nome obrigatório; descrição e imagens opcionais. */
export const createLocalitySchema = z.object({
  name: z.string().trim().min(1, 'A localidade precisa de um nome.').max(120),
  description: z.string().max(20000).optional(),
  images: z.array(localityImageSchema).max(20).optional(),
});

/** Edição: aceita qualquer subconjunto de campos. */
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
export type LocalityImage = z.infer<typeof localityImageSchema>;
