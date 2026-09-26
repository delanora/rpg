import type { Role } from '@prisma/client';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Dados embutidos no token. `sub` é o id do usuário. */
export interface TokenPayload {
  sub: string;
  username: string;
  displayName: string;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

/** Lança se o token for inválido/expirado. Retorna os dados caso seja válido. */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

/** Verifica sem lançar — útil onde o token pode estar ausente ou inválido. */
export function tryVerifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

/** Extrai o token de um header `Authorization: Bearer <token>`. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
