import { creatureAbilitiesOf, type CreatureAbility } from '../shared/creature-abilities.js';
import { mechanicalStateOf, deriveConditionEffects, effectiveMaxHp, effectiveSpeed } from '../shared/conditions.js';
import type { Creature, CreatureKind } from '@prisma/client';
import { z } from 'zod';
import { toLocalitySummary, type LocalitySummaryDto } from '../localities/localities.dto.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { ABILITY_KEYS, type AbilityKey, abilityModifier } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import { normalizeCoins, type CoinPurse } from '../shared/coins.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import {
  effectArmorClassBonuses,
  type EffectModifierSet,
} from '../effects/effect-modifiers.js';
import { creatureInventory, npcAttacks, npcEffectiveArmorClass } from './npc-sheet.js';
import { spatialSizeOfLabel } from '../combat/spatial/spatial-size.js';
import type { CreatureSizeLabel, SpatialSize } from '../combat/spatial/spatial.types.js';
import {
  creatureSpellcastingMaxOf,
  creatureSpellcastingProfileOf,
  creatureSpellRepertoireOf,
  type CreatureSpellcastingProfile,
  type CreatureSpellcastingResources,
  type CreatureSpellRepertoire,
} from '../shared/creature-spellcasting.js';

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
  /** Tamanho mecânico persistido (6.6L.1) — autoridade do Mestre. */
  size: CreatureSizeLabel;
  /** Forma canônica do tamanho (usada pelo espaço ocupado no combate). */
  spatialSize: SpatialSize;

  attacks: Attack[];
  /**
   * PERFIL DE CONJURAÇÃO explícito do statblock (6.6B). Vazio = criatura sem
   * conjuração utilizável. Rota master-only: não é repertório de magias.
   */
  spellcastingProfile: CreatureSpellcastingProfile;
  /**
   * ESPAÇOS DE MAGIA declarados pelo statblock (6.6C). Só o MÁXIMO: o uso é
   * estado de quem conjura (template ou instância) e não vai para o DTO.
   */
  spellcastingResources: CreatureSpellcastingResources;
  /**
   * REPERTÓRIO EXPLÍCITO do statblock (6.6F): as magias que este NPC pode
   * conjurar. Rota master-only — o jogador NUNCA recebe o repertório nem os
   * espaços de um NPC.
   */
  spellRepertoire: CreatureSpellRepertoire;
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
  tokenImages: string[];
  abilities: CreatureAbility[];
  legendaryActionsMax: number;

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

/**
 * DTO da criatura. `effectModifiers` (6.5B) é o resumo dos EFEITOS ativos da
 * PRÓPRIA criatura (template, nunca de uma instância de combate): CA e
 * deslocamento exibidos são derivados, nada é gravado.
 */
export function toCreatureDto(
  creature: CreatureWithLocalities,
  effectModifiers?: EffectModifierSet,
): CreatureDto {
  const attacks = parseJson<Attack[]>(attackListSchema, creature.attacks, []);
  // NPC persistente: inventário e ataques derivados das armas equipadas. O
  // template de criatura não recebe inventário e segue só com `attacks`.
  const inventory = creature.kind === 'NPC' ? creatureInventory(creature.inventory) : [];
  const derivedAttacks =
    creature.kind === 'NPC' ? npcAttacks(creature).slice(attacks.length) : [];
  const effectArmorBonuses = effectModifiers ? effectArmorClassBonuses(effectModifiers) : [];
  const effectArmorBonus = effectArmorBonuses.reduce((sum, piece) => sum + piece.value, 0);
  const effectiveArmorClass =
    (creature.kind === 'NPC' ? npcEffectiveArmorClass(creature, effectArmorBonuses) : creature.armorClass) +
    (creature.kind === 'NPC' ? 0 : effectArmorBonus);
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
    effectiveSpeed: effectiveSpeed(
      creature.speed,
      creature.mechanicalState,
      effectModifiers?.speedBonus ?? 0,
    ),
    armorClass: creature.armorClass,
    effectiveArmorClass,
    inventory,
    coins: normalizeCoins(creature.coins),
    derivedAttacks,
    speed: creature.speed,
    size: (creature.size ?? 'Medium') as CreatureSizeLabel,
    spatialSize: spatialSizeOfLabel(creature.size),
    attacks,
    spellcastingProfile: creatureSpellcastingProfileOf(creature.spellcastingProfile),
    spellcastingResources: creatureSpellcastingMaxOf(creature.spellcastingResources),
    spellRepertoire: creatureSpellRepertoireOf(creature.spellRepertoire),
    resistances,
    immunities,
    vulnerabilities,
    localities: (creature.localities ?? []).map(toLocalitySummary),
    imageUrl: creature.imageUrl,
    tokenImages: creature.tokenImages,
    abilities: creatureAbilitiesOf(creature.abilities),
    legendaryActionsMax: creature.legendaryActionsMax,
    description: creature.description,
    version: creature.version,
    createdAt: creature.createdAt.toISOString(),
    updatedAt: creature.updatedAt.toISOString(),
    derived: { modifiers },
  };
}
