import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents, type SheetUpdatedPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { toCharacterDto, type CharacterDto } from './characters.dto.js';
import type { CreateCharacterInput, UpdateCharacterInput } from './characters.schema.js';
import { applyClassSavingThrows, getClassDefinition } from '../shared/classes.js';
import { normalizeSaves, normalizeSkills } from '../shared/dnd5e.js';

/** Quem está alterando a ficha (vem do token, nunca do corpo da requisição). */
export interface Actor {
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
  'notes',
] as const;

function emptySpells(): Prisma.InputJsonValue {
  return { list: [], slots: {} };
}

/**
 * Publica a alteração para o mestre (que enxerga tudo) e para as demais
 * sessões do próprio jogador. Falha de tempo real nunca deve derrubar a
 * requisição HTTP que já foi persistida.
 */
function publishChange(
  actor: Actor,
  character: Character,
  changes: Record<string, unknown>,
): void {
  try {
    const payload: SheetUpdatedPayload = {
      userId: actor.userId,
      username: actor.username,
      characterId: character.id,
      version: character.version,
      changes,
      character: toCharacterDto(character, actor.username),
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(actor.userId, ServerEvents.SHEET_UPDATED, payload);
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

  publishChange(actor, character, { created: true });
  return toCharacterDto(character, actor.username);
}

export function getCharacterByUserId(userId: string): Promise<Character | null> {
  return prisma.character.findUnique({ where: { userId } });
}

/**
 * Aplica uma atualização parcial (edição inline).
 * As coleções enviadas substituem integralmente o valor anterior.
 */
export async function updateCharacter(
  actor: Actor,
  patch: UpdateCharacterInput,
): Promise<CharacterDto> {
  const existing = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!existing) {
    throw new HttpError('Você ainda não criou sua ficha.', 404);
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
    where: { userId: actor.userId },
    data: data as Prisma.CharacterUpdateInput,
  });

  publishChange(actor, character, patch as Record<string, unknown>);
  return toCharacterDto(character, actor.username);
}

/** Lista todas as fichas da mesa (uso exclusivo do mestre). */
export async function listCharacters(): Promise<CharacterDto[]> {
  const characters = await prisma.character.findMany({
    include: { user: { select: { username: true } } },
    orderBy: { name: 'asc' },
  });

  return characters.map((character) => toCharacterDto(character, character.user.username));
}
