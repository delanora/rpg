import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toCharacterDto, type InventoryItemDto } from '../characters/characters.dto.js';
import { inventoryItemSchema } from '../characters/characters.schema.js';
import { parseJson } from '../shared/json.js';
import { toItemDto, type ItemDto } from './items.dto.js';
import type { CreateItemInput, UpdateItemInput } from './items.schema.js';

const inventoryListSchema = z.array(inventoryItemSchema);

/**
 * O catálogo é compartilhado: o mestre o gerencia e os jogadores o consultam
 * para preencher o inventário. Por isso os eventos vão para toda a mesa.
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toTable(event, payload);
  } catch (error) {
    console.error('[items] falha ao publicar evento em tempo real:', error);
  }
}

export async function listItems(): Promise<ItemDto[]> {
  const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });
  return items.map(toItemDto);
}

async function findItem(id: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) throw new HttpError('Item não encontrado.', 404);
  return item;
}

export async function getItem(id: string): Promise<ItemDto> {
  return toItemDto(await findItem(id));
}

export async function createItem(input: CreateItemInput): Promise<ItemDto> {
  const item = await prisma.item.create({
    data: {
      name: input.name,
      description: input.description ?? '',
      weight: input.weight ?? 0,
      category: input.category ?? 'Item Geral',
      imageUrl: input.imageUrl ?? '',
    },
  });

  const dto = toItemDto(item);
  broadcast(ServerEvents.ITEM_CREATED, { item: dto });
  return dto;
}

export async function updateItem(id: string, patch: UpdateItemInput): Promise<ItemDto> {
  const current = await findItem(id);

  const data: Prisma.ItemUpdateInput = { version: { increment: 1 } };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.weight !== undefined) data.weight = patch.weight;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl;

  const item = await prisma.item.update({ where: { id }, data });

  if (patch.imageUrl !== undefined && patch.imageUrl !== current.imageUrl && current.imageUrl) {
    await deleteUploadedImage(current.imageUrl);
  }

  const dto = toItemDto(item);
  broadcast(ServerEvents.ITEM_UPDATED, { item: dto, changes: patch });
  return dto;
}

export async function deleteItem(id: string): Promise<void> {
  const current = await findItem(id);
  await prisma.item.delete({ where: { id } });
  if (current.imageUrl) await deleteUploadedImage(current.imageUrl);
  broadcast(ServerEvents.ITEM_DELETED, { itemId: id });
}

/**
 * Envia um item do catálogo para o inventário de um personagem. Sem limite de
 * quantidade: o mestre pode mandar quantos itens quiser. Se o personagem já
 * tiver o mesmo item do catálogo, as quantidades se somam.
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
      equipped: false,
      imageUrl: item.imageUrl,
      itemId: item.id,
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
    character: toCharacterDto(updated, character.user.username),
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
