import type { CustomRace, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import type { RaceOption } from '../shared/creation.js';
import { ABILITY_KEYS, type AbilityKey } from '../shared/dnd5e.js';
import type { CustomRaceDto, CustomRaceAbilityIncreaseDto, CustomRaceTraitDto } from './custom-races.dto.js';
import type { CreateCustomRaceInput, UpdateCustomRaceInput } from './custom-races.schema.js';

/**
 * Raças PERSONALIZADAS do mestre (Prompt 2.10).
 *
 * Seguem o formato do catálogo estruturado, sem sub-raças. O mestre cria/edita
 * pelo painel; o assistente de criação as lista junto das nove raças fixas e o
 * compêndio as mostra na mesma lista.
 */

function isAbilityKey(value: unknown): value is AbilityKey {
  return typeof value === 'string' && (ABILITY_KEYS as readonly string[]).includes(value);
}

/** Lê o JSONB `abilityScoreIncrease` como uma lista tipada, descartando lixo. */
function parseAbilityIncreases(value: unknown): CustomRaceAbilityIncreaseDto[] {
  if (!Array.isArray(value)) return [];
  const result: CustomRaceAbilityIncreaseDto[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { ability?: unknown; amount?: unknown };
    if (!isAbilityKey(item.ability)) continue;
    if (typeof item.amount !== 'number' || !Number.isFinite(item.amount)) continue;
    result.push({ ability: item.ability, amount: Math.trunc(item.amount) });
  }
  return result;
}

/** Lê o JSONB `traits` como uma lista de traços em texto. */
function parseTraits(value: unknown): CustomRaceTraitDto[] {
  if (!Array.isArray(value)) return [];
  const result: CustomRaceTraitDto[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { name?: unknown; description?: unknown };
    if (typeof item.name !== 'string' || item.name.trim().length === 0) continue;
    result.push({
      name: item.name.trim(),
      description: typeof item.description === 'string' ? item.description : '',
    });
  }
  return result;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Converte a linha do banco no DTO entregue ao cliente. */
export function toCustomRaceDto(race: CustomRace): CustomRaceDto {
  return {
    id: race.id,
    name: race.name,
    description: race.description,
    abilityScoreIncrease: parseAbilityIncreases(race.abilityScoreIncrease),
    speed: race.speed,
    size: race.size === 'Small' ? 'Small' : 'Medium',
    darkvision: race.darkvision,
    damageResistances: parseStringList(race.damageResistances),
    languages: parseStringList(race.languages),
    bonusLanguageChoices: race.bonusLanguageChoices,
    traits: parseTraits(race.traits),
    version: race.version,
  };
}

/**
 * Converte a raça personalizada numa OPÇÃO do catálogo de criação — a mesma
 * forma das raças fixas, para o assistente listar tudo junto. A chave é
 * `custom:<id>` e `customRaceId` marca a origem (a ficha guarda o id).
 */
export function customRaceToOption(race: CustomRace): RaceOption {
  const dto = toCustomRaceDto(race);
  const abilityBonuses: Partial<Record<AbilityKey, number>> = {};
  for (const increase of dto.abilityScoreIncrease) {
    abilityBonuses[increase.ability] = (abilityBonuses[increase.ability] ?? 0) + increase.amount;
  }

  return {
    key: `custom:${dto.id}`,
    name: dto.name,
    baseRace: dto.name,
    description: dto.description || undefined,
    raceId: dto.id,
    customRaceId: dto.id,
    abilityBonuses,
    abilityChoice: 0,
    choices: [],
    // Os traços das personalizadas são texto livre: ganham um id derivado só
    // para servir de chave na lista da ficha.
    traits: dto.traits.map((trait, index) => ({
      id: `custom-trait-${index}`,
      name: trait.name,
      description: trait.description,
    })),
  };
}

/** Todas as raças personalizadas, em ordem alfabética. */
export async function listCustomRaces(): Promise<CustomRaceDto[]> {
  const races = await prisma.customRace.findMany({ orderBy: { name: 'asc' } });
  return races.map(toCustomRaceDto);
}

/** As raças personalizadas já no formato de opção do assistente. */
export async function listCustomRaceOptions(): Promise<RaceOption[]> {
  const races = await prisma.customRace.findMany({ orderBy: { name: 'asc' } });
  return races.map(customRaceToOption);
}

/** Uma raça personalizada pelo id (linha crua), ou erro 404. */
export async function findCustomRace(id: string): Promise<CustomRace> {
  const race = await prisma.customRace.findUnique({ where: { id } });
  if (!race) throw new HttpError('Raça personalizada não encontrada.', 404);
  return race;
}

export async function getCustomRace(id: string): Promise<CustomRaceDto> {
  return toCustomRaceDto(await findCustomRace(id));
}

/** Quantos personagens usam esta raça personalizada. */
export async function countCharactersWithCustomRace(id: string): Promise<number> {
  return prisma.character.count({ where: { customRaceId: id } });
}

export async function createCustomRace(input: CreateCustomRaceInput): Promise<CustomRaceDto> {
  const race = await prisma.customRace.create({
    data: {
      name: input.name,
      description: input.description ?? '',
      abilityScoreIncrease: (input.abilityScoreIncrease ?? []) as Prisma.InputJsonValue,
      speed: input.speed ?? 9,
      size: input.size ?? 'Medium',
      darkvision: input.darkvision ?? 0,
      damageResistances: (input.damageResistances ?? []) as Prisma.InputJsonValue,
      languages: (input.languages ?? []) as Prisma.InputJsonValue,
      bonusLanguageChoices: input.bonusLanguageChoices ?? 0,
      traits: (input.traits ?? []) as Prisma.InputJsonValue,
    },
  });

  return toCustomRaceDto(race);
}

export async function updateCustomRace(
  id: string,
  patch: UpdateCustomRaceInput,
): Promise<CustomRaceDto> {
  await findCustomRace(id);

  const data: Prisma.CustomRaceUpdateInput = { version: { increment: 1 } };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.abilityScoreIncrease !== undefined) {
    data.abilityScoreIncrease = patch.abilityScoreIncrease as Prisma.InputJsonValue;
  }
  if (patch.speed !== undefined) data.speed = patch.speed;
  if (patch.size !== undefined) data.size = patch.size;
  if (patch.darkvision !== undefined) data.darkvision = patch.darkvision;
  if (patch.damageResistances !== undefined) {
    data.damageResistances = patch.damageResistances as Prisma.InputJsonValue;
  }
  if (patch.languages !== undefined) data.languages = patch.languages as Prisma.InputJsonValue;
  if (patch.bonusLanguageChoices !== undefined) {
    data.bonusLanguageChoices = patch.bonusLanguageChoices;
  }
  if (patch.traits !== undefined) data.traits = patch.traits as Prisma.InputJsonValue;

  const race = await prisma.customRace.update({ where: { id }, data });
  return toCustomRaceDto(race);
}

/**
 * Remove uma raça personalizada. Se houver personagens usando-a, os campos de
 * raça deles são LIMPOS (o FK cai sozinho com SET NULL) — evita fichas
 * apontando para uma raça inexistente. Erro se não existir.
 */
export async function deleteCustomRace(id: string): Promise<void> {
  await findCustomRace(id);

  await prisma.$transaction([
    prisma.character.updateMany({
      where: { customRaceId: id },
      data: { customRaceId: null, race: '', raceId: null, subraceId: null, raceChoices: {} },
    }),
    prisma.customRace.delete({ where: { id } }),
  ]);
}
