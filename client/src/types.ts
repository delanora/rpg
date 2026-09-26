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

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  weight: number;
  equipped: boolean;
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
  initiative: number;
  passivePerception: number;
  armorClassHint: number;
  carryingCapacity: number;
  totalWeight: number;
  saves: SaveDetail[];
  skills: Record<string, SkillDetail>;
  spellcasting: { ability: AbilityKey; saveDC: number; attackBonus: number } | null;
}

/** --- Classes (ver src/modules/shared/classes.ts) --------------------------- */

export type SpellcastingType = 'none' | 'full' | 'half' | 'third' | 'pact';
export type SpellLearning = 'known' | 'prepared' | 'none';

export interface ClassFeatureResource {
  name: string;
  max: number;
  recharge: 'short' | 'long' | 'none';
}

/** Efeito mecânico opcional de uma característica de classe. */
export interface ClassFeatureEffect {
  type: 'bonus' | 'resource' | 'save' | 'expertise' | 'sneakAttack' | 'other';
  target?: string;
  value?: number;
  ability?: AbilityKey;
  resource?: ClassFeatureResource;
  notes?: string;
}

/** Característica de classe ou subclasse (ainda não populadas). */
export interface ClassFeature {
  id: string;
  name: string;
  level: number;
  description: string;
  effect?: ClassFeatureEffect;
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

/** Ficha completa devolvida pela API. */
export interface Character {
  id: string;
  userId: string;
  ownerUsername?: string;

  name: string;
  race: string;
  className: string;
  /** Chave canônica da classe ('' = sem classe). */
  classKey: string;
  /** Subclasse escolhida ('' = nenhuma). */
  subclass: string;
  /** Definição completa da classe escolhida (nula se nenhuma). */
  classDefinition: ClassDefinition | null;
  /** Catálogo resumido das 12 classes. */
  classCatalog: ClassSummary[];
  /** Features de classe/subclasse já liberadas pelo nível atual. */
  activeFeatures: ActiveClassFeature[];
  level: number;
  background: string;
  alignment: string;
  experience: number;

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
export interface CharacterPatch {
  name?: string;
  race?: string;
  className?: string;
  classKey?: string;
  subclass?: string;
  level?: number;
  background?: string;
  alignment?: string;
  experience?: number;

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

  notes?: string;
}

export type CreatureKind = 'CREATURE' | 'NPC';

/** Imagem de uma localidade (arquivo servido em `/uploads/...`). */
export interface LocalityImage {
  url: string;
  name: string;
}

/** Versão enxuta usada dentro de criaturas/NPCs e do combate. */
export interface LocalitySummary {
  id: string;
  name: string;
}

/** Localidade do mundo (cidade, masmorra, taverna...). */
export interface Locality {
  id: string;
  name: string;
  description: string;
  images: LocalityImage[];
  creatureCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalityPatch {
  name?: string;
  description?: string;
  images?: LocalityImage[];
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
}

/** Payload do evento `sheet:updated` recebido pelo WebSocket. */
export interface SheetUpdatedPayload {
  userId: string;
  username: string;
  characterId: string;
  version: number;
  changes: Record<string, unknown>;
  character: Character;
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
