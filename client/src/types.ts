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

export type SkillsState = Record<string, SkillEntry>;
export type SavesState = Record<AbilityKey, boolean>;

/** Atributos de item por categoria (espelha src/modules/shared/item-details.ts). */
export interface ItemDetails {
  damageCount?: number;
  damageDie?: number;
  damageType?: string;
  attackBonus?: number;
  spellcastingFocus?: boolean;
  armorClassBonus?: number;
  effectRoll?: string;
  duration?: string;
  attunement?: boolean;
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

export interface Attack {
  id: string;
  name: string;
  damage: string;
  damageType: string;
  attackBonus: number;
  notes: string;
  /** Arma sutil (habilita Ataque Furtivo). */
  finesse: boolean;
  /** Arma à distância (habilita Ataque Furtivo). */
  ranged: boolean;
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
  /** Máximo de magias preparadas (conjuradores preparados) ou nulo. */
  preparedSpellCount: number | null;
  initiative: number;
  passivePerception: number;
  armorClassHint: number;
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
}

/** Característica de classe ou subclasse (ainda não populadas). */
export interface ClassFeature {
  id: string;
  name: string;
  level: number;
  description: string;
  effect?: ClassFeatureEffect;
  effects?: ClassFeatureEffect[];
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
  features: ClassFeature[];
}

/** Feature de classe/subclasse já liberada pelo nível atual. */
export interface ActiveClassFeature extends ClassFeature {
  source: 'class' | 'subclass';
  subclassName?: string;
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

/** Opção de classe para o seletor, com a elegibilidade do personagem calculada. */
export interface ClassOption extends ClassSummary {
  eligible: boolean;
  /** Motivo do bloqueio ('' quando elegível). */
  missing: string;
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  /** Nomes das subclasses disponíveis. */
  subclassNames: string[];
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
  /** Ajustes mecânicos derivados das features (Fúria, resistências, etc.). */
  classAdjustments: ClassAdjustments;
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
  armorClass: number;
  initiativeBonus: number;
  speed: number;

  skills: SkillsState;
  saves: SavesState;
  inventory: InventoryItem[];
  spells: SpellsState;
  attacks: Attack[];
  features: Feature[];

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
  martialArtsDie: number;
  hpBonus: number;
  wildShapeCr: number | null;
  wildShapeFlying: boolean;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  abilityCaps: Partial<Record<AbilityKey, number>>;
}

/** Configuração global da mesa (Level Up liberado pelo mestre). */
export interface GameConfig {
  levelUpUnlocked: boolean;
  levelUpRelease: number;
  updatedAt: string;
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
  /** Talento escolhido (registro textual; sem efeito mecânico ainda). */
  feat?: { name: string; description: string } | null;
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
  armorClass?: number;
  initiativeBonus?: number;
  speed?: number;

  skills?: SkillsState;
  saves?: SavesState;
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
  'Item Geral',
  'Tesouro',
  'Outro',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

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

export type DiceRollKind = 'skill' | 'save' | 'free';

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
  phase?: 'idle' | 'tumbling';
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
