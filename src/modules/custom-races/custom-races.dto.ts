import type { AbilityKey } from '../shared/dnd5e.js';
import type { RaceOption, RaceChoiceView } from '../shared/creation.js';

/** Incremento fixo de atributo de uma raça personalizada. */
export interface CustomRaceAbilityIncreaseDto {
  ability: AbilityKey;
  amount: number;
}

/** Traço em texto livre de uma raça personalizada. */
export interface CustomRaceTraitDto {
  name: string;
  description: string;
}

/** Raça PERSONALIZADA do mestre, no formato entregue ao cliente. */
export interface CustomRaceDto {
  id: string;
  name: string;
  description: string;
  abilityScoreIncrease: CustomRaceAbilityIncreaseDto[];
  /** Deslocamento em metros. */
  speed: number;
  size: 'Small' | 'Medium';
  /** Visão no escuro em metros (0 = sem). */
  darkvision: number;
  /** Tipos de dano resistidos (13 canônicos). */
  damageResistances: string[];
  languages: string[];
  bonusLanguageChoices: number;
  traits: CustomRaceTraitDto[];
  version: number;
}

/** Formato do compêndio: uma raça personalizada como uma linhagem. */
export interface CustomRaceAsOption extends RaceOption {}

/** Tipo auxiliar para as escolhas (sempre vazias nas personalizadas). */
export type CustomRaceChoice = RaceChoiceView;
