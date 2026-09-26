import type { PublicUser, SessionUser } from './types';

const TOKEN_KEY = 'grimorio.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Detalha erros de validação (issues do Zod) em uma mensagem legível. */
function describeError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message) return record.message;

    if (record.issues && typeof record.issues === 'object') {
      const parts: string[] = [];
      for (const value of Object.values(record.issues as Record<string, unknown>)) {
        if (Array.isArray(value)) parts.push(...value.map(String));
      }
      if (parts.length > 0) return parts.join(' ');
    }
  }
  return `Erro inesperado (HTTP ${status}).`;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(describeError(data, response.status), response.status);
  }

  return data as T;
}

interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface RegisterInput {
  username: string;
  displayName: string;
  password: string;
  masterInviteCode?: string;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/register', { method: 'POST', body: input });
}

/** Busca o usuário do token atual (usado ao recarregar a página). */
export interface StoredImage {
  url: string;
  name: string;
}

/**
 * Lê um arquivo de imagem e devolve uma data URL reduzida (máx. 1600px no
 * maior lado). Diminuir antes de enviar evita trafegar fotos de vários MB.
 */
export async function fileToImagePayload(file: File): Promise<{ dataUrl: string; name: string }> {
  const maxSide = 1600;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível processar a imagem.');

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // PNG/GIF mantêm transparência; o resto vira JPEG para ficar leve.
  const keepPng = file.type === 'image/png' || file.type === 'image/gif';
  const dataUrl = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85);

  return { dataUrl, name: file.name };
}

export type UploadFolder = 'localities' | 'creatures' | 'characters' | 'items';

/**
 * Envia uma imagem (data URL) e recebe a URL pública em `/uploads/<pasta>/...`.
 * Exclusivo do mestre (localidades, criaturas e itens do catálogo).
 */
export async function uploadImage(
  dataUrl: string,
  name: string,
  folder: UploadFolder = 'localities',
): Promise<StoredImage> {
  const { image } = await api<{ image: StoredImage }>('/api/uploads/image', {
    method: 'POST',
    body: { dataUrl, name, folder },
  });
  return image;
}

/** Envia o avatar do próprio personagem (aberto a qualquer jogador conectado). */
export async function uploadAvatar(dataUrl: string, name: string): Promise<StoredImage> {
  const { image } = await api<{ image: StoredImage }>('/api/uploads/avatar', {
    method: 'POST',
    body: { dataUrl, name },
  });
  return image;
}

export async function fetchCurrentUser(): Promise<SessionUser> {
  const { user } = await api<{
    user: { sub: string; username: string; displayName: string; role: SessionUser['role'] };
  }>('/api/auth/me');

  return {
    id: user.sub,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}
