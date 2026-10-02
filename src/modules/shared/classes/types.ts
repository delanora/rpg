import type { AbilityKey } from '../dnd5e.js';

/**
 * Registro das 12 classes do Livro do Jogador (PHB 2014).
 *
 * Esta é a fonte única de verdade sobre classes: dado de vida, salvaguardas
 * fixas, nível de escolha de subclasse, modo de conjuração e as características
 * de classe/subclasse (com os efeitos mecânicos e as escolhas que cada uma
 * declara).
 *
 * As 12 classes têm as suas características cadastradas, e todas as subclasses
 * do PHB estão registradas (o clérigo e o bruxo escolhem no 1º nível; as demais,
 * no nível indicado por `subclassLevel`).
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
  /**
   * Piso do máximo calculado (Inspiração de Bardo e Sentido Divino: `1 + mod.
   * de CAR`, nunca menos de 1). Vale depois do modificador.
   */
  min?: number;
}  /**
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
    /** Bônus fixo de CA (Estilo de Luta Defesa: +1 com armadura). */
    | 'armorClass'
    /** Bônus em TODAS as salvaguardas (Aura de Proteção do paladino). */
    | 'saveBonus'
    /**
     * Metade da proficiência (arredondada para baixo) em testes de habilidade
     * sem proficiência — Pau para Toda Obra do bardo (`target: 'checks'`) e
     * Atleta Notável do guerreiro (`target: 'physicalChecks'`, FOR/DES/CON).
     */
    | 'halfProficiency'
    /**
     * Limiar de crítico: acerta criticamente com `value` ou mais no d20
     * (Campeão: 19 no 3º nível e 18 no 15º). O MENOR limiar prevalece.
     */
    | 'critThreshold'
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
  /** Fórmula que só vale sem escudo equipado (Defesa sem Armadura do Monge). */
  requiresNoShield?: boolean;
  /**
   * Efeito que só vale com ARMADURA vestida (Estilo de Luta Defesa: "enquanto
   * você estiver usando armadura"). Escudo sozinho não conta como armadura.
   */
  requiresArmor?: boolean;
  /**
   * Somado ao valor o modificador deste atributo (Aura de Proteção: CAR).
   * Vale para `saveBonus`.
   */
  abilityMod?: AbilityKey;
  /** Piso do valor calculado (Aura de Proteção e inspirações: mínimo +1). */
  minValue?: number;
  /**
   * Arredondamento de "metade da proficiência" (`halfProficiency`): `down`
   * (padrão, Pau para Toda Obra) ou `up` (Atleta Extraordinário do Campeão).
   */
  round?: 'down' | 'up';
  /** Recurso com contador em `type: 'resource'`. */
  resource?: ClassFeatureResource;
  /** Só vale enquanto o toggle com este id estiver ativo (ex.: efeitos da Fúria). */
  requiresActive?: string;
  /** Observações livres sobre o efeito. */
  notes?: string;
}

/**
 * Uma opção que a característica oferece (ex.: 'Defesa' no Estilo de Luta).
 *
 * A chave é o que fica gravado em `classState.choices`; o efeito mecânico, quando
 * houver, só vale se ESTA opção for a escolhida (hoje só a Defesa tem efeito:
 * +1 CA com armadura — as demais ficam informativas até a Fase 5).
 */
export interface FeatureChoiceOption {
  /** Valor estável gravado na ficha (ex.: 'defense'). */
  key: string;
  name: string;
  description?: string;
  /** Efeito que só vale com esta opção escolhida. */
  effect?: ClassFeatureEffect;
}

/**
 * Escolha declarada por uma característica: quantas opções, quais e em que
 * nível da CLASSE ela é feita.
 *
 * O padrão (`count: 1`, `level`: o nível da característica) cobre a maioria. As
 * melhorias que dão "um tipo novo" (Inimigo Favorito no 6 e no 14, Explorador
 * Nato no 6 e no 10) são características próprias, cada uma com a sua escolha.
 */
export interface ClassFeatureChoice {
  /** Quantas opções escolher (padrão 1). */
  count?: number;
  /** Opções disponíveis (a chave é o valor gravado). */
  options: FeatureChoiceOption[];
  /** Nível (daquela classe) da escolha; padrão: o nível da característica. */
  level?: number;
  /** Rótulo do passo na interface; padrão: o nome da característica. */
  prompt?: string;
  /** Permite repetir a mesma opção nas escolhas múltiplas (padrão: não). */
  allowRepeat?: boolean;
  /**
   * O que a escolha FAZ na ficha além de ficar gravada. Hoje só 'skill': as
   * opções são PERÍCIAS e as escolhidas viram proficiência (Colégio do
   * Conhecimento do bardo: 3 perícias à escolha).
   */
  apply?: 'skill';
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
  /**
   * Escolha exigida pela característica (ex.: Estilo de Luta, Inimigo
   * Favorito). A escolha vive em `classState.choices[id da característica]`.
   */
  choice?: ClassFeatureChoice;
}

/** Uma subclasse (ex.: Caminho Primal do Bárbaro). */
export interface SubclassDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * Conjuração própria da subclasse, quando houver (ex.: Trapaceiro Arcano e
   * Cavaleiro Arcano, terço-conjuradores). Sobrepõe-se à da classe.
   */
  spellcasting?: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  /**
   * Proficiências de armadura/arma/ferramenta concedidas pela subclasse (ex.:
   * Colégio da Bravura: armaduras médias, escudos e armas marciais). São
   * SOMADAS às da classe quando a subclasse é escolhida no Level Up.
   */
  proficiencies?: ProficienciesState;
  features: ClassFeatureDefinition[];
}

/** Definição completa de uma classe. */
export interface ClassDefinition {
  /** Chave canônica (estável, usada no banco e nas APIs). */
  key: string;
  name: string;
  /**
   * O que a classe é, em uma frase — é o texto que a ficha mostra ao passar o
   * mouse no nome da classe (mesmo tom curto das descrições de subclasse).
   */
  description: string;
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

/**
 * Proficiências de armadura, arma e ferramenta do personagem.
 *
 * É texto exibido na ficha ("Armaduras leves", "Espadas longas", ...). As
 * escolhas abertas do livro ("1 instrumento musical à sua escolha") entram como
 * descrição; a escolha interativa fica para uma etapa futura. O EFEITO mecânico
 * (somar CA de armadura, ataque de arma) ainda NÃO é calculado a partir daqui.
 */
export interface ProficienciesState {
  armor: string[];
  weapons: string[];
  tools: string[];
}

/** Perícia à escolha concedida ao ENTRAR numa classe por multiclasse. */
export interface MulticlassSkillChoice {
  /** Quantas perícias escolher. */
  count: number;
  /** Chaves aceitas (ver SKILLS em shared/dnd5e.ts). Vazio = qualquer uma. */
  from: string[];
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
