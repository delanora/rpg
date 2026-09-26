import type { Character } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack } from '../shared/attacks.js';
import {
  CLASS_CATALOG,
  applyClassSavingThrows,
  getClassDefinition,
  type ClassDefinition,
  type ClassSummary,
} from '../shared/classes.js';
import {
  type AbilityKey,
  type DerivedStats,
  type SkillsState,
  deriveStats,
  normalizeSaves,
  normalizeSkills,
} from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import {
  featureSchema,
  inventoryItemSchema,
  spellSchema,
  spellSlotSchema,
  spellsStateSchema,
} from './characters.schema.js';

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

export type AttackDto = Attack;
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
  /** Chave canônica da classe ('' = sem classe). */
  classKey: string;
  /** Subclasse escolhida ('' = nenhuma). */
  subclass: string;
  /** Definição completa da classe escolhida (nula se nenhuma). */
  classDefinition: ClassDefinition | null;
  /** Catálogo resumido das 12 classes, usado pelo seletor da ficha. */
  classCatalog: ClassSummary[];
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

export function toCharacterDto(character: Character, ownerUsername?: string): CharacterDto {
  const skills = normalizeSkills(character.skills);
  const classDefinition = getClassDefinition(character.classKey);
  // As salvaguardas de classe são fixas: aparecem sempre proficientes na ficha,
  // mesmo que o valor gravado esteja desatualizado.
  const saves = applyClassSavingThrows(normalizeSaves(character.saves), classDefinition);
  const inventory = parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);
  const spells = parseJson<SpellsStateDto>(spellsStateSchema, character.spells, {
    list: [],
    slots: {},
  });
  const attacks = parseJson<AttackDto[]>(attackListSchema, character.attacks, []);
  const features = parseJson<FeatureDto[]>(featureListSchema, character.features, []);

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
    hitDie: classDefinition?.hitDie ?? null,
    spellcastingAbility: classDefinition ? classDefinition.spellcasting.ability : undefined,
  });

  return {
    id: character.id,
    userId: character.userId,
    ...(ownerUsername === undefined ? {} : { ownerUsername }),
    name: character.name,
    race: character.race,
    className: character.className,
    classKey: character.classKey,
    subclass: character.subclass,
    classDefinition,
    classCatalog: CLASS_CATALOG,
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
