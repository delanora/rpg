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
 * Os catálogos de RAÇAS e ANTECEDENTES do Livro do Jogador já estão preenchidos:
 * os passos 3 e 4 listam as opções em vez de pedir texto livre, e o que cada uma
 * concede entra sozinho na ficha — os bônus de atributo (ver
 * `racialAbilityBonuses`) e as perícias do antecedente (ver `backgroundSkills`),
 * ambos usados em creation.service.ts.
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

/** Uma raça do catálogo — uma entrada por linhagem/sub-raça do Livro do Jogador. */
export interface RaceOption {
  /** Chave única da LINHAGEM (ex.: `dwarf-hill`, `elf-high`, `half-elf`). */
  key: string;
  /** Nome completo, como fica gravado em `characters.race` (ex.: "Anão (Anão da Colina)"). */
  name: string;
  /**
   * Nome da raça base, para agrupar as sub-raças na interface
   * (ex.: as três linhagens de elfo compartilham "Elfo").
   */
  baseRace?: string;
  description?: string;
  /** Bônus racial FIXO aplicado aos atributos (ex.: Anão: CON +2). */
  abilityBonuses?: Partial<Record<AbilityKey, number>>;
  /**
   * Quantos atributos à escolha ganham +1 cada (Meio-Elfo: 2). Os atributos
   * escolhidos vivem no rascunho (`CreationDraft.abilityChoices`) e são
   * validados contra `raceChoicePool`.
   */
  abilityChoice?: number;
}

/** Um antecedente do catálogo (um dos 13 do Livro do Jogador). */
export interface BackgroundOption {
  key: string;
  /** Nome, como fica gravado em `characters.background` (ex.: "Herói do Povo"). */
  name: string;
  description?: string;
  /** Perícias concedidas pelo antecedente (chaves de `SKILLS`). */
  skills?: string[];
}

/**
 * Raças do Livro do Jogador (2014).
 *
 * Cada LINHAGEM é uma entrada própria, com os bônus JÁ SOMADOS da raça base e
 * da sub-raça — assim o passo 3 é uma seleção simples e o bônus entra direto
 * em `racialAbilityBonuses`. O `baseRace` guarda o nome da raça "mãe" para uma
 * futura interface em dois níveis.
 *
 * O Draconato fica em uma única entrada: a ancestralidade dracônica (cor) muda
 * a arma de sopro e a resistência, não os atributos, e o personagem ainda não
 * tem campo para guardá-la.
 */
export const RACE_CATALOG: readonly RaceOption[] = [
  {
    key: 'dwarf-hill',
    name: 'Anão (Anão da Colina)',
    baseRace: 'Anão',
    description: 'Robusto e teimoso, com sentidos apurados e vigor lendário.',
    abilityBonuses: { constitution: 2, wisdom: 1 },
  },
  {
    key: 'dwarf-mountain',
    name: 'Anão (Anão da Montanha)',
    baseRace: 'Anão',
    description: 'Criado nas alturas, troca a sabedoria pela força bruta.',
    abilityBonuses: { constitution: 2, strength: 2 },
  },
  {
    key: 'elf-high',
    name: 'Elfo (Alto Elfo)',
    baseRace: 'Elfo',
    description: 'Herdeiro das torres antigas, com mente afiada para a magia.',
    abilityBonuses: { dexterity: 2, intelligence: 1 },
  },
  {
    key: 'elf-wood',
    name: 'Elfo (Elfo da Floresta)',
    baseRace: 'Elfo',
    description: 'Andarilho das matas, atento e silencioso como a própria folhagem.',
    abilityBonuses: { dexterity: 2, wisdom: 1 },
  },
  {
    key: 'elf-drow',
    name: 'Elfo (Drow)',
    baseRace: 'Elfo',
    description: 'Elfo negro do Subterrâneo, marcado pela magia e pela presença sombria.',
    abilityBonuses: { dexterity: 2, charisma: 1 },
  },
  {
    key: 'halfling-lightfoot',
    name: 'Halfling (Pés-Leves)',
    baseRace: 'Halfling',
    description: 'Pequeno e sorrateiro, mais fácil de amar do que de encontrar.',
    abilityBonuses: { dexterity: 2, charisma: 1 },
  },
  {
    key: 'halfling-stout',
    name: 'Halfling (Robusto)',
    baseRace: 'Halfling',
    description: 'Mais resistente que os primos, com o vigor dos anões no sangue.',
    abilityBonuses: { dexterity: 2, constitution: 1 },
  },
  {
    key: 'human',
    name: 'Humano',
    baseRace: 'Humano',
    description: 'Versátil e ambicioso: um pouco melhor em tudo.',
    abilityBonuses: {
      strength: 1,
      dexterity: 1,
      constitution: 1,
      intelligence: 1,
      wisdom: 1,
      charisma: 1,
    },
  },
  {
    key: 'dragonborn',
    name: 'Draconato',
    baseRace: 'Draconato',
    description: 'Descendente de dragões, com sopro e resistência definidos pela linhagem.',
    abilityBonuses: { strength: 2, charisma: 1 },
  },
  {
    key: 'gnome-forest',
    name: 'Gnomo (Gnomo da Floresta)',
    baseRace: 'Gnomo',
    description: 'Curioso e ágil, com uma queda natural por ilusões e engenhocas.',
    abilityBonuses: { intelligence: 2, dexterity: 1 },
  },
  {
    key: 'gnome-rock',
    name: 'Gnomo (Gnomo das Rochas)',
    baseRace: 'Gnomo',
    description: 'Inventor nato, resistente à magia e às pedras do caminho.',
    abilityBonuses: { intelligence: 2, constitution: 1 },
  },
  {
    key: 'half-elf',
    name: 'Meio-Elfo',
    baseRace: 'Meio-Elfo',
    description: 'Entre dois mundos: encanto élfico e a versatilidade de quem não pertence a lugar nenhum.',
    // +1 em DOIS atributos à escolha (os escolhidos vão no rascunho).
    abilityBonuses: { charisma: 2 },
    abilityChoice: 2,
  },
  {
    key: 'half-orc',
    name: 'Meio-Orc',
    baseRace: 'Meio-Orc',
    description: 'Força bruta e fúria herdadas, temperadas por uma vontade teimosa.',
    abilityBonuses: { strength: 2, constitution: 1 },
  },
  {
    key: 'tiefling',
    name: 'Tiefling',
    baseRace: 'Tiefling',
    description: 'Sangue infernal: carisma e astúcia com um quê de condenação.',
    abilityBonuses: { charisma: 2, intelligence: 1 },
  },
];

/**
 * Antecedentes do Livro do Jogador (2014) — os 13.
 *
 * Cada um concede DUAS perícias com proficiência (as do livro), aplicadas pelo
 * passo 4 e somadas às escolhidas na classe, sem consumir as escolhas dela (ver
 * `skillsPatch` em creation.service.ts). Ferramentas, idiomas e a característica
 * do antecedente ainda não são modelados — só a perícia entra na ficha.
 */
export const BACKGROUND_CATALOG: readonly BackgroundOption[] = [
  {
    key: 'acolyte',
    name: 'Acólito',
    description: 'Você serviu a um templo e conhece os ritos, as orações e os segredos da fé.',
    skills: ['insight', 'religion'],
  },
  {
    key: 'charlatan',
    name: 'Charlatão',
    description: 'Você sempre teve um plano, uma identidade falsa e a lábia para vendê-la.',
    skills: ['deception', 'sleightOfHand'],
  },
  {
    key: 'criminal',
    name: 'Criminoso',
    description: 'Você tem contatos no submundo e um passado que prefere não comentar.',
    skills: ['deception', 'stealth'],
  },
  {
    key: 'entertainer',
    name: 'Artista',
    description: 'Você vive para a plateia: música, dança, malabarismo ou lábia de palco.',
    skills: ['acrobatics', 'performance'],
  },
  {
    key: 'folk-hero',
    name: 'Herói do Povo',
    description: 'Você veio do campo e o povo simples o tem como campeão.',
    skills: ['animalHandling', 'survival'],
  },
  {
    key: 'guild-artisan',
    name: 'Artesão de Guilda',
    description: 'Você é membro de uma guilda de artesãos, com carta, oficina e contatos.',
    skills: ['insight', 'persuasion'],
  },
  {
    key: 'hermit',
    name: 'Eremita',
    description: 'Você se isolou do mundo em busca de iluminação — e encontrou algo.',
    skills: ['medicine', 'religion'],
  },
  {
    key: 'noble',
    name: 'Nobre',
    description: 'Você nasceu com título, terras e a educação (e as dívidas) da nobreza.',
    skills: ['history', 'persuasion'],
  },
  {
    key: 'outlander',
    name: 'Forasteiro',
    description: 'Você cresceu nas terras selvagens, longe das cidades e das estradas.',
    skills: ['athletics', 'survival'],
  },
  {
    key: 'sage',
    name: 'Sábio',
    description: 'Você passou a vida entre livros e arquivos, caçando conhecimento proibido.',
    skills: ['arcana', 'history'],
  },
  {
    key: 'sailor',
    name: 'Marinheiro',
    description: 'Você navegou por anos: conhece cordas, tempestades e portos de todo lugar.',
    skills: ['athletics', 'perception'],
  },
  {
    key: 'soldier',
    name: 'Soldado',
    description: 'Você treinou e lutou num exército; a disciplina (ou a cicatriz) ficou.',
    skills: ['athletics', 'intimidation'],
  },
  {
    key: 'urchin',
    name: 'Órfão de Rua',
    description: 'Você cresceu sozinho nas ruas, rápido de mãos e invisível nos becos.',
    skills: ['sleightOfHand', 'stealth'],
  },
];

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
 * Bônus racial de atributo da raça escolhida, já com os `+1` à escolha do
 * jogador (Meio-Elfo). Raça fora do catálogo não concede bônus algum.
 */
export function racialAbilityBonuses(
  race: string,
  choices: readonly AbilityKey[] = [],
): Partial<Record<AbilityKey, number>> {
  const option = findRace(race);
  if (!option) return {};

  const bonuses: Partial<Record<AbilityKey, number>> = { ...(option.abilityBonuses ?? {}) };
  const pick = option.abilityChoice ?? 0;
  if (pick > 0) {
    for (const ability of choices.slice(0, pick)) {
      bonuses[ability] = (bonuses[ability] ?? 0) + 1;
    }
  }

  return bonuses;
}

/** Atributos elegíveis ao `+1` à escolha da raça (os que não têm bônus fixo). */
export function raceChoicePool(option: RaceOption): AbilityKey[] {
  return ABILITY_KEYS.filter((ability) => (option.abilityBonuses?.[ability] ?? 0) === 0);
}

/** Quantos atributos à escolha a raça pede (0 = nenhum). */
export function raceChoiceCount(race: string): number {
  return findRace(race)?.abilityChoice ?? 0;
}

/** Perícias concedidas pelo antecedente escolhido (vazio se ele não estiver no catálogo). */
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
  /**
   * Atributos escolhidos para os `+1` da raça (hoje só o Meio-Elfo usa). Fica no
   * rascunho para o passo 6 aplicar o bônus e a ficha reaberta poder desfazê-lo.
   */
  abilityChoices: AbilityKey[];
}

export const EMPTY_CREATION_DRAFT: CreationDraft = {
  mode: null,
  step: CREATION_FIRST_STEP,
  rolls: [],
  baseAbilities: {},
  skillPicks: [],
  abilityChoices: [],
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

  const abilityChoices = Array.isArray(source.abilityChoices)
    ? [
        ...new Set(
          source.abilityChoices.filter(
            (key): key is AbilityKey => typeof key === 'string' && isAbilityKey(key),
          ),
        ),
      ].slice(0, CREATION_ABILITY_COUNT)
    : [];

  return { mode, step, rolls, baseAbilities, skillPicks, abilityChoices };
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
