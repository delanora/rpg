import { mechanicalStateOf, deriveConditionEffects, effectiveMaxHp, effectiveSpeed } from '../shared/conditions.js';
import type { Creature, CreatureKind } from '@prisma/client';
import { z } from 'zod';
import { toLocalitySummary, type LocalitySummaryDto } from '../localities/localities.dto.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { ABILITY_KEYS, type AbilityKey, abilityModifier } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import { normalizeCoins, type CoinPurse } from '../shared/coins.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { creatureInventory, npcAttacks, npcEffectiveArmorClass } from './npc-sheet.js';

/** Formato da criatura enviado ao frontend. */
export interface CreatureDto {
  id: string;
  name: string;
  /** CREATURE (monstro de combate) ou NPC (personagem narrativo). */
  kind: CreatureKind;
  type: string;
  challengeRating: string;

  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  hpCurrent: number;
  hpMax: number;
  mechanicalState: ReturnType<typeof mechanicalStateOf>;
  conditionEffects: ReturnType<typeof deriveConditionEffects>;
  effectiveMaxHp: number;
  effectiveSpeed: number;
  armorClass: number;
  speed: number;

  attacks: Attack[];
  /**
   * Ataques do NPC em combate: os PRÓPRIOS + os derivados das armas equipadas.
   * Em criaturas-template fica vazio (o cliente usa só `attacks`).
   */
  derivedAttacks: CombatAttack[];
  /**
   * Inventário PERSISTENTE do NPC (mesmo formato da ficha). SEMPRE vazio em
   * criaturas-template: estas continuam apenas no statblock. Só o Mestre lê
   * este módulo — a rota de criaturas é master-only.
   */
  inventory: InventoryItemDto[];
  /** Carteira do NPC (mesmo motor de moedas da ficha). */
  coins: CoinPurse;
  /**
   * CA EFETIVA do NPC (armadura/escudo/bônus equipados). `armorClass` continua
   * sendo a CA BASE editável do statblock.
   */
  effectiveArmorClass: number;
  resistances: string[];
  immunities: string[];
  /** Tipos de dano aos quais a criatura é vulnerável (dano dobrado). */
  vulnerabilities: string[];
  /** Localidades vinculadas (uma ou mais). */
  localities: LocalitySummaryDto[];

  /** URL pública do ícone/retrato ('' = sem imagem). */
  imageUrl: string;

  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  /** Modificadores calculados a partir dos atributos. */
  derived: { modifiers: Record<AbilityKey, number> };
}

/** Criatura carregada com as localidades vinculadas. */
export type CreatureWithLocalities = Creature & {
  localities?: { id: string; name: string }[];
};

const attackListSchema = z.array(attackSchema);
const damageListSchema = z.array(z.string().max(60));

export function toCreatureDto(creature: CreatureWithLocalities): CreatureDto {
  const attacks = parseJson<Attack[]>(attackListSchema, creature.attacks, []);
  // NPC persistente: inventário e ataques derivados das armas equipadas. O
  // template de criatura não recebe inventário e segue só com `attacks`.
  const inventory = creature.kind === 'NPC' ? creatureInventory(creature.inventory) : [];
  const derivedAttacks =
    creature.kind === 'NPC' ? npcAttacks(creature).slice(attacks.length) : [];
  const effectiveArmorClass =
    creature.kind === 'NPC' ? npcEffectiveArmorClass(creature) : creature.armorClass;
  const resistances = parseJson<string[]>(damageListSchema, creature.resistances, []);
  const immunities = parseJson<string[]>(damageListSchema, creature.immunities, []);
  const vulnerabilities = parseJson<string[]>(
    damageListSchema,
    creature.vulnerabilities,
    [],
  );

  const abilities: Record<AbilityKey, number> = {
    strength: creature.strength,
    dexterity: creature.dexterity,
    constitution: creature.constitution,
    intelligence: creature.intelligence,
    wisdom: creature.wisdom,
    charisma: creature.charisma,
  };

  const modifiers = {} as Record<AbilityKey, number>;
  for (const ability of ABILITY_KEYS) {
    modifiers[ability] = abilityModifier(abilities[ability]);
  }

  return {
    id: creature.id,
    name: creature.name,
    kind: creature.kind,
    type: creature.type,
    challengeRating: creature.challengeRating,
    strength: creature.strength,
    dexterity: creature.dexterity,
    constitution: creature.constitution,
    intelligence: creature.intelligence,
    wisdom: creature.wisdom,
    charisma: creature.charisma,
    hpCurrent: creature.hpCurrent,
    hpMax: creature.hpMax,
    mechanicalState: mechanicalStateOf(creature.mechanicalState),
    conditionEffects: deriveConditionEffects(creature.mechanicalState),
    effectiveMaxHp: effectiveMaxHp(creature.hpMax, creature.mechanicalState),
    effectiveSpeed: effectiveSpeed(creature.speed, creature.mechanicalState),
    armorClass: creature.armorClass,
    effectiveArmorClass,
    inventory,
    coins: normalizeCoins(creature.coins),
    derivedAttacks,
    speed: creature.speed,
    attacks,
    resistances,
    immunities,
    vulnerabilities,
    localities: (creature.localities ?? []).map(toLocalitySummary),
    imageUrl: creature.imageUrl,
    description: creature.description,
    version: creature.version,
    createdAt: creature.createdAt.toISOString(),
    updatedAt: creature.updatedAt.toISOString(),
    derived: { modifiers },
  };
}
