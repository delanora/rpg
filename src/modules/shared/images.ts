import { z } from 'zod';

/**
 * Imagem já armazenada no servidor, referenciada pela URL pública em
 * `/uploads/...`. Usada pelas regiões e pelas localidades do mestre.
 */
export const imageSchema = z.object({
  url: z.string().trim().min(1).max(500),
  name: z.string().trim().max(200).default(''),
});

export type ImageRef = z.infer<typeof imageSchema>;

/** Lista de imagens lida de um JSONB, tolerante a dados antigos. */
export const imageListSchema = z.array(imageSchema);
