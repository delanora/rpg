/** Espelho dos tipos expostos pela API (ver src/modules/characters/characters.dto.ts). */

export type Role = 'PLAYER' | 'MASTER';

/** Usuário da sessão. Montado a partir de /api/auth/login e /api/auth/me. */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface PublicUser extends SessionUser {
  createdAt: string;
}

export type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export interface SkillEntry {
  proficient: boolean;
  expertise: boolean;
}

/** Armadura equipada (espelha shared/armor-class.ts). */
export interface ArmorPiece {
  name: string;
  /** 'Leve' | 'Média' | 'Pesada' */
  type: string;
  base: number;
}

/** Resultado do cálculo da CA, com o detalhamento para a ficha explicar. */
export interface ArmorClassDetail {
  /** CA final: override do mestre quando existe, senão a automática. */
  value: number;
  automatic: number;
  /** Override manual do mestre (`null` = automático). */
  override: number | null;
  armor: ArmorPiece | null;
  dexterityBonus: number;
  shieldBonus: number;
  magicBonus: number;
  /** Defesa sem armadura usada, quando não há armadura. */
  unarmoredLabel: string | null;
  /** Bônus fixos de classe aplicados à CA (Estilo de Luta Defesa: +1). */
  classBonus: number;
  /** Rótulos desses bônus (ex.: ["Estilo de Luta (Defesa)"]). */
  classBonusLabels: string[];
}

export type SkillsState = Record<string, SkillEntry>;
export type SavesState = Record<AbilityKey, boolean>;

/** Atributos de item por categoria (espelha src/modules/shared/item-details.ts). */
export interface ItemDetails {
  damageCount?: number;
  damageDie?: number;
  damageType?: DamageType;
  attackBonus?: number;
  /** Bônus mágico somado ao DANO da arma (ex.: +1). */
  damageBonus?: number;
  /** Arma corpo a corpo ('melee') ou à distância ('ranged'). */
  weaponType?: WeaponType;
  /** Arma simples ('simple') ou marcial ('martial'). */
  weaponCategory?: WeaponCategory;
  /** Tipo de munição consumido (exige a propriedade 'ammunition'). */
  ammoType?: AmmoType;
  /** Propriedades de arma do PHB marcadas pelo mestre. */
  properties?: WeaponProperty[];
  /** Dado do dano com as duas mãos (só com a propriedade Versátil). */
  versatileDie?: number;
  /** Alcance normal/longo em metros (à distância ou arremessável). */
  rangeNormal?: number;
  rangeLong?: number;
  spellcastingFocus?: boolean;
  /** Peso da armadura: 'Leve' | 'Média' | 'Pesada' (só a categoria Armadura usa). */
  armorType?: string;
  /** CA base da armadura (couro = 11, cota de malha = 16...). */
  baseArmorClass?: number;
  /** Bônus avulso de CA (escudos e itens mágicos). */
  armorClassBonus?: number;
  effectRoll?: string;
  duration?: string;
  attunement?: boolean;
  /** Marcado pelo mestre (Item Geral/Outro): o item pode ser USADO (consome 1). */
  consumable?: boolean;
}

/** Preço em peças de ouro (PO), prata (PP) e cobre (PC). */
export interface ItemPrice {
  gold: number;
  silver: number;
  copper: number;
}

/** Slots de equipamento do paperdoll (estilo Tibia). */
export type InventorySlot =
  | 'helmet'
  | 'necklace'
  | 'chest'
  | 'ring1'
  | 'ring2'
  | 'hand1'
  | 'hand2'
  | 'legs'
  | 'boots';

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  weight: number;
  /** Slot em que o item está equipado (`null` = mochila). */
  slot: InventorySlot | null;
  /** Posição na grade da mochila (`null` = equipado ou sem posição). */
  backpackX: number | null;
  backpackY: number | null;
  /** Sprite do item (`/uploads/items/...`); vazio quando é avulso. */
  imageUrl: string;
  /** Id do item no catálogo do mestre ('' quando é avulso). */
  itemId: string;
  /** Categoria do item no catálogo ('' quando avulso). */
  category: string;
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: ItemDetails;
}

/** Corpo de `POST /api/characters/me/inventory/move`. */
export interface InventoryMoveRequest {
  itemInventoryId: string;
  targetSlot?: InventorySlot | null;
  targetBackpackX?: number | null;
  targetBackpackY?: number | null;
}

/** --- Moedas (ver src/modules/shared/coins.ts) ------------------------------ */

/** Denominações do PHB, sempre nesta ordem: platina, ouro, electrum, prata, cobre. */
export const COIN_KEYS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
export type CoinKey = (typeof COIN_KEYS)[number];

/** Carteira de moedas: as cinco denominações, inteiros >= 0. */
export interface CoinPurse {
  pp: number;
  gp: number;
  ep: number;
  sp: number;
  cp: number;
}

/** Valor de moedas informado por uma ação (gastar, trocar, transferir). */
export type CoinAmount = Partial<CoinPurse>;

/** Ajuste do mestre: valores positivos dão e negativos retiram. */
export type CoinDelta = Partial<CoinPurse>;

/** Destino possível de uma transferência de moedas. */
export interface TransferTarget {
  id: string;
  name: string;
  ownerUsername: string;
}

export interface Spell {
  id: string;
  name: string;
  level: number;
  school: string;
  prepared: boolean;
  description: string;
}

export interface SpellSlot {
  max: number;
  used: number;
}

export interface SpellsState {
  list: Spell[];
  slots: Record<string, SpellSlot>;
}

/**
 * Tipos de dano do livro básico (espelha src/modules/shared/attacks.ts).
 * O mesmo conjunto vale para o dano dos ataques, o tipo dos itens e as
 * resistências/imunidades das criaturas.
 */
export const DAMAGE_TYPES = [
  'Cortante',
  'Perfurante',
  'Concussão',
  'Ácido',
  'Frio',
  'Fogo',
  'Elétrico',
  'Necrótico',
  'Veneno',
  'Psíquico',
  'Radiante',
  'Trovão',
  'Força',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Arma corpo a corpo x à distância (espelha src/modules/shared/item-details.ts). */
export const WEAPON_TYPES = ['melee', 'ranged'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** Categoria de proficiência da arma (PHB). */
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/** Propriedades de arma do PHB (subconjunto usado no cadastro). */
export const WEAPON_PROPERTIES = [
  'light',
  'finesse',
  'heavy',
  'two-handed',
  'versatile',
  'thrown',
  'reach',
  'ammunition',
  'loading',
  'special',
] as const;
export type WeaponProperty = (typeof WEAPON_PROPERTIES)[number];

/** Tipos de munição (espelha src/modules/shared/item-details.ts). */
export const AMMO_TYPES = ['Flecha', 'Virote', 'Bala de funda', 'Agulha de zarabatana'] as const;
export type AmmoType = (typeof AMMO_TYPES)[number];

/**
 * Dano estruturado de um ataque (espelha `damageSchema` do servidor):
 * `count`d`sides` + `bonus`; `count: 0` é dano fixo (só o bônus) e `type: null`
 * significa "sem tipo" (não aciona resistência).
 */
export interface Damage {
  count: number;
  sides: number;
  bonus: number;
  type: DamageType | null;
}

export interface Attack {
  id: string;
  name: string;
  damage: Damage;
  attackBonus: number;
  notes: string;
  /** Arma sutil (habilita Ataque Furtivo). */
  finesse: boolean;
  /** Arma à distância (habilita Ataque Furtivo). */
  ranged: boolean;
  /**
   * Item do INVENTÁRIO que este ataque usa. Quando aponta para uma arma
   * equipada numa das mãos, o combate passa a olhar a munição dela; o ataque
   * some da ficha enquanto a arma não estiver equipada.
   */
  inventoryItemId?: string;
  /** Texto original preservado quando o dano antigo não pôde ser convertido. */
  damageText?: string;
  /** Verdadeiro quando o dano veio de uma expressão antiga não conversível. */
  legacy: boolean;
  /**
   * Ataque CALCULADO da arma equipada (nunca gravado na ficha): vem em
   * `derivedAttacks`, não em `attacks`. A ficha não o edita.
   */
  derived?: boolean;
  /**
   * Motivo pelo qual o ataque derivado não pode ser usado agora (ex.: arma de
   * duas mãos com a outra mão ocupada). O combate recusa a rolagem.
   */
  blocked?: string;
}

export type FeatureSource = 'race' | 'class' | 'background' | 'feat' | 'other';

export interface Feature {
  id: string;
  name: string;
  source: FeatureSource;
  description: string;
}

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
  /** Bônus somado a TODAS as salvaguardas (Aura de Proteção: mod. de CAR). */
  saveBonus: number;
  /**
   * Metade da proficiência aplicada em testes de habilidade sem proficiência
   * (Pau para Toda Obra do bardo; Atleta Notável do guerreiro). 0 = sem efeito.
   */
  halfProficiencyBonus: number;
  /**
   * Limiar de crítico no d20 (20 = padrão; 19 = Crítico Aprimorado do Campeão;
   * 18 = Crítico Superior). Crítico sempre acerta; 1 natural sempre erra.
   */
  critThreshold: number;
  /**
   * As magias PREPARADAS são por classe — ver
   * `Character.classes[].spellcasting.preparedCount`. Não existe um total único:
   * cada conjurador prepara as suas, com o atributo e o nível da própria classe.
   */
  initiative: number;
  passivePerception: number;
  /** CA calculada (armadura + atributos + Defesa sem Armadura) e override do mestre. */
  armorClass: ArmorClassDetail;
  carryingCapacity: number;
  totalWeight: number;
  saves: SaveDetail[];
  skills: Record<string, SkillDetail>;
  spellcasting: { ability: AbilityKey; saveDC: number; attackBonus: number } | null;
  /** Espaços de magia combinados do conjurador multiclasse (max > 0). */
  spellSlots: { level: number; max: number }[];
  /** Magia de Pacto do bruxo, calculada à parte (null quando não há bruxo). */
  pactSlots: { max: number; slotLevel: number } | null;
  /** XP necessário para o próximo nível (null no nível 20). */
  xpForNextLevel: number | null;
}

/** --- Classes (ver src/modules/shared/classes.ts) --------------------------- */

export type SpellcastingType = 'none' | 'full' | 'half' | 'third' | 'pact';
export type SpellLearning = 'known' | 'prepared' | 'none';

export interface ClassFeatureResource {
  name: string;
  recharge: 'short' | 'long' | 'none';
  max?: number;
  maxByLevel?: { level: number; value: number }[];
  perLevel?: boolean;
  perLevelMultiplier?: number;
  abilityMod?: AbilityKey;
  /** Piso do máximo calculado (1 + mod. de CAR nunca fica abaixo de 1). */
  min?: number;
}

/** Efeito mecânico opcional de uma característica de classe. */
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
    /** Bônus fixo de CA (Estilo de Luta Defesa). */
    | 'armorClass'
    /** Bônus em TODAS as salvaguardas (Aura de Proteção). */
    | 'saveBonus'
    /** Metade da proficiência em testes de habilidade sem proficiência. */
    | 'halfProficiency'
    /** Limiar de crítico: acerta criticamente com `value` ou mais no d20. */
    | 'critThreshold'
    | 'other';
  id?: string;
  resourceId?: string;
  name?: string;
  target?: string;
  value?: number;
  base?: number;
  perLevel?: boolean;
  override?: boolean;
  scaling?: { level: number; value: number }[];
  ability?: AbilityKey;
  max?: number;
  damageTypes?: string[];
  unarmoredDefenseAbility?: AbilityKey;
  resource?: ClassFeatureResource;
  requiresActive?: string;
  notes?: string;
  /** Só vale com armadura vestida (Estilo de Luta Defesa). */
  requiresArmor?: boolean;
  /** Modificador somado ao valor (Aura de Proteção: CAR). */
  abilityMod?: AbilityKey;
  /** Piso do valor calculado (Aura de Proteção: mínimo +1). */
  minValue?: number;
  /**
   * Arredondamento de "metade da proficiência": 'down' (padrão) ou 'up'
   * (Atleta Extraordinário do Campeão).
   */
  round?: 'down' | 'up';
}

/** Uma opção oferecida por uma característica (ex.: 'Defesa' no Estilo de Luta). */
export interface FeatureChoiceOption {
  key: string;
  name: string;
  description?: string;
  /** Efeito que só vale com esta opção escolhida (Defesa: +1 CA). */
  effect?: ClassFeatureEffect;
}

/** Escolha declarada por uma característica (quantas, quais e em que nível). */
export interface ClassFeatureChoice {
  count?: number;
  options: FeatureChoiceOption[];
  level?: number;
  prompt?: string;
  /** Permite repetir a mesma opção nas escolhas múltiplas (padrão: não). */
  allowRepeat?: boolean;
  /**
   * O que a escolha faz na ficha além de ficar gravada. 'skill': as opções são
   * perícias e as escolhidas viram proficiência (Colégio do Conhecimento).
   */
  apply?: 'skill';
}

/** Característica de classe ou subclasse. */
export interface ClassFeature {
  id: string;
  name: string;
  level: number;
  description: string;
  effect?: ClassFeatureEffect;
  effects?: ClassFeatureEffect[];
  /** Escolha exigida (Estilo de Luta, Inimigo Favorito). */
  choice?: ClassFeatureChoice;
}

/** Escolha de característica com as opções e o que já foi escolhido. */
export interface FeatureChoiceInfo {
  featureId: string;
  name: string;
  prompt: string;
  /** Nível da CLASSE em que a escolha é feita. */
  level: number;
  count: number;
  allowRepeat: boolean;
  options: { key: string; name: string; description: string }[];
  chosen: string[];
}

export interface Subclass {
  id: string;
  name: string;
  description: string;
  /** Conjuração própria da subclasse (ex.: Trapaceiro Arcano). */
  spellcasting?: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  /**
   * Proficiências concedidas pela subclasse (Colégio da Bravura: armaduras
   * médias, escudos e armas marciais). Somadas às da classe quando escolhida.
   */
  proficiencies?: ProficienciesState;
  features: ClassFeature[];
}

/** Feature de classe/subclasse já liberada pelo nível atual. */
export interface ActiveClassFeature extends ClassFeature {
  source: 'class' | 'subclass';
  subclassName?: string;
  /** Chave da classe de origem (preenchida no modo multiclasse). */
  classKey?: string;
  /** Nível do personagem NAQUELA classe (é ele que escala os efeitos). */
  classLevel?: number;
}

/** Definição completa de uma classe. */
export interface ClassDefinition {
  key: string;
  name: string;
  hitDie: number;
  savingThrows: [AbilityKey, AbilityKey];
  subclassLevel: number;
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  features: ClassFeature[];
  subclasses: Subclass[];
}

/** Resumo usado no seletor de classe. */
export interface ClassSummary {
  key: string;
  name: string;
  hitDie: number;
  subclassLevel: number;
  spellcastingType: SpellcastingType;
}

/**
 * Proficiências de armadura, arma e ferramenta da ficha (texto exibido).
 * Campo de construção: só o mestre edita depois da criação finalizada.
 */
export interface ProficienciesState {
  armor: string[];
  weapons: string[];
  tools: string[];
}

/** Perícia à escolha concedida ao ENTRAR numa classe por multiclasse. */
export interface MulticlassSkillChoice {
  count: number;
  /** Chaves aceitas (ver SKILLS em dnd.ts). Vazio = qualquer uma. */
  from: string[];
}

/** Opção de classe para o seletor, com a elegibilidade do personagem calculada. */
export interface ClassOption extends ClassSummary {
  eligible: boolean;
  /**
   * Motivo do bloqueio ('' quando elegível). Cita a classe nova E as classes
   * que o personagem já tem, quando uma delas é que está barrando.
   */
  missing: string;
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  /** Nomes das subclasses disponíveis. */
  subclassNames: string[];
  /** O que a classe concede ao ser a PRIMEIRA do personagem (nível 1). */
  firstProficiencies: ProficienciesState;
  /** O que ela concede ao ENTRAR por multiclasse (PHB p.164). */
  multiclassProficiencies: ProficienciesState;
  /** Perícia à escolha da entrada por multiclasse (null quando não concede). */
  multiclassSkillChoice: MulticlassSkillChoice | null;
  /** Escolhas feitas no NÍVEL 1 da classe (Estilo de Luta, Inimigo Favorito). */
  featureChoices: FeatureChoiceInfo[];
  /**
   * Escolhas declaradas pelas SUBCLASSES desta classe, com o nome da subclasse.
   * É o que o Level Up usa quando a subclasse é escolhida no MESMO nível em que
   * ela já pede uma escolha (Caçador: Presa do Caçador no 3º).
   */
  subclassChoices: (FeatureChoiceInfo & { subclass: string })[];
}

/**
 * Uma classe do personagem (multiclasse). O nível é o nível NAQUELA classe; o
 * nível total da ficha é a soma dos níveis de todas as entradas.
 */
export interface ClassEntry {
  classKey: string;
  className: string;
  subclass: string;
  level: number;
  hitDie: number;
  subclassLevel: number;
  subclassEligible: boolean;
  subclassNames: string[];
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
    saveDC: number | null;
    attackBonus: number | null;
    preparedCount: number | null;
  } | null;
  /** Escolhas de característica desta classe, com o nível de cada uma. */
  featureChoices: FeatureChoiceInfo[];
}

/** Entrada de classe enviada no PATCH (o nível NUNCA é enviado). */
export interface ClassEntryPatch {
  classKey: string;
  subclass?: string;
}

/** Ficha completa devolvida pela API. */
export interface Character {
  id: string;
  userId: string;
  ownerUsername?: string;

  name: string;
  race: string;
  /** Nome composto das classes, com os níveis (ex.: "Bárbaro 3 / Ladino 2"). */
  className: string;
  /** Classes do personagem (multiclasse), em ordem de entrada. */
  classes: ClassEntry[];
  /**
   * Catálogo das 12 classes com a elegibilidade já calculada (pré-requisito de
   * atributo atendido ou o motivo do bloqueio).
   */
  classOptions: ClassOption[];
  /** Features de classe/subclasse já liberadas pelo nível atual. */
  activeFeatures: ActiveClassFeature[];
  /** Estado de runtime da classe (toggles ativos e usos gastos). */
  classState: ClassState;
  /**
   * O que CADA nível concedeu (PV, Aumento de Atributo/Talento, escolhas,
   * subclasse, perícia e proficiências). É o que o painel do mestre mostra ao
   * reduzir um nível.
   */
  levelHistory: LevelHistoryRecord[];
  /** Ajustes mecânicos derivados das features (Fúria, resistências, etc.). */
  classAdjustments: ClassAdjustments;
  /**
   * Criação encerrada: o jogador só mexe no estado de jogo (PV atual/temporário,
   * usos de recursos, anotações, avatar e movimentação de itens).
   */
  creationFinalized: boolean;
  /**
   * Rascunho do assistente de criação: modo escolhido, passo alcançado, as
   * rolagens de 4d6, os valores-base dos atributos e as perícias escolhidas.
   * Só vale enquanto `creationFinalized` for falso.
   */
  creationDraft: CreationDraft;
  level: number;
  /** Última liberação de Level Up que este personagem já usou. */
  lastLevelUpRelease: number;
  background: string;
  alignment: string;
  experience: number;
  /** URL pública do avatar ('' = sem avatar). */
  avatarUrl: string;

  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  /** CA efetiva (override do mestre ou a calculada). */
  armorClass: number;
  /** Override manual da CA (`null` = automático). Só o mestre grava. */
  armorClassOverride: number | null;
  initiativeBonus: number;
  speed: number;

  skills: SkillsState;
  saves: SavesState;
  /** Proficiências de armadura, arma e ferramenta (armaduras/armas/ferramentas). */
  proficiencies: ProficienciesState;
  inventory: InventoryItem[];
  spells: SpellsState;
  attacks: Attack[];
  /** Ataques calculados das armas equipadas (e o golpe desarmado). */
  derivedAttacks: Attack[];
  features: Feature[];
  /** Carteira de moedas: sempre com as cinco denominações. */
  coins: CoinPurse;

  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  derived: DerivedStats;
}

/** Campos que podem ser enviados no PATCH (edição inline). */
export interface ClassState {
  active: string[];
  used: Record<string, number>;
  /**
   * Escolhas de característica por id dela (ex.: `{ 'fighting-style':
   * ['defense'] }`). Campo de CONSTRUÇÃO: com a criação finalizada o jogador não
   * muda (403) — só o Level Up e o mestre.
   */
  choices: Record<string, string[]>;
}

export interface ActiveToggle {
  id: string;
  name: string;
  active: boolean;
  resourceId: string | null;
}

export interface ActiveResource {
  id: string;
  name: string;
  recharge: 'short' | 'long' | 'none';
  max: number;
  used: number;
  remaining: number;
  unlimited: boolean;
}

export interface ClassAdjustments {
  toggles: ActiveToggle[];
  resources: ActiveResource[];
  activeToggleIds: string[];
  meleeDamageBonus: number;
  resistances: string[];
  speedBonus: number;
  critExtraDice: number;
  unarmoredDefense: boolean;
  unarmoredDefenseAbility: AbilityKey | null;
  unarmoredDefenseBase: number;
  /** Fórmulas de Defesa sem Armadura disponíveis (vale a que der o maior valor). */
  unarmoredDefenseOptions: {
    label: string;
    base: number;
    ability: AbilityKey | null;
    requiresNoShield: boolean;
  }[];
  martialArtsDie: number;
  hpBonus: number;
  wildShapeCr: number | null;
  wildShapeFlying: boolean;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  abilityCaps: Partial<Record<AbilityKey, number>>;
  /** Bônus fixo de CA (Estilo de Luta Defesa: +1). */
  armorClassBonus: number;
  /** O bônus de CA só vale com armadura vestida. */
  armorClassBonusRequiresArmor: boolean;
  armorClassBonusLabel: string;
  /** Bônus somado a TODAS as salvaguardas (Aura de Proteção). */
  saveBonus: number;
  saveBonusLabel: string;
  /**
   * Efeitos "metade da proficiência" ativos: `target` diz em que testes eles
   * valem e `round` como arredondar (para baixo no Pau para Toda Obra, para
   * cima no Atleta Extraordinário). O maior valor prevalece.
   */
  halfProficiency: { target: 'checks' | 'physicalChecks'; round: 'down' | 'up' }[];
  /**
   * Limiar de crítico no d20 (20 = padrão; 19 = Crítico Aprimorado; 18 =
   * Crítico Superior). O MENOR limiar prevalece.
   */
  critThreshold: number | null;
}

/**
 * Configuração global da mesa.
 *
 * `levelUpRelease` conta as liberações de Level Up: cada clique do mestre em
 * "Liberar Level Up" avança o contador e cada personagem o compara com o próprio
 * `lastLevelUpRelease` para saber se ainda pode subir de nível.
 */
export interface GameConfig {
  /** Número da liberação atual, comparado com `Character.lastLevelUpRelease`. */
  levelUpRelease: number;
  /**
   * Nível em que a mesa começa: o assistente de criação aplica os níveis 2 até
   * ele ao concluir a montagem.
   */
  startingLevel: number;
  /**
   * Mostra as denominações extras (PL/pp e PE/ep) no bloco de moedas da ficha.
   * Desligado, a ficha mostra só PO (gp), PP (sp) e PC (cp).
   */
  extraCoins: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Compêndio da mesa (aba "Configurações da mesa")
// ---------------------------------------------------------------------------

/** Característica de uma classe ou subclasse do compêndio. */
export interface CompendiumFeature {
  id: string;
  name: string;
  /** Nível em que a característica é obtida. */
  level: number;
  description: string;
}

/** Uma subclasse do compêndio. */
export interface CompendiumSubclass {
  id: string;
  name: string;
  description: string;
  features: CompendiumFeature[];
}

/** Uma classe do compêndio, com os atributos que a definem. */
export interface CompendiumClass {
  key: string;
  name: string;
  /** Dado de vida: 6, 8, 10 ou 12. */
  hitDie: number;
  /** As duas salvaguardas com proficiência. */
  savingThrows: AbilityKey[];
  /** Nível em que a subclasse é escolhida. */
  subclassLevel: number;
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  features: CompendiumFeature[];
  subclasses: CompendiumSubclass[];
}

/** Uma linhagem de raça do compêndio. */
export interface CompendiumRace {
  key: string;
  name: string;
  /** Raça "mãe", para agrupar as linhagens (as três de elfo, as duas de anão...). */
  baseRace: string | null;
  description: string | null;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  /** Quantos atributos à escolha ganham +1 (Meio-Elfo: 2; 0 = nenhum). */
  abilityChoice: number;
}

/** Um antecedente do compêndio. */
export interface CompendiumBackground {
  key: string;
  name: string;
  description: string | null;
  /** Perícias concedidas (chaves de `SKILLS`). */
  skills: string[];
}

/**
 * Uma magia do compêndio.
 *
 * A estrutura já existe, mas a lista ainda vem vazia: o catálogo de magias será
 * preenchido numa etapa seguinte.
 */
export interface CompendiumSpell {
  key: string;
  name: string;
  /** 0 = truque; 1..9 = nível da magia. */
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  description: string;
  /** Chaves das classes que têm a magia na lista. */
  classes: string[];
}

/** As listas de referência da mesa. */
export interface Compendium {
  classes: CompendiumClass[];
  races: CompendiumRace[];
  backgrounds: CompendiumBackground[];
  spells: CompendiumSpell[];
}

// ---------------------------------------------------------------------------
// Assistente de criação de personagem
// ---------------------------------------------------------------------------

/** Uma rolagem de 4d6 do passo de atributos: os valores e o dado descartado. */
export interface CreationRoll {
  dice: number[];
  /** Índice do dado descartado (o menor dos quatro). */
  dropped: number;
}

/** Rascunho do assistente (espelho do JSONB `creationDraft` do servidor). */
export interface CreationDraft {
  mode: 'new' | 'existing' | null;
  step: number;
  rolls: CreationRoll[];
  baseAbilities: Partial<Record<AbilityKey, number>>;
  skillPicks: string[];
  /** Atributos escolhidos para os `+1` da raça (Meio-Elfo escolhe dois). */
  abilityChoices: AbilityKey[];
}

/** Uma raça do catálogo — uma entrada por linhagem/sub-raça do Livro do Jogador. */
export interface RaceOption {
  key: string;
  name: string;
  /** Nome da raça base (agrupa as sub-raças na interface). */
  baseRace?: string;
  description?: string;
  abilityBonuses?: Partial<Record<AbilityKey, number>>;
  /** Quantos atributos à escolha ganham +1 (Meio-Elfo: 2). */
  abilityChoice?: number;
}

/** Antecedente do catálogo. */
export interface BackgroundOption {
  key: string;
  name: string;
  description?: string;
  skills?: string[];
}

/** Estado do assistente devolvido pela API. */
export interface CreationState {
  mode: 'new' | 'existing' | null;
  step: number;
  rolls: CreationRoll[];
  baseAbilities: Partial<Record<AbilityKey, number>>;
  skillPicks: string[];
  /** Atributos escolhidos para os `+1` da raça (Meio-Elfo escolhe dois). */
  abilityChoices: AbilityKey[];
  skillChoice: { count: number; from: string[] };
  /**
   * Escolhas do NÍVEL 1 da classe inicial (Estilo de Luta do guerreiro,
   * Inimigo Favorito e Explorador Nato do patrulheiro).
   */
  featureChoices: FeatureChoiceInfo[];
  startingLevel: number;
  raceCatalog: RaceOption[];
  backgroundCatalog: BackgroundOption[];
  /** O que ainda falta para poder finalizar. */
  missing: string[];
}

/** Resposta das rotas do assistente (`{ character, creation }`). */
export interface CreationResponse {
  character: Character | null;
  creation: CreationState;
  /** Só na rolagem de atributo. */
  roll?: CreationRoll & { value: number };
}

/** Passo concluído enviado ao servidor (`PATCH /api/characters/me/creation`). */
export interface CreationStepRequest {
  step: number;
  mode?: 'new' | 'existing';
  name?: string;
  alignment?: string;
  avatarUrl?: string;
  race?: string;
  /** Atributos escolhidos para os `+1` da raça (passo 3). */
  abilityChoices?: AbilityKey[];
  background?: string;
  classKey?: string;
  /** Subclasse, quando a classe já a exige no nível 1 (passo 5). */
  subclass?: string;
  baseAbilities?: Record<AbilityKey, number>;
  skills?: string[];
}

export interface GameConfigPayload {
  config: GameConfig;
}

/** Corpo enviado ao assistente de Level Up (`POST /api/characters/me/level-up`). */
export interface LevelUpRequest {
  classKey: string;
  /** Subclasse, quando o novo nível da classe libera a escolha. */
  subclass?: string;
  hp: 'roll' | 'average';
  /** Aumento de Atributo: +2 em um atributo ou +1 em dois diferentes. */
  abilityIncreases?: { ability: AbilityKey; amount: number }[];
  /**
   * Perícia concedida pela entrada numa classe NOVA por multiclasse (Bardo:
   * qualquer; Patrulheiro e Ladino: da lista da classe).
   */
  skillChoice?: string;
  /** Talento escolhido (registro textual; sem efeito mecânico ainda). */
  feat?: { name: string; description: string } | null;
  /**
   * Escolhas de característica do nível que está sendo ganho (Estilo de Luta no
   * 1º nível do guerreiro e no 2º do paladino/patrulheiro, Inimigo Favorito e
   * Explorador Nato do patrulheiro): `{ [id da característica]: [opções] }`.
   */
  choices?: Record<string, string[]>;
}

/**
 * Um nível ganho, com o que ele concedeu (gravado pelo Level Up).
 * Níveis anteriores ao histórico não aparecem aqui — o downgrade os estima.
 */
export interface LevelHistoryRecord {
  classKey: string;
  /** Nível da CLASSE depois deste nível (1 = entrada por multiclasse). */
  classLevel: number;
  /** Nível total do personagem depois deste nível. */
  totalLevel: number;
  hp: { rolled: boolean; die: number; gained: number; conDelta: number; total: number };
  abilityIncreases: { ability: AbilityKey; amount: number }[];
  feat: { id: string; name: string } | null;
  choices: Record<string, string[]>;
  subclass: string;
  skills: string[];
  proficiencies: ProficienciesState | null;
  at: string;
}

/** Corpo do downgrade de nível (`POST /api/characters/:id/level-down`, mestre). */
export interface LevelDownRequest {
  /** Classe que perde um nível. */
  classKey: string;
  /** PV a retirar (padrão: o que o histórico registra; sem ele, a média). */
  hpLost?: number;
  /** Aumentos de atributo a desfazer além do que o histórico manda. */
  abilityDecreases?: { ability: AbilityKey; amount: number }[];
  /** Id da característica (talento) a remover além do que o histórico registra. */
  removeFeatId?: string;
}

/** O que o downgrade desfez na ficha (resposta do mestre). */
export interface LevelDownSummary {
  classKey: string;
  className: string;
  previousClassLevel: number;
  /** 0 = a classe saiu da ficha. */
  classLevel: number;
  totalLevel: number;
  classRemoved: boolean;
  hpLost: number;
  reverted: {
    abilities: { ability: AbilityKey; amount: number }[];
    feats: string[];
    choices: string[];
    subclass: string;
    skills: string[];
    proficiencies: ProficienciesState;
  };
  /** Avisos dos níveis sem histórico (PV estimado). */
  warnings: string[];
}

export interface LevelDownResult {
  character: Character;
  levelDown: LevelDownSummary;
}

export interface CharacterPatch {
  name?: string;
  race?: string;
  /**
   * Lista de classes enviada para editar a subclasse de cada uma. O nível de
   * cada classe é ignorado: ele só muda pelo fluxo de Level Up.
   */
  classes?: ClassEntryPatch[];
  background?: string;
  alignment?: string;
  experience?: number;
  avatarUrl?: string;

  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;

  hpCurrent?: number;
  hpMax?: number;
  hpTemp?: number;
  /** Override manual da CA — só o mestre pode enviar (`null` limpa). */
  armorClassOverride?: number | null;
  initiativeBonus?: number;
  speed?: number;

  skills?: SkillsState;
  saves?: SavesState;
  /** Só o mestre envia (campo de construção). */
  proficiencies?: ProficienciesState;
  inventory?: InventoryItem[];
  spells?: SpellsState;
  attacks?: Attack[];
  features?: Feature[];
  classState?: ClassState;

  notes?: string;
}

export type CreatureKind = 'CREATURE' | 'NPC';

/** Imagem de uma região ou localidade (arquivo servido em `/uploads/...`). */
export interface LocalityImage {
  url: string;
  name: string;
}

/** Versão enxuta usada dentro de criaturas/NPCs e do combate. */
export interface LocalitySummary {
  id: string;
  name: string;
}

/**
 * Região do mundo (reino, floresta, continente...) que agrupa localidades.
 * As criaturas e NPCs ficam nas localidades, nunca soltos na região.
 */
export interface Region {
  id: string;
  name: string;
  description: string;
  /** Anotações livres do mestre sobre a região. */
  notes: string;
  images: LocalityImage[];
  /** Quantas localidades estão dentro desta região. */
  localityCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RegionPatch {
  name?: string;
  description?: string;
  notes?: string;
  images?: LocalityImage[];
}

/** Localidade do mundo (cidade, masmorra, taverna...) dentro de uma região. */
export interface Locality {
  id: string;
  name: string;
  description: string;
  images: LocalityImage[];
  /** Região dona da localidade. */
  regionId: string;
  creatureCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalityPatch {
  name?: string;
  description?: string;
  images?: LocalityImage[];
  regionId?: string;
}

/** Criatura/NPC cadastrado pelo mestre. */
export interface Creature {
  id: string;
  name: string;
  kind: CreatureKind;
  type: string;
  challengeRating: string;
  /** Localidades vinculadas (uma ou mais). */
  localities: LocalitySummary[];

  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  hpCurrent: number;
  hpMax: number;
  armorClass: number;
  speed: number;

  attacks: Attack[];
  resistances: string[];
  immunities: string[];
  description: string;
  /** URL pública do ícone/retrato ('' = sem imagem). */
  imageUrl: string;

  version: number;
  createdAt: string;
  updatedAt: string;

  derived: { modifiers: Record<AbilityKey, number> };
}

/** Campos enviados no PATCH de criatura. */
export interface CreaturePatch {
  name?: string;
  kind?: CreatureKind;
  type?: string;
  challengeRating?: string;
  localityIds?: string[];

  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;

  hpCurrent?: number;
  hpMax?: number;
  armorClass?: number;
  speed?: number;

  attacks?: Attack[];
  resistances?: string[];
  immunities?: string[];
  description?: string;
  imageUrl?: string;
}

/**
 * Payload do evento `character:deleted`: o mestre excluiu a ficha **e a conta**
 * do jogador dono dela.
 */
export interface CharacterDeletedPayload {
  characterId: string;
  userId: string;
  name: string;
  username: string;
}

/** Payload do evento `sheet:updated` recebido pelo WebSocket. */
export interface SheetUpdatedPayload {
  userId: string;
  username: string;
  characterId: string;
  version: number;
  changes: Record<string, unknown>;
  character: Character;
  /** Presente quando quem editou não é o dono da ficha (o mestre). */
  editedBy?: string;
  at: string;
}

export interface OnlineUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface PresencePayload {
  online: OnlineUser[];
}

export interface CreatureCreatedPayload {
  creature: Creature;
}

export interface CreatureUpdatedPayload {
  creature: Creature;
  changes: Record<string, unknown>;
}

export interface CreatureDeletedPayload {
  creatureId: string;
}

export interface RegionCreatedPayload {
  region: Region;
}

export interface RegionUpdatedPayload {
  region: Region;
  changes: Record<string, unknown>;
}

export interface RegionDeletedPayload {
  regionId: string;
}

export interface LocalityCreatedPayload {
  locality: Locality;
}

export interface LocalityUpdatedPayload {
  locality: Locality;
  changes: Record<string, unknown>;
}

export interface LocalityDeletedPayload {
  localityId: string;
}

/** --- Catálogo de itens ------------------------------------------------------ */

/** Categorias do catálogo (espelha src/modules/items/items.schema.ts). */
export const ITEM_CATEGORIES = [
  'Arma',
  'Armadura',
  'Escudo',
  'Poção',
  'Anel',
  'Cajado',
  'Munição',
  'Item Geral',
  'Tesouro',
  'Outro',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * Peso das armaduras (espelha src/modules/shared/item-details.ts). Decide como
 * a Destreza entra na CA: leve soma tudo, média no máximo +2, pesada nada.
 */
export const ARMOR_TYPES = ['Leve', 'Média', 'Pesada'] as const;

export type ArmorType = (typeof ARMOR_TYPES)[number];

/** Item do catálogo central gerenciado pelo mestre. */
export interface Item {
  id: string;
  name: string;
  description: string;
  weight: number;
  category: string;
  imageUrl: string;
  /** Atributos específicos da categoria. */
  details: ItemDetails;
  /** Preço em PO/PP/PC; `null` para jogadores (valor é exclusivo do mestre). */
  price: ItemPrice | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemPatch {
  name?: string;
  description?: string;
  weight?: number;
  category?: ItemCategory;
  imageUrl?: string;
  details?: ItemDetails;
  price?: ItemPrice;
}

export interface ItemCreatedPayload {
  item: Item;
}

export interface ItemUpdatedPayload {
  item: Item;
  changes: Record<string, unknown>;
}

export interface ItemDeletedPayload {
  itemId: string;
}

/** --- Apresentação de imagens ------------------------------------------------ */

/** Imagem que o mestre está mostrando para a mesa. */
export interface Presentation {
  id: string;
  imageUrl: string;
  alt: string;
  presentedBy: string;
  at: string;
}

export interface PresentationShownPayload {
  presentation: Presentation;
}

export interface PresentationClosedPayload {
  /** `null` quando o servidor reenvia um fechamento sem apresentação aberta. */
  presentationId: string | null;
}

/** --- Combate ---------------------------------------------------------------- */

export type CombatStatus = 'PENDING_INITIATIVE' | 'ACTIVE' | 'ENDED';
export type CombatantKind = 'CHARACTER' | 'CREATURE';

export interface CombatantDto {
  id: string;
  kind: CombatantKind;
  characterId: string | null;
  creatureId: string | null;
  name: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  /** Avatar do personagem ou ícone da criatura (null = sem imagem). */
  imageUrl: string | null;
  dexterityMod: number;
  initiative: number | null;
  initiativeRoll: number | null;
  /** `null` quando a vida/CA está oculta para quem vê (criatura vista por jogador). */
  hpCurrent: number | null;
  hpMax: number | null;
  armorClass: number | null;
  /** Verdadeiro quando a vida/CA existem, mas ficam ocultas para quem vê. */
  statsHidden: boolean;
  missing: boolean;
  rolled: boolean;
}

export interface CombatDto {
  id: string;
  status: CombatStatus;
  round: number;
  currentIndex: number;
  currentCombatantId: string | null;
  localityId: string | null;
  localityName: string | null;
  combatants: CombatantDto[];
  createdAt: string;
  endedAt: string | null;
}

export interface CombatStartedPayload {
  combat: CombatDto;
}

export interface CombatUpdatedPayload {
  combat: CombatDto;
}

export interface CombatTurnPayload {
  combatId: string;
  combatantId: string;
  combatantName: string;
  ownerUserId: string | null;
  round: number;
  index: number;
}

export interface CombatEndedPayload {
  combatId: string;
}

export interface DiceRolledPayload {
  kind: 'initiative' | 'attack' | 'damage';
  actorName: string;
  expression: string;
  rolls: number[];
  sides: number;
  modifier: number;
  total: number;
  crit: boolean;
  at: string;
}

/** --- Janela de dados (rolagem livre, perícia e salvaguarda) ----------------- */

export type DiceRollKind = 'skill' | 'save' | 'free' | 'creation' | 'item';

/** Um dado já rolado (espelha src/modules/dice/dice.dto.ts). */
export interface RolledDie {
  sides: number;
  value: number;
  /** Descartado por vantagem/desvantagem. */
  dropped?: boolean;
}

export interface DiceRollDto {
  id: string;
  /** Dono da rolagem — casa a rolagem com o tabuleiro anunciado. */
  actorUserId: string;
  clientId: string | null;
  actorName: string;
  kind: DiceRollKind;
  label: string;
  dice: RolledDie[];
  bonus: number;
  total: number;
  advantage: boolean;
  disadvantage: boolean;
  isPrivate: boolean;
  crit: boolean;
  at: string;
}

export interface TableRollPayload {
  roll: DiceRollDto;
}

/**
 * Janela de dados aberta (ou fechada) por alguém da mesa.
 *
 * `active: false` chega quando quem rolou fecha a janela, marca a rolagem como
 * privada ou sai da mesa no meio dela.
 */
export interface TableRollActivePayload {
  active: boolean;
  userId: string;
  actorName: string;
  /** Avatar do personagem (`''` quando não há imagem). */
  avatarUrl: string;
  kind: DiceRollKind;
  label: string;
  /** Tabuleiro montado por quem está rolando. */
  board: RollBoardDto;
  /**
   * Última rolagem do tabuleiro (desde a última mexida no pool).
   *
   * É o que garante que quem sincroniza no meio da rolagem — recarrega a
   * página, reconecta — veja o resultado, e não só os dados parados na tela.
   */
  lastRoll: DiceRollDto | null;
  /** Momento da última mudança de estado (referência da animação de queda). */
  at: string;
}

/** Um dado do pool do tabuleiro. */
export interface RollBoardDie {
  sides: number;
  /** d20 fixo da rolagem de perícia/salvaguarda. */
  locked: boolean;
}

/** O tabuleiro de rolagem, como quem está rolando o montou. */
export interface RollBoardDto {
  pool: RollBoardDie[];
  advantage: boolean;
  disadvantage: boolean;
  bonus: number;
  /** `tumbling` = os dados estão rolando agora. */
  phase: 'idle' | 'tumbling';
}

/** Aviso enviado ao servidor quando o tabuleiro muda (abre, mexe no pool, rola). */
export interface TableRollActiveRequest {
  active: boolean;
  label?: string;
  kind?: DiceRollKind;
  private?: boolean;
  pool?: RollBoardDie[];
  advantage?: boolean;
  disadvantage?: boolean;
  bonus?: number;
}

/** Pedido de rolagem enviado ao servidor. */
export interface TableRollRequest {
  dice: { sides: number }[];
  advantage?: boolean;
  disadvantage?: boolean;
  bonus?: number;
  label?: string;
  kind?: DiceRollKind;
  private?: boolean;
  clientId?: string;
}

export interface AttackResolvedPayload {
  attackerName: string;
  attackName: string;
  targetName: string;
  attackRoll: number;
  attackBonus: number;
  attackTotal: number;
  /** `null` quando o alvo é uma criatura e quem vê é um jogador. */
  targetArmorClass: number | null;
  hit: boolean;
  critical: boolean;
  damageRolled: number;
  damageType: string;
  /** Dano extra de Ataque Furtivo já somado a `damageRolled` (nulo se não houve). */
  sneakAttack: { expression: string; total: number } | null;
  targetHpCurrent: number | null;
  targetHpMax: number | null;
  /** Verdadeiro quando CA/vida do alvo ficam ocultas para quem vê. */
  targetStatsHidden: boolean;
  at: string;
}
