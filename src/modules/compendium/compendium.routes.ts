import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { getCompendium } from './compendium.service.js';

export const compendiumRouter = Router();

compendiumRouter.use(authenticate);

/**
 * GET /api/compendium — listas de referência da mesa.
 *
 * Alimenta a aba "Configurações da mesa" do painel do mestre (classes, raças,
 * antecedentes e magias). Somente leitura por enquanto; aberto a qualquer
 * usuário autenticado para que a mesma fonte sirva a uma futura consulta do
 * jogador.
 */
compendiumRouter.get('/', async (_req, res) => {
  res.json({ compendium: await getCompendium() });
});
