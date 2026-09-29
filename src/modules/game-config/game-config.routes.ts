import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  getGameConfig,
  getMasterNotes,
  releaseLevelUp,
  setExtraCoins,
  setMasterNotes,
  setStartingLevel,
} from './game-config.service.js';
import { LEVEL_MAX, LEVEL_MIN } from '../shared/dnd5e.js';

export const gameConfigRouter = Router();

gameConfigRouter.use(authenticate);

const startingLevelSchema = z.object({
  level: z.number().int().min(LEVEL_MIN).max(LEVEL_MAX),
});

/** Liga/desliga a exibição de PL e PE no bloco de moedas da ficha. */
const extraCoinsSchema = z.object({
  enabled: z.boolean(),
});

/** Limite das anotações do mestre (o mesmo dos textos livres da ficha). */
const MASTER_NOTES_MAX = 20000;

const masterNotesSchema = z.object({
  notes: z.string().max(MASTER_NOTES_MAX),
});

/** GET /api/game — configuração atual da mesa (usada ao abrir a ficha). */
gameConfigRouter.get('/', (_req, res) => {
  void getGameConfig()
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/**
 * POST /api/game/starting-level — o mestre define o nível inicial da mesa.
 *
 * É o nível em que os personagens novos começam: o assistente de criação aplica
 * os níveis 2 até ele ao concluir a montagem.
 */
gameConfigRouter.post('/starting-level', requireRole('MASTER'), (req, res) => {
  const parsed = startingLevelSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  void setStartingLevel(parsed.data.level)
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/**
 * POST /api/game/extra-coins — o mestre liga/desliga as denominações extras.
 *
 * Só afeta a EXIBIÇÃO de PL (pp) e PE (ep) no bloco de moedas: os valores das
 * cinco denominações existem sempre na ficha.
 */
gameConfigRouter.post('/extra-coins', requireRole('MASTER'), (req, res) => {
  const parsed = extraCoinsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  void setExtraCoins(parsed.data.enabled)
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/**
 * GET /api/game/notes — anotações privadas do mestre (só MASTER).
 *
 * Fora do GET /api/game de propósito: lá a configuração é entregue também ao
 * jogador, e as anotações são do mestre.
 */
gameConfigRouter.get('/notes', requireRole('MASTER'), (_req, res) => {
  void getMasterNotes()
    .then((notes) => res.json(notes))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/**
 * PATCH /api/game/notes — grava as anotações do mestre (só MASTER).
 *
 * Substituição integral do texto; sem evento em tempo real (é privado).
 */
gameConfigRouter.patch('/notes', requireRole('MASTER'), (req, res) => {
  const parsed = masterNotesSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  void setMasterNotes(parsed.data.notes)
    .then((notes) => res.json(notes))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});

/**
 * POST /api/game/level-up — o mestre libera UM Level Up para a mesa.
 *
 * Cada chamada conta como uma liberação nova (incrementa o contador), então o
 * mestre NÃO precisa bloquear antes de liberar de novo: quem já subiu de nível
 * fica de fora até o próximo clique.
 */
gameConfigRouter.post('/level-up', requireRole('MASTER'), (_req, res) => {
  void releaseLevelUp()
    .then((config) => res.json({ config }))
    .catch(() => res.status(500).json({ error: 'INTERNAL_ERROR' }));
});
