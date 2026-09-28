/**
 * Criação de personagem (assistente em 9 passos).
 *
 * Aqui fica o que é DADO da criação, separado das regras de ficha:
 *
 * - os passos do assistente e o que cada um exige;
 * - o rascunho que vive no JSONB `characters.creationDraft` (modo escolhido,
 *   passo alcançado, as rolagens de 4d6 e os valores-base dos atributos);
 * - os catálogos de raças e antecedentes.
 *
 * Os catálogos ainda estão VAZIOS: enquanto não existirem, o assistente pede o
 * texto livre (raça/antecedente) e nenhum bônus racial é aplicado. A estrutura
 * já é a final — basta preencher `RACE_CATALOG`/`BACKGROUND_CATALOG` com o
 * conteúdo do livro que o passo passa a selecionar em vez de digitar e os
 * bônus de atributo/perícias entram em vigor sozinhos (ver
 * `racialAbilityBonuses` e o uso em creation.service.ts).
 */

import { ABILITY_KEYS, type AbilityKey } from './dnd5e.js';

// ---------------------------------------------------------------------------
// Passos do assistente
// ---------------------------------------------------------------------------

/** Passos, na ordem em que o jogador os percorre. O índice + 1 é o número do passo. */
export const CREATION_STEPS = [
  { id: 'mode', label: 'Tipo de personagem' },
  { id: 'identity', label: 'Identidade' },
  { id: 'race', label: 'Raça' },
  { id: 'background', label: 'Antecedente' },
  { id: 'class', label: 'Classe' },
  { id: 'abilities', label: 'Atributos' },
  { id: 'skills', label: 'Perícias' },
  { id: 'level', label: 'Nível e progressão' },
  { id: 'review', label: 'Revisão' },
] as const;

export type CreationStepId = (typeof CREATION_STEPS)[number]['id'];

/** Primeiro e último passo (1-based, como o cliente numera). */
export const CREATION_FIRST_STEP = 1;
export const CREATION_LAST_STEP = CREATION_STEPS.length;

/** Quantos valores de atributo o jogador precisa ter (um por atributo). */
export const CREATION_ABILITY_COUNT = ABILITY_KEYS.length;

/** Quantos dados por rolagem de atributo e quantos são descartados. */
export const CREATION_ROLL_DICE = 4;
export const CREATION_ROLL_DISCARD = 1;

/** Rótulo da rolagem no histórico do mestre. */
export const CREATION_ROLL_LABEL = 'Criação de personagem';

// ---------------------------------------------------------------------------
// Catálogos de raça e antecedente
// ---------------------------------------------------------------------------

/** Uma raça do catálogo (vazio enquanto o conteúdo do livro não é cadastrado). */
export interface RaceOption {
  key: string;
  name: string;
  description?: string;
  /** Bônus racial fixo aplicado aos atributos (ex.: Anão: CON +2). */
  abilityBonuses?: Partial<Record<AbilityKey, number>>;
}

/** Um antecedente do catálogo. */
export interface BackgroundOption {
  key: string;
  name: string;
  description?: string;
  /** Perícias concedidas pelo antecedente (chaves de `SKILLS`). */
  skills?: string[];
}

/** Raças do catálogo. Vazio: o assistente usa texto livre (ver o cabeçalho). */
export const RACE_CATALOG: readonly RaceOption[] = [];

/** Antecedentes do catálogo. Vazio: o assistente usa texto livre. */
export const BACKGROUND_CATALOG: readonly BackgroundOption[] = [];

/** Busca a raça pelo `key` ou pelo nome digitado (aceita caixa diferente). */
export function findRace(value: string): RaceOption | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return (
    RACE_CATALOG.find(
      (race) => race.key.toLowerCase() === needle || race.name.toLowerCase() === needle,
    ) ?? null
  );
}

/** Busca o antecedente pelo `key` ou pelo nome digitado. */
export function findBackground(value: string): BackgroundOption | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return (
    BACKGROUND_CATALOG.find(
      (background) =>
        background.key.toLowerCase() === needle || background.name.toLowerCase() === needle,
    ) ?? null
  );
}

/**
 * Bônus racial de atributo da raça escolhida. Sem catálogo (ou raça fora dele)
 * não há bônus — é o único ponto que precisa mudar quando o conteúdo entrar.
 */
export function racialAbilityBonuses(race: string): Partial<Record<AbilityKey, number>> {
  return findRace(race)?.abilityBonuses ?? {};
}

/** Perícias concedidas pelo antecedente escolhido (vazio sem catálogo). */
export function backgroundSkills(background: string): string[] {
  return findBackground(background)?.skills ?? [];
}

// ---------------------------------------------------------------------------
// Rascunho (JSONB `characters.creationDraft`)
// ---------------------------------------------------------------------------

/** Como o jogador está montando o personagem. */
export type CreationMode = 'new' | 'existing';

/** Uma rolagem de 4d6: os quatro valores e o índice do dado descartado. */
export interface CreationRoll {
  dice: number[];
  dropped: number;
}

export interface CreationDraft {
  /** Nulo até o primeiro passo ser respondido. */
  mode: CreationMode | null;
  /** Passo alcançado (retomada). Sempre entre 1 e o último passo. */
  step: number;
  /** Rolagens já feitas (no máximo seis — uma por atributo). */
  rolls: CreationRoll[];
  /** Valores BASE digitados/rolados, ANTES dos bônus raciais. */
  baseAbilities: Partial<Record<AbilityKey, number>>;
  /**
   * Perícias escolhidas NA CLASSE. As concedidas pelo antecedente entram por
   * fora desta lista (ver `backgroundSkills`), então trocar de antecedente não
   * consome — nem devolve — as escolhas da classe.
   */
  skillPicks: string[];
}

export const EMPTY_CREATION_DRAFT: CreationDraft = {
  mode: null,
  step: CREATION_FIRST_STEP,
  rolls: [],
  baseAbilities: {},
  skillPicks: [],
};

function isAbilityKey(value: string): value is AbilityKey {
  return (ABILITY_KEYS as readonly string[]).includes(value);
}

/** Lê/normaliza o rascunho vindo do JSONB, descartando lixo. */
export function normalizeCreationDraft(input: unknown): CreationDraft {
  const source = (input ?? {}) as Partial<CreationDraft> & Record<string, unknown>;

  const mode = source.mode === 'new' || source.mode === 'existing' ? source.mode : null;

  const step =
    typeof source.step === 'number' && Number.isFinite(source.step)
      ? Math.min(CREATION_LAST_STEP, Math.max(CREATION_FIRST_STEP, Math.floor(source.step)))
      : CREATION_FIRST_STEP;

  const rolls: CreationRoll[] = [];
  if (Array.isArray(source.rolls)) {
    for (const raw of source.rolls.slice(0, CREATION_ABILITY_COUNT)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { dice?: unknown; dropped?: unknown };
      if (!Array.isArray(item.dice) || item.dice.length !== CREATION_ROLL_DICE) continue;

      const dice = item.dice
        .map((value) => (typeof value === 'number' ? Math.floor(value) : NaN))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 6);
      if (dice.length !== CREATION_ROLL_DICE) continue;

      const dropped =
        typeof item.dropped === 'number' && item.dropped >= 0 && item.dropped < CREATION_ROLL_DICE
          ? Math.floor(item.dropped)
          : lowestIndex(dice);

      rolls.push({ dice, dropped });
    }
  }

  const baseAbilities: Partial<Record<AbilityKey, number>> = {};
  if (source.baseAbilities && typeof source.baseAbilities === 'object') {
    for (const [key, value] of Object.entries(source.baseAbilities as Record<string, unknown>)) {
      if (!isAbilityKey(key)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      baseAbilities[key] = Math.floor(value);
    }
  }

  const skillPicks = Array.isArray(source.skillPicks)
    ? source.skillPicks
        .filter((key): key is string => typeof key === 'string')
        .slice(0, CREATION_ABILITY_COUNT * 2)
    : [];

  return { mode, step, rolls, baseAbilities, skillPicks };
}

/** Índice do menor dado (o descartado na rolagem de 4d6). */
export function lowestIndex(dice: number[]): number {
  let index = 0;
  for (let position = 1; position < dice.length; position += 1) {
    if (dice[position] < dice[index]) index = position;
  }
  return index;
}

/** Valor da rolagem: a soma dos dados sem o descartado. */
export function rollValue(roll: CreationRoll): number {
  return roll.dice.reduce((sum, value, index) => (index === roll.dropped ? sum : sum + value), 0);
}

/** Os valores rolados (na ordem), para o jogador distribuir entre os atributos. */
export function rollValues(rolls: CreationRoll[]): number[] {
  return rolls.map(rollValue);
}
