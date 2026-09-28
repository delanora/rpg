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
  backgroundSkills,
  lowestIndex,
  normalizeCreationDraft,
  racialAbilityBonuses,
  rollValues,
  type BackgroundOption,
  type CreationDraft,
  type CreationMode,
  type CreationRoll,
  type RaceOption,
} from '../shared/creation.js';
import {
  creationSkillChoice,
  getClassDefinition,
  multiclassMissingLabel,
  normalizeClassEntries,
  totalCharacterLevel,
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
  /** Perícias que a classe do rascunho oferece (quantas e quais). */
  skillChoice: { count: number; from: string[] };
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

/**
 * Bônus raciais aplicados aos valores-BASE: os atributos gravados são sempre
 * base + raça, então trocar de raça (ou voltar ao passo 3) recalcula tudo a
 * partir do rascunho, sem perder o que o jogador digitou/rolou.
 */
function abilitiesPatchFrom(
  race: string,
  base: Partial<Record<AbilityKey, number>>,
): Partial<Record<AbilityKey, number>> {
  const bonuses = racialAbilityBonuses(race);
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
function baseAbilitiesOf(character: Character, race: string): Partial<Record<AbilityKey, number>> {
  const bonuses = racialAbilityBonuses(race || character.race);
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

/** Estado de perícias: as escolhidas na classe + as concedidas pelo antecedente. */
function skillsPatch(
  character: Character,
  picks: string[],
  background: string,
): Record<string, { proficient: boolean; expertise: boolean }> {
  const granted = backgroundSkills(background);
  const current = normalizeSkills(character.skills);
  const next: Record<string, { proficient: boolean; expertise: boolean }> = {};

  for (const key of SKILL_KEYS) {
    next[key] = {
      proficient: picks.includes(key) || granted.includes(key),
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
  character: Character,
  draft: CreationDraft,
  base: Partial<Record<AbilityKey, number>>,
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
  const current = baseAbilitiesOf(character, character.race);
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
  if (!character.background.trim()) missing.push('o antecedente (passo 4)');
  if (entries.length === 0) missing.push('a classe (passo 5)');

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

  return {
    character: character ? await toSheetDto(character, actor.username) : null,
    creation: {
      mode: draft.mode,
      step: draft.step,
      rolls: draft.rolls,
      baseAbilities: draft.baseAbilities,
      skillPicks: draft.skillPicks,
      skillChoice: creationSkillChoice(entries),
      startingLevel,
      raceCatalog: [...RACE_CATALOG],
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
      if (!race) throw new HttpError('Escreva a raça do personagem.', 400);
      patch.race = race;
      // A raça pode conceder bônus de atributo: os valores são refeitos a partir
      // dos valores-BASE do rascunho (nada do que foi rolado se perde).
      Object.assign(patch, abilitiesPatchFrom(race, nextDraft.baseAbilities));
      break;
    }

    case 4: {
      const background = (input.background ?? '').trim();
      if (!background) throw new HttpError('Escreva o antecedente do personagem.', 400);
      patch.background = background;
      // O antecedente pode conceder perícias: elas entram junto das escolhidas
      // na classe, sem consumir as escolhas dela.
      patch.skills = skillsPatch(character, nextDraft.skillPicks, background);
      break;
    }

    case 5: {
      const classKey = (input.classKey ?? '').trim();
      if (!classKey) throw new HttpError('Escolha a classe inicial do personagem.', 400);
      const definition = getClassDefinition(classKey);
      if (!definition) throw new HttpError('Classe desconhecida.', 400);

      // O pré-requisito de atributo é conferido aqui (com os valores já
      // gravados) e de novo no passo 6, quando os atributos existem.
      const current = normalizeClassEntries(character.classes);
      if (current.length === 0 || (current.length === 1 && current[0].level === 1)) {
        // Primeira classe (ou troca da classe inicial, ainda no nível 1).
        patch.classes = [{ classKey: definition.key, subclass: '' }];
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

      validateAbilities(character, draft, base);
      nextDraft.baseAbilities = { ...base };

      const race = patch.race ?? character.race;
      Object.assign(patch, abilitiesPatchFrom(race, nextDraft.baseAbilities));

      // Pré-requisito da classe, agora com os atributos finais: é o momento em
      // que o assistente barra a combinação (ex.: Paladino sem Força 13) e
      // devolve o jogador ao passo 6 com o que falta.
      const entries = normalizeClassEntries(character.classes);
      const definition = entries[0] ? getClassDefinition(entries[0].classKey) : null;
      if (definition) {
        const abilities = { ...abilitiesOf(character), ...patch } as Record<AbilityKey, number>;
        const missing = multiclassMissingLabel(definition.key, abilities);
        if (missing) {
          throw new HttpError(`Para entrar em ${definition.name} ${missing}.`, 400);
        }
      }
      break;
    }

    case 7: {
      const picks = [...new Set(input.skills ?? [])];
      validateSkillPicks(character, picks);
      nextDraft.skillPicks = picks;
      patch.skills = skillsPatch(character, picks, character.background);
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
    baseAbilities: baseAbilitiesOf(character, character.race),
    skillPicks: draft.skillPicks,
  };

  return setCreationFinalized(
    { userId: character.userId, username: character.user.username },
    master,
    false,
    { creationDraft: seeded as unknown as Prisma.InputJsonValue },
  );
}
