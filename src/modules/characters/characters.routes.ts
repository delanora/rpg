import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { toCharacterDto } from './characters.dto.js';
import { createCharacterSchema, updateCharacterSchema } from './characters.schema.js';
import {
  createCharacter,
  getCharacterByUserId,
  listCharacters,
  updateCharacter,
  updateCharacterAsMaster,
  type Actor,
} from './characters.service.js';

export const charactersRouter = Router();

/** Extrai o autor da requisição (sempre do token, jamais do corpo). */
function actorFrom(req: {
  user?: { sub: string; username: string; displayName: string };
}): Actor {
  return {
    userId: req.user!.sub,
    username: req.user!.username,
    displayName: req.user!.displayName,
  };
}

/**
 * GET /api/characters/me
 * Devolve a própria ficha (ou `null` se o jogador ainda não criou).
 * O `userId` vem do token, então é impossível ler a ficha de outra pessoa.
 */
charactersRouter.get('/me', authenticate, async (req, res) => {
  const character = await getCharacterByUserId(req.user!.sub);
  res.json({ character: character ? toCharacterDto(character) : null });
});

/** POST /api/characters/me — cria a própria ficha. */
charactersRouter.post('/me', authenticate, async (req, res) => {
  const parsed = createCharacterSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await createCharacter(actorFrom(req), parsed.data);
  res.status(201).json({ character });
});

/**
 * PATCH /api/characters/me — edição inline.
 * Aceita qualquer subconjunto dos campos da ficha.
 */
charactersRouter.patch('/me', authenticate, async (req, res) => {
  const parsed = updateCharacterSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  const character = await updateCharacter(actorFrom(req), parsed.data);
  res.json({ character });
});

/**
 * GET /api/characters — lista todas as fichas da mesa.
 * Exclusivo do mestre; é a base do painel de controle (Etapa 3).
 */
charactersRouter.get('/', authenticate, requireRole('MASTER'), async (_req, res) => {
  const characters = await listCharacters();
  res.json({ characters });
});

/**
 * PATCH /api/characters/:id — o mestre ajusta a ficha de um jogador.
 *
 * A ficha continua pertencendo ao jogador: o mestre recebe o resultado, o
 * dono é avisado em tempo real (com `editedBy` marcando quem mexeu) e a
 * própria ficha segue sendo a do jogador — nada muda de dono.
 */
charactersRouter.patch('/:id', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = updateCharacterSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  const character = await updateCharacterAsMaster(
    String(req.params.id),
    actorFrom(req),
    parsed.data,
  );
  res.json({ character });
});
