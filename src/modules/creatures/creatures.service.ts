import { effectiveExhaustionLevel, effectiveMaxHp } from '../shared/conditions.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import { ServerEvents, type ServerEvent } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { assertLocalitiesExist } from '../localities/localities.service.js';
import { toCreatureDto, type CreatureDto, type CreatureWithLocalities } from './creatures.dto.js';
import type {
  CreateCreatureInput,
  NpcAddItemInput,
  NpcAttuneInput,
  NpcCoinsInput,
  NpcMoveItemInput,
  NpcRemoveItemInput,
  UpdateCreatureInput,
} from './creatures.schema.js';
import { creatureInventory } from './npc-sheet.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { parseJson } from '../shared/json.js';
import {
  itemDetailsSchema,
  itemRarityOf,
  sanitizeItemDetails,
  type ItemDetails,
} from '../shared/item-details.js';
import { attunementError } from '../shared/attunement.js';
import { COIN_KEYS, COIN_NAMES, normalizeCoins, type CoinPurse } from '../shared/coins.js';

/** Campos escalares copiados diretamente do PATCH para o banco. */
const SCALAR_KEYS = [
  'name',
  'kind',
  'type',
  'challengeRating',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'hpCurrent',
  'hpMax',
  'armorClass',
  'speed',
  'description',
  'imageUrl',
] as const;

/** Toda leitura inclui as localidades vinculadas (usadas no editor e nos cards). */
const withLocalities = { localities: { select: { id: true, name: true } } } as const;

/**
 * Publica no painel dos mestres. Só os mestres recebem eventos de criaturas:
 * as criaturas ficam ocultas dos jogadores até entrarem no combate (Etapa 4).
 */
function broadcast(event: ServerEvent, payload: unknown): void {
  try {
    getBroadcaster().toMasters(event, payload);
  } catch (error) {
    console.error('[creatures] falha ao publicar evento em tempo real:', error);
  }
}

export async function listCreatures(): Promise<CreatureDto[]> {
  const creatures = await prisma.creature.findMany({
    orderBy: { name: 'asc' },
    include: withLocalities,
  });
  return creatures.map(toCreatureDto);
}

export async function findCreature(id: string): Promise<CreatureWithLocalities> {
  const creature = await prisma.creature.findUnique({ where: { id }, include: withLocalities });
  if (!creature) throw new HttpError('Criatura não encontrada.', 404);
  return creature;
}

export async function getCreature(id: string): Promise<CreatureDto> {
  return toCreatureDto(await findCreature(id));
}

export async function createCreature(input: CreateCreatureInput): Promise<CreatureDto> {
  await assertLocalitiesExist(input.localityIds);

  const hpMax = input.hpMax ?? 10;

  const creature = await prisma.creature.create({
    data: {
      name: input.name ?? 'Nova criatura',
      kind: input.kind ?? 'CREATURE',
      type: input.type ?? '',
      challengeRating: input.challengeRating ?? '',
      hpMax,
      hpCurrent: hpMax,
      armorClass: input.armorClass ?? 10,
      attacks: [] as Prisma.InputJsonValue,
      resistances: [] as Prisma.InputJsonValue,
      immunities: [] as Prisma.InputJsonValue,
      vulnerabilities: [] as Prisma.InputJsonValue,
      localities: { connect: input.localityIds.map((id) => ({ id })) },
    },
    include: withLocalities,
  });

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_CREATED, { creature: dto });
  return dto;
}

export async function updateCreature(
  id: string,
  patch: UpdateCreatureInput,
): Promise<CreatureDto> {
  const current = await findCreature(id);

  const data: Record<string, unknown> = { version: { increment: 1 } };

  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }

  if (patch.attacks !== undefined) data.attacks = patch.attacks;
  if (patch.resistances !== undefined) data.resistances = patch.resistances;
  if (patch.immunities !== undefined) data.immunities = patch.immunities;
  if (patch.vulnerabilities !== undefined) data.vulnerabilities = patch.vulnerabilities;

  if (patch.localityIds !== undefined) {
    await assertLocalitiesExist(patch.localityIds);
    data.localities = { set: patch.localityIds.map((localityId) => ({ id: localityId })) };
  }

  // A Exaustão 4+ só limita o PV se a REGRA da mesa estiver ligada (o nível
  // salvo continua intacto e volta a valer ao religar).
  if (effectiveExhaustionLevel(current.mechanicalState) >= 4) data.hpCurrent = Math.min((data.hpCurrent as number | undefined) ?? current.hpCurrent, effectiveMaxHp((data.hpMax as number | undefined) ?? current.hpMax, current.mechanicalState));
  let creature;
  try {
    creature = await prisma.creature.update({
    where: { id, version: current.version },
    data: data as Prisma.CreatureUpdateInput,
    include: withLocalities,
  });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') throw new HttpError('Criatura mudou. Atualize e tente novamente.', 409, 'CONFLICT');
    throw error;
  }


  // Ícone trocado sai do disco (o antigo não é mais referenciado).
  if (patch.imageUrl !== undefined && patch.imageUrl !== current.imageUrl && current.imageUrl) {
    await deleteUploadedImage(current.imageUrl);
  }

  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_UPDATED, { creature: dto, changes: patch });
  return dto;
}

export async function deleteCreature(id: string): Promise<void> {
  const current = await findCreature(id);
  await prisma.creature.delete({ where: { id } });
  if (current.imageUrl) await deleteUploadedImage(current.imageUrl);
  broadcast(ServerEvents.CREATURE_DELETED, { creatureId: id });
}

/* -------------------------------------------------------------------------- */
/* INVENTÁRIO E MOEDAS DO NPC                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O inventário persistente é EXCLUSIVO de NPC (`Kind.NPC`). Criaturas-template
 * continuam no statblock — dar inventário a cada goblin genérico está fora do
 * escopo e é recusado com clareza.
 */
function requireNpc(creature: CreatureWithLocalities): void {
  if (creature.kind !== 'NPC') {
    throw new HttpError(
      'Inventário persistente existe apenas para NPCs: criaturas-template usam o statblock.',
      400,
      'VALIDATION_ERROR',
    );
  }
}

/**
 * Escrita do inventário com a MESMA proteção do cadastro: a versão esperada é
 * conferida no UPDATE. Duas abas do Mestre não sobrescrevem uma à outra.
 */
async function writeNpcInventory(
  id: string,
  expectedVersion: number,
  inventory: InventoryItemDto[],
): Promise<CreatureDto> {
  const written = await prisma.creature.updateMany({
    where: { id, version: expectedVersion, kind: 'NPC' },
    data: {
      inventory: inventory as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (written.count !== 1) {
    const current = await prisma.creature.findUnique({ where: { id } });
    if (!current) throw new HttpError('NPC não encontrado.', 404);
    if (current.kind !== 'NPC') {
      throw new HttpError(
        'Inventário persistente existe apenas para NPCs: criaturas-template usam o statblock.',
        400,
        'VALIDATION_ERROR',
      );
    }
    throw new HttpError('NPC mudou. Atualize e tente novamente.', 409, 'CONFLICT');
  }

  const creature = await findCreature(id);
  const dto = toCreatureDto(creature);
  broadcast(ServerEvents.CREATURE_UPDATED, { creature: dto, changes: { inventory } });
  // NPC já em combate: CA/ataques derivados mudaram — reemite o combate.
  const combat = await import('../combat/combat.service.js');
  await combat.refreshCombatForCreature(id).catch(() => undefined);
  return dto;
}

/**
 * Adiciona itens ao NPC. Do catálogo (`itemId`), copia o snapshot que a ficha
 * também guarda; avulso, usa os campos informados. Pilhas do MESMO item sem
 * slot se juntam em vez de criar linhas repetidas.
 */
export async function addNpcItem(id: string, input: NpcAddItemInput): Promise<CreatureDto> {
  const creature = await findCreature(id);
  requireNpc(creature);
  const inventory = creatureInventory(creature.inventory);

  if (input.itemId) {
    const item = await prisma.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new HttpError('Item do catálogo não encontrado.', 404);
    const existing = inventory.find(
      (entry) => entry.itemId === item.id && entry.slot === null,
    );
    if (existing) {
      existing.quantity += input.quantity;
      return writeNpcInventory(id, input.expectedVersion, inventory);
    }
    const details = parseJson<ItemDetails>(itemDetailsSchema, item.details, {});
    const entry = inventoryListSchema.element.parse({
      id: randomUUID(),
      name: item.name,
      description: item.description,
      quantity: input.quantity,
      weight: item.weight,
      imageUrl: item.imageUrl,
      itemId: item.id,
      category: item.category,
      rarity: itemRarityOf(item.rarity),
      requiresAttunement: item.requiresAttunement,
      details,
      campSupply: { enabled: item.campSupplyEnabled, value: item.campSupplyValue },
    });
    return writeNpcInventory(id, input.expectedVersion, [...inventory, entry]);
  }

  const category = input.category ?? '';
  const entry = inventoryListSchema.element.parse({
    id: randomUUID(),
    name: input.name,
    description: input.description ?? '',
    quantity: input.quantity,
    category,
    details: sanitizeItemDetails(category, input.details),
    requiresAttunement: input.requiresAttunement ?? false,
  });
  return writeNpcInventory(id, input.expectedVersion, [...inventory, entry]);
}

/** Equipa/desequipa (mesma troca de slot da ficha; sem restrição de categoria). */
export async function moveNpcItem(id: string, input: NpcMoveItemInput): Promise<CreatureDto> {
  const creature = await findCreature(id);
  requireNpc(creature);
  const inventory = creatureInventory(creature.inventory);
  const item = inventory.find((entry) => entry.id === input.itemInventoryId);
  if (!item) throw new HttpError('Item não encontrado no inventário do NPC.', 404);

  if (input.targetSlot !== null) {
    const occupant = inventory.find(
      (entry) => entry.id !== item.id && entry.slot === input.targetSlot,
    );
    const previousSlot = item.slot;
    item.slot = input.targetSlot;
    item.backpackX = null;
    item.backpackY = null;
    if (occupant) {
      occupant.slot = previousSlot;
      occupant.backpackX = null;
      occupant.backpackY = null;
    }
  } else {
    item.slot = null;
  }

  return writeNpcInventory(id, input.expectedVersion, inventory);
}

/** Remove unidades; a entrada sai do inventário ao chegar a 0. */
export async function removeNpcItem(id: string, input: NpcRemoveItemInput): Promise<CreatureDto> {
  const creature = await findCreature(id);
  requireNpc(creature);
  const inventory = creatureInventory(creature.inventory);
  const item = inventory.find((entry) => entry.id === input.itemInventoryId);
  if (!item) throw new HttpError('Item não encontrado no inventário do NPC.', 404);
  if (item.quantity < input.quantity) {
    throw new HttpError(`Não há ${input.quantity} unidades de ${item.name}.`, 409, 'CONFLICT');
  }
  const next = inventory
    .map((entry) =>
      entry.id === item.id ? { ...entry, quantity: entry.quantity - input.quantity } : entry,
    )
    .filter((entry) => entry.quantity > 0);
  return writeNpcInventory(id, input.expectedVersion, next);
}

/** Sintonização pelo MESMO limite de 3 (`shared/attunement.ts`). */
export async function attuneNpcItem(id: string, input: NpcAttuneInput): Promise<CreatureDto> {
  const creature = await findCreature(id);
  requireNpc(creature);
  const inventory = creatureInventory(creature.inventory);
  const item = inventory.find((entry) => entry.id === input.itemInventoryId);
  if (!item) throw new HttpError('Item não encontrado no inventário do NPC.', 404);
  const error = attunementError(inventory, item, input.attuned);
  if (error) throw new HttpError(error, 409, 'CONFLICT');
  item.attuned = input.attuned;
  return writeNpcInventory(id, input.expectedVersion, inventory);
}

/**
 * Moedas do NPC: usa a carteira e as denominações do motor existente. O saldo
 * NUNCA fica negativo (retirada maior é recusada) e a escrita é condicionada
 * à versão, como no cadastro.
 */
export async function giveNpcCoins(id: string, input: NpcCoinsInput): Promise<CreatureDto> {
  const creature = await findCreature(id);
  requireNpc(creature);
  const current = normalizeCoins(creature.coins);
  const next = { ...current } as CoinPurse;
  for (const key of COIN_KEYS) {
    const value = current[key] + (input.delta[key] ?? 0);
    if (value < 0) {
      throw new HttpError(`Saldo de ${COIN_NAMES[key]} insuficiente no NPC.`, 409, 'CONFLICT');
    }
    next[key] = value;
  }

  const written = await prisma.creature.updateMany({
    where: { id, version: input.expectedVersion, kind: 'NPC' },
    data: { coins: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (written.count !== 1) {
    throw new HttpError('NPC mudou. Atualize e tente novamente.', 409, 'CONFLICT');
  }

  const updated = await findCreature(id);
  const dto = toCreatureDto(updated);
  broadcast(ServerEvents.CREATURE_UPDATED, { creature: dto, changes: { coins: next } });
  const combat = await import('../combat/combat.service.js');
  await combat.refreshCombatForCreature(id).catch(() => undefined);
  return dto;
}
