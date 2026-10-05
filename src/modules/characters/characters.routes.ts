import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware.js';
import {
  createCharacterSchema,
  creationRollRequestSchema,
  creationStepSchema,
  giveCoinsSchema,
  levelDownSchema,
  levelUpSchema,
  moveInventoryItemSchema,
  spellbookSchema,
  spendCoinsSchema,
  transferCoinsSchema,
  updateCharacterSchema,
  useInventoryItemSchema,
} from './characters.schema.js';
import { exchangeCoinsSchema } from '../shared/coins.js';
import {
  createCharacter,
  deleteCharacter,
  exchangeCoins,
  getSheetByUserId,
  giveCoins,
  levelDownCharacter,
  levelUpCharacter,
  listCharacters,
  listTransferTargets,
  moveInventoryItem,
  setClassSpellbook,
  spendCoins,
  transferCoins,
  updateCharacter,
  updateCharacterAsMaster,
  useInventoryItem,
  type Actor,
} from './characters.service.js';
import {
  creationLevelUp,
  finalizeCreation,
  getCreationState,
  reopenCreation,
  rollCreationAttribute,
  saveCreationStep,
} from './creation.service.js';

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
 * GET /api/characters/me/creation — estado do assistente de criação.
 *
 * Devolve a ficha (ou `null`, quando ainda não existe), o rascunho (modo,
 * passo alcançado, rolagens e valores-base), os catálogos de raça/antecedente,
 * o nível inicial da mesa e o que ainda falta para finalizar.
 */
charactersRouter.get('/me/creation', authenticate, async (req, res) => {
  res.json(await getCreationState(actorFrom(req)));
});

/**
 * PATCH /api/characters/me/creation — salva o passo concluído do assistente.
 *
 * Cada passo grava o que lhe pertence na própria ficha e avança o rascunho; é
 * o que permite fechar o navegador e retomar de onde parou.
 */
charactersRouter.patch('/me/creation', authenticate, async (req, res) => {
  const parsed = creationStepSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  res.json(await saveCreationStep(actorFrom(req), parsed.data));
});

/**
 * POST /api/characters/me/creation/roll — rola 4d6 (descartando o menor) para
 * um atributo.
 *
 * A rolagem usa o mesmo mecanismo da janela de dados, não avisa a mesa (só o
 * histórico do mestre) e fica guardada no rascunho. `restart` recomeça os seis
 * valores.
 */
charactersRouter.post('/me/creation/roll', authenticate, async (req, res) => {
  const parsed = creationRollRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  res.status(201).json(await rollCreationAttribute(actorFrom(req), parsed.data));
});

/**
 * POST /api/characters/me/creation/level-up — aplica um nível durante a criação.
 *
 * É o passo 8 ("nível inicial da mesa") usando o MESMO assistente de Level Up,
 * sem depender da liberação do mestre e sem consumir a liberação dele.
 */
charactersRouter.post('/me/creation/level-up', authenticate, async (req, res) => {
  const parsed = levelUpSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  res.json(await creationLevelUp(actorFrom(req), parsed.data));
});

/**
 * POST /api/characters/me/creation/finalize — último passo do assistente.
 *
 * Grava `creationFinalized = true` depois de conferir que nenhum passo ficou
 * para trás. Dali em diante o jogador só mexe no estado de jogo.
 */
charactersRouter.post('/me/creation/finalize', authenticate, async (req, res) => {
  res.json(await finalizeCreation(actorFrom(req)));
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
 * PUT /api/characters/me/spellbook — define o livro de magias de UMA classe.
 *
 * Valida a seleção contra o catálogo (lista da classe, nível máximo, limites de
 * truques/conhecidas/preparadas e escolas do CA/TA) e regrava as entradas
 * daquela classe. O dono da ficha e o mestre podem chamar.
 */
charactersRouter.put('/me/spellbook', authenticate, async (req, res) => {
  const parsed = spellbookSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await setClassSpellbook(actorFrom(req), parsed.data);
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
 * POST /api/characters/me/inventory/use — usa (consome) 1 unidade de um item.
 *
 * Só vale para Poção e para itens marcados como consumíveis pelo mestre. Se o
 * item tiver `effectRoll`, a resposta traz também a rolagem (`roll`); nenhum
 * efeito é aplicado automaticamente na ficha.
 */
charactersRouter.post('/me/inventory/use', authenticate, async (req, res) => {
  const parsed = useInventoryItemSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  res.json(await useInventoryItem(actorFrom(req), parsed.data));
});

/**
 * POST /api/characters/me/coins/spend — gasta moedas do próprio saldo.
 *
 * O gasto é EXATO, denominação por denominação (sem troco automático).
 * Saldo insuficiente é 400 e nada muda.
 */
charactersRouter.post('/me/coins/spend', authenticate, async (req, res) => {
  const parsed = spendCoinsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await spendCoins(actorFrom(req), parsed.data.amount);
  res.json({ character });
});

/**
 * POST /api/characters/me/coins/exchange — troca entre denominações.
 *
 * Usa as conversões do PHB e preserva o valor total; trocas que exigiriam
 * fração (ex.: 1 cp para PO) são recusadas.
 */
charactersRouter.post('/me/coins/exchange', authenticate, async (req, res) => {
  const parsed = exchangeCoinsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await exchangeCoins(actorFrom(req), parsed.data);
  res.json({ character });
});

/**
 * POST /api/characters/me/coins/transfer — transfere para OUTRO jogador.
 *
 * Não vale para si mesmo nem para o mestre; as duas fichas mudam na mesma
 * transação e as duas recebem `sheet:updated`.
 */
charactersRouter.post('/me/coins/transfer', authenticate, async (req, res) => {
  const parsed = transferCoinsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await transferCoins(
    actorFrom(req),
    parsed.data.targetCharacterId,
    parsed.data.amount,
  );
  res.json({ character });
});

/**
 * GET /api/characters/players — destinos possíveis de uma transferência.
 *
 * Só os personagens de OUTROS jogadores (sem o mestre e sem a própria ficha).
 */
charactersRouter.get('/players', authenticate, async (req, res) => {
  res.json({ characters: await listTransferTargets(actorFrom(req)) });
});

/**
 * POST /api/characters/:id/coins — o mestre dá ou retira moedas de uma ficha.
 *
 * `delta` aceita valores positivos (dar) e negativos (retirar); retirar mais do
 * que existe é 400. A ficha do jogador recebe `sheet:updated`.
 */
charactersRouter.post('/:id/coins', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = giveCoinsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const character = await giveCoins(String(req.params.id), actorFrom(req), parsed.data.delta);
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
 * POST /api/characters/:id/level-down — o mestre reduz UM nível do personagem.
 *
 * O inverso do Level Up: tira um nível da classe indicada e desfaz o que aquele
 * nível concedeu (PV, Aumento de Atributo/Talento, escolhas, subclasse, perícia
 * de multiclasse e proficiências), usando o histórico gravado no Level Up.
 *
 * Nível 1 caindo para 0 remove a classe da ficha. A resposta traz também
 * `levelDown` com o que foi revertido e `warnings` dos níveis antigos, sem
 * histórico (só o PV foi estimado).
 */
charactersRouter.post('/:id/level-down', authenticate, requireRole('MASTER'), async (req, res) => {
  const parsed = levelDownSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  res.json(await levelDownCharacter(String(req.params.id), actorFrom(req), parsed.data));
});

/**
 * POST /api/characters/:id/creation/reopen — devolve a ficha ao assistente.
 *
 * Exclusivo do mestre: `creationFinalized` volta para `false` e o jogador
 * reencontra o wizard de criação no próximo acesso (com o que já existia
 * preenchido). É o único caminho de volta: o jogador não refaz a criação
 * sozinho.
 */
charactersRouter.post(
  '/:id/creation/reopen',
  authenticate,
  requireRole('MASTER'),
  async (req, res) => {
    res.json({ character: await reopenCreation(String(req.params.id), actorFrom(req)) });
  },
);

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
