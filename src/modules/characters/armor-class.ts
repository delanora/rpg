import type { Character } from '@prisma/client';
import {
  armorPiecesFrom,
  computeArmorClass,
  type ArmorClassDetail,
  type UnarmoredCandidate,
} from '../shared/armor-class.js';
import {
  computeMulticlassAdjustments,
  normalizeClassEntries,
  normalizeClassState,
  type ClassAdjustments,
} from '../shared/classes.js';
import { abilityModifier, type AbilityKey } from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import { inventoryListSchema } from './characters.schema.js';

/**
 * Classe de Armadura da ficha.
 *
 * A CA é **calculada** — nunca um valor fixo: vem dos atributos atuais, da
 * armadura/escudo equipados e das defesas sem armadura das classes. A única
 * coisa gravada é o override manual do mestre (`Character.armorClass`; `0` =
 * automático). O combate lê a mesma conta, para a mesa nunca ver duas CAs.
 */

/** Modificadores dos 6 atributos (para quem precisa deles fora do DTO). */
function modifiersOf(abilities: Record<AbilityKey, number>): Record<AbilityKey, number> {
  const modifiers = {} as Record<AbilityKey, number>;
  for (const ability of Object.keys(abilities) as AbilityKey[]) {
    modifiers[ability] = abilityModifier(abilities[ability]);
  }
  return modifiers;
}

/** Atributos gravados na ficha, sem os bônus de features. */
function rawAbilities(character: Character): Record<AbilityKey, number> {
  return {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
}

/**
 * Atributos efetivos: os gravados mais os bônus de features (ex.: Campeão
 * Primitivo dá +4 em Força e Constituição, respeitando o teto da feature).
 * Todo cálculo derivado (CA, iniciativa, CD de magia) usa estes valores.
 */
export function effectiveAbilitiesOf(
  character: Character,
  adjustments: ClassAdjustments,
): Record<AbilityKey, number> {
  const abilities = rawAbilities(character);

  for (const [ability, bonus] of Object.entries(adjustments.abilityBonuses)) {
    const key = ability as AbilityKey;
    const cap = adjustments.abilityCaps[key] ?? Number.POSITIVE_INFINITY;
    abilities[key] = Math.min(abilities[key] + bonus, cap);
  }

  return abilities;
}

/**
 * Fórmulas de Defesa sem Armadura que valem agora.
 *
 * A do monge exige também **nenhum escudo** — por isso o filtro olha o
 * equipamento. As demais (Bárbaro e Linhagem Dracônica) convivem com escudo.
 */
export function applicableUnarmoredDefenses(
  adjustments: ClassAdjustments,
  hasShield: boolean,
): { label: string; base: number; ability: AbilityKey | null }[] {
  return adjustments.unarmoredDefenseOptions
    .filter((option) => !option.requiresNoShield || !hasShield)
    .map(({ label, base, ability }) => ({ label, base, ability }));
}

/** Peças de CA lidas do inventário (armadura no peitoral, escudo e bônus mágicos). */
export function armorPiecesOf(inventory: unknown) {
  return armorPiecesFrom(parseJson(inventoryListSchema, inventory, []));
}

/**
 * CA completa de uma ficha lida direto do banco.
 *
 * Usada pelo combate (o combatente não guarda cópia da CA dos personagens) e
 * por qualquer caminho que não passe pelo DTO da ficha.
 */
export function characterArmorClass(character: Character): ArmorClassDetail {
  const entries = normalizeClassEntries(character.classes);
  const adjustments = computeMulticlassAdjustments(entries, normalizeClassState(character.classState));
  const abilities = effectiveAbilitiesOf(character, adjustments);
  const pieces = armorPiecesOf(character.inventory);
  const modifiers = modifiersOf(abilities);

  const unarmored: UnarmoredCandidate[] = applicableUnarmoredDefenses(
    adjustments,
    pieces.shieldBonus > 0,
  ).map((option) => ({
    label: option.label,
    // O valor final da fórmula: base + Destreza + o atributo da classe.
    value: option.base + modifiers.dexterity + (option.ability ? modifiers[option.ability] : 0),
  }));

  return computeArmorClass({
    dexterityModifier: modifiers.dexterity,
    pieces,
    unarmored,
    override: character.armorClass,
  });
}
