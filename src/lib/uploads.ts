import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http-error.js';

/**
 * Armazenamento local de imagens enviadas pelo mestre (ex.: fotos de uma
 * localidade). Os arquivos vivem em `uploads/` na raiz do projeto e são
 * servidos estaticamente em `/uploads/...`.
 *
 * As imagens chegam como data URL (base64) no JSON — evita uma dependência de
 * multipart e funciona igual no dev e após o build.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** `src/lib` e `dist/lib` estão ambos a dois níveis da raiz do projeto. */
export const UPLOADS_DIR = path.resolve(currentDir, '../../uploads');

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Tamanho máximo do arquivo já decodificado (5 MB). */
const MAX_BYTES = 5 * 1024 * 1024;

const DATA_URL = /^data:(image\/[a-zA-Z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export interface StoredImage {
  url: string;
  name: string;
}

/**
 * Pastas aceitas no armazenamento. Cada tipo de conteúdo tem a sua, o que
 * mantém os arquivos organizados e a limpeza por recurso simples.
 */
export const UPLOAD_FOLDERS = ['localities', 'creatures', 'characters', 'items'] as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

/**
 * Grava uma imagem enviada como data URL e devolve a URL pública.
 * Lança `HttpError` 400 quando o formato não é suportado ou passa do limite.
 */
export async function saveDataUrlImage(
  dataUrl: string,
  name: string,
  folder: UploadFolder = 'localities',
): Promise<StoredImage> {
  const safeFolder = UPLOAD_FOLDERS.includes(folder) ? folder : 'localities';
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) {
    throw new HttpError('Formato de imagem inválido (use PNG, JPEG, WEBP ou GIF).', 400);
  }

  const mime = match[1].toLowerCase();
  const extension = EXTENSIONS[mime];
  if (!extension) {
    throw new HttpError('Tipo de imagem não suportado (use PNG, JPEG, WEBP ou GIF).', 400);
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new HttpError('A imagem está vazia.', 400);
  }
  if (buffer.length > MAX_BYTES) {
    throw new HttpError('A imagem é grande demais (máximo de 5 MB).', 400);
  }

  const fileName = `${randomUUID()}.${extension}`;
  const directory = path.join(UPLOADS_DIR, safeFolder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), buffer);

  return { url: `/uploads/${safeFolder}/${fileName}`, name: name.trim().slice(0, 200) };
}

/**
 * Pasta das músicas da mesa. O arquivo é sempre gravado aqui; a pasta existe
 * apenas no disco e é criada sob demanda.
 */
export const MUSIC_FOLDER = 'music';

/** Extensões de áudio aceitas (o navegador manda o MIME no data URL). */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

/** Tamanho máximo do áudio já decodificado (24 MB — uma faixa típica). */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

const AUDIO_DATA_URL = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export interface StoredAudio {
  url: string;
  name: string;
  /** Tamanho do arquivo em bytes (mostrado na lista do mestre). */
  size: number;
}

/**
 * Grava um áudio enviado como data URL e devolve a URL pública.
 *
 * Mesma estratégia das imagens (base64 no JSON, sem multipart), com um teto
 * próprio — uma faixa é bem maior que um sprite.
 */
export async function saveDataUrlAudio(dataUrl: string, name: string): Promise<StoredAudio> {
  const match = AUDIO_DATA_URL.exec(dataUrl.trim());
  if (!match) {
    throw new HttpError('Formato de áudio inválido (use MP3, OGG, WAV, M4A ou WEBM).', 400);
  }

  const extension = AUDIO_EXTENSIONS[match[1].toLowerCase()];
  if (!extension) {
    throw new HttpError('Tipo de áudio não suportado (use MP3, OGG, WAV, M4A ou WEBM).', 400);
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new HttpError('O arquivo de áudio está vazio.', 400);
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new HttpError('O áudio é grande demais (máximo de 24 MB).', 400);
  }

  const fileName = `${randomUUID()}.${extension}`;
  const directory = path.join(UPLOADS_DIR, MUSIC_FOLDER);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), buffer);

  return { url: `/uploads/${MUSIC_FOLDER}/${fileName}`, name: name.trim().slice(0, 200), size: buffer.length };
}

/** Remove um arquivo de upload a partir da URL pública (best-effort). */
export async function deleteUploadedImage(url: string): Promise<void> {
  if (!url.startsWith('/uploads/')) return;

  const relative = url.replace(/^\/uploads\//, '');
  const target = path.resolve(UPLOADS_DIR, relative);

  // Nunca sai da pasta de uploads, mesmo com um `..` malicioso no caminho.
  if (!target.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) return;

  try {
    await rm(target, { force: true });
  } catch {
    // Arquivo já removido — nada a fazer.
  }
}
