import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import {
  normalizeClassEntries,
  pactMagicSlots,
  spellSlotsForClasses,
} from '../../shared/classes.js';
import { parseJson } from '../../shared/json.js';
import {
  spellsStateSchema,
  type SpellsStateInput,
} from '../../characters/characters.schema.js';
import {
  creatureSpellcastingMaxOf,
  creatureSpellcastingUsedOf,
  type CreatureSpellcastingUsed,
} from '../../shared/creature-spellcasting.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import {
  castingResourcesForPools,
  selectCastingResource,
  type CastingResource,
  type CastingResourceRef,
} from './casting-resource.js';

/**
 * FASE 6.6C — estado AUTORITATIVO dos espaços de magia.
 *
 * Personagem: o MÁXIMO é derivado das classes (`spellSlotsForClasses` /
 * `pactMagicSlots`) e o USO já vive em `Character.spells` (`slotsUsed` /
 * `pactMagic.used`) — a MESMA fonte de verdade da ficha e dos descansos. Este
 * serviço não cria tabela nem contador paralelo.
 *
 * Criatura/NPC: o statblock declara o MÁXIMO (`Creature.spellcastingResources`);
 * o USO fica na entidade que conjura (template ou INSTÂNCIA de combate), nunca
 * compartilhado entre cópias do mesmo template.
 *
 * O gasto é condicionado à versão (optimistic guard), na MESMA transação do
 * `SpellCast` committed: retry não gasta de novo e a última corrida de um espaço
 * só tem um vencedor.
 */

type Db = Prisma.TransactionClient | typeof prisma;

interface ResourceSnapshot {
  kind: CastingResource['kind'];
  level: number;
  sourceId: string;
}

function unavailable(message: string): never {
  throw new HttpError(message, 409, 'SPELLCASTING_RESOURCE_NOT_AVAILABLE');
}

function mapSelectionError(error: unknown): never {
  if (error instanceof Error) {
    if (error.name === 'SPELLCASTING_RESOURCE_REQUIRED') {
      throw new HttpError(error.message, 400, 'SPELLCASTING_RESOURCE_REQUIRED');
    }
    if (error.name === 'SPELLCASTING_RESOURCE_INVALID') {
      throw new HttpError(error.message, 400, 'SPELLCASTING_RESOURCE_INVALID');
    }
    if (error.name === 'SPELLCASTING_RESOURCE_NOT_AVAILABLE') {
      throw new HttpError(error.message, 409, 'SPELLCASTING_RESOURCE_NOT_AVAILABLE');
    }
  }
  throw error;
}

function resourcesOfCharacterRow(row: {
  classes: unknown;
  spells: unknown;
}): CastingResource[] {
  const entries = normalizeClassEntries(row.classes);
  const spells = parseJson<SpellsStateInput>(spellsStateSchema, row.spells, {
    list: [],
    slotsUsed: {},
    pactMagic: { used: 0 },
  });
  return castingResourcesForPools({
    spellSlots: spellSlotsForClasses(entries),
    pactSlots: pactMagicSlots(entries),
    slotsUsed: spells.slotsUsed,
    pactUsed: spells.pactMagic.used,
  });
}

function resourcesOfStatblock(maxRaw: unknown, usedRaw: unknown): CastingResource[] {
  const max = creatureSpellcastingMaxOf(maxRaw);
  const used = creatureSpellcastingUsedOf(usedRaw);
  return castingResourcesForPools({
    spellSlots: max.spellSlots,
    pactSlots: max.pactSlot
      ? { max: max.pactSlot.max, slotLevel: max.pactSlot.level }
      : null,
    slotsUsed: used.spellSlotsUsed,
    pactUsed: used.pactSlotUsed,
  });
}

/** Recursos de um PERSONAGEM (max derivado + uso persistido). */
export async function characterCastingResources(
  entity: MechanicalEntity,
  db: Db,
): Promise<CastingResource[]> {
  const row = await db.character.findUnique({ where: { id: entity.id } });
  if (!row) throw new HttpError('Personagem não encontrado.', 404);
  return resourcesOfCharacterRow(row);
}

/** Recursos de uma CRIATURA template ou de uma INSTÂNCIA de combate. */
export async function creatureCastingResources(
  entity: MechanicalEntity,
  db: Db,
): Promise<CastingResource[]> {
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return resourcesOfStatblock(row.spellcastingResources, row.spellcastingUsed);
  }
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true },
  });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) {
    return characterCastingResources({ kind: 'character', id: row.characterId }, db);
  }
  if (!row.creature) return [];
  return resourcesOfStatblock(row.creature.spellcastingResources, row.spellcastingUsed);
}

/** Recursos do caster (canonicaliza combatente de personagem para a ficha). */
export async function castingResourcesForEntity(
  entity: MechanicalEntity,
  db: Db = prisma,
): Promise<CastingResource[]> {
  if (entity.kind === 'character') return characterCastingResources(entity, db);
  return creatureCastingResources(entity, db);
}

/**
 * VALIDATE (read-only): escolhe o recurso para a magia.
 *
 * `spellLevel` vem do catálogo; o cliente só pode apontar `kind` + `level`.
 */
export async function resolveCastingResource(
  entity: MechanicalEntity,
  spellLevel: number,
  requested: CastingResourceRef | undefined,
  db: Db = prisma,
): Promise<CastingResource | null> {
  const resources = await castingResourcesForEntity(entity, db);
  try {
    return selectCastingResource(resources, spellLevel, requested);
  } catch (error) {
    return mapSelectionError(error);
  }
}

function withSpent(
  used: CreatureSpellcastingUsed,
  resource: CastingResource,
): Prisma.InputJsonValue {
  const spellSlotsUsed = { ...used.spellSlotsUsed };
  if (resource.kind === 'spell-slot') {
    spellSlotsUsed[String(resource.level)] =
      (spellSlotsUsed[String(resource.level)] ?? 0) + 1;
    return { spellSlotsUsed } as unknown as Prisma.InputJsonValue;
  }
  return {
    spellSlotsUsed,
    pactSlotUsed: used.pactSlotUsed + 1,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * COMMIT: gasta UM espaço, com guarda de versão. Devolve o snapshot do recurso.
 *
 * Chamado dentro da transação do `SpellCast` — falha de escrita desfaz o cast e
 * falha do cast desfaz o gasto (atomicidade).
 */
export async function spendCastingResource(
  entity: MechanicalEntity,
  resource: CastingResource,
  db: Prisma.TransactionClient,
): Promise<ResourceSnapshot> {
  if (resource.remaining <= 0) {
    unavailable('O espaço de magia selecionado não está mais disponível.');
  }

  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const current = resourcesOfCharacterRow(row).find(
      (item) => item.kind === resource.kind && item.level === resource.level,
    );
    if (!current || current.remaining <= 0) {
      unavailable('O espaço de magia selecionado não está mais disponível.');
    }
    const spells = parseJson<SpellsStateInput>(spellsStateSchema, row.spells, {
      list: [],
      slotsUsed: {},
      pactMagic: { used: 0 },
    });
    const next =
      resource.kind === 'spell-slot'
        ? {
            ...spells,
            slotsUsed: {
              ...spells.slotsUsed,
              [String(resource.level)]: (spells.slotsUsed[String(resource.level)] ?? 0) + 1,
            },
          }
        : { ...spells, pactMagic: { used: spells.pactMagic.used + 1 } };
    const written = await db.character.updateMany({
      where: { id: row.id, version: row.version },
      data: { spells: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    if (!written.count) {
      unavailable('O estado da ficha mudou durante a conjuração; nenhum espaço foi gasto.');
    }
    return { kind: resource.kind, level: resource.level, sourceId: resource.sourceId };
  }

  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    const written = await db.creature.updateMany({
      where: { id: row.id, version: row.version },
      data: {
        spellcastingUsed: withSpent(creatureSpellcastingUsedOf(row.spellcastingUsed), resource),
        version: { increment: 1 },
      },
    });
    if (!written.count) {
      unavailable('O estado da criatura mudou durante a conjuração; nenhum espaço foi gasto.');
    }
    return { kind: resource.kind, level: resource.level, sourceId: resource.sourceId };
  }

  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true },
  });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) {
    return spendCastingResource({ kind: 'character', id: row.characterId }, resource, db);
  }
  const written = await db.combatant.updateMany({
    where: { id: row.id, mechanicalVersion: row.mechanicalVersion },
    data: {
      spellcastingUsed: withSpent(creatureSpellcastingUsedOf(row.spellcastingUsed), resource),
      mechanicalVersion: { increment: 1 },
    },
  });
  if (!written.count) {
    unavailable('O estado da instância mudou durante a conjuração; nenhum espaço foi gasto.');
  }
  return { kind: resource.kind, level: resource.level, sourceId: resource.sourceId };
}
