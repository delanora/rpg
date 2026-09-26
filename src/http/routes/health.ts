import { Router } from 'express';
import { prisma } from '../../config/prisma.js';

export const healthRouter = Router();

/**
 * GET /api/health
 * Verifica se o servidor está no ar e se o PostgreSQL responde.
 * Útil para monitoramento e para os health checks dos provedores de hospedagem.
 */
healthRouter.get('/', async (_req, res) => {
  let database = 'up';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  const healthy = database === 'up';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
});
