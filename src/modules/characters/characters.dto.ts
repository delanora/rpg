import type { Character } from '@prisma/client';
import { z } from 'zod';
import {
  attackSchema,
  featureSchema,
  inventoryItemSchema,
  spellSchema,
  spellSlotSchema,
  spellsStateSchema,
} from './characters.schema.js';
import {
  type AbilityKey,
  type DerivedStats,
  type SkillsState,
  deriveStats,
  normalizeSaves,
  normalizeSkills,
} from './dnd5e.js';

export interface InventoryItemDto {
  id: string;
  name: string;
  description: string;
  quantity: number;
  weight: number;
  equipped: boolean;
}

export type SpellDto = z.infer<typeof spellSchema>;
export type SpellSlotDto = z.infer<typeof spellSlotSchema>;
export interface SpellsStateDto {
  list: SpellDto[];
  slots: Record<string, SpellSlotDto>;
}

export type AttackDto = z.infer<typeof attackSchema>;
export type FeatureDto = z.infer<typeof featureSchema>;

/** Formato enviado ao frontend. Inclui os valores derivados, nunca gravados. */
export interface CharacterDto {
  id: string;
  userId: string;
  ownerUsername?: string;

  // Identidade
  name: string;
  race: string;
  className: string;
  level: number;
  background: string;
  alignment: string;
  experience: number;

  // Atributos
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  // Vida e defesa (nomes espelham o payload do PATCH, facilitando a edição inline)
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  armorClass: number;
  initiativeBonus: number;
  speed: number;

  // Coleções
  skills: SkillsState;
  saves: Record<AbilityKey, boolean>;
  inventory: InventoryItemDto[];
  spells: SpellsStateDto;
  attacks: AttackDto[];
  features: FeatureDto[];

  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  derived: DerivedStats;
}

const inventoryListSchema = z.array(inventoryItemSchema);
const attackListSchema = z.array(attackSchema);
const featureListSchema = z.array(featureSchema);

/** Faz o parse com fallback seguro — protege contra dados antigos/corrompidos. */
function parseOr<T>(schema: z.ZodTypeAny, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return (result.success ? result.data : fallback) as T;
}

export function toCharacterDto(character: Character, ownerUsername?: string): CharacterDto {
  const skills = normalizeSkills(character.skills);
  const saves = normalizeSaves(character.saves);
  const inventory = parseOr<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);
  const spells = parseOr<SpellsStateDto>(spellsStateSchema, character.spells, {
    list: [],
    slots: {},
  });
  const attacks = parseOr<AttackDto[]>(attackListSchema, character.attacks, []);
  const features = parseOr<FeatureDto[]>(featureListSchema, character.features, []);

  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };

  const derived = deriveStats({
    level: character.level,
    abilities,
    skills,
    saves,
    initiativeBonus: character.initiativeBonus,
    className: character.className,
    inventory,
  });

  return {
    id: character.id,
    userId: character.userId,
    ...(ownerUsername === undefined ? {} : { ownerUsername }),
    name: character.name,
    race: character.race,
    className: character.className,
    level: character.level,
    background: character.background,
    alignment: character.alignment,
    experience: character.experience,
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
    hpCurrent: character.hpCurrent,
    hpMax: character.hpMax,
    hpTemp: character.hpTemp,
    armorClass: character.armorClass,
    initiativeBonus: character.initiativeBonus,
    speed: character.speed,
    skills,
    saves,
    inventory,
    spells,
    attacks,
    features,
    notes: character.notes,
    version: character.version,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
    derived,
  };
}
