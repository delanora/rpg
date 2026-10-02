import { randomUUID } from 'node:crypto';
import type { Item, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { republishSheetsWithCatalogItem, toSheetDto } from '../characters/characters.service.js';
import { inventoryItemSchema } from '../characters/characters.schema.js';
import { itemRarityOf, sanitizeItemDetails } from '../shared/item-details.js';
import { parseJson } from '../shared/json.js';
import { toItemDto, type ItemDto } from './items.dto.js';
import type { CreateItemInput, UpdateItemInput } from './items.schema.js';

const inventoryListSchema = z.array(inventoryItemSchema);

/**
 * O catálogo é compartilhado, mas o preço é exclusivo do mestre: os mestres
 * recebem o item completo e os jogadores uma versão sem valor de mercado.
 */
function broadcastItem(event: ServerEvent, item: Item, changes?: Record<string, unknown>): void {
  try {
    const broadcaster = getBroadcaster();
    const full = toItemDto(item, 'MASTER');
    const stripped = toItemDto(item, 'PLAYER');
    broadcaster.toMasters(event, changes ? { item: full, changes } : { item: full });
    broadcaster.toPlayers(event, changes ? { item: stripped, changes } : { item: stripped });
  } catch (error) {
    console.error('[items] falha ao publicar evento em tempo real:', error);
  }
}

function broadcastDeleted(itemId: string): void {
  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.ITEM_DELETED, { itemId });
    broadcaster.toPlayers(ServerEvents.ITEM_DELETED, { itemId });
  } catch (error) {
    console.error('[items] falha ao publicar evento em tempo real:', error);
  }
}

export async function listItems(viewer: Role): Promise<ItemDto[]> {
  const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });
  return items.map((item) => toItemDto(item, viewer));
}

async function findItem(id: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) throw new HttpError('Item não encontrado.', 404);
  return item;
}

export async function getItem(id: string, viewer: Role): Promise<ItemDto> {
  return toItemDto(await findItem(id), viewer);
}

export async function createItem(input: CreateItemInput): Promise<ItemDto> {
  const category = input.category ?? 'Item Geral';
  const price = input.price ?? {};

  const item = await prisma.item.create({
    data: {
      name: input.name,
      description: input.description ?? '',
      weight: input.weight ?? 0,
      category,
      rarity: input.rarity ?? null,
      requiresAttunement: input.requiresAttunement ?? false,
      imageUrl: input.imageUrl ?? '',
      details: sanitizeItemDetails(category, input.details) as Prisma.InputJsonValue,
      priceGold: price.gold ?? 0,
      priceSilver: price.silver ?? 0,
      priceCopper: price.copper ?? 0,
    },
  });

  broadcastItem(ServerEvents.ITEM_CREATED, item);
  return toItemDto(item, 'MASTER');
}

export async function updateItem(id: string, patch: UpdateItemInput): Promise<ItemDto> {
  const current = await findItem(id);

  const data: Prisma.ItemUpdateInput = { version: { increment: 1 } };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.weight !== undefined) data.weight = patch.weight;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.rarity !== undefined) data.rarity = patch.rarity;
  if (patch.requiresAttunement !== undefined) data.requiresAttunement = patch.requiresAttunement;
  if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl;

  // Atributos são re-normalizados com a categoria final (a troca de categoria
  // limpa os campos que não se aplicam mais).
  if (patch.details !== undefined || patch.category !== undefined) {
    const category = patch.category ?? current.category;
    data.details = sanitizeItemDetails(
      category,
      patch.details ?? current.details,
    ) as Prisma.InputJsonValue;
  }

  if (patch.price !== undefined) {
    if (patch.price.gold !== undefined) data.priceGold = patch.price.gold;
    if (patch.price.silver !== undefined) data.priceSilver = patch.price.silver;
    if (patch.price.copper !== undefined) data.priceCopper = patch.price.copper;
  }

  const item = await prisma.item.update({ where: { id }, data });

  if (patch.imageUrl !== undefined && patch.imageUrl !== current.imageUrl && current.imageUrl) {
    await deleteUploadedImage(current.imageUrl);
  }

  broadcastItem(ServerEvents.ITEM_UPDATED, item, patch as Record<string, unknown>);

  // O inventário dos jogadores espelha o catálogo: quem já tem o item recebe
  // a ficha atualizada na hora, sem recarregar nada.
  await republishSheetsWithCatalogItem(item.id);

  return toItemDto(item, 'MASTER');
}

export async function deleteItem(id: string): Promise<void> {
  const current = await findItem(id);
  await prisma.item.delete({ where: { id } });
  if (current.imageUrl) await deleteUploadedImage(current.imageUrl);
  broadcastDeleted(id);
}

/**
 * Envia um item do catálogo para o inventário de um personagem. Sem limite de
 * quantidade: o mestre pode mandar quantos itens quiser. Se o personagem já
 * tiver o mesmo item do catálogo, as quantidades se somam.
 *
 * O item leva sprite, peso, descrição e os atributos da categoria (dano, CA,
 * rolagem de efeito...) — mas nunca o preço, que é informação do mestre.
 */
export async function sendItemToCharacter(
  itemId: string,
  characterId: string,
  quantity: number,
): Promise<{ itemId: string; characterId: string; quantity: number }> {
  const item = await findItem(itemId);
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });
  if (!character) throw new HttpError('Personagem não encontrado.', 404);

  const inventory = parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);
  const existing = inventory.find((entry) => entry.itemId === item.id);

  if (existing) {
    existing.quantity += quantity;
  } else {
    inventory.push({
      id: randomUUID(),
      name: item.name,
      description: item.description,
      quantity,
      weight: item.weight,
      // O item chega à mochila, sem posição e sem slot definidos.
      slot: null,
      backpackX: null,
      backpackY: null,
      imageUrl: item.imageUrl,
      itemId: item.id,
      category: item.category,
      rarity: itemRarityOf(item.rarity),
      requiresAttunement: item.requiresAttunement,
      details: sanitizeItemDetails(item.category, item.details),
    });
  }

  const updated = await prisma.character.update({
    where: { id: characterId },
    data: {
      inventory: inventory as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  // A ficha vai apenas para o mestre e para o dono — nunca para a mesa toda.
  const payload = {
    userId: updated.userId,
    username: character.user.username,
    characterId: updated.id,
    version: updated.version,
    changes: { inventory },
    character: await toSheetDto(updated, character.user.username),
    at: new Date().toISOString(),
  };
  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(updated.userId, ServerEvents.SHEET_UPDATED, payload);
  } catch (error) {
    console.error('[items] falha ao publicar a ficha em tempo real:', error);
  }

  return { itemId: item.id, characterId, quantity };
}
