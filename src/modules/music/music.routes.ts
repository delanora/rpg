import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { musicPatchSchema, musicSkipSchema, uploadTrackSchema } from './music.schema.js';
import {
  addTrack,
  applyPatch,
  deleteTrack,
  getState,
  listTracks,
  skip,
} from './music.service.js';

export const musicRouter = Router();

musicRouter.use(authenticate);

/**
 * GET /api/music/state — estado da reprodução.
 * Acessível a TODOS: é o que o jogador segue para escutar a mesma música.
 */
musicRouter.get('/state', async (_req, res) => {
  res.json({ state: await getState() });
});

/**
 * Catálogo e comandos de reprodução são exclusivos do mestre — só ele comanda
 * a mesa. O `requireRole` fica no router (e não em cada rota), como nos demais
 * módulos, e a sessão do jogador nem alcança estes caminhos.
 */
const masterOnly = Router();
masterOnly.use(requireRole('MASTER'));

/** GET /api/music/tracks — catálogo completo (só o mestre tem a interface). */
masterOnly.get('/tracks', async (_req, res) => {
  res.json({ tracks: await listTracks() });
});

/** POST /api/music/tracks — upload de uma faixa (data URL em JSON). */
masterOnly.post('/tracks', async (req, res) => {
  const parsed = uploadTrackSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ track: await addTrack(parsed.data) });
});

/** DELETE /api/music/tracks/:id — remove a faixa e o arquivo. */
masterOnly.delete('/tracks/:id', async (req, res) => {
  await deleteTrack(req.params.id);
  res.status(204).end();
});

/**
 * POST /api/music/state — muda a reprodução (tocar, pausar, escolher faixa,
 * buscar posição, repetir).
 */
masterOnly.post('/state', async (req, res) => {
  const parsed = musicPatchSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ state: await applyPatch(parsed.data) });
});

/** POST /api/music/skip — próxima/anterior (dá a volta na lista). */
masterOnly.post('/skip', async (req, res) => {
  const parsed = musicSkipSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.json({ state: await skip(parsed.data.direction) });
});

musicRouter.use(masterOnly);
