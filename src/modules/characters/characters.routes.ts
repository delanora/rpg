import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createCharacterSchema,
  levelUpSchema,
  moveInventoryItemSchema,
  updateCharacterSchema,
} from './characters.schema.js';
import {
  createCharacter,
  deleteCharacter,
  finalizeCharacter,
  getSheetByUserId,
  levelUpCharacter,
  listCharacters,
  moveInventoryItem,
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
  res.json({ character: await getSheetByUserId(req.user!.sub) });
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
 * POST /api/characters/me/finalize — encerra a criação do personagem.
 *
 * Botão **provisório** da ficha (será substituído pelo wizard de criação):
 * depois de finalizada, o jogador só mexe no estado de jogo e a construção
 * passa a mudar apenas pelo Level Up ou pelo mestre.
 */
charactersRouter.post('/me/finalize', authenticate, async (req, res) => {
  res.json({ character: await finalizeCharacter(actorFrom(req)) });
});

/**
 * POST /api/characters/me/level-up — sobe um nível pelo assistente.
 *
 * Só funciona quando o mestre liberou o Level Up da mesa e o jogador ainda
 * não usou a liberação atual. O dado de vida é rolado no servidor.
 */
charactersRouter.post('/me/level-up', authenticate, async (req, res) => {
  const parsed = levelUpSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await levelUpCharacter(actorFrom(req), parsed.data);
  res.json({ character });
});

/**
 * POST /api/characters/me/inventory/move — move/equipa um item do inventário.
 *
 * Recebe o id do item dentro do inventário e o destino (slot ou posição na
 * mochila). Em tempo real, o dono e o mestre recebem `sheet:updated`.
 */
charactersRouter.post('/me/inventory/move', authenticate, async (req, res) => {
  const parsed = moveInventoryItemSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await moveInventoryItem(actorFrom(req), parsed.data);
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

/**
 * DELETE /api/characters/:id — exclui o personagem **e a conta do jogador**.
 *
 * Ação exclusiva do mestre e irreversível: o usuário dono da ficha é apagado
 * (a ficha sai em cascata) e ele é desconectado da mesa. A confirmação é da
 * interface — a rota já chega decidida.
 */
charactersRouter.delete('/:id', authenticate, requireRole('MASTER'), async (req, res) => {
  await deleteCharacter(String(req.params.id), actorFrom(req));
  res.status(204).end();
});
