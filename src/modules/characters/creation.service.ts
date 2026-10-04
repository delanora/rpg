import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { rollTableDice } from '../dice/dice.service.js';
import {
  BACKGROUND_CATALOG,
  CREATION_ABILITY_COUNT,
  CREATION_FIRST_STEP,
  CREATION_LAST_STEP,
  CREATION_ROLL_DICE,
  CREATION_ROLL_LABEL,
  EMPTY_CREATION_DRAFT,
  RACE_CATALOG,
  backgroundLanguageGrants,
  backgroundSkills,
  backgroundToolGrants,
  findBackground,
  lowestIndex,
  normalizeCreationDraft,
  raceChoiceCount,
  raceChoicePool,
  rollValues,
  type BackgroundOption,
  type CreationDraft,
  type CreationMode,
  type CreationRoll,
  type RaceOption,
} from '../shared/creation.js';
import { isLanguageName } from '../shared/languages.js';
import {
  raceDamageResistances,
  raceDarkvision,
  raceFixedAbilityBonuses,
  raceLanguages,
  raceSkillProficiencies,
  raceSpeed,
  raceToolProficiencies,
} from '../shared/races/index.js';
import {
  findCustomRace,
  listCustomRaceOptions,
  toCustomRaceDto,
} from '../custom-races/custom-races.service.js';
import {
  classSkillChoice,
  creationSkillChoice,
  expertiseOptionsFor,
  expertiseSkillsState,
  featureChoiceInfo,
  featuresWithSubclass,
  getClassDefinition,
  multiclassPrerequisiteLabel,
  normalizeClassEntries,
  normalizeClassState,
  normalizeProficiencies,
  pendingFeatureChoices,
  resolveFeatureChoices,
  totalCharacterLevel,
  type FeatureChoiceInfo,
  type FeatureChoiceOption,
  type FeatureChoiceOptionsOverride,
} from '../shared/classes.js';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  ABILITY_SCORE_MAX,
  ABILITY_SCORE_MIN,
  SKILL_KEYS,
  SKILL_LABELS,
  normalizeSkills,
  type AbilityKey,
} from '../shared/dnd5e.js';
import { getGameConfig } from '../game-config/game-config.service.js';
import {
  createCharacter,
  levelUpDraft,
  setCreationFinalized,
  toSheetDto,
  updateDraftSheet,
  type Actor,
} from './characters.service.js';
import type { CharacterDto } from './characters.dto.js';
import { featureSchema } from './characters.schema.js';
import type {
  CreationRollRequestInput,
  CreationStepInput,
  LevelUpInput,
  UpdateCharacterInput,
} from './characters.schema.js';

/**
 * Assistente de criação de personagem.
 *
 * O RASCUNHO é o próprio registro de `Character` com `creationFinalized = false`:
 * criado no primeiro passo, salvo a cada passo concluído (nome, raça,
 * antecedente, classe, atributos e perícias vão para os campos da ficha) e
 * complementado pelo JSONB `creationDraft` (modo escolhido, passo alcançado, as
 * rolagens de 4d6, os valores-base dos atributos e as perícias escolhidas).
 * Fechar o navegador não perde nada: ao voltar, o jogador retoma de onde parou.
 *
 * Nada aqui inventa regra: as validações de classe, pré-requisito de atributo,
 * PV inicial, salvaguardas e perícias passam pelo mesmo caminho da ficha
 * (`updateDraftSheet` → characters.service.ts) e os níveis iniciais da mesa
 * usam o mesmo assistente de Level Up (`levelUpDraft`).
 */

/** Nome padrão da ficha recém-criada — enquanto for este, o passo 2 não foi feito. */
const DEFAULT_CHARACTER_NAME = 'novo personagem';

/** O que o assistente precisa saber sobre o estado atual da criação. */
export interface CreationStateDto {
  /** Modo escolhido no passo 1 (null enquanto não respondido). */
  mode: CreationMode | null;
  /** Passo alcançado (retomada). O cliente abre o wizard aqui. */
  step: number;
  /** Rolagens de 4d6 já feitas (até seis). */
  rolls: CreationRoll[];
  /** Valores-base dos atributos (antes dos bônus raciais). */
  baseAbilities: Partial<Record<AbilityKey, number>>;
  /** Perícias escolhidas na classe. */
  skillPicks: string[];
  /** Atributos escolhidos para os `+1` da raça (Meio-Elfo escolhe dois). */
  abilityChoices: AbilityKey[];
  /** Idiomas escolhidos quando a raça concede idioma(s) à escolha. */
  languageChoices: string[];
  /** Ferramentas escolhidas nas categorias do antecedente: `{ escolha: id }`. */
  backgroundToolChoices: Record<string, string>;
  /** Idiomas escolhidos quando o antecedente concede idioma(s) à escolha. */
  backgroundLanguageChoices: string[];
  /** Perícias que a classe do rascunho oferece (quantas e quais). */
  skillChoice: { count: number; from: string[] };
  /**
   * Perícias que a RAÇA já concede (fixas ou pelas escolhas dela, ex.: Meio-Elfo)
   * — o passo 7 as mostra marcadas e travadas, sem gastar escolhas da classe.
   */
  raceSkillKeys: string[];
  /**
   * Escolhas de característica do NÍVEL 1 da classe inicial (Estilo de Luta do
   * guerreiro, Inimigo Favorito e Explorador Nato do patrulheiro) — com as
   * opções e o que já foi escolhido.
   */
  featureChoices: FeatureChoiceInfo[];
  /**
   * Expertise do NÍVEL 1 da classe inicial (Ladino) — pedida no passo das
   * perícias, quando já dá para saber o que o personagem domina.
   */
  expertiseChoices: FeatureChoiceInfo[];
  /** Nível em que a mesa começa: o passo 8 aplica os níveis 2 até ele. */
  startingLevel: number;
  /** Catálogos (vazios enquanto o conteúdo não for cadastrado). */
  raceCatalog: RaceOption[];
  backgroundCatalog: BackgroundOption[];
  /** O que ainda falta para poder finalizar (vazio = pronto). */
  missing: string[];
}

export interface CreationState {
  character: CharacterDto | null;
  creation: CreationStateDto;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Atributos gravados na ficha, no formato das regras. */
function abilitiesOf(character: Character): Record<AbilityKey, number> {
  return {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
}

/** Bônus de atributo de uma raça já escolhida: fixos + os `+1` à escolha. */
function bonusesFromOption(
  option: RaceOption,
  choices: readonly AbilityKey[],
): Partial<Record<AbilityKey, number>> {
  const bonuses: Partial<Record<AbilityKey, number>> = { ...(option.abilityBonuses ?? {}) };
  const take = option.abilityChoice ?? 0;
  for (const ability of choices.slice(0, take)) {
    bonuses[ability] = (bonuses[ability] ?? 0) + 1;
  }
  return bonuses;
}

/** Lê `raceChoices` (JSONB cru) como um mapa `{ escolha: opção }`. */
function parseRaceChoices(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** Lê as características gravadas na ficha (JSONB cru), descartando lixo. */
function parseFeatures(input: unknown): ReturnType<typeof featureSchema.parse>[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const parsed = featureSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Bônus de atributo da raça GRAVADA na ficha (para recalcular os valores-BASE).
 * As raças personalizadas buscam os incrementos no banco; as do catálogo fixo
 * somam os `+1` às escolhas do rascunho.
 */
async function bonusesForCharacter(
  character: Character,
  abilityChoices: readonly AbilityKey[],
): Promise<Partial<Record<AbilityKey, number>>> {
  if (character.customRaceId) {
    const race = await findCustomRace(character.customRaceId);
    const bonuses: Partial<Record<AbilityKey, number>> = {};
    for (const increase of toCustomRaceDto(race).abilityScoreIncrease) {
      bonuses[increase.ability] = (bonuses[increase.ability] ?? 0) + increase.amount;
    }
    return bonuses;
  }

  const bonuses = raceFixedAbilityBonuses({
    raceId: character.raceId,
    subraceId: character.subraceId,
  });
  for (const ability of abilityChoices) {
    bonuses[ability] = (bonuses[ability] ?? 0) + 1;
  }
  return bonuses;
}

/**
 * Bônus raciais aplicados aos valores-BASE: os atributos gravados são sempre
 * base + raça, então trocar de raça (ou voltar ao passo 3) recalcula tudo a
 * partir do rascunho, sem perder o que o jogador digitou/rolou.
 */
function abilitiesPatchFrom(
  bonuses: Partial<Record<AbilityKey, number>>,
  base: Partial<Record<AbilityKey, number>>,
): Partial<Record<AbilityKey, number>> {
  const patch: Partial<Record<AbilityKey, number>> = {};

  for (const ability of ABILITY_KEYS) {
    const value = base[ability];
    if (value === undefined) continue;
    patch[ability] = clamp(
      value + (bonuses[ability] ?? 0),
      ABILITY_SCORE_MIN,
      ABILITY_SCORE_MAX,
    );
  }

  return patch;
}

/** Valores-BASE a partir dos atributos gravados (descontando os bônus raciais). */
function baseAbilitiesOf(
  character: Character,
  bonuses: Partial<Record<AbilityKey, number>>,
): Partial<Record<AbilityKey, number>> {
  const abilities = abilitiesOf(character);
  const base: Partial<Record<AbilityKey, number>> = {};

  for (const ability of ABILITY_KEYS) {
    base[ability] = clamp(
      abilities[ability] - (bonuses[ability] ?? 0),
      ABILITY_SCORE_MIN,
      ABILITY_SCORE_MAX,
    );
  }

  return base;
}

/**
 * Acha a opção de raça (fixa ou personalizada) pelo nome ou pela chave. As
 * personalizadas entram em `catalog` já convertidas em `RaceOption`.
 */
function matchRaceOption(catalog: readonly RaceOption[], value: string): RaceOption | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return (
    catalog.find(
      (option) => option.key.toLowerCase() === needle || option.name.toLowerCase() === needle,
    ) ?? null
  );
}

/** O que a raça concede à ficha, já resolvido (fixa ou personalizada). */
interface RaceGrants {
  speed: number;
  darkvision: number;
  resistances: string[];
  languages: string[];
  skills: string[];
  tools: string[];
}

/** Resolve os efeitos da raça gravada (fixa ou personalizada). */
async function raceGrants(input: {
  raceId: string | null;
  subraceId: string | null;
  customRaceId: string | null;
  choices: Record<string, string>;
}): Promise<RaceGrants> {
  if (input.customRaceId) {
    const race = await findCustomRace(input.customRaceId);
    const dto = toCustomRaceDto(race);
    return {
      speed: dto.speed,
      darkvision: dto.darkvision,
      resistances: dto.damageResistances,
      languages: dto.languages,
      skills: [],
      tools: [],
    };
  }

  return {
    speed: raceSpeed(input),
    darkvision: raceDarkvision(input),
    resistances: raceDamageResistances(input),
    languages: raceLanguages(input),
    skills: raceSkillProficiencies(input),
    tools: raceToolProficiencies(input),
  };
}

/** Resolve os efeitos da raça atualmente gravada na ficha. */
async function characterRaceGrants(character: Character): Promise<RaceGrants> {
  return raceGrants({
    raceId: character.raceId,
    subraceId: character.subraceId,
    customRaceId: character.customRaceId,
    choices: parseRaceChoices(character.raceChoices),
  });
}

/** Perícias concedidas pela raça atualmente gravada na ficha. */
async function characterRaceSkills(character: Character): Promise<string[]> {
  return (await characterRaceGrants(character)).skills;
}

/**
 * Ferramentas da ficha do rascunho: as da RAÇA (fixas e escolhidas) mais as do
 * ANTECEDENTE (fixas e escolhidas por categoria). É DERIVADO — recalculado a
 * cada passo, para voltar ao passo 3 (ou 4) não perder o que o outro concedeu.
 */
function resolvedTools(
  raceTools: readonly string[],
  background: string,
  toolChoices: Record<string, string>,
): string[] {
  return [...new Set([...raceTools, ...backgroundToolGrants(background, toolChoices)])];
}

/**
 * Idiomas da ficha do rascunho: os FIXOS e escolhidos da raça mais os escolhidos
 * do antecedente. Também DERIVADO (mesma razão das ferramentas).
 */
function resolvedLanguages(
  raceFixed: readonly string[],
  raceChoices: readonly string[],
  background: string,
  backgroundChoices: readonly string[],
): string[] {
  return [
    ...new Set([
      ...raceFixed,
      ...raceChoices,
      ...backgroundLanguageGrants(background, backgroundChoices),
    ]),
  ];
}

/** A ficha do rascunho (criada no primeiro passo) ou erro se a criação já fechou. */
async function requireDraft(actor: Actor): Promise<Character> {
  const existing = await prisma.character.findUnique({ where: { userId: actor.userId } });

  if (existing && existing.creationFinalized) {
    throw new HttpError(
      'A criação deste personagem já foi finalizada — só o mestre pode reabri-la.',
      409,
    );
  }

  if (existing) return existing;

  // O rascunho nasce no PRIMEIRO passo do assistente; a criação da ficha em si
  // continua sendo a mesma função de sempre (e o mestre já vê a ficha na lista).
  await createCharacter(actor, {});
  return prisma.character.findUniqueOrThrow({ where: { userId: actor.userId } });
}

/**
 * Opções de Expertise com a ficha em mãos: tudo o que o personagem JÁ domina —
 * as perícias marcadas e as ferramentas dela (PHB: só se dobra uma proficiência
 * existente). Usada pelo passo das perícias, quando a escolha é pedida.
 */
function creationExpertiseOptions(character: Character): FeatureChoiceOption[] {
  const skills = normalizeSkills(character.skills);
  return expertiseOptionsFor(
    Object.entries(skills)
      .filter(([, entry]) => entry.proficient)
      .map(([key]) => key),
    normalizeProficiencies(character.proficiencies).tools,
  );
}

/**
 * Estado de perícias: as escolhidas na classe + as do antecedente + as da raça
 * (perícias raciais fixas ou resolvidas pelas escolhas, ex.: Meio-Elfo).
 */
function skillsPatch(
  character: Character,
  picks: string[],
  background: string,
  raceSkills: readonly string[] = [],
): Record<string, { proficient: boolean; expertise: boolean }> {
  const granted = backgroundSkills(background);
  const current = normalizeSkills(character.skills);
  const next: Record<string, { proficient: boolean; expertise: boolean }> = {};

  for (const key of SKILL_KEYS) {
    next[key] = {
      proficient:
        picks.includes(key) || granted.includes(key) || raceSkills.includes(key),
      expertise: current[key]?.expertise ?? false,
    };
  }

  return next;
}

/** Confere as perícias do passo 7 contra a lista e a quantidade da classe. */
function validateSkillPicks(character: Character, picks: string[]): void {
  const choice = creationSkillChoice(normalizeClassEntries(character.classes));

  const unknown = picks.filter((key) => !SKILL_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(`Perícia desconhecida: ${unknown.join(', ')}.`, 400);
  }

  const outside = choice.from.length > 0 ? picks.filter((key) => !choice.from.includes(key)) : [];
  if (outside.length > 0) {
    throw new HttpError(
      `Fora da lista da classe: ${outside.map((key) => SKILL_LABELS[key] ?? key).join(', ')}.`,
      400,
    );
  }

  if (choice.count === 0) return;
  if (picks.length < choice.count) {
    throw new HttpError(`Escolha ${choice.count} perícia(s) para a classe escolhida.`, 400);
  }
  if (picks.length > choice.count) {
    throw new HttpError(
      `A classe escolhida concede ${choice.count} perícia(s) — escolha exatamente esse tanto.`,
      400,
    );
  }
}

/** Confere os valores do passo 6 conforme o modo escolhido. */
function validateAbilities(
  draft: CreationDraft,
  base: Partial<Record<AbilityKey, number>>,
  current: Partial<Record<AbilityKey, number>>,
): void {
  if (draft.mode === 'new') {
    if (draft.rolls.length < CREATION_ABILITY_COUNT) {
      throw new HttpError(
        `Role os ${CREATION_ABILITY_COUNT} valores (4d6 descartando o menor) antes de distribuir.`,
        400,
      );
    }

    // Os seis valores distribuídos têm de ser EXATAMENTE os seis rolados.
    const rolled = [...rollValues(draft.rolls)].sort((a, b) => a - b);
    const chosen = ABILITY_KEYS.map((ability) => base[ability] ?? 0).sort((a, b) => a - b);
    if (rolled.some((value, index) => value !== chosen[index])) {
      throw new HttpError('Distribua exatamente os seis valores rolados, um por atributo.', 400);
    }
    return;
  }

  // Modo "personagem existente": o jogador digita os valores (1 a 20). Uma ficha
  // reaberta pelo mestre pode ter valores acima disso (melhorias de nível já
  // aplicadas) — nesse caso o valor que já estava na ficha passa como está.
  for (const ability of ABILITY_KEYS) {
    const value = base[ability];
    if (value === undefined) continue;
    if (value >= ABILITY_SCORE_MIN && value <= 20) continue;
    if (value === current[ability]) continue;

    throw new HttpError(
      `O valor de ${ABILITY_LABELS[ability]} na criação fica entre ${ABILITY_SCORE_MIN} e 20.`,
      400,
    );
  }
}

/** O que ainda falta para o personagem poder ser finalizado. */
function missingForFinalize(character: Character, draft: CreationDraft): string[] {
  const missing: string[] = [];
  const entries = normalizeClassEntries(character.classes);

  if (draft.mode === null) missing.push('o tipo de personagem (passo 1)');
  if (!character.name.trim() || character.name.trim().toLowerCase() === DEFAULT_CHARACTER_NAME) {
    missing.push('o nome (passo 2)');
  }
  if (!character.race.trim()) missing.push('a raça (passo 3)');
  if (
    raceChoiceCount(character.race) > 0 &&
    draft.abilityChoices.length < raceChoiceCount(character.race)
  ) {
    missing.push('os atributos à escolha da raça (passo 3)');
  }
  if (!character.background.trim()) missing.push('o antecedente (passo 4)');

  // Ferramentas e idiomas à escolha do antecedente (quando ele os concede).
  const backgroundOption = findBackground(character.background);
  if (backgroundOption) {
    for (const choice of backgroundOption.toolChoices ?? []) {
      if (!draft.backgroundToolChoices[choice.id]) {
        missing.push(`a ${choice.label} do antecedente (passo 4)`);
      }
    }
    const languageCount = backgroundOption.languageChoices ?? 0;
    if (languageCount > 0 && draft.backgroundLanguageChoices.length < languageCount) {
      missing.push('os idiomas do antecedente (passo 4)');
    }
  }

  if (entries.length === 0) missing.push('a classe (passo 5)');

  // Clérigo/Feiticeiro/Bruxo precisam da subclasse desde o nível 1.
  const firstClass = entries[0];
  const firstDefinition = firstClass ? getClassDefinition(firstClass.classKey) : null;
  if (firstDefinition && firstDefinition.subclassLevel <= 1 && !firstClass.subclass) {
    missing.push('a subclasse (passo 5)');
  }

  // Escolhas do nível 1 da classe inicial (Estilo de Luta, Inimigo Favorito e
  // Explorador Nato) — o mesmo passo 5 as pede. A Expertise fica de fora: ela
  // é pedida no passo das perícias, quando já dá para saber o que o personagem
  // domina.
  if (firstDefinition) {
    const choices = normalizeClassState(character.classState).choices;
    for (const info of pendingFeatureChoices(
      firstDefinition,
      1,
      choices,
      '',
      {},
      ['expertise'],
    )) {
      missing.push(`${info.prompt} (passo 5)`);
    }
    for (const info of pendingFeatureChoices(
      firstDefinition,
      1,
      choices,
      '',
      {},
      ['skill'],
    ).filter((item) => item.apply === 'expertise')) {
      missing.push(`${info.prompt} (passo 7)`);
    }
  }

  if (!ABILITY_KEYS.every((ability) => draft.baseAbilities[ability] !== undefined)) {
    missing.push('os atributos (passo 6)');
  }

  const choice = creationSkillChoice(entries);
  if (choice.count > 0) {
    const skills = normalizeSkills(character.skills);
    const proficient = SKILL_KEYS.filter((key) => skills[key]?.proficient);
    if (proficient.length < choice.count) missing.push('as perícias (passo 7)');
  }

  return missing;
}

/** Monta o estado completo (ficha + criação) para o cliente. */
async function buildState(
  actor: Actor,
  character: Character | null,
  startingLevel: number,
): Promise<CreationState> {
  const draft = normalizeCreationDraft(character?.creationDraft ?? EMPTY_CREATION_DRAFT);
  const entries = normalizeClassEntries(character?.classes ?? []);
  const firstDefinition = entries[0] ? getClassDefinition(entries[0].classKey) : null;
  const classChoices = normalizeClassState(character?.classState).choices;
  const raceSkillKeys = character ? await characterRaceSkills(character) : [];

  return {
    character: character ? await toSheetDto(character, actor.username) : null,
    creation: {
      mode: draft.mode,
      step: draft.step,
      rolls: draft.rolls,
      baseAbilities: draft.baseAbilities,
      skillPicks: draft.skillPicks,
      abilityChoices: draft.abilityChoices,
      languageChoices: draft.languageChoices,
      backgroundToolChoices: draft.backgroundToolChoices,
      backgroundLanguageChoices: draft.backgroundLanguageChoices,
      skillChoice: creationSkillChoice(entries),
      raceSkillKeys,
      featureChoices: firstDefinition
        ? featureChoiceInfo(firstDefinition, classChoices, '', {}, 1).filter(
            (info) => info.level === 1 && info.apply !== 'expertise',
          )
        : [],
      expertiseChoices:
        firstDefinition && character
          ? featureChoiceInfo(
              firstDefinition,
              classChoices,
              '',
              { expertise: creationExpertiseOptions(character) },
              1,
            ).filter((info) => info.level === 1 && info.apply === 'expertise')
          : [],
      startingLevel,
      // Catálogo único: as nove raças fixas do catálogo estruturado + as raças
      // PERSONALIZADAS do mestre (tabela CustomRace).
      raceCatalog: [...RACE_CATALOG, ...(await listCustomRaceOptions())],
      backgroundCatalog: [...BACKGROUND_CATALOG],
      missing: character
        ? missingForFinalize(character, draft)
        : ['o tipo de personagem (passo 1)'],
    },
  };
}

/** Estado atual do assistente para o jogador autenticado. */
export async function getCreationState(actor: Actor): Promise<CreationState> {
  const [character, config] = await Promise.all([
    prisma.character.findUnique({ where: { userId: actor.userId } }),
    getGameConfig(),
  ]);

  return buildState(actor, character, config.startingLevel);
}

/**
 * Salva o passo concluído. Cada passo grava só os campos que ele resolve — e
 * `step` guarda o passo ALCANÇADO (o maior já visto), para a retomada nunca
 * voltar para trás sozinha.
 */
export async function saveCreationStep(
  actor: Actor,
  input: CreationStepInput,
): Promise<CreationState> {
  const character = await requireDraft(actor);
  const draft = normalizeCreationDraft(character.creationDraft);
  const nextDraft: CreationDraft = {
    ...draft,
    baseAbilities: { ...draft.baseAbilities },
    skillPicks: [...draft.skillPicks],
    abilityChoices: [...draft.abilityChoices],
  };
  const patch: UpdateCharacterInput = {};

  switch (input.step) {
    case 1: {
      if (!input.mode) {
        throw new HttpError('Escolha se o personagem é novo ou já existe.', 400);
      }
      nextDraft.mode = input.mode;
      break;
    }

    case 2: {
      if (!input.name || input.name.trim().length < 2) {
        throw new HttpError('Escreva o nome do personagem.', 400);
      }
      patch.name = input.name;
      if (input.alignment !== undefined) patch.alignment = input.alignment;
      if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
      break;
    }

    case 3: {
      const race = (input.race ?? '').trim();
      if (!race) throw new HttpError('Escolha a raça do personagem.', 400);

      // O passo 3 lê o catálogo ESTRUTURADO (nove raças fixas) + as raças
      // PERSONALIZADAS do mestre, numa lista única. A opção diz de onde a raça
      // veio (`raceId`/`subraceId`/`customRaceId`) e as escolhas que ela exige.
      const catalog = [...RACE_CATALOG, ...(await listCustomRaceOptions())];
      const option = matchRaceOption(catalog, race);
      if (!option) throw new HttpError(`Raça desconhecida: ${race}.`, 400);

      // Escolhas de ATRIBUTO (Meio-Elfo: +1 em dois): validadas contra o pool e
      // guardadas no rascunho; trocar para uma raça sem escolha limpa a lista.
      const required = option.abilityChoice ?? 0;
      const choices = [...new Set(input.abilityChoices ?? [])];
      if (required > 0) {
        const pool = raceChoicePool(option);
        const outside = choices.filter((ability) => !pool.includes(ability));
        if (outside.length > 0) {
          throw new HttpError(
            `Fora da escolha de ${option.name}: ${outside
              .map((ability) => ABILITY_LABELS[ability] ?? ability)
              .join(', ')}.`,
            400,
          );
        }
        if (choices.length !== required) {
          throw new HttpError(
            `${option.name} concede +1 em ${required} atributos à sua escolha — escolha exatamente esse tanto.`,
            400,
          );
        }
      }
      nextDraft.abilityChoices = required > 0 ? choices : [];

      // Demais escolhas (ancestralidade do Draconato, perícias do Meio-Elfo,
      // ferramenta do Anão): validadas contra as opções de cada definição.
      const raceChoices: Record<string, string> = {};
      for (const definition of option.choices ?? []) {
        if (definition.apply === 'ability') continue;
        const picked = input.raceChoices?.[definition.id];
        if (!picked) {
          // Todas as escolhas do catálogo (ancestralidade do Draconato, perícias
          // do Meio-Elfo, ferramenta do Anão) são obrigatórias.
          throw new HttpError(`Escolha ${definition.label} de ${option.name}.`, 400);
        }
        if (!definition.options.some((item) => item.id === picked)) {
          throw new HttpError(`Opção inválida em "${definition.label}".`, 400);
        }
        raceChoices[definition.id] = picked;
      }
      // As escolhas de atributo também entram no mapa (com os ids das
      // definições), pois efeitos como `resistanceFromChoice` leem daqui.
      (option.choices ?? [])
        .filter((definition) => definition.apply === 'ability')
        .forEach((definition, index) => {
          const picked = choices[index];
          if (picked) raceChoices[definition.id] = picked;
        });

      // Idiomas à escolha (Humano e Meio-Elfo concedem 1): só valem idiomas do
      // catálogo que NÃO sejam fixos da raça, sem repetição e no número exato.
      const bonusLanguages = option.bonusLanguageChoices ?? 0;
      const fixedLanguages = option.languages ?? [];
      const languageChoices = [
        ...new Set((input.languageChoices ?? []).map((name) => name.trim())),
      ].filter(Boolean);
      if (bonusLanguages > 0) {
        const invalid = languageChoices.filter(
          (name) => !isLanguageName(name) || fixedLanguages.includes(name),
        );
        if (invalid.length > 0) {
          throw new HttpError(`Idioma inválido para ${option.name}: ${invalid.join(', ')}.`, 400);
        }
        if (languageChoices.length !== bonusLanguages) {
          throw new HttpError(
            `${option.name} concede ${bonusLanguages} idioma(s) à sua escolha — escolha exatamente esse tanto.`,
            400,
          );
        }
      } else if (languageChoices.length > 0) {
        throw new HttpError(`${option.name} não concede idioma à escolha.`, 400);
      }
      nextDraft.languageChoices = bonusLanguages > 0 ? languageChoices : [];

      patch.race = option.name;
      patch.raceId = option.customRaceId ? null : option.raceId;
      patch.subraceId = option.subraceId ?? null;
      patch.customRaceId = option.customRaceId ?? null;
      patch.raceChoices = raceChoices;

      // Efeitos que a ficha guarda: deslocamento, visão no escuro, resistências,
      // idiomas e as proficiências de perícia/ferramenta resolvidas.
      const grants = await raceGrants({
        raceId: option.customRaceId ? null : option.raceId,
        subraceId: option.subraceId ?? null,
        customRaceId: option.customRaceId ?? null,
        choices: raceChoices,
      });

      // Ao TROCAR a raça, as perícias que a NOVA raça já concede saem das
      // escolhas da classe (mesma poda da troca de classe): elas entram na
      // ficha de qualquer forma e, no passo 7, aparecem marcadas e travadas —
      // mantê-las em `skillPicks` faria o contador/validação gastarem uma
      // escolha que a classe não concedeu.
      nextDraft.skillPicks = nextDraft.skillPicks.filter(
        (key) => !grants.skills.includes(key),
      );

      patch.speed = grants.speed;
      patch.darkvision = grants.darkvision;
      patch.raceResistances = grants.resistances as NonNullable<
        UpdateCharacterInput['raceResistances']
      >;
      patch.languages = resolvedLanguages(
        grants.languages,
        nextDraft.languageChoices,
        character.background,
        nextDraft.backgroundLanguageChoices,
      );
      patch.toolProficiencies = resolvedTools(
        grants.tools,
        character.background,
        nextDraft.backgroundToolChoices,
      );
      patch.skills = skillsPatch(
        character,
        nextDraft.skillPicks,
        character.background,
        grants.skills,
      );

      // A raça concede bônus de atributo: os valores são refeitos a partir dos
      // valores-BASE do rascunho (nada do que foi rolado se perde).
      Object.assign(
        patch,
        abilitiesPatchFrom(bonusesFromOption(option, choices), nextDraft.baseAbilities),
      );
      break;
    }

    case 4: {
      const background = (input.background ?? '').trim();
      if (!background) throw new HttpError('Escreva o antecedente do personagem.', 400);

      // O antecedente do catálogo concede ferramentas (fixas e/ou à escolha por
      // categoria), idiomas à escolha e uma característica narrativa. Um
      // antecedente escrito à mão (fora do catálogo) segue aceito, sem esses
      // extras — só as perícias, como antes.
      const option = findBackground(background);
      const toolChoices: Record<string, string> = {};
      let languageChoices: string[] = [];

      if (option) {
        for (const choice of option.toolChoices ?? []) {
          const picked = (input.backgroundToolChoices ?? {})[choice.id];
          if (!picked) throw new HttpError(`Escolha ${choice.label} de ${option.name}.`, 400);
          if (!choice.options.some((item) => item.id === picked)) {
            throw new HttpError(`Opção inválida em "${choice.label}".`, 400);
          }
          toolChoices[choice.id] = picked;
        }

        const languageCount = option.languageChoices ?? 0;
        languageChoices = [
          ...new Set((input.backgroundLanguageChoices ?? []).map((name) => name.trim())),
        ].filter(Boolean);
        if (languageCount > 0) {
          const invalid = languageChoices.filter((name) => !isLanguageName(name));
          if (invalid.length > 0) {
            throw new HttpError(`Idioma inválido para ${option.name}: ${invalid.join(', ')}.`, 400);
          }
          if (languageChoices.length !== languageCount) {
            throw new HttpError(
              `${option.name} concede ${languageCount} idioma(s) à sua escolha — escolha exatamente esse tanto.`,
              400,
            );
          }
        } else if (languageChoices.length > 0) {
          throw new HttpError(`${option.name} não concede idioma à escolha.`, 400);
        }
      }

      nextDraft.backgroundToolChoices = option ? toolChoices : {};
      nextDraft.backgroundLanguageChoices =
        option && (option.languageChoices ?? 0) > 0 ? languageChoices : [];

      patch.background = background;
      // O antecedente pode conceder perícias: elas entram junto das escolhidas
      // na classe e das concedidas pela raça, sem consumir as escolhas da classe.
      patch.skills = skillsPatch(
        character,
        nextDraft.skillPicks,
        background,
        await characterRaceSkills(character),
      );

      // Ferramentas e idiomas são DERIVADOS: raça + antecedente, recalculados a
      // cada passo para voltar ao passo 3 não apagar o que o antecedente deu.
      const race = await characterRaceGrants(character);
      patch.toolProficiencies = resolvedTools(
        race.tools,
        background,
        nextDraft.backgroundToolChoices,
      );
      patch.languages = resolvedLanguages(
        race.languages,
        nextDraft.languageChoices,
        background,
        nextDraft.backgroundLanguageChoices,
      );

      // A característica narrativa do antecedente entra na aba Características
      // (`source: 'background'`), substituindo uma anterior do mesmo tipo.
      if (option) {
        patch.features = [
          ...parseFeatures(character.features).filter((feature) => feature.source !== 'background'),
          {
            id: `background:${option.key}`,
            name: option.feature?.name ?? option.name,
            source: 'background',
            description: option.feature?.description ?? '',
          },
        ];
      }
      break;
    }

    case 5: {
      const classKey = (input.classKey ?? '').trim();
      if (!classKey) throw new HttpError('Escolha a classe inicial do personagem.', 400);
      const definition = getClassDefinition(classKey);
      if (!definition) throw new HttpError('Classe desconhecida.', 400);

      // Clérigo, Feiticeiro e Bruxo escolhem a subclasse já na PRIMEIRA classe
      // (Domínio, Origem e Patrono). Ela vem neste mesmo passo e é validada
      // junto das classes (ver resolveClassPatch, em characters.service.ts).
      const subclass = (input.subclass ?? '').trim();

      // O pré-requisito de atributo é conferido aqui (com os valores já
      // gravados) e de novo no passo 6, quando os atributos existem.
      const current = normalizeClassEntries(character.classes);
      if (current.length === 0 || (current.length === 1 && current[0].level === 1)) {
        // Primeira classe (ou troca da classe inicial, ainda no nível 1).
        patch.classes = [{ classKey: definition.key, subclass }];

        // Escolhas que a classe pede no NÍVEL 1: Estilo de Luta do Guerreiro,
        // Inimigo Favorito e Explorador Nato do Patrulheiro. Ao TROCAR a classe
        // as escolhas da anterior caem (elas não existem na nova); ao repetir o
        // passo com a mesma classe, o que já foi escolhido é mantido.
        const stored = normalizeClassState(character.classState);
        const keepsClass = current.length === 1 && current[0].classKey === definition.key;
        // Ao TROCAR a classe inicial, as perícias já escolhidas da classe
        // anterior saem: ficam só as que a NOVA lista também aceita (lista
        // vazia = qualquer perícia). Sem isso, uma escolha fora do novo pool
        // viraria uma "perícia fantasma" — não aparece no passo 7, mas conta no
        // envio e o validador a recusa ("Fora da lista da classe").
        if (!keepsClass) {
          const pool = classSkillChoice(definition.key).from;
          nextDraft.skillPicks = nextDraft.skillPicks.filter(
            (key) => SKILL_KEYS.includes(key) && (pool.length === 0 || pool.includes(key)),
          );
        }
        // A Expertise é adiada para o passo das perícias (as opções só existem
        // depois que o personagem escolhe o que domina).
        const choices = resolveFeatureChoices(
          definition,
          1,
          input.choices ?? {},
          keepsClass ? stored.choices : {},
          '',
          {},
          ['expertise'],
        );
        patch.classState = { ...stored, choices };
      } else if (current.length !== 1 || current[0].classKey !== definition.key) {
        // Ficha reaberta já com níveis: trocar de classe aqui apagaria os
        // níveis já ganhos, então a troca continua sendo do Level Up/mestre.
        throw new HttpError(
          'Este personagem já tem níveis: a classe inicial só muda pelo Level Up ou pelo mestre.',
          400,
        );
      }
      break;
    }

    case 6: {
      const base = input.baseAbilities;
      if (!base) throw new HttpError('Distribua os seis valores entre os atributos.', 400);

      const pending = ABILITY_KEYS.filter((ability) => base[ability] === undefined);
      if (pending.length > 0) {
        throw new HttpError(
          `Faltam valores para: ${pending.map((ability) => ABILITY_LABELS[ability]).join(', ')}.`,
          400,
        );
      }

      const currentBase = baseAbilitiesOf(
        character,
        await bonusesForCharacter(character, draft.abilityChoices),
      );
      validateAbilities(draft, base, currentBase);
      nextDraft.baseAbilities = { ...base };

      Object.assign(
        patch,
        abilitiesPatchFrom(
          await bonusesForCharacter(character, nextDraft.abilityChoices),
          nextDraft.baseAbilities,
        ),
      );

      // Pré-requisito da classe, agora com os atributos finais: é o momento em
      // que o assistente barra a combinação (ex.: Paladino sem Força 13) e
      // devolve o jogador ao passo 6 com o que falta.
      const entries = normalizeClassEntries(character.classes);
      const definition = entries[0] ? getClassDefinition(entries[0].classKey) : null;
      if (definition) {
        const abilities = { ...abilitiesOf(character), ...patch } as Record<AbilityKey, number>;
        const missing = multiclassPrerequisiteLabel(definition.key, abilities, entries);
        if (missing) {
          throw new HttpError(`${missing}.`, 400);
        }
      }
      break;
    }

    case 7: {
      const picks = [...new Set(input.skills ?? [])];
      validateSkillPicks(character, picks);
      nextDraft.skillPicks = picks;
      const nextSkills = skillsPatch(
        character,
        picks,
        character.background,
        await characterRaceSkills(character),
      );

      // Expertise do nível 1 (Ladino): só agora, com as perícias escolhidas, dá
      // para validar a escolha contra o que o personagem domina. O passo 5
      // adiou a escolha justamente por isso.
      const entries = normalizeClassEntries(character.classes);
      const definition = entries[0] ? getClassDefinition(entries[0].classKey) : null;
      if (definition) {
        const stored = normalizeClassState(character.classState);
        const choices = resolveFeatureChoices(
          definition,
          1,
          input.choices ?? {},
          stored.choices,
          '',
          {
            expertise: expertiseOptionsFor(
              Object.entries(nextSkills)
                .filter(([, entry]) => entry.proficient)
                .map(([key]) => key),
              normalizeProficiencies(character.proficiencies).tools,
            ),
          },
        );
        patch.classState = { ...stored, choices };
        patch.skills = expertiseSkillsState(
          featuresWithSubclass(definition, ''),
          choices,
          nextSkills,
        );
      } else {
        patch.skills = nextSkills;
      }
      break;
    }

    case 8: {
      // O passo 8 não tem campo próprio: ele aplica os níveis iniciais da mesa
      // pelo assistente de Level Up (ver `creationLevelUp`). Só dá para avançar
      // quando o personagem já chegou no nível inicial.
      const config = await getGameConfig();
      const level = totalCharacterLevel(normalizeClassEntries(character.classes));
      if (level < config.startingLevel) {
        throw new HttpError(
          `Esta mesa começa no nível ${config.startingLevel}: ainda faltam ${
            config.startingLevel - level
          } nível(is) para aplicar.`,
          400,
        );
      }
      break;
    }

    default:
      // O passo 9 é a revisão: quem fecha a criação é `finalizeCreation`.
      break;
  }

  nextDraft.step = Math.max(draft.step, Math.min(CREATION_LAST_STEP, input.step + 1));

  // Enquanto os atributos não existem, o pré-requisito da classe ainda não
  // pode ser conferido — o passo 6 é quem faz isso, com os valores finais.
  const abilitiesReady = ABILITY_KEYS.every(
    (ability) => nextDraft.baseAbilities[ability] !== undefined,
  );

  await updateDraftSheet(
    { userId: actor.userId, username: actor.username },
    patch,
    nextDraft as unknown as Prisma.InputJsonValue,
    { skipClassPrerequisite: !abilitiesReady },
  );

  const saved = await prisma.character.findUniqueOrThrow({ where: { userId: actor.userId } });
  const config = await getGameConfig();

  return buildState(actor, saved, config.startingLevel);
}

/**
 * Passo 6 do modo "personagem novo": rola 4d6 descartando o menor, com o MESMO
 * mecanismo da janela de dados (o dado continua sendo sorteado no servidor).
 *
 * A rolagem não vira aviso para a mesa — só entra no histórico do mestre, como
 * "[Jogador]: Criação de personagem: [valor]" — e o resultado fica guardado no
 * rascunho, para o jogador distribuir agora ou depois de fechar o navegador.
 */
export async function rollCreationAttribute(
  actor: Actor,
  input: CreationRollRequestInput,
): Promise<CreationState & { roll: CreationRoll & { value: number } }> {
  const character = await requireDraft(actor);
  const draft = normalizeCreationDraft(character.creationDraft);

  const rolls = input.restart ? [] : [...draft.rolls];
  if (rolls.length >= CREATION_ABILITY_COUNT) {
    throw new HttpError(
      'Os seis valores já foram rolados — use "rolar novamente" para começar de novo.',
      409,
    );
  }

  const roll = await rollTableDice(
    {
      userId: actor.userId,
      username: actor.username,
      displayName: actor.displayName,
      // A rolagem de criação é sempre do jogador: nunca é privada (o `private`
      // nem é enviado), então o papel não interfere em nada.
      role: 'PLAYER',
    },
    {
      dice: Array.from({ length: CREATION_ROLL_DICE }, () => ({ sides: 6 })),
      kind: 'creation',
      label: CREATION_ROLL_LABEL,
    },
  );

  const dice = roll.dice.map((die) => die.value);
  const entry: CreationRoll = { dice, dropped: lowestIndex(dice) };
  rolls.push(entry);

  const saved = await prisma.character.update({
    where: { userId: actor.userId },
    data: {
      creationDraft: { ...draft, rolls } as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  const config = await getGameConfig();

  return {
    ...(await buildState(actor, saved, config.startingLevel)),
    roll: { ...entry, value: rollValues([entry])[0] },
  };
}

/** Passo 8: aplica um nível do assistente de Level Up durante a criação. */
export async function creationLevelUp(actor: Actor, input: LevelUpInput): Promise<CreationState> {
  const config = await getGameConfig();
  await levelUpDraft(actor, input, config.startingLevel);

  const saved = await prisma.character.findUniqueOrThrow({ where: { userId: actor.userId } });
  return buildState(actor, saved, config.startingLevel);
}

/**
 * Passo 9: fecha a criação (`creationFinalized = true`).
 *
 * Antes de fechar, confere que nenhum passo ficou para trás — a mensagem lista o
 * que falta, em vez de aceitar uma ficha pela metade.
 */
export async function finalizeCreation(actor: Actor): Promise<CreationState> {
  const character = await requireDraft(actor);
  const draft = normalizeCreationDraft(character.creationDraft);
  const missing = missingForFinalize(character, draft);

  const config = await getGameConfig();
  const level = totalCharacterLevel(normalizeClassEntries(character.classes));
  if (level < config.startingLevel) missing.push('os níveis iniciais da mesa (passo 8)');

  if (missing.length > 0) {
    throw new HttpError(`Ainda falta preencher: ${missing.join(', ')}.`, 400);
  }

  await setCreationFinalized(
    { userId: actor.userId, username: actor.username },
    actor,
    true,
    { creationDraft: { ...draft, step: CREATION_LAST_STEP } as unknown as Prisma.InputJsonValue },
  );

  const saved = await prisma.character.findUniqueOrThrow({ where: { userId: actor.userId } });
  return buildState(actor, saved, config.startingLevel);
}

/**
 * Reabre a criação de um jogador (exclusivo do mestre).
 *
 * O personagem volta para o assistente com o que já existe preenchido: modo
 * "personagem existente" (os atributos podem ser revisados), os valores atuais
 * como BASE e o passo 1 — o jogador reencontra o wizard no próximo acesso.
 */
export async function reopenCreation(characterId: string, master: Actor): Promise<CharacterDto> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true, role: true } } },
  });

  if (!character) throw new HttpError('Ficha não encontrada.', 404);
  if (character.user.role === 'MASTER') {
    throw new HttpError('Esta conta não tem ficha de jogador.', 400);
  }

  const draft = normalizeCreationDraft(character.creationDraft);
  const seeded: CreationDraft = {
    mode: draft.mode ?? 'existing',
    step: CREATION_FIRST_STEP,
    rolls: draft.rolls,
    baseAbilities: baseAbilitiesOf(
      character,
      await bonusesForCharacter(character, draft.abilityChoices),
    ),
    skillPicks: draft.skillPicks,
    abilityChoices: draft.abilityChoices,
    languageChoices: draft.languageChoices,
    backgroundToolChoices: draft.backgroundToolChoices,
    backgroundLanguageChoices: draft.backgroundLanguageChoices,
  };

  return setCreationFinalized(
    { userId: character.userId, username: character.user.username },
    master,
    false,
    { creationDraft: seeded as unknown as Prisma.InputJsonValue },
  );
}
