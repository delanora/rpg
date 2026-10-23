import type { Creature } from '@prisma/client';
import { inventoryListSchema } from '../characters/characters.schema.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { parseJson } from '../shared/json.js';
import {
  armorPiecesFrom,
  computeArmorClass,
  type ArmorClassDetail,
} from '../shared/armor-class.js';
import { deriveWeaponAttacks } from '../shared/weapon-attacks.js';
import { abilityModifier, proficiencyBonus, type AbilityKey } from '../shared/dnd5e.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { z } from 'zod';
import { isConsumableItem } from '../shared/item-details.js';

/**
 * FICHA DERIVADA DO NPC.
 *
 * O NPC usa o MESMO cadastro de `Creature` (kind NPC) e os MESMOS motores da
 * ficha do jogador: inventário (JSONB no formato de `Character.inventory`),
 * moedas (`shared/coins.ts`), CA (`shared/armor-class.ts`), ataques de arma
 * (`shared/weapon-attacks.ts`) e consumíveis (`isConsumableItem`). Nada é
 * duplicado aqui — estas funções só resolvem as entradas que o motor espera.
 *
 * Criaturas-TEMPLATE (kind CREATURE) continuam no statblock: elas NÃO recebem
 * inventário persistente automaticamente (`creatureInventory` devolve [] e a
 * CA/lista de ataques derivados não são aplicadas).
 */

const attackListSchema = z.array(attackSchema);

/** Inventário persistente do NPC (vazio em criaturas-template). */
export function creatureInventory(value: unknown): InventoryItemDto[] {
  return parseJson<InventoryItemDto[]>(inventoryListSchema, value, []);
}

/** Ataques PRÓPRIOS gravados no statblock. */
export function creatureOwnAttacks(creature: Pick<Creature, 'attacks'>): Attack[] {
  return parseJson<Attack[]>(attackListSchema, creature.attacks, []);
}

/**
 * Nível equivalente para o bônus de proficiência a partir do ND (DMG): o
 * motor de armas usa `proficiencyBonus(level)`, e o NPC não tem nível de
 * classe. ND 0–4 → +2; 5–8 → +3; 9–12 → +4; 13–16 → +5; 17+ → +6.
 * Aproximação documentada: é a mesma faixa de proficiência do PHB.
 */
export function challengeRatingLevel(challengeRating: string): number {
  const normalized = challengeRating.trim().replace(',', '.');
  const fraction = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  const value = fraction
    ? Number(fraction[1]) / Number(fraction[2])
    : Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 4) return 1;
  if (value <= 8) return 5;
  if (value <= 12) return 9;
  if (value <= 16) return 13;
  return 17;
}

function npcAbilities(creature: Creature): Record<AbilityKey, number> {
  return {
    strength: creature.strength,
    dexterity: creature.dexterity,
    constitution: creature.constitution,
    intelligence: creature.intelligence,
    wisdom: creature.wisdom,
    charisma: creature.charisma,
  };
}

/**
 * ATAQUES do NPC em combate: os PRÓPRIOS (mordida etc.) continuam sempre;
 * armas EQUIPADAS acrescentam ataques derivados pelo mesmo motor da ficha.
 * O golpe desarmado do motor só entra quando o NPC não tem nenhum ataque
 * próprio — caso contrário seria ruído em um lobo, por exemplo.
 */
export function npcAttacks(creature: Creature): CombatAttack[] {
  const own = creatureOwnAttacks(creature);
  if (creature.kind !== 'NPC') return own;

  const derived = deriveWeaponAttacks({
    abilities: npcAbilities(creature),
    level: challengeRatingLevel(creature.challengeRating),
    // O NPC é tratado como proficiente com o equipamento que carrega (o
    // cadastro não tem lista de proficiências). O bônus mágico da arma continua
    // vindo do motor, sem segunda conta.
    weaponProficiencies: ['Armas simples', 'Armas marciais'],
    inventory: creatureInventory(creature.inventory),
  }).filter((attack) => attack.id !== 'unarmed' || own.length === 0);

  return [...own, ...derived];
}

/**
 * CA do NPC: armadura/escudo/bônus mágicos equipados usam o MESMO motor da
 * ficha. Sem armadura, a CA base do statblock é a candidata (o motor pega o
 * maior entre ela e 10 + DES). O override do Mestre não se aplica aqui.
 */
export function npcArmorClass(
  creature: Creature,
  inventory: readonly InventoryItemDto[] = creatureInventory(creature.inventory),
): ArmorClassDetail {
  return computeArmorClass({
    dexterityModifier: abilityModifier(creature.dexterity),
    pieces: armorPiecesFrom(inventory),
    unarmored: [{ label: 'CA base do statblock', value: creature.armorClass }],
  });
}

/** CA efetiva do NPC (a do statblock continua sendo a base editável). */
export function npcEffectiveArmorClass(creature: Creature): number {
  return npcArmorClass(creature).value;
}

/**
 * Itens USÁVEIS do inventário (consumíveis/poções), incluindo os que ainda não
 * têm efeito automatizado. Armas equipadas NÃO entram: elas são ataques, não
 * consumíveis.
 */
export function usableInventoryItems(inventory: readonly InventoryItemDto[]): InventoryItemDto[] {
  return inventory.filter(
    (item) => item.quantity > 0 && isConsumableItem(item.category, item.details),
  );
}

/**
 * Quantas unidades o motor de proficiência conhece é irrelevante para o NPC;
 * a função existe para deixar explícito que a conta usa `proficiencyBonus`.
 */
export function npcProficiencyBonus(creature: Creature): number {
  return proficiencyBonus(challengeRatingLevel(creature.challengeRating));
}
