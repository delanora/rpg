import type { Role, User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { signToken } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { toPublicUser, type PublicUser } from '../users/users.service.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export function createSession(user: User): AuthResult {
  const token = signToken({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });

  return { token, user: toPublicUser(user) };
}

/**
 * Cria uma conta. O papel é PLAYER por padrão; vira MASTER apenas quando o
 * jogador informa o código de convite configurado em `MASTER_INVITE_CODE`.
 */
export async function registerUser(input: RegisterInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) {
    throw new HttpError('Este nome de usuário já está em uso.', 409);
  }

  let role: Role = 'PLAYER';

  if (input.masterInviteCode) {
    if (!env.MASTER_INVITE_CODE || input.masterInviteCode !== env.MASTER_INVITE_CODE) {
      throw new HttpError('Código de mestre inválido.', 403);
    }
    role = 'MASTER';
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      role,
    },
  });
}

/**
 * Valida credenciais. Usuário inexistente e senha errada devolvem a mesma
 * mensagem, para não revelar quais contas existem.
 */
export async function loginUser(input: LoginInput): Promise<User> {
  const user = await prisma.user.findUnique({ where: { username: input.username } });

  if (!user) {
    throw new HttpError('Usuário ou senha inválidos.', 401);
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new HttpError('Usuário ou senha inválidos.', 401);
  }

  return user;
}
