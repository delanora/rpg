import type { Creature, CreatureKind } from '@prisma/client';
import { z } from 'zod';
import { toLocalitySummary, type LocalitySummaryDto } from '../localities/localities.dto.js';
import { attackSchema, type Attack } from '../shared/attacks.js';
import { ABILITY_KEYS, type AbilityKey, abilityModifier } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';

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
  armorClass: number;
  speed: number;

  attacks: Attack[];
  resistances: string[];
  immunities: string[];
  /** Localidades vinculadas (uma ou mais). */
  localities: LocalitySummaryDto[];

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
  const resistances = parseJson<string[]>(damageListSchema, creature.resistances, []);
  const immunities = parseJson<string[]>(damageListSchema, creature.immunities, []);

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
    armorClass: creature.armorClass,
    speed: creature.speed,
    attacks,
    resistances,
    immunities,
    localities: (creature.localities ?? []).map(toLocalitySummary),
    description: creature.description,
    version: creature.version,
    createdAt: creature.createdAt.toISOString(),
    updatedAt: creature.updatedAt.toISOString(),
    derived: { modifiers },
  };
}
