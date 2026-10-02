import { DAMAGE_TYPES } from './types';
import type {
  AbilityKey,
  Damage,
  FeatureSource,
  ItemDetails,
  SpellLearning,
  SpellcastingType,
  WeaponCategory,
  WeaponProperty,
  WeaponType,
} from './types';

// Reexportado para quem já importava os tipos de dano daqui.
export { DAMAGE_TYPES };

/**
 * Constantes de D&D 5e usadas apenas para exibição/labels no frontend.
 * Os cálculos são sempre feitos no servidor; aqui não há regra de negócio.
 */

export const ABILITY_KEYS: readonly AbilityKey[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

export const ABILITY_ABBREVIATIONS: Record<AbilityKey, string> = {
  strength: 'FOR',
  dexterity: 'DES',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'SAB',
  charisma: 'CAR',
};

export interface SkillDefinition {
  key: string;
  label: string;
  ability: AbilityKey;
}

export const SKILLS: readonly SkillDefinition[] = [
  { key: 'acrobatics', label: 'Acrobacia', ability: 'dexterity' },
  { key: 'animalHandling', label: 'Adestramento', ability: 'wisdom' },
  { key: 'arcana', label: 'Arcanismo', ability: 'intelligence' },
  { key: 'athletics', label: 'Atletismo', ability: 'strength' },
  { key: 'performance', label: 'Atuação', ability: 'charisma' },
  { key: 'deception', label: 'Enganação', ability: 'charisma' },
  { key: 'stealth', label: 'Furtividade', ability: 'dexterity' },
  { key: 'history', label: 'História', ability: 'intelligence' },
  { key: 'intimidation', label: 'Intimidação', ability: 'charisma' },
  { key: 'insight', label: 'Intuição', ability: 'wisdom' },
  { key: 'investigation', label: 'Investigação', ability: 'intelligence' },
  { key: 'medicine', label: 'Medicina', ability: 'wisdom' },
  { key: 'nature', label: 'Natureza', ability: 'intelligence' },
  { key: 'perception', label: 'Percepção', ability: 'wisdom' },
  { key: 'persuasion', label: 'Persuasão', ability: 'charisma' },
  { key: 'sleightOfHand', label: 'Prestidigitação', ability: 'dexterity' },
  { key: 'religion', label: 'Religião', ability: 'intelligence' },
  { key: 'survival', label: 'Sobrevivência', ability: 'wisdom' },
];

export const ALIGNMENTS = [
  'Leal e Bom',
  'Neutro e Bom',
  'Caótico e Bom',
  'Leal e Neutro',
  'Neutro',
  'Caótico e Neutro',
  'Leal e Mau',
  'Neutro e Mau',
  'Caótico e Mau',
] as const;

/**
 * O que cada alinhamento quer dizer, em uma frase — é o texto que a ficha mostra
 * ao passar o mouse no alinhamento escolhido.
 */
export const ALIGNMENT_DESCRIPTIONS: Record<string, string> = {
  'Leal e Bom': 'Age pelo dever e pela compaixão: cumpre a lei e protege os inocentes.',
  'Neutro e Bom': 'Faz o bem sem se prender a leis — ajuda quem precisa, como e quando puder.',
  'Caótico e Bom': 'Segue a própria consciência: livre das regras, escolhe o bem pelo coração.',
  'Leal e Neutro': 'Vive pela ordem e pelo dever, sem pender para o bem nem para o mal.',
  Neutro: 'Busca o equilíbrio: age conforme a situação, sem compromisso com a lei ou o caos.',
  'Caótico e Neutro':
    'Segue o próprio desejo — faz o que quer, quando quer, sem se importar com o resto.',
  'Leal e Mau': 'Usa a lei e a hierarquia em proveito próprio, sem freios morais.',
  'Neutro e Mau': 'Age pelo interesse próprio: maldade sem código nem escrúpulo.',
  'Caótico e Mau': 'Destrói e tiraniza por prazer ou por ganho — nem lei, nem limite.',
};

/** Descrição do alinhamento escolhido ('' quando não houver). */
export function alignmentDescription(value: string): string {
  return ALIGNMENT_DESCRIPTIONS[value] ?? '';
}

export const FEATURE_SOURCES: readonly FeatureSource[] = [
  'race',
  'class',
  'background',
  'feat',
  'other',
];

export const FEATURE_SOURCE_LABELS: Record<FeatureSource, string> = {
  race: 'Raça',
  class: 'Classe',
  background: 'Antecedente',
  feat: 'Talento',
  other: 'Outro',
};

/** Rótulos do tipo de conjuração de uma classe. */
export const SPELLCASTING_TYPE_LABELS: Record<SpellcastingType, string> = {
  none: 'Sem conjuração',
  full: 'Conjurador completo',
  half: 'Meio-conjurador',
  third: 'Terço-conjurador',
  pact: 'Magia de pacto',
};

/** Rótulos do modo de aprendizado das magias. */
export const SPELL_LEARNING_LABELS: Record<SpellLearning, string> = {
  known: 'Conhecidas',
  prepared: 'Preparadas',
  none: '—',
};

/** Formata o dado de vida (ex.: 10 -> "d10"). */
export function hitDieLabel(die: number | null): string {
  return die === null ? '—' : `d${die}`;
}

export const WEAPON_TYPE_LABELS: Record<WeaponType, string> = {
  melee: 'Corpo a corpo',
  ranged: 'À distância',
};

export const WEAPON_CATEGORY_LABELS: Record<WeaponCategory, string> = {
  simple: 'Simples',
  martial: 'Marcial',
};

export const WEAPON_PROPERTY_LABELS: Record<WeaponProperty, string> = {
  light: 'Leve',
  finesse: 'Acuidade',
  heavy: 'Pesada',
  'two-handed': 'Duas mãos',
  versatile: 'Versátil',
  thrown: 'Arremesso',
  reach: 'Alcance',
  ammunition: 'Munição',
  loading: 'Recarga',
  special: 'Especial',
};

export const SPELL_SCHOOLS = [
  'Abjuração',
  'Adivinhação',
  'Conjuração',
  'Encantamento',
  'Evocação',
  'Ilusão',
  'Necromancia',
  'Transmutação',
] as const;

export const SPELL_LEVEL_LABELS: Record<number, string> = {
  0: 'Truques',
  1: '1º nível',
  2: '2º nível',
  3: '3º nível',
  4: '4º nível',
  5: '5º nível',
  6: '6º nível',
  7: '7º nível',
  8: '8º nível',
  9: '9º nível',
};

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/** Um quadrado do grid (tabuleiro) vale 1,5 m — 5 pés, como no PHB. */
export const METERS_PER_SQUARE = 1.5;

/**
 * Deslocamento em quadrados do grid: "9 metros = 6 quadrados". Quando a metragem
 * não é múltipla de 1,5 m, o valor sai arredondado com "≈".
 */
export function speedInSquares(meters: number): string {
  const squares = meters / METERS_PER_SQUARE;
  const rounded = Math.round(squares * 100) / 100;
  const exact = Number.isInteger(rounded);
  const text = exact ? String(rounded) : rounded.toFixed(2).replace('.', ',');
  const label = rounded === 1 ? 'quadrado' : 'quadrados';
  return `${exact ? '' : '≈'}${text} ${label} de 1,5 m`;
}

/**
 * Expressão textual do dano estruturado ("2d6+3", "1d8-1", "4") — só para
 * exibição, igual ao `damageExpression` do servidor.
 */
export function damageExpression(damage: Damage | null | undefined): string {
  if (!damage) return '—';
  const dice = damage.count > 0 && damage.sides > 0 ? `${damage.count}d${damage.sides}` : '';
  if (dice === '') return String(damage.bonus);
  if (damage.bonus === 0) return dice;
  return `${dice}${damage.bonus > 0 ? '+' : ''}${damage.bonus}`;
}

/**
 * Tetos de danos ADICIONAIS por ataque/arma (o principal não conta). Espelha
 * `MAX_EXTRA_DAMAGES` do servidor.
 */
export const MAX_EXTRA_DAMAGES = 10;

/** Um dano está vazio (não rola dado nenhum e não soma bônus)? */
export function damageIsEmpty(damage: Damage | null | undefined): boolean {
  if (!damage) return true;
  const hasDice = damage.count > 0 && damage.sides > 0;
  return !hasDice && damage.bonus === 0;
}

/**
 * TODOS os danos de um ataque/arma: o principal (`damage`) mais os adicionais
 * (`extraDamages`). Espelha `attackDamages` do servidor.
 */
export function attackDamages(attack: {
  damage: Damage;
  extraDamages?: Damage[];
}): Damage[] {
  return [attack.damage, ...(attack.extraDamages ?? [])];
}

/** Só as expressões, lado a lado: "1d8+3 + 1d6". */
export function damageListExpression(damages: Damage[]): string {
  const parts = damages
    .filter((damage) => !damageIsEmpty(damage))
    .map((damage) => damageExpression(damage));
  return parts.length > 0 ? parts.join(' + ') : '—';
}

/**
 * Tipos dos danos COM valor, sem repetir ("Cortante, Necrótico") — o que a
 * tabela mostra quando o ataque/arma tem mais de um tipo.
 */
export function damageTypeLabel(damages: Damage[]): string {
  const types = damages
    .filter((damage) => !damageIsEmpty(damage) && damage.type)
    .map((damage) => damage.type as string);
  return types.length > 0 ? [...new Set(types)].join(', ') : '—';
}

/**
 * Resume os atributos de um item por categoria (ex.: "2d6 Cortante · acerto +5",
 * "CA +2", "efeito 2d4+2 · 10 min"). Vazio quando o item não tem atributos.
 */
export function describeItemDetails(category: string, details: ItemDetails | undefined): string {
  if (!details) return '';
  const parts: string[] = [];

  if (category === 'Arma' || category === 'Cajado') {
    if (details.damageCount && details.damageDie) {
      parts.push(
        details.damageBonus
          ? `${details.damageCount}d${details.damageDie}${formatModifier(details.damageBonus)}`
          : `${details.damageCount}d${details.damageDie}`,
      );
    } else if (details.damageBonus) {
      parts.push(`dano ${formatModifier(details.damageBonus)}`);
    }
    if (details.damageType) parts.push(details.damageType);
    // Danos ADICIONAIS da arma: cada um com o seu dado e o seu tipo.
    for (const extra of details.extraDamages ?? []) {
      if (damageIsEmpty(extra)) continue;
      parts.push(`${damageExpression(extra)}${extra.type ? ` ${extra.type}` : ''}`);
    }
    if (details.attackBonus) parts.push(`acerto ${formatModifier(details.attackBonus)}`);
    // Perfil da arma (tipo, categoria, propriedades e alcance).
    if (details.weaponCategory) parts.push(WEAPON_CATEGORY_LABELS[details.weaponCategory]);
    if (details.weaponType === 'ranged' || details.properties?.includes('thrown')) {
      parts.push(WEAPON_TYPE_LABELS.ranged);
    }
    if (details.properties?.length) {
      parts.push(details.properties.map((property) => WEAPON_PROPERTY_LABELS[property]).join(', '));
    }
    if (details.properties?.includes('versatile') && details.versatileDie) {
      parts.push(`versátil d${details.versatileDie}`);
    }
    if (details.properties?.includes('ammunition') && details.ammoType) {
      parts.push(`munição ${details.ammoType}`);
    }
    if (details.rangeNormal !== undefined && details.rangeLong !== undefined) {
      parts.push(`${details.rangeNormal}/${details.rangeLong} m`);
    }
    if (category === 'Cajado' && details.spellcastingFocus) parts.push('foco de conjuração');
  } else if (category === 'Armadura') {
    if (details.armorType && details.baseArmorClass) {
      parts.push(`CA ${details.baseArmorClass} (${details.armorType.toLowerCase()})`);
    } else if (details.baseArmorClass) {
      parts.push(`CA ${details.baseArmorClass}`);
    }
    if (details.armorClassBonus) parts.push(`CA ${formatModifier(details.armorClassBonus)}`);
  } else if (category === 'Escudo') {
    if (details.armorClassBonus) parts.push(`CA ${formatModifier(details.armorClassBonus)}`);
  } else if (category === 'Munição') {
    if (details.ammoType) parts.push(details.ammoType);
    if (details.attackBonus) parts.push(`acerto ${formatModifier(details.attackBonus)}`);
    if (details.damageBonus) parts.push(`dano ${formatModifier(details.damageBonus)}`);
  } else if (category === 'Poção') {
    if (details.effectRoll) parts.push(`efeito ${details.effectRoll}`);
    if (details.duration) parts.push(details.duration);
  } else if (category === 'Anel') {
    if (details.effectRoll) parts.push(`efeito ${details.effectRoll}`);
    if (details.attunement) parts.push('sintonização');
  } else if (category === 'Item Geral' || category === 'Outro') {
    if (details.effectRoll) parts.push(`efeito ${details.effectRoll}`);
    if (details.consumable) parts.push('consumível (usável)');
  }

  return parts.join(' · ');
}

/**
 * O item pode ser USADO pelo jogador (consome 1 unidade)?
 *
 * Espelha `isConsumableItem` do servidor: toda Poção é consumível; nas demais
 * categorias só quando o mestre marcou `details.consumable`.
 */
export function isConsumableItem(category: string, details: ItemDetails): boolean {
  return category === 'Poção' || details.consumable === true;
}

/** Formata um Valor de Desafio (CR): 0.25 -> "1/4", 0.5 -> "1/2", 1 -> "1". */
export function formatChallengeRating(value: number): string {
  if (value === 0) return '0';
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(value);
}
