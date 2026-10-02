import { DAMAGE_TYPES } from './types';
import type {
  AbilityKey,
  Damage,
  FeatureSource,
  HealingDice,
  ItemDetails,
  ItemRarity,
  PotionCategory,
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
  /** Para que a perícia serve, em uma frase (mostrada no hover da linha). */
  description: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    key: 'acrobatics',
    label: 'Acrobacia',
    ability: 'dexterity',
    description: 'Equilíbrio, cambalhotas e escapar de agarrões ou de uma queda.',
  },
  {
    key: 'animalHandling',
    label: 'Adestramento',
    ability: 'wisdom',
    description: 'Acalmar, treinar e conduzir animais, inclusive montados.',
  },
  {
    key: 'arcana',
    label: 'Arcanismo',
    ability: 'intelligence',
    description: 'Reconhecer magias, itens mágicos, planos e criaturas arcanas.',
  },
  {
    key: 'athletics',
    label: 'Atletismo',
    ability: 'strength',
    description: 'Escalar, nadar, saltar longe e agarrar ou derrubar à força.',
  },
  {
    key: 'performance',
    label: 'Atuação',
    ability: 'charisma',
    description: 'Entreter uma plateia com música, dança, teatro ou discurso.',
  },
  {
    key: 'deception',
    label: 'Enganação',
    ability: 'charisma',
    description: 'Mentir, disfarçar-se e esconder as próprias intenções.',
  },
  {
    key: 'stealth',
    label: 'Furtividade',
    ability: 'dexterity',
    description: 'Mover-se sem ser visto nem ouvido, e seguir alguém em silêncio.',
  },
  {
    key: 'history',
    label: 'História',
    ability: 'intelligence',
    description: 'Lembrar eventos, reinos, linhagens e guerras antigas.',
  },
  {
    key: 'intimidation',
    label: 'Intimidação',
    ability: 'charisma',
    description: 'Ameaçar e coagir alguém pela presença e pela voz.',
  },
  {
    key: 'insight',
    label: 'Intuição',
    ability: 'wisdom',
    description: 'Perceber intenções e dizer se alguém está mentindo.',
  },
  {
    key: 'investigation',
    label: 'Investigação',
    ability: 'intelligence',
    description: 'Deduzir a partir de pistas e achar o que está escondido.',
  },
  {
    key: 'medicine',
    label: 'Medicina',
    ability: 'wisdom',
    description: 'Estabilizar um moribundo e diagnosticar doenças ou venenos.',
  },
  {
    key: 'nature',
    label: 'Natureza',
    ability: 'intelligence',
    description: 'Conhecer terreno, plantas, animais, clima e ciclos naturais.',
  },
  {
    key: 'perception',
    label: 'Percepção',
    ability: 'wisdom',
    description: 'Notar detalhes, ouvir ruídos e perceber emboscadas.',
  },
  {
    key: 'persuasion',
    label: 'Persuasão',
    ability: 'charisma',
    description: 'Convencer e negociar com argumentos honestos.',
  },
  {
    key: 'sleightOfHand',
    label: 'Prestidigitação',
    ability: 'dexterity',
    description: 'Furtar bolsos, esconder objetos e fazer truques com as mãos.',
  },
  {
    key: 'religion',
    label: 'Religião',
    ability: 'intelligence',
    description: 'Conhecer divindades, ritos, símbolos e criaturas divinas.',
  },
  {
    key: 'survival',
    label: 'Sobrevivência',
    ability: 'wisdom',
    description: 'Rastrear, orientar-se e caçar no ermo, prevendo o tempo.',
  },
];

/**
 * Para que serve cada SALVAGUARDA, em uma frase — é o resumo que a ficha mostra
 * ao passar o mouse na linha da salvaguarda.
 */
/** Prefixo das ferramentas nas chaves de Expertise (`tool:<rótulo>`). */
export const EXPERTISE_TOOL_PREFIX = 'tool:';

/** Rótulo exibido de uma chave de Expertise (perícia ou ferramenta). */
export function expertiseKeyLabel(key: string): string {
  if (key.startsWith(EXPERTISE_TOOL_PREFIX)) {
    return key.slice(EXPERTISE_TOOL_PREFIX.length);
  }
  return SKILLS.find((skill) => skill.key === key)?.label ?? key;
}

/**
 * O que o personagem JÁ domina e pode receber Expertise: as perícias com
 * proficiência e as ferramentas da ficha (as opções saem daqui).
 */
export function expertiseEligibleOptions(
  proficientSkills: readonly string[],
  tools: readonly string[],
): { key: string; name: string }[] {
  const options: { key: string; name: string }[] = [];
  for (const skill of SKILLS) {
    if (proficientSkills.includes(skill.key)) options.push({ key: skill.key, name: skill.label });
  }
  for (const tool of tools) {
    const label = tool.trim();
    if (label === '') continue;
    options.push({ key: `${EXPERTISE_TOOL_PREFIX}${label}`, name: label });
  }
  return options;
}

export const SAVE_DESCRIPTIONS: Record<AbilityKey, string> = {
  strength: 'Resistir a empurrões, agarrões e efeitos que prendem ou derrubam.',
  dexterity: 'Escapar de explosões e áreas perigosas (bola de fogo, sopro do dragão).',
  constitution: 'Aguentar venenos, doenças e efeitos que drenam o corpo.',
  intelligence: 'Resistir a efeitos que atacam a mente e a memória.',
  wisdom: 'Resistir a encantamentos e a efeitos que dominam a vontade.',
  charisma: 'Resistir a efeitos que aprisionam ou banem a alma.',
};

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

/** Rótulos em português das raridades (os valores internos ficam em `types.ts`). */
export const ITEM_RARITY_LABELS: Record<ItemRarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  very_rare: 'Muito Raro',
  legendary: 'Lendário',
  artifact: 'Artefato',
};

/**
 * CORES das raridades — FONTE ÚNICA do sistema visual de raridade.
 *
 * Para mudar a cor de uma raridade, altere SÓ aqui: todo o app (inventário,
 * painel do mestre e modal de detalhes) lê deste mapa. Um item sem raridade
 * reconhecida usa o estilo neutro do tema (nenhuma cor aleatória).
 */
export const ITEM_RARITY_COLORS: Record<ItemRarity, string> = {
  common: '#BDBDBD',
  uncommon: '#4CAF50',
  rare: '#2196F3',
  very_rare: '#9C27B0',
  legendary: '#FF9800',
  artifact: '#D32F2F',
};

/**
 * Apelidos aceitos para cada raridade (chave em minúsculas, sem acento). Aceita
 * tanto os valores internos (`very_rare`) quanto os rótulos em português, em
 * qualquer capitalização ("comum", "Comum", "COMUM").
 */
const RARITY_ALIASES: Record<string, ItemRarity> = {
  common: 'common',
  comum: 'common',
  uncommon: 'uncommon',
  incomum: 'uncommon',
  rare: 'rare',
  raro: 'rare',
  very_rare: 'very_rare',
  veryrare: 'very_rare',
  'muito raro': 'very_rare',
  legendary: 'legendary',
  lendario: 'legendary',
  artifact: 'artifact',
  artefato: 'artifact',
};

/**
 * Normaliza um valor de raridade vindo de qualquer fonte (minúsculas, sem
 * acento, espaço em branco colapsado) para o valor interno. Devolve `null`
 * quando não reconhece — o consumidor usa o estilo neutro.
 */
export function normalizeRarity(value: string | null | undefined): ItemRarity | null {
  if (!value) return null;
  const key = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  return RARITY_ALIASES[key] ?? RARITY_ALIASES[key.replace(/ /g, '_')] ?? null;
}

/** Cor da raridade (fonte única) ou `null` quando não há raridade reconhecida. */
export function rarityColor(rarity: string | null | undefined): string | null {
  const key = normalizeRarity(rarity);
  return key ? ITEM_RARITY_COLORS[key] : null;
}

/**
 * Versão translúcida da cor da raridade (borda/fundo discreto). `alpha` é o
 * sufixo hexadecimal de opacidade (padrão `33` ≈ 20%). `null` sem raridade.
 */
export function rarityTint(rarity: string | null | undefined, alpha = '33'): string | null {
  const color = rarityColor(rarity);
  return color ? `${color}${alpha}` : null;
}

/** Rótulo da raridade para exibição (`null` ou desconhecida → ''). */
export function rarityLabel(rarity: string | null | undefined): string {
  const key = normalizeRarity(rarity);
  return key ? ITEM_RARITY_LABELS[key] : '';
}

/**
 * Rótulos em português das categorias de POÇÃO (os valores internos ficam em
 * `types.ts` / `item-details.ts`). Só a categoria Poção usa este mapa.
 */
/**
 * Expressão da cura estruturada de uma poção: `2d8+3`, `1d4` (sem bônus).
 * Espelha o `count d sides + bonus` que o servidor rola no uso do item.
 */
export function healingDiceLabel(dice: HealingDice): string {
  return `${dice.count}d${dice.sides}${dice.bonus ? `+${dice.bonus}` : ''}`;
}

export const POTION_CATEGORY_LABELS: Record<PotionCategory, string> = {
  healing: 'Cura',
  enhancement: 'Atributos e aprimoramento',
  protection: 'Resistência e proteção',
  mobility: 'Mobilidade',
  stealth: 'Furtividade e percepção',
  exploration: 'Sobrevivência e exploração',
  poison: 'Veneno',
  longevity: 'Longevidade',
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
    if (details.potionCategory) parts.push(POTION_CATEGORY_LABELS[details.potionCategory]);
    // Poção de Cura automatizada: mostra a cura estruturada no lugar do texto
    // livre de efeito (que deixa de valer para ela).
    if (details.healingDice) {
      parts.push(`cura ${healingDiceLabel(details.healingDice)}`);
    } else if (details.effectRoll) {
      parts.push(`efeito ${details.effectRoll}`);
    }
    if (details.duration) parts.push(details.duration);
  } else if (category === 'Anel') {
    if (details.effectRoll) parts.push(`efeito ${details.effectRoll}`);
  } else if (category === 'Item Geral' || category === 'Outro') {
    if (details.effectRoll) parts.push(`efeito ${details.effectRoll}`);
    if (details.consumable) parts.push('consumível (usável)');
  }

  return parts.join(' · ');
}

/** Uma linha rótulo/valor da ficha detalhada do item. */
export interface ItemDetailRow {
  label: string;
  value: string;
}

/**
 * Atributos do item em pares rótulo/valor, para a ficha detalhada do modal do
 * inventário. Só entram as linhas que o item realmente tem — nada de campos
 * vazios. O PREÇO nunca é incluído (é informação exclusiva do mestre e nem
 * chega ao objeto do inventário).
 */
export function itemDetailRows(details: ItemDetails | undefined): ItemDetailRow[] {
  if (!details) return [];
  const rows: ItemDetailRow[] = [];
  const add = (label: string, value: string | undefined | null): void => {
    if (value) rows.push({ label, value });
  };

  // Dano principal (Arma/Cajado): a expressão já leva o bônus de dano junto.
  const hasMainDamage = Boolean(details.damageCount && details.damageDie);
  if (hasMainDamage) {
    add(
      'Dano',
      damageExpression({
        count: details.damageCount ?? 0,
        sides: details.damageDie ?? 0,
        bonus: details.damageBonus ?? 0,
        type: details.damageType ?? null,
      }),
    );
  } else if (details.damageBonus) {
    add('Bônus de dano', formatModifier(details.damageBonus));
  }
  add('Tipo de dano', details.damageType);

  // Danos ADICIONAIS (um por tipo), cada um com a sua expressão.
  for (const extra of details.extraDamages ?? []) {
    if (damageIsEmpty(extra)) continue;
    add(
      'Dano adicional',
      extra.type ? `${damageExpression(extra)} (${extra.type})` : damageExpression(extra),
    );
  }

  add('Bônus de ataque', details.attackBonus ? formatModifier(details.attackBonus) : undefined);
  add('Uso', details.weaponType ? WEAPON_TYPE_LABELS[details.weaponType] : undefined);
  add(
    'Categoria da arma',
    details.weaponCategory ? WEAPON_CATEGORY_LABELS[details.weaponCategory] : undefined,
  );
  if (details.properties?.length) {
    add(
      'Propriedades',
      details.properties.map((property) => WEAPON_PROPERTY_LABELS[property]).join(', '),
    );
  }
  add('Munição', details.ammoType);
  add('Dado versátil', details.versatileDie ? `d${details.versatileDie}` : undefined);
  if (details.rangeNormal !== undefined || details.rangeLong !== undefined) {
    const ranges = [details.rangeNormal, details.rangeLong].filter(
      (value): value is number => value !== undefined,
    );
    add('Alcance', `${ranges.join('/')} m`);
  }
  add('Foco de conjuração', details.spellcastingFocus ? 'Sim' : undefined);
  add('Tipo de armadura', details.armorType);
  add('CA base', details.baseArmorClass ? String(details.baseArmorClass) : undefined);
  add('Bônus de CA', details.armorClassBonus ? formatModifier(details.armorClassBonus) : undefined);
  add(
    'Categoria da poção',
    details.potionCategory ? POTION_CATEGORY_LABELS[details.potionCategory] : undefined,
  );
  add('Cura', details.healingDice ? healingDiceLabel(details.healingDice) : undefined);
  if (!details.healingDice) add('Efeito', details.effectRoll);
  add('Duração', details.duration);
  add('Usável', details.consumable ? 'Sim (consome 1 unidade)' : undefined);

  return rows;
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
