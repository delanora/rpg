/**
 * Regras de APRESENTAÇÃO do catálogo de itens do mestre.
 *
 * Tudo aqui é função pura sobre os itens já carregados no cliente: a busca, os
 * filtros rápidos, a ordenação alfabética e o resumo curto dos cards. Nenhuma
 * rota nova é necessária — a aba só reorganiza o que já veio do servidor.
 */

import {
  ITEM_RARITY_LABELS,
  POTION_CATEGORY_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_PROPERTY_LABELS,
  WEAPON_TYPE_LABELS,
  categoryLabel,
  damageExpression,
  damageIsEmpty,
  describeItemDetails,
  formatModifier,
  healingDiceLabel,
  normalizeRarity,
  rarityLabel,
} from '../../dnd';
import { DAMAGE_TYPES, ITEM_RARITIES } from '../../types';
import type { Character, Item, ItemRarity } from '../../types';
import { matchesSearch } from './search';

/** Preço resumido (PO/PP/PC) — visível apenas no painel do mestre. */
export function priceLabel(item: Item): string {
  if (!item.price) return '';
  const parts: string[] = [];
  if (item.price.gold) parts.push(`${item.price.gold} PO`);
  if (item.price.silver) parts.push(`${item.price.silver} PP`);
  if (item.price.copper) parts.push(`${item.price.copper} PC`);
  return parts.length > 0 ? parts.join(' · ') : 'sem valor';
}

/**
 * Tipos de dano que o item REALMENTE tem: o principal da arma mais os danos
 * adicionais com valor. Item sem dano devolve lista vazia — nada de poluir a
 * interface com um tipo que não existe.
 */
export function itemDamageTypes(item: Item): string[] {
  const details = item.details;
  if (!details) return [];

  const types: string[] = [];
  if (details.damageType) types.push(details.damageType);
  for (const extra of details.extraDamages ?? []) {
    if (extra.type && !damageIsEmpty(extra)) types.push(extra.type);
  }
  return [...new Set(types)];
}

/**
 * Linha-resumo do card: os atributos da categoria (dano/efeito/CA...) quando
 * existirem; senão, a primeira linha da descrição, encurtada.
 */
export function itemSummary(item: Item): string {
  const described = describeItemDetails(item.category, item.details);
  if (described) return described;

  const description = item.description.trim();
  if (!description) return '';
  const firstLine = description.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 90 ? `${firstLine.slice(0, 89).trimEnd()}…` : firstLine;
}

/** Valor do filtro de raridade para os itens sem raridade classificada. */
export const NO_RARITY = '__none__';

export interface ItemFilters {
  /** Busca textual (nome, categoria, raridade, tipo de dano...). */
  query: string;
  /** Categoria exata do item; `''` = todas. */
  category: string;
  /** Raridade (`common`...), `NO_RARITY` ou `''` = todas. */
  rarity: string;
  /** Tipo de dano exato; `''` = todos. */
  damageType: string;
}

export const EMPTY_ITEM_FILTERS: ItemFilters = {
  query: '',
  category: '',
  rarity: '',
  damageType: '',
};

/** Ordenação padrão do catálogo: alfabética por nome, ignorando acentos. */
export function sortItemsByName(items: Item[]): Item[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

function matchesFilters(item: Item, filters: ItemFilters): boolean {
  if (filters.category && item.category !== filters.category) return false;

  if (filters.rarity) {
    const key = normalizeRarity(item.rarity);
    if (filters.rarity === NO_RARITY) {
      if (key) return false;
    } else if (key !== filters.rarity) {
      return false;
    }
  }

  if (filters.damageType && !itemDamageTypes(item).includes(filters.damageType)) return false;

  return matchesSearch(
    filters.query,
    item.name,
    categoryLabel(item.category),
    rarityLabel(item.rarity),
    ...itemDamageTypes(item),
    describeItemDetails(item.category, item.details),
    priceLabel(item),
  );
}

/** Aplica busca + filtros rápidos e devolve a lista já ordenada. */
export function filterItems(items: Item[], filters: ItemFilters): Item[] {
  return sortItemsByName(items.filter((item) => matchesFilters(item, filters)));
}

/** Uma opção de filtro rápido: valor estável + rótulo exibido. */
export interface FilterOption {
  value: string;
  label: string;
}

/** Categorias presentes no catálogo, em ordem alfabética de rótulo. */
export function categoryFilterOptions(items: Item[]): FilterOption[] {
  const present = new Map<string, string>();
  for (const item of items) present.set(item.category, categoryLabel(item.category));
  return [...present.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
}

/** Raridades presentes no catálogo (ordem do PHB) + "Sem raridade". */
export function rarityFilterOptions(items: Item[]): FilterOption[] {
  const present = new Set<ItemRarity>();
  let hasNone = false;
  for (const item of items) {
    const key = normalizeRarity(item.rarity);
    if (key) present.add(key);
    else hasNone = true;
  }

  const options: FilterOption[] = ITEM_RARITIES.filter((rarity) => present.has(rarity)).map(
    (rarity) => ({
      value: rarity as string,
      label: ITEM_RARITY_LABELS[rarity],
    }),
  );
  if (hasNone) options.push({ value: NO_RARITY, label: 'Sem raridade' });
  return options;
}

/** Tipos de dano presentes no catálogo, na ordem canônica do livro básico. */
export function damageTypeFilterOptions(items: Item[]): FilterOption[] {
  const present = new Set<string>();
  for (const item of items) {
    for (const type of itemDamageTypes(item)) present.add(type);
  }
  return DAMAGE_TYPES.filter((type) => present.has(type)).map((type) => ({
    value: type,
    label: type,
  }));
}

/**
 * Personagens que têm o item no inventário. É dado que já está carregado no
 * painel (nenhuma rota nova): usado só para avisar do impacto antes de excluir.
 */
export function itemUsage(item: Item, characters: Character[]): Character[] {
  return characters.filter((character) =>
    character.inventory.some((entry) => entry.itemId === item.id),
  );
}

/**
 * Linhas curtas do resumo mecânico do item — o texto do hero do editor.
 *
 * Deriva TUDO do mesmo `item.details` (nenhuma fonte nova de verdade) e adapta
 * a leitura à categoria: dano e perfil da arma, CA da armadura, efeito da
 * poção, valor do recurso de acampamento... Cada linha é uma ideia, para não
 * virar um parágrafo minúsculo. Vazio quando o item ainda não tem atributos.
 */
export function itemHeroLines(item: Item): string[] {
  const details = item.details;
  const lines: string[] = [];
  const push = (value: string | undefined | null): void => {
    const text = value?.trim();
    if (text) lines.push(text);
  };

  if (item.category === 'Arma' || item.category === 'Cajado') {
    // Dano principal + danos adicionais na MESMA linha ("1d4 Perfurante + 1d6 Fogo").
    const damage: string[] = [];
    if (details.damageCount && details.damageDie) {
      const expression = damageExpression({
        count: details.damageCount,
        sides: details.damageDie,
        bonus: details.damageBonus ?? 0,
        type: details.damageType ?? null,
      });
      damage.push(`${expression}${details.damageType ? ` ${details.damageType}` : ''}`);
    } else if (details.damageBonus) {
      damage.push(`dano ${formatModifier(details.damageBonus)}`);
    } else if (details.damageType) {
      damage.push(details.damageType);
    }
    for (const extra of details.extraDamages ?? []) {
      if (damageIsEmpty(extra)) continue;
      damage.push(`+ ${damageExpression(extra)}${extra.type ? ` ${extra.type}` : ''}`);
    }
    push(damage.join(' '));

    // Perfil: categoria, uso e munição/foco numa linha.
    const profile: string[] = [];
    if (details.weaponCategory) profile.push(WEAPON_CATEGORY_LABELS[details.weaponCategory]);
    if (details.weaponType) profile.push(WEAPON_TYPE_LABELS[details.weaponType]);
    if (details.properties?.includes('ammunition') && details.ammoType) {
      profile.push(`munição ${details.ammoType}`);
    }
    if (item.category === 'Cajado' && details.spellcastingFocus) profile.push('foco de conjuração');
    push(profile.join(' · '));

    // Propriedades + alcance na última linha.
    const traits: string[] = (details.properties ?? []).map(
      (property) => WEAPON_PROPERTY_LABELS[property],
    );
    if (details.properties?.includes('versatile') && details.versatileDie) {
      traits.push(`versátil d${details.versatileDie}`);
    }
    if (details.rangeNormal !== undefined && details.rangeLong !== undefined) {
      traits.push(`${details.rangeNormal} / ${details.rangeLong} m`);
    }
    push(traits.join(' · '));
  } else if (item.category === 'Armadura') {
    if (details.baseArmorClass) {
      push(`CA ${details.baseArmorClass}${details.armorType ? ` (${details.armorType})` : ''}`);
    }
    if (details.armorClassBonus) push(`Bônus de CA ${formatModifier(details.armorClassBonus)}`);
  } else if (item.category === 'Escudo') {
    if (details.armorClassBonus) push(`CA ${formatModifier(details.armorClassBonus)}`);
  } else if (item.category === 'Munição') {
    push(details.ammoType);
    const bonus: string[] = [];
    if (details.attackBonus) bonus.push(`acerto ${formatModifier(details.attackBonus)}`);
    if (details.damageBonus) bonus.push(`dano ${formatModifier(details.damageBonus)}`);
    push(bonus.join(' · '));
  } else if (item.category === 'Poção') {
    if (details.potionCategory) push(POTION_CATEGORY_LABELS[details.potionCategory]);
    if (details.healingDice) push(`cura ${healingDiceLabel(details.healingDice)}`);
    else if (details.effectRoll) push(`efeito ${details.effectRoll}`);
    push(details.duration);
  } else if (item.category === 'Anel') {
    if (details.effectRoll) push(`efeito ${details.effectRoll}`);
  } else if (item.category === 'CAMP_SUPPLY') {
    push('Recurso de acampamento');
    push(`${item.campSupply?.value ?? 0} por unidade`);
  } else if (item.category === 'Item Geral' || item.category === 'Outro') {
    if (details.effectRoll) push(`efeito ${details.effectRoll}`);
    if (details.consumable) push('consumível (usável)');
  }

  if (lines.length === 0) {
    // Sem atributos: mostra a primeira linha da descrição, se houver.
    const fallback = itemSummary(item);
    if (fallback) lines.push(fallback);
  }
  return lines;
}
