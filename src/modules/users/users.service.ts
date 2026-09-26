import type { Role, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/** Representação segura do usuário — nunca expõe o hash da senha. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Lista todos os usuários (usada pelo painel do mestre). */
export function listUsers(): Promise<User[]> {
  return prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
