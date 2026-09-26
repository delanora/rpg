import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

/**
 * Singleton do PrismaClient.
 * Em desenvolvimento o `tsx watch` recarrega o módulo a cada alteração; guardar
 * a instância no `globalThis` evita abrir conexões novas a cada reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
