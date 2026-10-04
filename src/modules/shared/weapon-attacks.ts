import { WEAPON_SLOTS } from './ammo.js';
import type { CombatAttack } from './attacks.js';
import {
  ABILITY_ABBREVIATIONS,
  ABILITY_KEYS,
  abilityModifier,
  formatModifier,
  proficiencyBonus,
  type AbilityKey,
} from './dnd5e.js';
import type { ItemDetails, WeaponCategory } from './item-details.js';

/**
 * ATAQUE DERIVADO DA ARMA EQUIPADA.
 *
 * Um ataque de arma não é gravado na ficha (como a CA): ele é CALCULADO a cada
 * leitura a partir da arma equipada numa das mãos. O formato é o mesmo
 * `Attack` do combate, marcado com `derived`; quando a arma não pode ser
 * empunhada (`two-handed` com a outra mão ocupada) o ataque continua listado,
 * mas com `blocked` — o combate recusa a rolagem com 400.
 *
 * Regras cobertas (PHB 2014):
 * - **Habilidade**: corpo a corpo usa FOR; à distância usa DES; acuidade
 *   (`finesse`) usa a MELHOR entre FOR e DES; arremesso usa FOR (ou a melhor,
 *   com acuidade), mesmo sendo um ataque à distância.
 * - **Proficiência**: soma o bônus quando a lista de proficiências de arma da
 *   ficha traz a CATEGORIA ("Armas simples"/"Armas marciais") ou o NOME da arma
 *   ("Espadas longas"), tolerante a plural/acento.
 * - **Versátil**: com a outra mão livre, empunha com as duas mãos e usa
 *   `versatileDie`.
 * - **Duas mãos**: exige a outra mão livre; ocupada, o ataque fica bloqueado.
 * - **Segunda arma leve** (combate com duas armas): duas armas LEVES corpo a
 *   corpo, uma em cada mão, geram um ataque extra da mão secundária que NÃO
 *   soma o modificador de dano (salvo se ele for negativo).
 * - **Arremesso**: arma com a propriedade `thrown` ganha uma variante à
 *   distância (mesma habilidade do corpo a corpo, mas `ranged`).
 * - **Golpe desarmado**: sempre disponível (1 + FOR de dano de concussão,
 *   proficiente).
 *
 * Fica em `shared` porque o combate (servidor) e a ficha (DTO) derivam os
 * MESMOS ataques — nada de duas contas.
 */

/** Mínimo que uma arma do inventário precisa ter para entrar na conta. */
export interface WeaponInventoryItem {
  id: string;
  name: string;
  slot: string | null;
  category: string;
  details: ItemDetails;
}

/** Entrada do cálculo — tudo já resolvido por quem chama (DTO ou combate). */
export interface WeaponAttackInput {
  /** Atributos EFETIVOS (com os bônus de features). */
  abilities: Record<AbilityKey, number>;
  /** Nível total do personagem (define o bônus de proficiência). */
  level: number;
  /** Lista de proficiências de ARMA (texto), ex.: ['Armas simples', 'Adagas']. */
  weaponProficiencies: readonly string[];
  inventory: readonly WeaponInventoryItem[];
}

/** Nome da categoria de proficiência que cobre cada categoria de arma. */
const CATEGORY_PROFICIENCY: Record<WeaponCategory, string> = {
  simple: 'Armas simples',
  martial: 'Armas marciais',
};

type WeaponAttackKind = 'melee' | 'ranged' | 'thrown';

const KIND_LABEL: Record<WeaponAttackKind, string> = {
  melee: 'Corpo a corpo',
  ranged: 'À distância',
  thrown: 'Arremesso',
};

function isWeaponCategory(category: string): boolean {
  return category === 'Arma' || category === 'Cajado';
}

/**
 * Nome comparável de arma/proficiência: sem acento, minúsculo, plural no
 * singular e "ões" → "ão" ("Espadas longas" → "espada longa", "Bordões" →
 * "bordao"). Assim "Adagas" (proficiência) casa com "Adaga" (item).
 */
export function foldWeaponName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/oes\b/g, 'ao')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');
}

/**
 * O personagem é proficiente com a arma? A checagem é, nesta ordem:
 *
 *  1. CATEGORIA ("Armas simples"/"Armas marciais");
 *  2. ID CANÔNICO da arma (`canonicalWeaponId` de `shared/weapons`), quando a
 *     entrada de `proficiencies.weapons` for um id (ex.: proficiência de raça);
 *  3. FALLBACK pelo NOME específico ("Rapieiras" ↔ "Rapieira").
 *
 * Entradas de texto livre continuam funcionando pelo passo 3; itens sem vínculo
 * canônico simplesmente pulam o passo 2.
 */
export function isProficientWithWeapon(
  weaponProficiencies: readonly string[],
  weaponCategory: WeaponCategory,
  weaponName: string,
  canonicalWeaponId?: string | null,
): boolean {
  const known = new Set(weaponProficiencies.map(foldWeaponName));
  if (known.has(foldWeaponName(CATEGORY_PROFICIENCY[weaponCategory]))) return true;
  if (canonicalWeaponId && known.has(foldWeaponName(canonicalWeaponId))) return true;
  return known.has(foldWeaponName(weaponName));
}

function modifiersOf(abilities: Record<AbilityKey, number>): Record<AbilityKey, number> {
  const modifiers = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) modifiers[key] = abilityModifier(abilities[key]);
  return modifiers;
}

function equippedWeaponIn(
  inventory: readonly WeaponInventoryItem[],
  slot: string,
): WeaponInventoryItem | null {
  return (
    inventory.find((item) => item.slot === slot && isWeaponCategory(item.category)) ?? null
  );
}

/** Algum item está equipado neste slot de mão (arma, escudo, foco...)? */
function isHandOccupied(inventory: readonly WeaponInventoryItem[], slot: string): boolean {
  return inventory.some((item) => item.slot === slot);
}

function isLightMelee(weapon: WeaponInventoryItem): boolean {
  const details = weapon.details;
  return details.weaponType !== 'ranged' && (details.properties ?? []).includes('light');
}

/** Clampa ao mesmo contrato do `attackSchema` (-30..30). */
function clampAttackBonus(value: number): number {
  return Math.max(-30, Math.min(30, value));
}

/**
 * Habilidade e modificador do ataque. Armas à distância usam DES; arremesso e
 * corpo a corpo usam FOR, e a acuidade troca pela MELHOR de FOR/DES.
 */
function abilityFor(
  kind: WeaponAttackKind,
  finesse: boolean,
  modifiers: Record<AbilityKey, number>,
): { ability: AbilityKey; modifier: number } {
  if (kind === 'ranged') return { ability: 'dexterity', modifier: modifiers.dexterity };
  if (finesse && modifiers.dexterity > modifiers.strength) {
    return { ability: 'dexterity', modifier: modifiers.dexterity };
  }
  return { ability: 'strength', modifier: modifiers.strength };
}

function attackNote(options: {
  kind: WeaponAttackKind;
  ability: AbilityKey;
  modifier: number;
  proficiency: number;
  twoHands: boolean;
  die: number;
}): string {
  const parts = [
    KIND_LABEL[options.kind],
    `${ABILITY_ABBREVIATIONS[options.ability]} ${formatModifier(options.modifier)}`,
  ];
  parts.push(
    options.proficiency > 0
      ? `proficiente ${formatModifier(options.proficiency)}`
      : 'sem proficiência',
  );
  if (options.twoHands) parts.push(`duas mãos 1d${options.die}`);
  return parts.join(' · ');
}

function makeWeaponAttack(options: {
  id: string;
  name: string;
  weapon: WeaponInventoryItem;
  kind: WeaponAttackKind;
  attackBonus: number;
  damageBonus: number;
  die: number;
  dieCount: number;
  notes: string;
  /** Proficiência com a arma (a ficha marca no ataque derivado). */
  proficient?: boolean;
  blocked?: string;
}): CombatAttack {
  const properties = options.weapon.details.properties ?? [];
  return {
    id: options.id,
    name: options.name,
    damage: {
      count: options.dieCount,
      sides: options.die,
      bonus: options.damageBonus,
      type: options.weapon.details.damageType ?? null,
    },
    // Tipos de dano ADICIONAIS que o mestre cadastrou na arma (ex.: o fogo de
    // uma espada flamejante). Vêm junto para a ficha mostrar e para o combate
    // ter o que aplicar quando cada tipo passar a ser resolvido por si.
    extraDamages: options.weapon.details.extraDamages ?? [],
    attackBonus: options.attackBonus,
    notes: options.notes,
    finesse: properties.includes('finesse'),
    // Arremesso e distância contam como ataque à distância (sem Fúria e
    // habilitando o Ataque Furtivo).
    ranged: options.kind !== 'melee',
    inventoryItemId: options.weapon.id,
    legacy: false,
    derived: true,
    ...(options.proficient === undefined ? {} : { proficient: options.proficient }),
    ...(options.blocked === undefined ? {} : { blocked: options.blocked }),
  };
}

/** Golpe desarmado: sempre disponível, 1 + FOR de dano de concussão. */
function unarmedAttack(strengthMod: number, proficiency: number): CombatAttack {
  return {
    id: 'unarmed',
    name: 'Golpe desarmado',
    damage: { count: 0, sides: 0, bonus: 1 + strengthMod, type: 'Concussão' },
    extraDamages: [],
    attackBonus: clampAttackBonus(strengthMod + proficiency),
    notes: `Corpo a corpo · FOR ${formatModifier(strengthMod)} · proficiente ${formatModifier(proficiency)}`,
    finesse: false,
    ranged: false,
    proficient: true,
    legacy: false,
    derived: true,
  };
}

/**
 * Deriva os ataques das armas equipadas (mais o golpe desarmado) de uma ficha.
 * A ordem é: armas da mão principal, variantes de arremesso, ataque da mão
 * secundária (duas armas leves) e, por fim, o golpe desarmado.
 */
export function deriveWeaponAttacks(input: WeaponAttackInput): CombatAttack[] {
  const modifiers = modifiersOf(input.abilities);
  const proficiency = proficiencyBonus(input.level);
  const attacks: CombatAttack[] = [];

  for (const slot of WEAPON_SLOTS) {
    const weapon = equippedWeaponIn(input.inventory, slot);
    if (!weapon) continue;

    const otherSlot = slot === 'hand1' ? 'hand2' : 'hand1';
    const otherHandBusy = isHandOccupied(input.inventory, otherSlot);
    const details = weapon.details;
    const properties = details.properties ?? [];
    const finesse = properties.includes('finesse');
    const versatile = properties.includes('versatile');
    const twoHanded = properties.includes('two-handed');
    const thrown = properties.includes('thrown');
    const category = details.weaponCategory ?? 'simple';
    const proficient = isProficientWithWeapon(
      input.weaponProficiencies,
      category,
      weapon.name,
      details.canonicalWeaponId,
    );
    const profBonus = proficient ? proficiency : 0;
    const magicDamage = details.damageBonus ?? 0;
    const magicAttack = details.attackBonus ?? 0;
    const baseDie = details.damageDie ?? 0;
    const baseCount = baseDie > 0 ? (details.damageCount ?? 1) : 0;

    // Duas mãos exige a outra mão livre; ocupada, o ataque fica bloqueado.
    const blocked = twoHanded && otherHandBusy
      ? `A arma ${weapon.name} é de duas mãos: libere a outra mão para usá-la.`
      : undefined;

    // Versátil com a outra mão livre: empunha com as duas mãos e troca o dado.
    const twoHands = versatile && !otherHandBusy && (details.versatileDie ?? 0) > 0;
    const die = twoHands ? (details.versatileDie ?? 0) : baseDie;
    const dieCount = die > 0 ? (details.damageCount ?? 1) : 0;

    const kind: WeaponAttackKind = details.weaponType === 'ranged' ? 'ranged' : 'melee';
    const choice = abilityFor(kind, finesse, modifiers);

    attacks.push(
      makeWeaponAttack({
        id: `weapon:${weapon.id}`,
        name: weapon.name,
        weapon,
        kind,
        attackBonus: clampAttackBonus(choice.modifier + profBonus + magicAttack),
        damageBonus: choice.modifier + magicDamage,
        die,
        dieCount,
        notes: attackNote({
          kind,
          ability: choice.ability,
          modifier: choice.modifier,
          proficiency: profBonus,
          twoHands,
          die,
        }),
        proficient,
        ...(blocked === undefined ? {} : { blocked }),
      }),
    );

    // Arremesso: variante à distância da arma arremessável.
    if (thrown && !blocked) {
      const throwChoice = abilityFor('thrown', finesse, modifiers);
      attacks.push(
        makeWeaponAttack({
          id: `thrown:${weapon.id}`,
          name: `${weapon.name} (arremesso)`,
          weapon,
          kind: 'thrown',
          attackBonus: clampAttackBonus(throwChoice.modifier + profBonus + magicAttack),
          damageBonus: throwChoice.modifier + magicDamage,
          die: baseDie,
          dieCount: baseCount,
          notes: attackNote({
            kind: 'thrown',
            ability: throwChoice.ability,
            modifier: throwChoice.modifier,
            proficiency: profBonus,
            twoHands: false,
            die: baseDie,
          }),
          proficient,
        }),
      );
    }
  }

  // Duas armas LEVES corpo a corpo, uma em cada mão: ataque da mão secundária
  // sem o modificador de dano (ele só entra se for negativo).
  const mainHand = equippedWeaponIn(input.inventory, 'hand1');
  const offHand = equippedWeaponIn(input.inventory, 'hand2');
  if (mainHand && offHand && isLightMelee(mainHand) && isLightMelee(offHand)) {
    const details = offHand.details;
    const properties = details.properties ?? [];
    const choice = abilityFor('melee', properties.includes('finesse'), modifiers);
    const proficient = isProficientWithWeapon(
      input.weaponProficiencies,
      details.weaponCategory ?? 'simple',
      offHand.name,
      details.canonicalWeaponId,
    );
    const profBonus = proficient ? proficiency : 0;
    const die = details.damageDie ?? 0;
    const dieCount = die > 0 ? (details.damageCount ?? 1) : 0;

    attacks.push(
      makeWeaponAttack({
        id: `offhand:${offHand.id}`,
        name: `${offHand.name} (mão secundária)`,
        weapon: offHand,
        kind: 'melee',
        attackBonus: clampAttackBonus(choice.modifier + profBonus + (details.attackBonus ?? 0)),
        // Mão secundária: o modificador de dano NÃO entra, salvo se negativo.
        damageBonus: Math.min(choice.modifier, 0) + (details.damageBonus ?? 0),
        die,
        dieCount,
        notes: 'Mão secundária · sem o modificador de dano (duas armas leves)',
        proficient,
      }),
    );
  }

  attacks.push(unarmedAttack(modifiers.strength, proficiency));

  return attacks;
}
