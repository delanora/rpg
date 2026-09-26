import type { Character } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack } from '../shared/attacks.js';
import {
  applySaveProficiencies,
  asiLevelsFor,
  classEntriesLabel,
  classOptionsFor,
  computeMulticlassAdjustments,
  expertiseSlots,
  featureEffectsOf,
  findSubclass,
  getClassDefinition,
  getMulticlassFeatures,
  multiclassCasterLevel,
  multiclassSneakAttack,
  normalizeClassEntries,
  normalizeClassState,
  pactMagicSlots,
  spellSlotsForCasterLevel,
  totalCharacterLevel,
  type ActiveClassFeature,
  type ClassAdjustments,
  type ClassEntry,
  type ClassOption,
  type ClassState,
  type SpellcastingType,
  type SpellLearning,
} from '../shared/classes.js';
import {
  type AbilityKey,
  type DerivedStats,
  type SkillsState,
  abilityModifier,
  deriveStats,
  normalizeSaves,
  normalizeSkills,
  spellAttackBonus,
  spellSaveDc,
} from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import type { ItemDetails } from '../shared/item-details.js';
import { syncInventory, type CatalogSnapshot } from './inventory-sync.js';
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

/**
 * Uma classe do personagem no DTO, com o que o frontend precisa para exibir e
 * editar aquela classe (o nível dela é somente leitura: sobe pelo Level Up).
 */
export interface ClassEntryDto {
  classKey: string;
  /** Nome da classe (ex.: "Ladino"). */
  className: string;
  /** Subclasse escolhida ('' = nenhuma). */
  subclass: string;
  /** Nível NAQUELA classe. */
  level: number;
  hitDie: number;
  /** Nível daquela classe em que a subclasse é escolhida. */
  subclassLevel: number;
  /** Verdadeiro quando o nível dela já libera a escolha de subclasse. */
  subclassEligible: boolean;
  /** Nomes das subclasses disponíveis. */
  subclassNames: string[];
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  /**
   * Conjuração DESTA classe: a CD e o ataque usam o nível total do personagem
   * (bônus de proficiência), e as magias preparadas usam o nível dela.
   */
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
    saveDC: number | null;
    attackBonus: number | null;
    preparedCount: number | null;
  } | null;
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
  /** Nome composto das classes, com os níveis (ex.: "Bárbaro 3 / Ladino 2"). */
  className: string;
  /** Classes do personagem (multiclasse), em ordem de entrada. */
  classes: ClassEntryDto[];
  /**
   * Catálogo das 12 classes com a elegibilidade do personagem já calculada
   * (pré-requisito de atributo atendido ou o motivo do bloqueio).
   */
  classOptions: ClassOption[];
  /** Features de TODAS as classes já liberadas nos níveis delas. */
  activeFeatures: ActiveClassFeature[];
  /** Estado de runtime da classe (toggles ativos e usos gastos). */
  classState: ClassState;
  /** Ajustes mecânicos somados das classes (Fúria, resistências, etc.). */
  classAdjustments: ClassAdjustments;
  /** Nível total do personagem (soma dos níveis das classes). */
  level: number;
  /**
   * Última liberação de Level Up que ESTE personagem já usou. O cliente compara
   * com `GameConfig.levelUpRelease` para habilitar o botão uma vez por liberação.
   */
  lastLevelUpRelease: number;
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

export function toCharacterDto(
  character: Character,
  ownerUsername?: string,
  /** Itens do catálogo, para o inventário espelhar os dados atuais do mestre. */
  catalog?: Map<string, CatalogSnapshot>,
): CharacterDto {
  const skills = normalizeSkills(character.skills);

  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };

  // Multiclasse: as classes vêm da lista e o nível total é a soma delas.
  const classEntries = normalizeClassEntries(character.classes);
  const level = totalCharacterLevel(classEntries);
  const className = classEntriesLabel(classEntries);
  const classState = normalizeClassState(character.classState);

  // Cada classe é avaliada no PRÓPRIO nível: um Bárbaro 3/Ladino 2 tem as
  // features de bárbaro até o 3 e as de ladino até o 2, ao mesmo tempo.
  const activeFeatures = getMulticlassFeatures(classEntries);
  const classAdjustments = computeMulticlassAdjustments(classEntries, classState, abilities);

  // Salvaguardas fixas: as de todas as classes e as concedidas por features
  // (ex.: Mente Escorregadia). Aparecem sempre proficientes, mesmo se o valor
  // gravado estiver desatualizado.
  const lockedSaves = [
    ...classEntries.flatMap((entry) => getClassDefinition(entry.classKey)?.savingThrows ?? []),
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
  const sneakDice = hasSneakAttack ? multiclassSneakAttack(classEntries) : 0;

  // Magia de multiclasse: o total de espaços usa o nível de conjurador somado
  // (completo + ½ meio + ⅓ terço); o bruxo fica de fora e usa o próprio pacto.
  const casterLevel = multiclassCasterLevel(classEntries);
  const spellSlots = spellSlotsForCasterLevel(casterLevel);
  const pactSlots = pactMagicSlots(classEntries);
  const inventory = syncInventory(
    parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []),
    catalog ?? new Map(),
  );
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

  /**
   * Conjuração de uma classe: a subclasse pode trocar a configuração (ex.:
   * Trapaceiro Arcano é um terço-conjurador). A CD/ataque usa o nível TOTAL do
   * personagem (bônus de proficiência) e as preparadas usam o nível DELA.
   */
  function spellcastingOf(entry: ClassEntry): ClassEntryDto['spellcasting'] {
    const definition = getClassDefinition(entry.classKey);
    if (!definition) return null;

    const subclassDefinition = findSubclass(definition, entry.subclass);
    const config = subclassDefinition?.spellcasting ?? definition.spellcasting;
    const ability = config.ability;
    const score = ability ? effectiveAbilities[ability] : null;

    return {
      type: config.type,
      ability,
      learning: config.learning,
      saveDC: ability !== null && score !== null ? spellSaveDc(level, score) : null,
      attackBonus: ability !== null && score !== null ? spellAttackBonus(level, score) : null,
      preparedCount:
        ability !== null &&
        score !== null &&
        config.learning === 'prepared' &&
        config.type === 'full'
          ? Math.max(1, abilityModifier(score) + entry.level)
          : null,
    };
  }

  const classEntryDtos: ClassEntryDto[] = classEntries.map((entry) => {
    const definition = getClassDefinition(entry.classKey);

    return {
      classKey: entry.classKey,
      className: definition?.name ?? entry.classKey,
      subclass: entry.subclass,
      level: entry.level,
      hitDie: definition?.hitDie ?? 8,
      subclassLevel: definition?.subclassLevel ?? 1,
      subclassEligible: definition !== null && entry.level >= definition.subclassLevel,
      subclassNames: definition?.subclasses.map((item) => item.name) ?? [],
      asiLevels: [...asiLevelsFor(entry.classKey)],
      spellcasting: spellcastingOf(entry),
    };
  });

  // Primeiro conjurador do personagem — mantém o `derived.spellcasting` que a
  // ficha já usa (CD/ataque) para fichas de uma classe só.
  const primaryCasting = classEntryDtos.find(
    (entry) => entry.spellcasting !== null && entry.spellcasting.ability !== null,
  )?.spellcasting;

  const derived = deriveStats({
    level,
    abilities: effectiveAbilities,
    skills,
    saves,
    initiativeBonus: character.initiativeBonus,
    className,
    inventory,
    hitDie: classEntryDtos[0]?.hitDie ?? null,
    spellcastingAbility: primaryCasting?.ability ?? undefined,
    lockedSaves,
    sneakAttack: sneakDice > 0 ? { dice: sneakDice, expression: `${sneakDice}d6` } : null,
    expertiseSlots: expertiseSlots(activeFeatures),
    unarmoredDefenseAbility: classAdjustments.unarmoredDefenseAbility,
    unarmoredDefenseBase: classAdjustments.unarmoredDefense ? classAdjustments.unarmoredDefenseBase : null,
    preparedSpellCount: primaryCasting?.preparedCount ?? null,
    spellSlots,
    pactSlots,
  });

  return {
    id: character.id,
    userId: character.userId,
    ...(ownerUsername === undefined ? {} : { ownerUsername }),
    name: character.name,
    race: character.race,
    className,
    classes: classEntryDtos,
    classOptions: classOptionsFor(abilities, classEntries),
    activeFeatures,
    classState,
    classAdjustments,
    level,
    lastLevelUpRelease: character.lastLevelUpRelease,
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
