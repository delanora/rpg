import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createCreatureSchema,
  npcAddItemSchema,
  npcAttuneSchema,
  npcCoinsSchema,
  npcMoveItemSchema,
  npcRemoveItemSchema,
  updateCreatureSchema,
} from './creatures.schema.js';
import {
  addNpcItem,
  attuneNpcItem,
  createCreature,
  deleteCreature,
  getCreature,
  giveNpcCoins,
  listCreatures,
  moveNpcItem,
  removeNpcItem,
  updateCreature,
} from './creatures.service.js';

export const creaturesRouter = Router();

/**
 * Todas as rotas de criaturas são exclusivas do mestre: os jogadores não
 * devem enxergar o bestiário antes de as criaturas entrarem no combate.
 */
creaturesRouter.use(authenticate, requireRole('MASTER'));

/** GET /api/creatures — bestiário completo. */
creaturesRouter.get('/', async (_req, res) => {
  res.json({ creatures: await listCreatures() });
});

/** GET /api/creatures/:id — uma criatura. */
creaturesRouter.get('/:id', async (req, res) => {
  res.json({ creature: await getCreature(req.params.id) });
});

/** POST /api/creatures — cadastra uma criatura/NPC. */
creaturesRouter.post('/', async (req, res) => {
  const parsed = createCreatureSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  res.status(201).json({ creature: await createCreature(parsed.data) });
});

/** PATCH /api/creatures/:id — edição inline. */
creaturesRouter.patch('/:id', async (req, res) => {
  const parsed = updateCreatureSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nada para atualizar.' });
    return;
  }

  res.json({ creature: await updateCreature(req.params.id, parsed.data) });
});

/** DELETE /api/creatures/:id — remove uma criatura. */
creaturesRouter.delete('/:id', async (req, res) => {
  await deleteCreature(req.params.id);
  res.status(204).end();
});

/* -------------------------------------------------------------------------- */
/* Inventário e moedas do NPC — SEMPRE master-only (router já exige MASTER).   */
/* -------------------------------------------------------------------------- */

/** POST /api/creatures/:id/inventory — adiciona item do catálogo ou avulso. */
creaturesRouter.post('/:id/inventory', async (req, res) => {
  const parsed = npcAddItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ creature: await addNpcItem(req.params.id, parsed.data) });
});

/** POST /api/creatures/:id/inventory/move — equipa/desequipa ou volta à mochila. */
creaturesRouter.post('/:id/inventory/move', async (req, res) => {
  const parsed = npcMoveItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ creature: await moveNpcItem(req.params.id, parsed.data) });
});

/** POST /api/creatures/:id/inventory/remove — remove unidades. */
creaturesRouter.post('/:id/inventory/remove', async (req, res) => {
  const parsed = npcRemoveItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ creature: await removeNpcItem(req.params.id, parsed.data) });
});

/** POST /api/creatures/:id/inventory/attune — sintoniza/dessintoniza. */
creaturesRouter.post('/:id/inventory/attune', async (req, res) => {
  const parsed = npcAttuneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ creature: await attuneNpcItem(req.params.id, parsed.data) });
});

/** POST /api/creatures/:id/coins — dá/retira moedas do NPC. */
creaturesRouter.post('/:id/coins', async (req, res) => {
  const parsed = npcCoinsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({ creature: await giveNpcCoins(req.params.id, parsed.data) });
});
