import type { Character } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack } from '../shared/attacks.js';
import {
  CLASS_CATALOG,
  applySaveProficiencies,
  computeClassAdjustments,
  expertiseSlots,
  featureEffectsOf,
  findSubclass,
  getActiveClassFeatures,
  getClassDefinition,
  normalizeClassState,
  sneakAttackDice,
  type ActiveClassFeature,
  type ClassAdjustments,
  type ClassDefinition,
  type ClassState,
  type ClassSummary,
} from '../shared/classes.js';
import {
  type AbilityKey,
  type DerivedStats,
  type SkillsState,
  abilityModifier,
  deriveStats,
  normalizeSaves,
  normalizeSkills,
} from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import type { ItemDetails } from '../shared/item-details.js';
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
  /** Sprite do item (`/uploads/items/...`); vazio quando é avulso. */
  imageUrl: string;
  /** Id do item no catálogo do mestre ('' quando é avulso). */
  itemId: string;
  /** Categoria do item no catálogo ('' quando avulso). */
  category: string;
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: ItemDetails;
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
  /** Features de classe/subclasse já liberadas pelo nível atual. */
  activeFeatures: ActiveClassFeature[];
  /** Estado de runtime da classe (toggles ativos e usos gastos). */
  classState: ClassState;
  /** Ajustes mecânicos derivados das features (Fúria, resistências, etc.). */
  classAdjustments: ClassAdjustments;
  level: number;
  background: string;
  alignment: string;
  experience: number;
  /** URL pública do avatar do personagem ('' = sem avatar). */
  avatarUrl: string;

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
  const activeFeatures = getActiveClassFeatures(
    classDefinition,
    character.level,
    character.subclass,
  );
  const subclassDefinition = findSubclass(classDefinition, character.subclass);
  const spellcasting = subclassDefinition?.spellcasting ?? classDefinition?.spellcasting ?? null;

  // Salvaguardas fixas: as da classe e as concedidas por features (ex.: Mente
  // Escorregadia). Aparecem sempre proficientes, mesmo se o valor gravado
  // estiver desatualizado.
  const lockedSaves = [
    ...(classDefinition?.savingThrows ?? []),
    ...activeFeatures.flatMap((feature) =>
      featureEffectsOf(feature).flatMap((effect) =>
        effect.type === 'save' && effect.ability ? [effect.ability] : [],
      ),
    ),
  ];
  const saves = applySaveProficiencies(normalizeSaves(character.saves), lockedSaves);

  const hasSneakAttack = activeFeatures.some((feature) =>
    featureEffectsOf(feature).some((effect) => effect.type === 'sneakAttack'),
  );
  const sneakDice = hasSneakAttack ? sneakAttackDice(character.level) : 0;

  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };

  // Estado de classe (Fúria, etc.) e os ajustes mecânicos que ele liga. Os
  // atributos entram no cálculo de recursos como a Couraça Arcana (2×nível + INT).
  const classState = normalizeClassState(character.classState);
  const classAdjustments = computeClassAdjustments(
    activeFeatures,
    character.level,
    classState,
    abilities,
  );
  const inventory = parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);
  const spells = parseJson<SpellsStateDto>(spellsStateSchema, character.spells, {
    list: [],
    slots: {},
  });
  const attacks = parseJson<AttackDto[]>(attackListSchema, character.attacks, []);
  const features = parseJson<FeatureDto[]>(featureListSchema, character.features, []);

  // Bônus de atributo de features (ex.: Campeão Primitivo) entram nos valores
  // efetivos usados por todos os cálculos derivados; a pontuação gravada segue
  // sendo a base.
  const effectiveAbilities: Record<AbilityKey, number> = { ...abilities };
  for (const [ability, bonus] of Object.entries(classAdjustments.abilityBonuses)) {
    const key = ability as AbilityKey;
    const cap = classAdjustments.abilityCaps[key] ?? Number.POSITIVE_INFINITY;
    effectiveAbilities[key] = Math.min(effectiveAbilities[key] + bonus, cap);
  }

  // Conjuradores preparados (Druida, Clérigo, Mago) recalculam as magias
  // preparadas por descanso: mod. do atributo + nível, mínimo 1.
  const castingAbility = spellcasting?.ability ?? null;
  const preparedSpellCount =
    castingAbility &&
    spellcasting &&
    spellcasting.learning === 'prepared' &&
    spellcasting.type === 'full'
      ? Math.max(1, abilityModifier(effectiveAbilities[castingAbility]) + character.level)
      : null;

  const derived = deriveStats({
    level: character.level,
    abilities: effectiveAbilities,
    skills,
    saves,
    initiativeBonus: character.initiativeBonus,
    className: character.className,
    inventory,
    hitDie: classDefinition?.hitDie ?? null,
    spellcastingAbility: spellcasting ? spellcasting.ability : undefined,
    lockedSaves,
    sneakAttack: sneakDice > 0 ? { dice: sneakDice, expression: `${sneakDice}d6` } : null,
    expertiseSlots: expertiseSlots(activeFeatures),
    unarmoredDefenseAbility: classAdjustments.unarmoredDefenseAbility,
    unarmoredDefenseBase: classAdjustments.unarmoredDefense ? classAdjustments.unarmoredDefenseBase : null,
    preparedSpellCount,
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
    activeFeatures,
    classState,
    classAdjustments,
    level: character.level,
    background: character.background,
    alignment: character.alignment,
    experience: character.experience,
    avatarUrl: character.avatarUrl,
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
