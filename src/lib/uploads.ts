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
 * Grava uma imagem enviada como data URL e devolve a URL pública.
 * Lança `HttpError` 400 quando o formato não é suportado ou passa do limite.
 */
export async function saveDataUrlImage(dataUrl: string, name: string): Promise<StoredImage> {
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
  const directory = path.join(UPLOADS_DIR, 'localities');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), buffer);

  return { url: `/uploads/localities/${fileName}`, name: name.trim().slice(0, 200) };
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
