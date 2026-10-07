import { z } from 'zod';

/** Teto de posição/duração: 6 horas — folga generosa para uma faixa longa. */
const MAX_SECONDS = 6 * 60 * 60;

/**
 * Upload de faixa: o arquivo chega como data URL no JSON (mesma estratégia das
 * imagens, sem multipart) + o nome e a DURAÇÃO medida pelo navegador — é ela
 * que deixa o servidor agendar o fim da faixa para a mesa inteira.
 */
export const uploadTrackSchema = z.object({
  dataUrl: z.string().min(1, 'Envie um arquivo de áudio.'),
  name: z.string().trim().min(1, 'Dê um nome à faixa.').max(200),
  duration: z.number().min(0).max(MAX_SECONDS).optional(),
});

/** Mudança de estado da reprodução (patch parcial — só o que mudou). */
export const musicPatchSchema = z.object({
  playing: z.boolean().optional(),
  trackId: z.string().trim().min(1).nullable().optional(),
  position: z.number().min(0).max(MAX_SECONDS).optional(),
  repeat: z.boolean().optional(),
  /** Volume de 0 (mudo) a 1 (máximo) — vale para a mesa inteira. */
  volume: z.number().min(0).max(1).optional(),
});

/** Pular para a faixa seguinte/anterior. */
export const musicSkipSchema = z.object({
  direction: z.enum(['next', 'prev']),
});

export type UploadTrackInput = z.infer<typeof uploadTrackSchema>;
export type MusicPatchInput = z.infer<typeof musicPatchSchema>;
