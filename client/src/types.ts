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
  initiative: number;
  passivePerception: number;
  armorClassHint: number;
  carryingCapacity: number;
  totalWeight: number;
  saves: SaveDetail[];
  skills: Record<string, SkillDetail>;
  spellcasting: { ability: AbilityKey; saveDC: number; attackBonus: number } | null;
}

/** Ficha completa devolvida pela API. */
export interface Character {
  id: string;
  userId: string;
  ownerUsername?: string;

  name: string;
  race: string;
  className: string;
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
