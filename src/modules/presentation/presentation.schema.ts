import { z } from 'zod';

/**
 * Só aceitamos imagens do próprio grimório (`/uploads/...`), data URLs de
 * imagem ou http(s) — evita que um `src` esquisito chegue às telas da mesa.
 */
const imageUrlSchema = z
  .string()
  .trim()
  .min(1, 'Informe a imagem a apresentar.')
  .max(2000)
  .refine(
    (value) =>
      value.startsWith('/uploads/') || value.startsWith('data:image/') || /^https?:\/\//.test(value),
    'Endereço de imagem não suportado.',
  );

/**
 * O mestre manda apenas a imagem e um rótulo: quem apresentou e quando é
 * carimbado pelo servidor a partir do token, igual às demais escritas.
 */
export const presentImageSchema = z.object({
  imageUrl: imageUrlSchema,
  alt: z.string().trim().max(160).optional(),
});

export type PresentImageInput = z.infer<typeof presentImageSchema>;
