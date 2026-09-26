import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents, type SheetUpdatedPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toCharacterDto, type CharacterDto } from './characters.dto.js';
import {
  catalogItemIds,
  loadCatalogLookup,
  type CatalogSnapshot,
} from './inventory-sync.js';
import type { CreateCharacterInput, UpdateCharacterInput } from './characters.schema.js';
import { applyClassSavingThrows, getClassDefinition } from '../shared/classes.js';
import { normalizeSaves, normalizeSkills } from '../shared/dnd5e.js';

/** Quem está alterando a ficha (vem do token, nunca do corpo da requisição). */
export interface Actor {
  userId: string;
  username: string;
  /** Nome de exibição — é ele que aparece para o jogador quando o mestre edita. */
  displayName: string;
}

/** Dono da ficha: recebe o evento e assina o DTO entregue à mesa. */
interface SheetOwner {
  userId: string;
  username: string;
}

/** Campos escalares copiados diretamente do PATCH para o banco. */
const SCALAR_KEYS = [
  'name',
  'race',
  'className',
  'level',
  'background',
  'alignment',
  'experience',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'hpCurrent',
  'hpMax',
  'hpTemp',
  'armorClass',
  'initiativeBonus',
  'speed',
  'avatarUrl',
  'notes',
] as const;

function emptySpells(): Prisma.InputJsonValue {
  return { list: [], slots: {} };
}

/**
 * Publica a alteração para o mestre (que enxerga tudo) e para as demais
 * sessões do dono da ficha — inclusive quando quem editou foi o mestre, para
 * o jogador ver a mudança na tela na hora.
 *
 * `editedBy` só é preenchido quando o editor não é o dono. Falha de tempo real
 * nunca deve derrubar a requisição HTTP que já foi persistida.
 */
async function publishChange(
  owner: SheetOwner,
  character: Character,
  changes: Record<string, unknown>,
  editedBy?: string,
): Promise<void> {
  try {
    const payload: SheetUpdatedPayload = {
      userId: owner.userId,
      username: owner.username,
      characterId: character.id,
      version: character.version,
      changes,
      character: await toSheetDto(character, owner.username),
      editedBy,
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(owner.userId, ServerEvents.SHEET_UPDATED, payload);
  } catch (error) {
    console.error('[characters] falha ao publicar alteração em tempo real:', error);
  }
}

/** Cria a ficha do usuário autenticado (uma por usuário). */
export async function createCharacter(
  actor: Actor,
  input: CreateCharacterInput,
): Promise<CharacterDto> {
  const existing = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (existing) {
    throw new HttpError('Você já possui uma ficha.', 409);
  }

  const classKey = input.classKey ?? '';
  const classDefinition = getClassDefinition(classKey);

  const character = await prisma.character.create({
    data: {
      userId: actor.userId,
      name: input.name ?? 'Novo Personagem',
      race: input.race ?? '',
      className: classDefinition?.name ?? input.className ?? '',
      classKey,
      subclass: '',
      level: input.level ?? 1,
      skills: normalizeSkills({}) as unknown as Prisma.InputJsonValue,
      saves: applyClassSavingThrows(
        normalizeSaves({}),
        classDefinition,
      ) as unknown as Prisma.InputJsonValue,
      inventory: [] as Prisma.InputJsonValue,
      spells: emptySpells(),
      attacks: [] as Prisma.InputJsonValue,
      features: [] as Prisma.InputJsonValue,
    },
  });

  await publishChange(actor, character, { created: true });
  return toSheetDto(character, actor.username);
}

export function getCharacterByUserId(userId: string): Promise<Character | null> {
  return prisma.character.findUnique({ where: { userId } });
}

/**
 * Monta o DTO da ficha já com o inventário espelhando o catálogo do mestre
 * (nome, peso, descrição, sprite e atributos sempre como estão no catálogo).
 */
export async function toSheetDto(
  character: Character,
  ownerUsername?: string,
): Promise<CharacterDto> {
  const catalog = await loadCatalogLookup([character.inventory]);
  return toCharacterDto(character, ownerUsername, catalog);
}

/** Ficha do usuário autenticado, no formato entregue ao frontend. */
export async function getSheetByUserId(userId: string): Promise<CharacterDto | null> {
  const character = await getCharacterByUserId(userId);
  return character ? toSheetDto(character) : null;
}

/**
 * Republica as fichas que têm um item do catálogo no inventário.
 *
 * É o que faz o jogador ver na hora a correção feita pelo mestre na aba de
 * itens: o inventário espelha o catálogo, então basta reenviar a ficha.
 */
export async function republishSheetsWithCatalogItem(itemId: string): Promise<void> {
  const characters = await prisma.character.findMany({
    include: { user: { select: { username: true } } },
  });

  const affected = characters.filter((character) =>
    catalogItemIds([character.inventory]).includes(itemId),
  );

  for (const character of affected) {
    await publishChange(
      { userId: character.userId, username: character.user.username },
      character,
      { itemSynced: itemId },
    );
  }
}

/**
 * Núcleo da edição: valida o patch contra a classe, grava e publica.
 * Serve tanto ao dono da ficha quanto ao mestre que a está editando.
 */
async function applyCharacterPatch(
  owner: SheetOwner,
  patch: UpdateCharacterInput,
  editedBy?: string,
): Promise<CharacterDto> {
  const existing = await prisma.character.findUnique({ where: { userId: owner.userId } });
  if (!existing) {
    throw new HttpError('Esta ficha ainda não foi criada.', 404);
  }

  const data: Record<string, unknown> = { version: { increment: 1 } };

  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }

  // --- Classe, subclasse e salvaguardas fixas ------------------------------
  const nextClassKey = patch.classKey ?? existing.classKey;
  const classDefinition = getClassDefinition(nextClassKey);
  const classChanged = patch.classKey !== undefined && patch.classKey !== existing.classKey;
  const nextLevel = patch.level ?? existing.level;

  if (classDefinition && patch.classKey !== undefined) {
    // A classe define o nome exibido (o campo livre `className` vira derivado).
    data.className = classDefinition.name;
  }
  if (patch.classKey !== undefined) data.classKey = patch.classKey;

  if (patch.subclass !== undefined && patch.subclass !== '') {
    if (!classDefinition) {
      throw new HttpError('Escolha uma classe antes de definir a subclasse.', 400);
    }
    if (nextLevel < classDefinition.subclassLevel) {
      throw new HttpError(
        `A subclasse de ${classDefinition.name} é escolhida a partir do nível ${classDefinition.subclassLevel}.`,
        400,
      );
    }
  }

  if (classChanged) {
    // Trocar de classe zera a subclasse, as salvaguardas e o estado de classe.
    data.subclass = '';
    data.classState = { active: [], used: {} };
  } else if (patch.subclass !== undefined) {
    data.subclass = patch.subclass;
  }

  const currentSaves = normalizeSaves(existing.saves);
  const classSavesApplied =
    classDefinition !== null &&
    classDefinition.savingThrows.every((ability) => currentSaves[ability]);

  if (patch.saves !== undefined || classChanged || (classDefinition !== null && !classSavesApplied)) {
    const base = classChanged
      ? normalizeSaves({})
      : normalizeSaves(patch.saves ?? existing.saves);
    data.saves = applyClassSavingThrows(base, classDefinition);
  }

  if (patch.skills !== undefined) data.skills = normalizeSkills(patch.skills);
  if (patch.inventory !== undefined) data.inventory = patch.inventory;
  if (patch.spells !== undefined) data.spells = patch.spells;
  if (patch.attacks !== undefined) data.attacks = patch.attacks;
  if (patch.features !== undefined) data.features = patch.features;
  if (patch.classState !== undefined) data.classState = patch.classState;

  const character = await prisma.character.update({
    where: { userId: owner.userId },
    data: data as Prisma.CharacterUpdateInput,
  });

  await publishChange(owner, character, patch as Record<string, unknown>, editedBy);
  return toSheetDto(character, owner.username);
}

/**
 * Aplica uma atualização parcial na ficha do próprio autor.
 * As coleções enviadas substituem integralmente o valor anterior.
 */
export function updateCharacter(actor: Actor, patch: UpdateCharacterInput): Promise<CharacterDto> {
  return applyCharacterPatch({ userId: actor.userId, username: actor.username }, patch);
}

/**
 * O mestre edita a ficha de um jogador (PATCH /api/characters/:id).
 *
 * O dono continua sendo o jogador: o evento vai para as sessões dele e o DTO
 * segue assinado com o nome do dono, mas com `editedBy` marcando quem mexeu.
 * Só o mestre chega aqui — a rota exige o papel MASTER.
 */
export async function updateCharacterAsMaster(
  characterId: string,
  master: Actor,
  patch: UpdateCharacterInput,
): Promise<CharacterDto> {
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });

  if (!target) {
    throw new HttpError('Ficha não encontrada.', 404);
  }

  return applyCharacterPatch(
    { userId: target.userId, username: target.user.username },
    patch,
    master.displayName,
  );
}

/** Lista todas as fichas da mesa (uso exclusivo do mestre). */
export async function listCharacters(): Promise<CharacterDto[]> {
  const characters = await prisma.character.findMany({
    include: { user: { select: { username: true } } },
    orderBy: { name: 'asc' },
  });

  // Uma única consulta ao catálogo para todas as fichas da mesa.
  const catalog: Map<string, CatalogSnapshot> = await loadCatalogLookup(
    characters.map((character) => character.inventory),
  );

  return characters.map((character) =>
    toCharacterDto(character, character.user.username, catalog),
  );
}
