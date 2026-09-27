import type { AbilityKey } from '../dnd5e.js';

/**
 * Registro das 12 classes do Livro do Jogador (PHB 2014).
 *
 * Esta é a fonte única de verdade sobre classes: dado de vida, salvaguardas
 * fixas, nível de escolha de subclasse e o modo de conjuração. As features de
 * cada classe/subclasse ainda NÃO estão preenchidas — a estrutura já está
 * pronta (`features` e `subclasses`) para recebê-las nos próximos passos, uma
 * classe por vez.
 */

/** Como a classe obtém e usa magias. */
export type SpellcastingType = 'none' | 'full' | 'half' | 'third' | 'pact';

/** De onde vêm as magias: lista fixa (conhecidas) ou recalculada (preparadas). */
export type SpellLearning = 'known' | 'prepared' | 'none';

/** Recurso com contador concedido por uma característica (ex.: Fúria). */
export interface ClassFeatureResource {
  name: string;
  recharge: 'short' | 'long' | 'none';
  /** Máximo fixo (quando não varia com o nível). */
  max?: number;
  /** Máximo por nível: usa o maior nível menor ou igual ao atual. -1 = ilimitado. */
  maxByLevel?: { level: number; value: number }[];
  /** Máximo igual ao nível do personagem (ex.: pontos de Ki do monge). */
  perLevel?: boolean;
  /** Multiplicador do máximo por nível quando `perLevel` (padrão 1; Couraça Arcana usa 2). */
  perLevelMultiplier?: number;
  /** Somado ao máximo o modificador deste atributo (ex.: Couraça Arcana usa INT). */
  abilityMod?: AbilityKey;
}

/**
 * Efeito mecânico opcional de uma característica. É a ponte entre o texto da
 * característica e a aplicação automática na ficha (bônus numérico, recurso
 * com contador etc.). Preenchido junto com as features de cada classe.
 */
export interface ClassFeatureEffect {
  type:
    | 'bonus'
    | 'resource'
    | 'save'
    | 'expertise'
    | 'sneakAttack'
    | 'toggle'
    | 'resistance'
    | 'speed'
    | 'damageBonus'
    | 'critDice'
    | 'unarmoredDefense'
    | 'martialArts'
    | 'wildShape'
    | 'hpBonus'
    | 'abilityBonus'
    | 'other';
  /** Identificador do toggle/recurso (ex.: 'rage'). Vazio = id da feature. */
  id?: string;
  /** Recurso consumido pelo toggle (ex.: 'ki'); vazio = recurso de mesmo id. */
  resourceId?: string;
  /** Valor base em `type: 'unarmoredDefense'` (padrão 10; Linhagem Dracônica usa 13). */
  base?: number;
  /** Multiplica o valor pelo nível do personagem (ex.: +1 PV por nível). */
  perLevel?: boolean;
  /** Substitui efeitos anteriores do mesmo tipo (ex.: CR da Forma Selvagem do Círculo da Lua). */
  override?: boolean;
  /** Rótulo do toggle (ex.: 'Fúria'). */
  name?: string;
  /** Alvo do bônus quando `type: 'bonus'`. */
  target?: string;
  /** Valor fixo (ou espaços, em `type: 'expertise'`). */
  value?: number;
  /** Valor escalonado por nível: usa o maior nível menor ou igual ao atual. */
  scaling?: { level: number; value: number }[];
  /** Atributo concedido/afetado (`save`, `abilityBonus`). */
  ability?: AbilityKey;
  /** Teto do atributo em `abilityBonus` (ex.: 24 no Campeão Primitivo). */
  max?: number;
  /** Tipos de dano resistidos em `type: 'resistance'`. */
  damageTypes?: string[];
  /** Atributo somado na Defesa sem Armadura (Bárbaro: CON; Monge: SAB). */
  unarmoredDefenseAbility?: AbilityKey;
  /** Recurso com contador em `type: 'resource'`. */
  resource?: ClassFeatureResource;
  /** Só vale enquanto o toggle com este id estiver ativo (ex.: efeitos da Fúria). */
  requiresActive?: string;
  /** Observações livres sobre o efeito. */
  notes?: string;
}

/** Uma característica concedida por uma classe ou subclasse. */
export interface ClassFeatureDefinition {
  /** Identificador estável (ex.: 'rage'). */
  id: string;
  name: string;
  /** Nível do personagem em que a característica é obtida. */
  level: number;
  description: string;
  /** Efeito mecânico vinculado, quando houver (features simples). */
  effect?: ClassFeatureEffect;
  /** Efeitos múltiplos (ex.: Fúria tem toggle, recurso, bônus e resistência). */
  effects?: ClassFeatureEffect[];
}

/** Uma subclasse (ex.: Caminho Primal do Bárbaro). */
export interface SubclassDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * Conjuração própria da subclasse, quando houver (ex.: Trapaceiro Arcano,
   * um terço-conjurador). Sobreponha-se à conjuração da classe.
   */
  spellcasting?: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  features: ClassFeatureDefinition[];
}

/** Definição completa de uma classe. */
export interface ClassDefinition {
  /** Chave canônica (estável, usada no banco e nas APIs). */
  key: string;
  name: string;
  /** Dado de vida: 6, 8, 10 ou 12. */
  hitDie: number;
  /** As duas salvaguardas com proficiência — fixas, nunca mudam. */
  savingThrows: [AbilityKey, AbilityKey];
  /** Nível em que a subclasse é escolhida. */
  subclassLevel: number;
  spellcasting: {
    type: SpellcastingType;
    /** Atributo de conjuração (nulo quando a classe não conjura). */
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  /** Características de classe (vazio por enquanto). */
  features: ClassFeatureDefinition[];
  /** Subclasses disponíveis (vazio por enquanto). */
  subclasses: SubclassDefinition[];
}

/** Resumo usado para montar o seletor de classe no cliente. */
export interface ClassSummary {
  key: string;
  name: string;
  hitDie: number;
  subclassLevel: number;
  spellcastingType: SpellcastingType;
}

/** Nenhuma classe tem features/subclasses cadastradas ainda. */
export const NO_FEATURES: ClassFeatureDefinition[] = [];
export const NO_SUBCLASSES: SubclassDefinition[] = [];
