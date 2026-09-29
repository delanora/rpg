/**
 * Regras de D&D 5ª Edição usadas pela ficha.
 *
 * Tudo aqui é cálculo puro (sem banco, sem HTTP), o que mantém as regras
 * testáveis e reaproveitáveis pela Etapa 4 (combate: iniciativa, CA, ataques).
 */

import {
  computeArmorClass,
  type ArmorClassDetail,
  type ArmorClassPieces,
} from './armor-class.js';

// ---------------------------------------------------------------------------
// Atributos
// ---------------------------------------------------------------------------

export const ABILITY_KEYS = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type AbilityKey = (typeof ABILITY_KEYS)[number];

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

/** Abreviações usadas em textos curtos (ex.: "FOR +2"). */
export const ABILITY_ABBREVIATIONS: Record<AbilityKey, string> = {
  strength: 'FOR',
  dexterity: 'DES',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'SAB',
  charisma: 'CAR',
};

export const ABILITY_SCORE_MIN = 1;
export const ABILITY_SCORE_MAX = 30;
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 20;

// ---------------------------------------------------------------------------
// Perícias (18 perícias do livro básico)
// ---------------------------------------------------------------------------

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
] as const;

export const SKILL_KEYS = SKILLS.map((skill) => skill.key);

export const SKILL_ABILITY: Record<string, AbilityKey> = Object.fromEntries(
  SKILLS.map((skill) => [skill.key, skill.ability]),
);

export const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  SKILLS.map((skill) => [skill.key, skill.label]),
);

// ---------------------------------------------------------------------------
// Cálculos base
// ---------------------------------------------------------------------------

/** Modificador de atributo: floor((valor - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Bônus de proficiência pelo nível: +2 (1–4), +3 (5–8), +4 (9–12), +5 (13–16), +6 (17–20). */
export function proficiencyBonus(level: number): number {
  const clamped = Math.min(Math.max(level, LEVEL_MIN), LEVEL_MAX);
  return 2 + Math.floor((clamped - 1) / 4);
}

/** Formata um modificador com sinal: 2 -> "+2", -1 -> "-1". */
export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * XP acumulado necessário para alcançar cada nível (PHB 2014).
 * O índice é o nível atual: `XP_THRESHOLDS[1]` = XP para chegar ao nível 2.
 */
const XP_THRESHOLDS: readonly number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
  165000, 195000, 225000, 265000, 305000, 355000,
];

/** XP necessário para alcançar o próximo nível (null no nível 20). */
export function xpForNextLevel(level: number): number | null {
  const clamped = Math.min(20, Math.max(1, Math.floor(level)));
  return clamped >= 20 ? null : (XP_THRESHOLDS[clamped] ?? null);
}

/**
 * Capacidade de carga: Força × 7,5 (em quilogramas).
 *
 * É a conversão usada no livro em português: 2 lb = 1 kg, então as 15 lb por
 * ponto de Força viram 7,5 kg.
 */
export function carryingCapacity(strength: number): number {
  return strength * 7.5;
}

/** Iniciativa = modificador de Destreza + bônus avulso. */
export function initiative(dexterity: number, bonus = 0): number {
  return abilityModifier(dexterity) + bonus;
}

/** Classe de Armadura sugerida sem armadura: 10 + mod. de Destreza. */
export function unarmoredArmorClass(dexterity: number): number {
  return 10 + abilityModifier(dexterity);
}

// ---------------------------------------------------------------------------
// Classes conjuradoras
// ---------------------------------------------------------------------------

/**
 * Atributo de conjuração por classe (aceita nomes em português e inglês).
 * Classes puramente marciais não aparecem (não têm CD de magia).
 */
export const CLASS_SPELLCASTING_ABILITY: Record<string, AbilityKey> = {
  bardo: 'charisma',
  bard: 'charisma',
  bruxo: 'charisma',
  warlock: 'charisma',
  clérigo: 'wisdom',
  clerigo: 'wisdom',
  cleric: 'wisdom',
  druida: 'wisdom',
  druid: 'wisdom',
  feiticeiro: 'charisma',
  sorcerer: 'charisma',
  mago: 'intelligence',
  wizard: 'intelligence',
  paladino: 'charisma',
  paladin: 'charisma',
  guardião: 'wisdom',
  guardiao: 'wisdom',
  ranger: 'wisdom',
};

/** CD de magia = 8 + proficiência + mod. do atributo de conjuração. */
export function spellSaveDc(level: number, abilityScore: number): number {
  return 8 + proficiencyBonus(level) + abilityModifier(abilityScore);
}

/** Bônus de ataque mágico = proficiência + mod. do atributo de conjuração. */
export function spellAttackBonus(level: number, abilityScore: number): number {
  return proficiencyBonus(level) + abilityModifier(abilityScore);
}

// ---------------------------------------------------------------------------
// Normalização dos estados (usados com os campos JSONB)
// ---------------------------------------------------------------------------

export interface SkillEntry {
  proficient: boolean;
  expertise: boolean;
}

export type SavesState = Partial<Record<AbilityKey, boolean>>;
export type SkillsState = Record<string, SkillEntry>;

/** Garante que todas as 18 perícias existam, com flags booleanas. */
export function normalizeSkills(input: unknown): SkillsState {
  const source = (input ?? {}) as Record<string, Partial<SkillEntry>>;
  const result: SkillsState = {};

  for (const skill of SKILLS) {
    const entry = source[skill.key];
    result[skill.key] = {
      proficient: Boolean(entry?.proficient),
      expertise: Boolean(entry?.expertise),
    };
  }

  return result;
}

/** Garante que os 6 atributos tenham um booleano de proficiência em salvaguarda. */
export function normalizeSaves(input: unknown): Record<AbilityKey, boolean> {
  const source = (input ?? {}) as Partial<Record<AbilityKey, boolean>>;
  const result = {} as Record<AbilityKey, boolean>;

  for (const ability of ABILITY_KEYS) {
    result[ability] = Boolean(source[ability]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Valores derivados (calculados, nunca gravados)
// ---------------------------------------------------------------------------

export interface SaveDetail {
  ability: AbilityKey;
  proficient: boolean;
  modifier: number;
  total: number;
}

export interface SkillDetail {
  label: string;
  ability: AbilityKey;
  modifier: number;
  proficient: boolean;
  expertise: boolean;
  total: number;
}

export interface DerivedStats {
  proficiencyBonus: number;
  modifiers: Record<AbilityKey, number>;
  /** Dado de vida da classe (6, 8, 10 ou 12) ou nulo se nenhuma classe foi escolhida. */
  hitDie: number | null;
  /** Salvaguardas que não podem ser desmarcadas (classe e features). */
  lockedSaves: AbilityKey[];
  /** Dados de Ataque Furtivo (ex.: 2d6) quando a classe concede a feature. */
  sneakAttack: { dice: number; expression: string } | null;
  /** Espaços de Expertise (dobrar proficiência) concedidos pelas features. */
  expertiseSlots: number;
  initiative: number;
  passivePerception: number;
  /** CA calculada (armadura equipada + atributos + defesa sem armadura). */
  armorClass: ArmorClassDetail;
  carryingCapacity: number;
  totalWeight: number;
  saves: SaveDetail[];
  skills: Record<string, SkillDetail>;
  /** Bônus somado a TODAS as salvaguardas (Aura de Proteção: mod. de CAR). */
  saveBonus: number;
  /**
   * Metade da proficiência aplicada em testes de habilidade sem proficiência
   * (Pau para Toda Obra do bardo; Atleta Extraordinário do Campeão). 0 = sem
   * efeito. Quando mais de um efeito vale para o mesmo teste, este é o MAIOR
   * valor aplicado (nunca a soma).
   */
  halfProficiencyBonus: number;
  /** Limiar de crítico no d20 (20 = só o 20 natural; Campeão: 19 e depois 18). */
  critThreshold: number;
  spellcasting: { ability: AbilityKey; saveDC: number; attackBonus: number } | null;
  /**
   * Magias preparadas: NÃO existe um total aqui. Preparadas são POR CLASSE (o
   * Paladino conta metade do nível e cada classe usa o próprio atributo), então
   * o valor vive em `CharacterDto.classes[].spellcasting.preparedCount` — ver
   * `preparedSpellCountFor` em shared/classes. Um número único enganaria fichas
   * multiclasse.
   */
  /** Espaços de magia: a tabela da própria classe com UMA classe conjuradora;
   *  a combinada só com DUAS OU MAIS (ver `spellSlotsForClasses`). */
  spellSlots: { level: number; max: number }[];
  /** Magia de Pacto do bruxo, calculada à parte (null quando não há bruxo). */
  pactSlots: { max: number; slotLevel: number } | null;
  /** XP necessário para o próximo nível (null no nível 20). */
  xpForNextLevel: number | null;
}

export interface DerivedInput {
  level: number;
  abilities: Record<AbilityKey, number>;
  skills: SkillsState;
  saves: Record<AbilityKey, boolean>;
  initiativeBonus: number;
  className: string;
  inventory: Array<{ quantity: number; weight: number }>;
  /**
   * Atributo de conjuração vindo do registro de classes. Quando `undefined`,
   * cai no mapa por nome de classe abaixo (compatibilidade com fichas antigas).
   */
  spellcastingAbility?: AbilityKey | null;
  /** Dado de vida da classe escolhida. */
  hitDie?: number | null;
  /** Salvaguardas fixas (classe + features) que a ficha deve travar. */
  lockedSaves?: AbilityKey[];
  /** Dados de Ataque Furtivo já resolvidos. */
  sneakAttack?: { dice: number; expression: string } | null;
  /** Total de espaços de Expertise. */
  expertiseSlots?: number;
  /** Espaços de magia já resolvidos (regra de multiclasse). */
  spellSlots?: { level: number; max: number }[];
  /** Espaços de Magia de Pacto do bruxo, quando houver. */
  pactSlots?: { max: number; slotLevel: number } | null;
  /**
   * Defesas sem Armadura concedidas pelas classes (Bárbaro/Monge/Linhagem
   * Dracônica). Elas não se acumulam: vale a que der o MAIOR valor.
   */
  unarmoredDefenses?: readonly { label: string; base: number; ability: AbilityKey | null }[];
  /** Armadura, escudo e bônus mágicos lidos do equipamento. */
  armorPieces?: ArmorClassPieces;
  /** Override manual da CA definido pelo mestre (`0`/ausente = automático). */
  armorClassOverride?: number | null;
  /** Bônus somado a todas as salvaguardas (Aura de Proteção). */
  saveBonus?: number;
  /**
   * Efeitos de "metade da proficiência" (ver DerivedStats): alvo e
   * arredondamento (para baixo no bardo; para cima no Campeão).
   */
  halfProficiency?: readonly { target: 'checks' | 'physicalChecks'; round: 'down' | 'up' }[];
  /** Limiar de crítico do personagem (Campeão: 19/18); padrão 20. */
  critThreshold?: number | null;
  /** Bônus fixos de CA de classes (Estilo de Luta Defesa). */
  classArmorBonuses?: readonly ClassArmorBonus[];
}

/** Bônus fixo de CA concedido por uma classe (Estilo de Luta Defesa). */
export interface ClassArmorBonus {
  label: string;
  value: number;
  /** Só vale com armadura vestida (regra da Defesa). */
  requiresArmor?: boolean;
}

/** Calcula todos os valores derivados exibidos na ficha. */
export function deriveStats(input: DerivedInput): DerivedStats {
  const prof = proficiencyBonus(input.level);
  const saveBonus = input.saveBonus ?? 0;
  const critThreshold = input.critThreshold ?? 20;
  const halfProfGrants: readonly { target: string; round: string }[] = input.halfProficiency ?? [];

  /**
   * Metade da proficiência SOMENTE em testes de habilidade sem proficiência.
   * Cada efeito arredonda do seu jeito (bardo para baixo, Campeão para cima) e,
   * se dois valerem para o MESMO teste, vale o MAIOR — nunca a soma.
   */
  function halfProficiencyFor(ability: AbilityKey): number {
    if (halfProfGrants.length === 0) return 0;
    const physical =
      ability === 'strength' || ability === 'dexterity' || ability === 'constitution';
    const applicable = halfProfGrants.filter(
      (grant) => grant.target === 'checks' || (grant.target === 'physicalChecks' && physical),
    );
    if (applicable.length === 0) return 0;

    return applicable.reduce((top, grant) => {
      const value = grant.round === 'up' ? Math.ceil(prof / 2) : Math.floor(prof / 2);
      return Math.max(top, value);
    }, 0);
  }

  const modifiers = {} as Record<AbilityKey, number>;
  for (const ability of ABILITY_KEYS) {
    modifiers[ability] = abilityModifier(input.abilities[ability]);
  }

  const saves: SaveDetail[] = ABILITY_KEYS.map((ability) => {
    const proficient = input.saves[ability];
    return {
      ability,
      proficient,
      modifier: modifiers[ability],
      // O bônus de salvaguarda (Aura de Proteção) entra em TODAS, com ou sem
      // proficiência — e nunca na conta aqui da perícia/CA.
      total: modifiers[ability] + (proficient ? prof : 0) + saveBonus,
    };
  });

  const skills: Record<string, SkillDetail> = {};
  for (const skill of SKILLS) {
    const entry = input.skills[skill.key] ?? { proficient: false, expertise: false };
    const modifier = modifiers[skill.ability];
    // Expertise só conta se houver proficiência (e dobra o bônus); sem
    // proficiência ainda cabe a metade da proficiência (Pau para Toda Obra).
    const bonus = entry.proficient
      ? prof * (entry.expertise ? 2 : 1)
      : halfProficiencyFor(skill.ability);

    skills[skill.key] = {
      label: skill.label,
      ability: skill.ability,
      modifier,
      proficient: entry.proficient,
      expertise: entry.expertise,
      total: modifier + bonus,
    };
  }

  const perception = skills.perception;
  const totalWeight = input.inventory.reduce(
    (sum, item) => sum + (item.weight ?? 0) * (item.quantity ?? 0),
    0,
  );

  const spellcastingAbility =
    input.spellcastingAbility !== undefined
      ? input.spellcastingAbility
      : (CLASS_SPELLCASTING_ABILITY[input.className.trim().toLowerCase()] ?? null);

  return {
    proficiencyBonus: prof,
    modifiers,
    hitDie: input.hitDie ?? null,
    lockedSaves: input.lockedSaves ?? [],
    sneakAttack: input.sneakAttack ?? null,
    expertiseSlots: input.expertiseSlots ?? 0,
    saveBonus,
    halfProficiencyBonus: halfProfGrants.reduce((top, grant) => {
      const value = grant.round === 'up' ? Math.ceil(prof / 2) : Math.floor(prof / 2);
      return Math.max(top, value);
    }, 0),
    critThreshold,
    // A iniciativa é um teste de Destreza: a metade da proficiência vale nela.
    initiative: initiative(
      input.abilities.dexterity,
      input.initiativeBonus + halfProficiencyFor('dexterity'),
    ),
    passivePerception: 10 + (perception?.total ?? modifiers.wisdom),
    armorClass: computeArmorClass({
      dexterityModifier: modifiers.dexterity,
      pieces: input.armorPieces ?? { armor: null, shieldBonus: 0, magicBonus: 0 },
      classBonuses: input.classArmorBonuses ?? [],
      unarmored: (input.unarmoredDefenses ?? []).map((option) => ({
        label: option.label,
        value:
          option.base +
          modifiers.dexterity +
          (option.ability ? modifiers[option.ability] : 0),
      })),
      override: input.armorClassOverride ?? null,
    }),
    carryingCapacity: carryingCapacity(input.abilities.strength),
    totalWeight: Math.round(totalWeight * 100) / 100,
    saves,
    skills,
    spellSlots: input.spellSlots ?? [],
    pactSlots: input.pactSlots ?? null,
    xpForNextLevel: xpForNextLevel(input.level),
    spellcasting:
      spellcastingAbility === null
        ? null
        : {
            ability: spellcastingAbility,
            saveDC: spellSaveDc(input.level, input.abilities[spellcastingAbility]),
            attackBonus: spellAttackBonus(input.level, input.abilities[spellcastingAbility]),
          },
  };
}

/** Alinhamentos do livro básico. */
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

/** Fontes de características, usadas na seção de características. */
export const FEATURE_SOURCES = ['race', 'class', 'background', 'feat', 'other'] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];

export const FEATURE_SOURCE_LABELS: Record<FeatureSource, string> = {
  race: 'Raça',
  class: 'Classe',
  background: 'Antecedente',
  feat: 'Talento',
  other: 'Outro',
};
