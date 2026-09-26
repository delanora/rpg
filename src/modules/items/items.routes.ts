import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import { createItemSchema, sendItemSchema, updateItemSchema } from './items.schema.js';
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  sendItemToCharacter,
  updateItem,
} from './items.service.js';

export const itemsRouter = Router();

itemsRouter.use(authenticate);

/**
 * O catálogo é visível a todos: os jogadores o usam para buscar itens ao
 * montar o inventário. A gestão (criar/editar/remover/enviar) é do mestre.
 */
itemsRouter.get('/', async (req, res) => {
  res.json({ items: await listItems(req.user?.role ?? 'PLAYER') });
});

itemsRouter.get('/:id', async (req, res) => {
  res.json({ item: await getItem(String(req.params.id), req.user?.role ?? 'PLAYER') });
});

itemsRouter.post('/', requireRole('MASTER'), async (req, res) => {
  const parsed = createItemSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ item: await createItem(parsed.data) });
});

itemsRouter.patch('/:id', requireRole('MASTER'), async (req, res) => {
  const parsed = updateItemSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ item: await updateItem(String(req.params.id), parsed.data) });
});

itemsRouter.delete('/:id', requireRole('MASTER'), async (req, res) => {
  await deleteItem(String(req.params.id));
  res.status(204).end();
});

/** POST /api/items/:id/send — envia o item ao inventário de um personagem. */
itemsRouter.post('/:id/send', requireRole('MASTER'), async (req, res) => {
  const parsed = sendItemSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const result = await sendItemToCharacter(
    String(req.params.id),
    parsed.data.characterId,
    parsed.data.quantity ?? 1,
  );
  res.status(201).json(result);
});
