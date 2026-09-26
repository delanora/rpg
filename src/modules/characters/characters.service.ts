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
import {
  applySaveProficiencies,
  getClassDefinition,
  multiclassMissingLabel,
  normalizeClassEntries,
  type ClassEntry,
} from '../shared/classes.js';
import type { AbilityKey } from '../shared/dnd5e.js';
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

/** Atributos do personagem no formato usado pelas regras de classe. */
function abilitiesOf(character: Character): Record<AbilityKey, number> {
  return {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
}

/** Salvaguardas fixas de TODAS as classes do personagem (multiclasse). */
function lockedSavesOf(entries: ClassEntry[]): AbilityKey[] {
  return entries.flatMap((entry) => getClassDefinition(entry.classKey)?.savingThrows ?? []);
}

/**
 * Resolve a lista de classes de um PATCH.
 *
 * O **nível** de cada classe só muda pelo fluxo de Level Up, então aqui:
 *
 *  - Ficha sem classe: aceita exatamente uma classe (entra no nível 1) e exige
 *    o pré-requisito de atributo da classe.
 *  - Ficha com classes: a lista só pode trocar a SUBCLASSE de classes que já
 *    existem (respeitando o nível de escolha daquela classe). Adicionar,
 *    remover ou mudar nível é recusado com uma mensagem clara.
 *
 * Retorna `null` quando o patch não mexeu em classes.
 */
function resolveClassPatch(
  existing: ClassEntry[],
  incoming: { classKey: string; subclass: string }[] | undefined,
  abilities: Record<AbilityKey, number>,
): ClassEntry[] | null {
  if (incoming === undefined) return null;

  if (existing.length === 0) {
    if (incoming.length === 0) return [];
    if (incoming.length > 1) {
      throw new HttpError('A ficha começa com uma classe só; as demais entram pelo Level Up.', 400);
    }

    const chosen = incoming[0];
    const definition = getClassDefinition(chosen.classKey);
    if (!definition) throw new HttpError('Classe desconhecida.', 400);

    const missing = multiclassMissingLabel(definition.key, abilities);
    if (missing) {
      throw new HttpError(`Para entrar em ${definition.name} ${missing}.`, 400);
    }

    return [{ classKey: definition.key, subclass: '', level: 1 }];
  }

  const known = new Set(existing.map((entry) => entry.classKey));
  for (const entry of incoming) {
    if (!known.has(entry.classKey)) {
      throw new HttpError(
        'Para adicionar uma classe nova use o Level Up (multiclasse).',
        400,
      );
    }
  }

  let changed = false;
  const next = existing.map((entry) => {
    const patch = incoming.find((item) => item.classKey === entry.classKey);
    if (!patch || patch.subclass === entry.subclass) return entry;

    const definition = getClassDefinition(entry.classKey);

    if (patch.subclass !== '' && definition && entry.level < definition.subclassLevel) {
      throw new HttpError(
        `A subclasse de ${definition.name} é escolhida a partir do nível ${definition.subclassLevel} dela.`,
        400,
      );
    }

    changed = true;
    return { ...entry, subclass: patch.subclass };
  });

  return changed ? next : null;
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

  const character = await prisma.character.create({
    data: {
      userId: actor.userId,
      name: input.name ?? 'Novo Personagem',
      race: input.race ?? '',
      // A ficha nasce sem classe: o jogador escolhe a primeira na ficha, onde
      // o pré-requisito de atributo pode ser conferido com os valores reais.
      classes: [] as unknown as Prisma.InputJsonValue,
      skills: normalizeSkills({}) as unknown as Prisma.InputJsonValue,
      saves: normalizeSaves({}) as unknown as Prisma.InputJsonValue,
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

  // --- Nível e classes -----------------------------------------------------
  // O nível do personagem é a soma dos níveis das classes: quem sobe é o
  // fluxo de Level Up (liberado pelo mestre), nunca o PATCH da ficha.
  if (patch.level !== undefined) {
    throw new HttpError('O nível do personagem só muda pelo Level Up.', 400);
  }

  const currentClasses = normalizeClassEntries(existing.classes);
  const nextClasses = resolveClassPatch(
    currentClasses,
    patch.classes,
    abilitiesOf(existing),
  );
  const classes = nextClasses ?? currentClasses;
  const classesChanged = nextClasses !== null;

  if (classesChanged) {
    data.classes = classes as unknown as Prisma.InputJsonValue;
    // Sem classe, nada de estado de classe pendurado.
    if (classes.length === 0) data.classState = { active: [], used: {} };
  }

  // --- Salvaguardas fixas das classes --------------------------------------
  const currentSaves = normalizeSaves(existing.saves);
  const lockedSaves = lockedSavesOf(classes);
  const lockedSavesMissing = lockedSaves.some((ability) => !currentSaves[ability]);

  if (patch.saves !== undefined || classesChanged || lockedSavesMissing) {
    const base = normalizeSaves(patch.saves ?? existing.saves);
    data.saves = applySaveProficiencies(base, lockedSaves);
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
