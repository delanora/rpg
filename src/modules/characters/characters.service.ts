import { randomInt, randomUUID } from 'node:crypto';
import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents, type SheetUpdatedPayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { getGameConfig } from '../game-config/game-config.service.js';
import { toCharacterDto, type CharacterDto, type InventoryItemDto } from './characters.dto.js';
import {
  catalogItemIds,
  loadCatalogLookup,
  type CatalogSnapshot,
} from './inventory-sync.js';
import { inventoryListSchema } from './characters.schema.js';
import type {
  CreateCharacterInput,
  LevelUpInput,
  MoveInventoryItemInput,
  UpdateCharacterInput,
} from './characters.schema.js';
import { parseJson } from '../shared/json.js';
import {
  applySaveProficiencies,
  averageHitDie,
  findSubclass,
  getClassDefinition,
  isAsiLevel,
  multiclassMissingLabel,
  normalizeClassEntries,
  totalCharacterLevel,
  type ClassEntry,
} from '../shared/classes.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import { LEVEL_MAX, abilityModifier, normalizeSaves, normalizeSkills } from '../shared/dnd5e.js';

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
 * PV de nível 1: o máximo do Dado de Vida da classe + modificador de
 * Constituição (mínimo 1, mesmo com Constituição negativa).
 */
function firstLevelHpMax(hitDie: number, constitution: number): number {
  return Math.max(1, hitDie + abilityModifier(constitution));
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
      // O PV inicial (dado de vida + Constituição) é calculado nessa escolha.
      // Ver applyCharacterPatch.
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

/**
 * Sobe um nível seguindo o assistente de Level Up.
 *
 * Só é permitido quando o mestre liberou a mesa E o jogador ainda não usou a
 * liberação atual (`lastLevelUpRelease < GameConfig.levelUpRelease`). Aplica de
 * uma vez: o nível da classe (nova ou existente), o PV ganho (dado rolado no
 * servidor ou a média do PHB, sempre mínimo 1), a subclasse quando o nível a
 * libera e o Aumento de Atributo/Talento quando é um nível de ASI da classe.
 */
export async function levelUpCharacter(actor: Actor, input: LevelUpInput): Promise<CharacterDto> {
  const config = await getGameConfig();
  if (!config.levelUpUnlocked) {
    throw new HttpError('O mestre ainda não liberou o Level Up.', 403);
  }

  // Leitura, checagem e gravação na MESMA transação: o `where` com o
  // `lastLevelUpRelease` antigo (ver applyLevelUp) impede que dois cliques
  // simultâneos apliquem dois níveis na mesma liberação.
  const { updated, levelUp } = await prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { userId: actor.userId } });
    if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

    if (character.lastLevelUpRelease >= config.levelUpRelease) {
      throw new HttpError('Você já usou esta liberação de Level Up.', 409);
    }

    return applyLevelUp(tx, actor, input, config, character);
  });

  await publishChange(actor, updated, { levelUp });

  return toSheetDto(updated, actor.username);
}

/**
 * Núcleo do Level Up: valida contra a classe e grava dentro da transação.
 *
 * A gravação é um `updateMany` cujo `where` inclui o `lastLevelUpRelease` lido:
 * se outra requisição já aplicou o level up, nenhuma linha casa e devolvemos 409.
 */
async function applyLevelUp(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: LevelUpInput,
  config: Awaited<ReturnType<typeof getGameConfig>>,
  character: Character,
): Promise<{
  updated: Character;
  levelUp: { classKey: string; classLevel: number; hpGained: number; hpRolled: boolean };
}> {
  const entries = normalizeClassEntries(character.classes);
  const abilities = abilitiesOf(character);

  if (totalCharacterLevel(entries) >= LEVEL_MAX) {
    throw new HttpError('O personagem já está no nível máximo (20).', 400);
  }

  const definition = getClassDefinition(input.classKey);
  if (!definition) throw new HttpError('Classe desconhecida.', 400);

  const existing = entries.find((entry) => entry.classKey === definition.key);
  if (existing && existing.level >= LEVEL_MAX) {
    throw new HttpError(`${definition.name} já está no nível máximo.`, 400);
  }

  // Classe nova (multiclasse) precisa do pré-requisito de atributo.
  if (!existing) {
    const missing = multiclassMissingLabel(definition.key, abilities);
    if (missing) throw new HttpError(`Para entrar em ${definition.name} ${missing}.`, 400);
  }

  const newClassLevel = existing ? existing.level + 1 : 1;

  // --- Pontos de vida: dado rolado ou média (d6=4, d8=5, d10=6, d12=7) ----
  const conModifier = abilityModifier(character.constitution);
  const dieRoll =
    input.hp === 'roll'
      ? randomInt(1, definition.hitDie + 1)
      : averageHitDie(definition.hitDie);
  // Mínimo de 1 PV por nível, mesmo com modificador de Constituição negativo.
  const hpGained = Math.max(1, dieRoll + conModifier);

  // --- Subclasse: exigida quando o nível da classe libera a escolha ---------
  let subclass = existing?.subclass ?? '';
  if (!subclass && newClassLevel >= definition.subclassLevel) {
    const chosen = input.subclass.trim();
    if (!chosen) {
      throw new HttpError(`Escolha a subclasse de ${definition.name}.`, 400);
    }
    const found = findSubclass(definition, chosen);
    if (!found) throw new HttpError('Subclasse desconhecida.', 400);
    subclass = found.name;
  }

  // --- Aumento de Atributo ou Talento (só nos níveis de ASI da classe) ------
  const data: Record<string, unknown> = {};
  const features: unknown[] = Array.isArray(character.features) ? [...character.features] : [];

  if (isAsiLevel(definition.key, newClassLevel)) {
    if (input.feat) {
      features.push({
        id: `feat-${randomUUID()}`,
        name: input.feat.name,
        source: 'feat',
        description: input.feat.description,
      });
      data.features = features;
    } else {
      const increases = new Map<AbilityKey, number>();
      for (const item of input.abilityIncreases) {
        const ability = item.ability as AbilityKey;
        increases.set(ability, (increases.get(ability) ?? 0) + item.amount);
      }
      const points = [...increases.values()].reduce((sum, value) => sum + value, 0);
      if (points !== 2) {
        throw new HttpError(
          'Distribua as 2 melhorias: +2 em um atributo ou +1 em dois diferentes.',
          400,
        );
      }

      for (const [ability, amount] of increases) {
        if (character[ability] + amount > 20) {
          throw new HttpError('Nenhum atributo pode passar de 20.', 400);
        }
        data[ability] = character[ability] + amount;
      }
    }
  } else if (input.feat || input.abilityIncreases.length > 0) {
    throw new HttpError(
      'Este nível não concede Aumento de Atributo nem Talento.',
      400,
    );
  }

  // --- Grava de uma vez ----------------------------------------------------
  const nextEntries: ClassEntry[] = existing
    ? entries.map((entry) =>
        entry.classKey === definition.key ? { ...entry, level: newClassLevel, subclass } : entry,
      )
    : [...entries, { classKey: definition.key, subclass, level: 1 }];

  const result = await tx.character.updateMany({
    where: {
      userId: actor.userId,
      // Condição de corrida: só grava se a liberação ainda não foi usada.
      lastLevelUpRelease: character.lastLevelUpRelease,
    },
    data: {
      ...(data as Prisma.CharacterUpdateManyMutationInput),
      classes: nextEntries as unknown as Prisma.InputJsonValue,
      // O PV ganho vale tanto para o máximo quanto para o PV atual.
      hpMax: character.hpMax + hpGained,
      hpCurrent: character.hpCurrent + hpGained,
      lastLevelUpRelease: config.levelUpRelease,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new HttpError('Você já usou esta liberação de Level Up.', 409);
  }

  // Relê a ficha dentro da transação para devolver o estado já gravado.
  const updated = await tx.character.findUniqueOrThrow({ where: { userId: actor.userId } });

  return {
    updated,
    levelUp: {
      classKey: definition.key,
      classLevel: newClassLevel,
      hpGained,
      hpRolled: input.hp === 'roll',
    },
  };
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
 * Move um item do inventário: equipa em um slot ou reposiciona na mochila.
 *
 * O destino padrão é a mochila (`slot` nulo). Se o destino já estiver ocupado,
 * o item que estava lá assume a posição antiga do item movido (troca), o que
 * mantém a regra de um item por slot. Nenhuma categoria é validada: qualquer
 * item pode ir a qualquer slot ou célula.
 */
export async function moveInventoryItem(
  actor: Actor,
  input: MoveInventoryItemInput,
): Promise<CharacterDto> {
  const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

  const inventory = parseJson<InventoryItemDto[]>(
    inventoryListSchema,
    character.inventory,
    [],
  );
  const item = inventory.find((entry) => entry.id === input.itemInventoryId);
  if (!item) throw new HttpError('Item não encontrado no inventário.', 404);

  const targetX = input.targetBackpackX ?? null;
  const targetY = input.targetBackpackY ?? null;
  // Slot definido e não nulo equipa; caso contrário, vai para a grade da mochila.
  const equipToSlot = input.targetSlot !== undefined && input.targetSlot !== null;

  // Item que já ocupa o destino (nunca o próprio item sendo movido).
  const occupant = equipToSlot
    ? inventory.find((entry) => entry.id !== item.id && entry.slot === input.targetSlot)
    : targetX !== null && targetY !== null
      ? inventory.find(
          (entry) =>
            entry.id !== item.id &&
            entry.slot === null &&
            entry.backpackX === targetX &&
            entry.backpackY === targetY,
        )
      : undefined;

  // Posição antiga do item movido; na troca, é para onde o ocupante vai.
  const previousSlot = item.slot;
  const previousX = item.backpackX;
  const previousY = item.backpackY;

  if (equipToSlot) {
    item.slot = input.targetSlot ?? null;
    item.backpackX = null;
    item.backpackY = null;
  } else {
    item.slot = null;
    item.backpackX = targetX;
    item.backpackY = targetY;
  }

  if (occupant) {
    occupant.slot = previousSlot;
    occupant.backpackX = previousX;
    occupant.backpackY = previousY;
  }

  const updated = await prisma.character.update({
    where: { userId: actor.userId },
    data: {
      inventory: inventory as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  await publishChange(actor, updated, { inventory });
  return toSheetDto(updated, actor.username);
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

    // Primeira classe escolhida: define o PV inicial (dado de vida máximo +
    // modificador de Constituição), salvo se o patch já mandou PV explícito.
    if (currentClasses.length === 0 && classes.length > 0 && patch.hpMax === undefined) {
      const chosen = getClassDefinition(classes[0].classKey);
      if (chosen) {
        const constitution = patch.constitution ?? existing.constitution;
        const hpMax = firstLevelHpMax(chosen.hitDie, constitution);
        data.hpMax = hpMax;
        if (patch.hpCurrent === undefined) data.hpCurrent = hpMax;
      }
    }
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
