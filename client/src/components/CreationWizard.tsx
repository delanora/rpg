import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileToImagePayload, uploadAvatar } from '../api';
import {
  creationLevelUp,
  fetchCreationState,
  finalizeCreation,
  rollCreationAttribute,
  saveCreationStep,
} from '../creationApi';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  ALIGNMENTS,
  LANGUAGE_NAMES,
  SKILLS,
  expertiseEligibleOptions,
} from '../dnd';
import { findRaceOption, raceBonusesWithChoices } from '../races';
import type {
  AbilityKey,
  BackgroundOption,
  Character,
  CreationResponse,
  CreationRoll,
  CreationStepRequest,
  LevelUpRequest,
  RaceOption,
  SessionUser,
} from '../types';
import { AbilityStep } from './creation/AbilityStep';
import { FeatureChoiceField } from './FeatureChoiceField';
import { Icon } from './Icon';
import { LevelUpDialog } from './LevelUpDialog';
import { Portrait } from './Portrait';
import { RaceFaceIcon } from './RaceFace';

/** Passos do assistente, na ordem em que são percorridos. */
const STEP_LABELS = [
  'Tipo de personagem',
  'Identidade',
  'Raça',
  'Antecedente',
  'Classe',
  'Atributos',
  'Perícias',
  'Nível e progressão',
  'Revisão',
];

const LAST_STEP = STEP_LABELS.length;

/** Nome padrão da ficha recém-criada: enquanto for este, o passo 2 está vazio. */
const DEFAULT_NAME = 'novo personagem';

/** "+2" / "-1" (para o resumo dos bônus raciais). */
function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/** Resumo curto dos bônus de uma raça, para o rótulo da opção no seletor. */
function raceBonusLabel(option: RaceOption): string {
  const parts = ABILITY_KEYS.filter(
    (ability) => (option.abilityBonuses?.[ability] ?? 0) !== 0,
  ).map((ability) => `${ABILITY_LABELS[ability]} ${signed(option.abilityBonuses?.[ability] ?? 0)}`);

  if ((option.abilityChoice ?? 0) > 0) parts.push(`+1 à escolha (${option.abilityChoice})`);
  return parts.join(' · ');
}

/** Nomes das perícias concedidas por um antecedente (para o rótulo do seletor). */
function backgroundSkillNames(option: BackgroundOption): string[] {
  return (option.skills ?? []).map(
    (key) => SKILLS.find((skill) => skill.key === key)?.label ?? key,
  );
}

/** Atributos elegíveis ao `+1` à escolha da raça (os que não têm bônus fixo). */
function raceChoicePool(option: RaceOption): AbilityKey[] {
  return ABILITY_KEYS.filter((ability) => (option.abilityBonuses?.[ability] ?? 0) === 0);
}

/**
 * Chave do GRUPO de uma raça (a raça "mãe"): as sub-raças compartilham a chave
 * da raça base. Personalizadas usam o próprio id.
 */
function raceGroupKeyOf(option: RaceOption): string {
  return option.customRaceId ?? option.raceId;
}

/**
 * Poda as perícias escolhidas às que a classe aceita. Ao TROCAR a classe
 * inicial, uma escolha fora da nova lista vira uma "perícia fantasma": ela não
 * aparece no passo 7 (não está no pool) mas continuaria contando no contador e
 * no envio, e o servidor a recusaria. Lista vazia = qualquer perícia (Bardo).
 */
function pruneSkillPicksToClass(picks: string[], from: readonly string[]): string[] {
  if (from.length === 0) return picks.filter((key) => SKILLS.some((skill) => skill.key === key));
  return picks.filter((key) => from.includes(key));
}

/** Nome próprio da sub-raça (tira o "Raça (" e o ")"). */
function subraceName(option: RaceOption): string {
  return option.name.match(/\(([^)]+)\)/)?.[1] ?? option.name;
}

/** Diferença de bônus de atributo entre a sub-raça e a raça base (o que a sub-raça concede). */
function subraceBonusLabel(base: RaceOption, lineage: RaceOption): string {
  return ABILITY_KEYS.filter(
    (ability) =>
      (lineage.abilityBonuses?.[ability] ?? 0) !== (base.abilityBonuses?.[ability] ?? 0),
  )
    .map(
      (ability) =>
        `${ABILITY_LABELS[ability]} ${signed(
          (lineage.abilityBonuses?.[ability] ?? 0) - (base.abilityBonuses?.[ability] ?? 0),
        )}`,
    )
    .join(' · ');
}

interface CreationWizardProps {
  user: SessionUser;
  /** Como começar a mesa: o nível inicial vem da configuração da mesa. */
  onCharacter: (character: Character) => void;
  /** Criação concluída: o assistente fecha e a ficha aparece. */
  onFinished: (character: Character) => void;
}

/**
 * Assistente de criação de personagem (tela cheia).
 *
 * Abre sozinho para o jogador que ainda não tem ficha ou que tem uma ficha com a
 * criação em aberto (`creationFinalized = false`), e bloqueia o acesso à ficha
 * até o fim. O progresso é salvo a cada passo no próprio registro do personagem:
 * fechar o navegador não perde nada, o jogador retoma de onde parou.
 *
 * As regras são todas do servidor (classe, pré-requisito de atributo, PV, CA,
 * perícias e níveis iniciais) — aqui só existe a condução dos passos.
 */
export function CreationWizard({ user, onCharacter, onFinished }: CreationWizardProps) {
  const [state, setState] = useState<CreationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Campos dos passos (hidratados do rascunho na abertura).
  const [mode, setMode] = useState<'new' | 'existing' | null>(null);
  const [name, setName] = useState('');
  const [alignment, setAlignment] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [race, setRace] = useState('');
  /** Raça "mãe" selecionada na grade da sub-etapa 3a (chave do grupo). */
  const [raceBaseKey, setRaceBaseKey] = useState('');
  /** Sub-etapa interna do passo 3: 'race' (3a) ou 'subrace' (3b). */
  const [raceSubStep, setRaceSubStep] = useState<'race' | 'subrace'>('race');
  const [abilityChoices, setAbilityChoices] = useState<AbilityKey[]>([]);
  /** Escolhas da raça fora os atributos: `{ escolha: opção }`. */
  const [raceChoices, setRaceChoices] = useState<Record<string, string>>({});
  /** Idiomas escolhidos quando a raça concede idioma(s) à escolha. */
  const [languageChoices, setLanguageChoices] = useState<string[]>([]);
  const [background, setBackground] = useState('');
  /** Ferramentas escolhidas por categoria no antecedente: `{ escolha: id }`. */
  const [backgroundToolChoices, setBackgroundToolChoices] = useState<Record<string, string>>({});
  /** Idiomas escolhidos quando o antecedente concede idioma(s) à escolha. */
  const [backgroundLanguageChoices, setBackgroundLanguageChoices] = useState<string[]>([]);
  const [classKey, setClassKey] = useState('');
  const [subclass, setSubclass] = useState('');
  /** Escolhas de característica do passo 5 (Estilo de Luta, Inimigo Favorito). */
  const [choicePicks, setChoicePicks] = useState<Record<string, string[]>>({});
  const [assigned, setAssigned] = useState<Partial<Record<AbilityKey, number>>>({});
  const [picks, setPicks] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  const character = state?.character ?? null;
  const creation = state?.creation ?? null;

  /** Hidrata os campos locais a partir do que já está gravado (retomada). */
  const hydrate = useCallback((response: CreationResponse) => {
    const { creation: saved, character: sheet } = response;

    setMode(saved.mode);
    setName(
      sheet && sheet.name.trim().toLowerCase() !== DEFAULT_NAME ? sheet.name : '',
    );
    setAlignment(sheet?.alignment ?? '');
    setAvatarUrl(sheet?.avatarUrl ?? '');
    setRace(sheet?.race ?? '');
    // Retoma já na grade da raça, com a raça gravada pré-selecionada.
    const storedLineage = findRaceOption(saved.raceCatalog ?? [], sheet?.race ?? '');
    setRaceBaseKey(storedLineage ? raceGroupKeyOf(storedLineage) : '');
    setRaceSubStep('race');
    setAbilityChoices(saved.abilityChoices ?? []);
    setRaceChoices(saved.raceChoices ?? {});
    setLanguageChoices(saved.languageChoices ?? []);
    setBackground(sheet?.background ?? '');
    setBackgroundToolChoices(saved.backgroundToolChoices ?? {});
    setBackgroundLanguageChoices(saved.backgroundLanguageChoices ?? []);
    setClassKey(sheet?.classes[0]?.classKey ?? '');
    setSubclass(sheet?.classes[0]?.subclass ?? '');
    setAssigned(saved.baseAbilities);
    setPicks(saved.skillPicks);
    setStep(saved.step);
  }, []);

  useEffect(() => {
    let active = true;

    fetchCreationState()
      .then((response) => {
        if (!active) return;
        setState(response);
        hydrate(response);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao abrir a criação.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [hydrate]);

  /** Grava o passo e avança. Cada passo é salvo no servidor na hora. */
  const saveStep = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);

      try {
        const response = await saveCreationStep({ step, ...body } as CreationStepRequest);
        setState(response);
        if (response.character) onCharacter(response.character);
        // Trocar a raça poda as escolhas que a nova raça já concede (o servidor
        // faz a poda); sincroniza o estado local para o passo 7 não guardar uma
        // escolha que agora vem marcada e travada.
        if (step === 3) setPicks(response.creation.skillPicks);
        setStep((current) => Math.min(LAST_STEP, current + 1));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao salvar este passo.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [step, onCharacter],
  );

  /** Rolagem de atributo do passo 6 (o dado é sorteado no servidor). */
  const rollAttribute = useCallback(
    async (restart: boolean): Promise<CreationRoll | null> => {
      const response = await rollCreationAttribute(restart);
      setState(response);
      if (response.character) onCharacter(response.character);
      if (restart) setAssigned({});
      return response.roll ? { dice: response.roll.dice, dropped: response.roll.dropped } : null;
    },
    [onCharacter],
  );

  /* --- O que cada passo exige para poder avançar ------------------------- */

  const skillCount = creation?.skillChoice.count ?? 0;
  const skillPool = useMemo(() => {
    const from = creation?.skillChoice.from ?? [];
    const keys = from.length > 0 ? from : SKILLS.map((skill) => skill.key);
    return keys
      .map((key) => SKILLS.find((skill) => skill.key === key))
      .filter((skill): skill is (typeof SKILLS)[number] => Boolean(skill));
  }, [creation?.skillChoice.from]);

  /** A LINHAGEM escolhida (raça base ou sub-raça), quando vem do catálogo. */
  const selectedRace = useMemo(
    () => findRaceOption(creation?.raceCatalog ?? [], race),
    [creation?.raceCatalog, race],
  );

  /** As raças na grade da 3a: uma entrada por grupo (sem as variantes de sub-raça). */
  const raceCards = useMemo(
    () => (creation?.raceCatalog ?? []).filter((option) => !option.subraceId),
    [creation?.raceCatalog],
  );

  /** Sub-raças de uma raça, na ordem do catálogo. */
  const subracesOf = useCallback(
    (base: RaceOption): RaceOption[] =>
      (creation?.raceCatalog ?? []).filter(
        (option) => option.subraceId && raceGroupKeyOf(option) === raceGroupKeyOf(base),
      ),
    [creation?.raceCatalog],
  );

  /** A raça "mãe" selecionada na 3a (pelo grupo). */
  const raceBaseOption = useMemo(
    () => raceCards.find((option) => raceGroupKeyOf(option) === raceBaseKey) ?? null,
    [raceCards, raceBaseKey],
  );

  const raceBaseSubraces = raceBaseOption ? subracesOf(raceBaseOption) : [];
  const raceNeedsSubrace = raceBaseSubraces.length > 0;

  /** Traços que são SÓ da sub-raça escolhida (os da raça base ficam à parte). */
  const subraceOnlyTraits = useMemo(() => {
    if (!raceBaseOption || !selectedRace?.subraceId) return [];
    const baseIds = new Set((raceBaseOption.traits ?? []).map((trait) => trait.id));
    return (selectedRace.traits ?? []).filter((trait) => !baseIds.has(trait.id));
  }, [raceBaseOption, selectedRace]);

  /**
   * As escolhas da raça (ancestralidade do Draconato, perícia/ferramenta,
   * idiomas e o `+1` à escolha) são da RAÇA e vivem no painel da 3a — mesmo
   * quando ela tem sub-raça, porque a sub-raça não acrescenta escolhas próprias.
   */
  const raceChoiceNeeded = raceBaseOption?.abilityChoice ?? 0;

  const raceExtraChoices = useMemo(
    () => (raceBaseOption?.choices ?? []).filter((choice) => choice.apply !== 'ability'),
    [raceBaseOption],
  );

  const raceExtrasReady = raceExtraChoices.every((choice) => {
    const picked = raceChoices[choice.id];
    return Boolean(picked) && choice.options.some((option) => option.id === picked);
  });

  /** Quantos idiomas à escolha a raça concede (Humano e Meio-Elfo: 1). */
  const languageChoiceCount = raceBaseOption?.bonusLanguageChoices ?? 0;

  /** Idiomas disponíveis: os do catálogo que a raça não concede de forma fixa. */
  const languagePool = useMemo(() => {
    const fixed = new Set(raceBaseOption?.languages ?? []);
    return LANGUAGE_NAMES.filter((name) => !fixed.has(name));
  }, [raceBaseOption]);

  /** Todas as escolhas obrigatórias da raça respondidas? */
  const raceChoicesReady =
    (raceChoiceNeeded === 0 || abilityChoices.length === raceChoiceNeeded) &&
    raceExtrasReady &&
    (languageChoiceCount === 0 ||
      languageChoices.filter(Boolean).length === languageChoiceCount);

  /** Grava o idioma da enésima escolha, sem repetir. */
  function setLanguageChoice(index: number, value: string): void {
    setLanguageChoices((current) => {
      const next = [...current];
      if (value === '') next.splice(index, 1);
      else if (index < next.length) next[index] = value;
      else next.push(value);
      return [...new Set(next)];
    });
  }

  /** O antecedente escolhido, quando ele vem do catálogo (por nome ou por chave). */
  const selectedBackground = useMemo(() => {
    const needle = background.trim().toLowerCase();
    if (!needle) return null;
    return (
      (creation?.backgroundCatalog ?? []).find(
        (option) =>
          option.name.toLowerCase() === needle || option.key.toLowerCase() === needle,
      ) ?? null
    );
  }, [creation?.backgroundCatalog, background]);

  /** Perícias que o antecedente concede (mostradas nos passos 4 e 7). */
  const backgroundSkillLabels = selectedBackground
    ? backgroundSkillNames(selectedBackground)
    : [];

  /** Chaves (cruas) das perícias do antecedente — travadas no passo 7. */
  const backgroundSkillKeys = useMemo(
    () => new Set(selectedBackground?.skills ?? []),
    [selectedBackground],
  );

  /** Chaves das perícias que a RAÇA já concede (ex.: Percepção do Elfo). */
  const raceSkillKeys = useMemo(
    () => new Set(creation?.raceSkillKeys ?? []),
    [creation?.raceSkillKeys],
  );

  /** Nomes das perícias raciais, para a nota do passo 7. */
  const raceSkillLabels = useMemo(
    () =>
      [...raceSkillKeys].map(
        (key) => SKILLS.find((skill) => skill.key === key)?.label ?? key,
      ),
    [raceSkillKeys],
  );

  /**
   * Escolhas de perícia da classe válidas: descarta as que o antecedente já
   * concede (aparecem marcadas e travadas na lista, sem gastar escolha).
   */
  /** Chaves do pool da classe (o que o passo 7 mostra). */
  const skillPoolKeys = useMemo(() => new Set(skillPool.map((skill) => skill.key)), [skillPool]);

  const effectivePicks = useMemo(
    () =>
      picks.filter(
        (key) =>
          skillPoolKeys.has(key) && !backgroundSkillKeys.has(key) && !raceSkillKeys.has(key),
      ),
    [picks, skillPoolKeys, backgroundSkillKeys, raceSkillKeys],
  );

  /** Escolhas de ferramenta por categoria que o antecedente pede. */
  const backgroundToolChoiceDefs = selectedBackground?.toolChoices ?? [];

  /** Todas as escolhas de ferramenta do antecedente já respondidas? */
  const backgroundToolsReady = backgroundToolChoiceDefs.every((choice) => {
    const picked = backgroundToolChoices[choice.id];
    return Boolean(picked) && choice.options.some((option) => option.id === picked);
  });

  /** Quantos idiomas à escolha o antecedente concede (Acólito/Sábio: 2). */
  const backgroundLanguageCount = selectedBackground?.languageChoices ?? 0;

  /** Idiomas disponíveis: os do catálogo que a ficha ainda não tem (raça). */
  const backgroundLanguagePool = useMemo(() => {
    const taken = new Set([...(character?.languages ?? []), ...languageChoices]);
    return LANGUAGE_NAMES.filter((name) => !taken.has(name));
  }, [character?.languages, languageChoices]);

  /**
   * Seleciona a raça na grade da 3a. Troca de grupo limpa as escolhas (o pool
   * muda); raça sem sub-raça já fixa a linhagem, com sub-raça ela fica pendente
   * até a 3b.
   */
  function pickBaseRace(base: RaceOption): void {
    const group = raceGroupKeyOf(base);
    if (group !== raceBaseKey) {
      setAbilityChoices([]);
      setRaceChoices({});
      setLanguageChoices([]);
    }
    setRaceBaseKey(group);

    const subs = subracesOf(base);
    if (subs.length === 0) {
      setRace(base.key);
    } else if (!selectedRace || raceGroupKeyOf(selectedRace) !== group) {
      setRace('');
    }
  }

  /** Seleciona a sub-raça na 3b (as escolhas da raça base são preservadas). */
  function pickSubrace(lineage: RaceOption): void {
    setRace(lineage.key);
  }

  /** Grava a escolha de uma definição (ancestralidade, perícia, ferramenta…). */
  function setRaceExtraChoice(id: string, value: string): void {
    setRaceChoices((current) => {
      const next = { ...current };
      if (value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }

  /** Troca o antecedente e recomeça as escolhas dele (ferramentas e idiomas). */
  function selectBackground(value: string): void {
    setBackground(value);
    setBackgroundToolChoices({});
    setBackgroundLanguageChoices([]);
  }

  /** Grava a ferramenta de uma escolha por categoria do antecedente. */
  function setBackgroundToolChoice(id: string, value: string): void {
    setBackgroundToolChoices((current) => {
      const next = { ...current };
      if (value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }

  /** Grava o idioma da enésima escolha do antecedente, sem repetir. */
  function setBackgroundLanguageChoice(index: number, value: string): void {
    setBackgroundLanguageChoices((current) => {
      const next = [...current];
      if (value === '') next.splice(index, 1);
      else if (index < next.length) next[index] = value;
      else next.push(value);
      return [...new Set(next)];
    });
  }

  /** Grava o atributo da enésima escolha da raça (+1), sem repetir atributo. */
  function setRaceChoice(index: number, value: string): void {
    setAbilityChoices((current) => {
      const next = [...current];
      if (value === '') next.splice(index, 1);
      else if (index < next.length) next[index] = value as AbilityKey;
      else next.push(value as AbilityKey);
      return [...new Set(next)];
    });
  }

  /** A classe escolhida, com a subclasse que o nível 1 já exige (Clérigo/Feiticeiro/Bruxo). */
  const selectedClass = useMemo(
    () => (character?.classOptions ?? []).find((option) => option.key === classKey) ?? null,
    [character?.classOptions, classKey],
  );
  const classNeedsSubclass =
    selectedClass !== null &&
    selectedClass.subclassLevel <= 1 &&
    selectedClass.subclassNames.length > 0;

  /**
   * Escolhas que a classe pede no NÍVEL 1 (Estilo de Luta do Guerreiro, Inimigo
   * Favorito e Explorador Nato do Patrulheiro). O Estilo de Luta do Paladino e
   * do Patrulheiro só chega no 2º nível — lá elas aparecem no Level Up.
   */
  const featureChoices = useMemo(() => {
    if (selectedClass === null || classKey === '') return [];
    // As opções vêm da classe SELECIONADA (`classOptions[].featureChoices`); o
    // que já estava escolhido só vale se for a MESMA classe que está na ficha.
    const sameClass = character?.classes[0]?.classKey === selectedClass.key;
    const stored = new Map(
      (sameClass ? (creation?.featureChoices ?? []) : []).map((item) => [
        item.featureId,
        item.chosen,
      ]),
    );
    // A Expertise fica de fora daqui: ela é pedida no passo das perícias, quando
    // já dá para saber o que o personagem domina.
    return (selectedClass.featureChoices ?? [])
      .filter((item) => item.apply !== 'expertise')
      .map((item) => ({
        ...item,
        chosen: stored.get(item.featureId) ?? [],
      }));
  }, [selectedClass, classKey, character?.classes, creation?.featureChoices]);

  /**
   * Expertise do nível 1 (Ladino): pedida junto das perícias, com as opções
   * saindo do que o personagem JÁ domina — as escolhas desta tela contam.
   */
  const expertiseChoice = useMemo(() => {
    const base = creation?.expertiseChoices?.[0];
    if (!base) return null;
    const proficient = new Set(picks);
    for (const [key, entry] of Object.entries(character?.skills ?? {})) {
      if (entry.proficient) proficient.add(key);
    }
    const options = expertiseEligibleOptions(
      [...proficient],
      character?.proficiencies?.tools ?? [],
    );
    return { ...base, options: options.map((option) => ({ ...option, description: '' })) };
  }, [creation?.expertiseChoices, picks, character?.skills, character?.proficiencies?.tools]);

  /** Escolhas completas (uma opção por escolha pedida). */
  const choicesReady = featureChoices.every(
    (item) => (choicePicks[item.featureId] ?? item.chosen).filter(Boolean).length >= item.count,
  );

  const assignedCount = ABILITY_KEYS.filter((ability) => assigned[ability] !== undefined).length;
  const abilitiesReady = assignedCount === ABILITY_KEYS.length;
  const level = character?.level ?? 0;
  const startingLevel = creation?.startingLevel ?? 1;

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return mode !== null;
      case 2:
        return name.trim().length >= 2;
      case 3: {
        if (raceBaseOption === null) return false;
        // Com sub-raça, a 3a só exige a raça (o "Próximo" abre a 3b).
        if (raceNeedsSubrace && raceSubStep === 'race') return true;
        if (raceNeedsSubrace && selectedRace === null) return false;
        return raceChoicesReady;
      }
      case 4:
        return (
          background.trim().length > 0 &&
          backgroundToolsReady &&
          (backgroundLanguageCount === 0 ||
            backgroundLanguageChoices.filter(Boolean).length === backgroundLanguageCount)
        );
      case 5:
        return classKey !== '' && (!classNeedsSubclass || subclass !== '') && choicesReady;
      case 6:
        return assignedCount === ABILITY_KEYS.length;
      case 7: {
        const expertiseReady =
          expertiseChoice === null ||
          (choicePicks[expertiseChoice.featureId] ?? expertiseChoice.chosen).filter(Boolean)
            .length >= expertiseChoice.count;
        return (skillCount === 0 || effectivePicks.length === skillCount) && expertiseReady;
      }
      case 8:
        return level >= startingLevel;
      default:
        return true;    }
  })();

  /** Corpo do passo atual enviado ao servidor. */
  function stepBody(): Record<string, unknown> {
    switch (step) {
      case 1:
        return { mode };
      case 2:
        return { name, alignment, avatarUrl };
      case 3:
        return { race, abilityChoices, raceChoices, languageChoices };
      case 4:
        return { background, backgroundToolChoices, backgroundLanguageChoices };
      case 5:
        return {
          classKey,
          subclass,
          choices: Object.fromEntries(
            featureChoices.map((item) => [
              item.featureId,
              (choicePicks[item.featureId] ?? item.chosen).filter(Boolean),
            ]),
          ),
        };
      case 6:
        return { baseAbilities: assigned };
      case 7:
        return {
          skills: effectivePicks,
          ...(expertiseChoice
            ? {
                choices: {
                  [expertiseChoice.featureId]: (
                    choicePicks[expertiseChoice.featureId] ?? expertiseChoice.chosen
                  ).filter(Boolean),
                },
              }
            : {}),
        };
      default:
        return {};
    }
  }

  async function next(): Promise<void> {
    if (busy) return;
    // Passo 3 com sub-raça: o "Próximo" da 3a abre a sub-etapa 3b (sem salvar).
    if (step === 3 && raceNeedsSubrace && raceSubStep === 'race') {
      setRaceSubStep('subrace');
      return;
    }
    if (!canAdvance) return;
    await saveStep(stepBody());
  }

  async function finish(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await finalizeCreation();
      if (response.character) onFinished(response.character);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao finalizar a criação.');
    } finally {
      setBusy(false);
    }
  }

  /** Passo 8: aplica um nível pelo assistente de Level Up da ficha. */
  async function applyLevelUp(request: LevelUpRequest): Promise<Character> {
    const response = await creationLevelUp(request);
    setState(response);
    if (response.character) onCharacter(response.character);
    return response.character as Character;
  }

  async function handleAvatar(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadAvatar(payload.dataUrl, payload.name);
      setAvatarUrl(image.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar o avatar.');
    } finally {
      setUploading(false);
    }
  }

  const racialBonus = useMemo(
    () => raceBonusesWithChoices(selectedRace, abilityChoices),
    [selectedRace, abilityChoices],
  );

  if (loading) {
    return (
      <div className="wizard-overlay">
        <p className="splash">Abrindo a criação de personagem...</p>
      </div>
    );
  }

  return (
    <div className="wizard-overlay">
      <div className="wizard">
        <header className="wizard-head">
          <h1>
            <Icon name="scroll" size={20} /> Criação de personagem
          </h1>
          <span className="wizard-user">{user.displayName}</span>
        </header>

        {/* Trilha dos nove passos. */}
        <ol className="wizard-track">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            const state_ = number === step ? 'current' : number < step ? 'done' : 'todo';
            return (
              <li key={label} className={`wizard-step-chip ${state_}`}>
                <span className="wizard-step-number">{number}</span>
                <span className="wizard-step-label">{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="wizard-body">
          <h2>
            {step}. {STEP_LABELS[step - 1]}
          </h2>

          {/* --- 1. Tipo de personagem -------------------------------------- */}
          {step === 1 ? (
            <div className="wizard-step-body">
              <p className="section-note">
                O personagem é novo (você rola os atributos) ou já existe na mesa (você digita os
                valores que já tem)?
              </p>
              <ul className="modal-list">
                {[
                  {
                    value: 'new' as const,
                    label: 'Personagem novo',
                    hint: 'Role 4d6 (descartando o menor) seis vezes e distribua os valores.',
                  },
                  {
                    value: 'existing' as const,
                    label: 'Personagem existente',
                    hint: 'Digite os atributos da sua ficha, de 1 a 20.',
                  },
                ].map((option) => (
                  <li key={option.value}>
                    <label className={mode === option.value ? 'check-row active' : 'check-row'}>
                      <input
                        type="radio"
                        name="creation-mode"
                        checked={mode === option.value}
                        onChange={() => setMode(option.value)}
                      />
                      <span className="check-name">
                        {option.label}
                        <span className="muted"> · {option.hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* --- 2. Identidade ---------------------------------------------- */}
          {step === 2 ? (
            <div className="wizard-step-body">
              <div className="wizard-identity">
                <div className="wizard-avatar">
                  <Portrait src={avatarUrl} alt={name || 'Personagem'} size="lg" icon="users" />
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={uploading || busy}
                    onClick={() => avatarInput.current?.click()}
                  >
                    <Icon name="quill" size={14} /> {uploading ? 'enviando...' : 'escolher avatar'}
                  </button>
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => void handleAvatar(event.target.files)}
                  />
                  <small className="muted">opcional</small>
                </div>

                <div className="grid grid-2">
                  <label className="field">
                    <span>Nome</span>
                    <input
                      type="text"
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Alinhamento</span>
                    <select value={alignment} onChange={(event) => setAlignment(event.target.value)}>
                      <option value="">— escolha —</option>
                      {ALIGNMENTS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {/* --- 3. Raça (grade + sub-raça) ---------------------------------- */}
          {step === 3 ? (
            <div className="wizard-step-body">
              {creation && creation.raceCatalog.length > 0 ? (
                raceSubStep === 'race' ? (
                  <>
                    <p className="wizard-race-title">Selecionar Raça</p>

                    <div className="race-grid" role="radiogroup" aria-label="Raça">
                      {raceCards.map((base) => {
                        const selected = raceGroupKeyOf(base) === raceBaseKey;
                        return (
                          <button
                            type="button"
                            key={base.key}
                            className={`race-card${selected ? ' is-selected' : ''}`}
                            aria-pressed={selected}
                            disabled={busy}
                            onClick={() => pickBaseRace(base)}
                          >
                            <span className="race-portrait" aria-hidden="true">
                              <RaceFaceIcon option={base} />
                            </span>
                            <span className="race-card-name">{base.name}</span>
                            {base.customRaceId ? (
                              <span className="race-card-tag">Personalizada</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    {raceBaseOption ? (
                      <div className="race-detail">
                        <h3>{raceBaseOption.name}</h3>
                        {raceBaseOption.description ? (
                          <p className="race-detail-note">{raceBaseOption.description}</p>
                        ) : null}

                        <p className="race-bonus">
                          <strong>Bônus de atributo</strong>
                          {raceBonusLabel(raceBaseOption) || '—'}
                        </p>

                        {(raceBaseOption.traits ?? []).length > 0 ? (
                          <>
                            <span className="race-detail-sub">Recursos da raça</span>
                            <div className="race-traits-full">
                              {(raceBaseOption.traits ?? []).map((trait) => (
                                <p className="race-trait-line" key={trait.id}>
                                  <strong>{trait.name}</strong>
                                  {trait.description}
                                </p>
                              ))}
                            </div>
                          </>
                        ) : null}

                        {/* Meio-Elfo: +1 em dois atributos à escolha. */}
                        {raceChoiceNeeded > 0 ? (
                          <div className="wizard-race-choice">
                            <p className="section-note">
                              {raceBaseOption.name} concede +1 em {raceChoiceNeeded} atributos à sua
                              escolha (além dos bônus fixos de{' '}
                              {raceBonusLabel(raceBaseOption) || '—'}).
                            </p>
                            <div className="grid grid-2">
                              {Array.from({ length: raceChoiceNeeded }, (_, index) => {
                                const chosen = abilityChoices[index] ?? '';
                                return (
                                  <label className="field" key={`race-choice-${index}`}>
                                    <span>Escolha {index + 1}</span>
                                    <select
                                      value={chosen}
                                      disabled={busy}
                                      onChange={(event) => setRaceChoice(index, event.target.value)}
                                    >
                                      <option value="">— escolha —</option>
                                      {raceChoicePool(raceBaseOption).map((ability) => (
                                        <option
                                          key={ability}
                                          value={ability}
                                          disabled={
                                            abilityChoices.includes(ability) && chosen !== ability
                                          }
                                        >
                                          {ABILITY_LABELS[ability]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* Demais escolhas: ancestralidade do Draconato, perícias
                            do Meio-Elfo, ferramenta do Anão... */}
                        {raceExtraChoices.length > 0 ? (
                          <div className="wizard-race-choice">
                            <p className="section-note">
                              {raceBaseOption.name} pede as escolhas abaixo.
                            </p>
                            <div className="grid grid-2">
                              {raceExtraChoices.map((choice) => (
                                <label className="field" key={choice.id}>
                                  <span>{choice.label}</span>
                                  <select
                                    value={raceChoices[choice.id] ?? ''}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setRaceExtraChoice(choice.id, event.target.value)
                                    }
                                  >
                                    <option value="">— escolha —</option>
                                    {choice.options.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Idiomas à escolha (Humano e Meio-Elfo concedem 1). */}
                        {languageChoiceCount > 0 ? (
                          <div className="wizard-race-choice">
                            <p className="section-note">
                              {raceBaseOption.name} concede {languageChoiceCount} idioma(s) à sua
                              escolha.
                            </p>
                            <div className="grid grid-2">
                              {Array.from({ length: languageChoiceCount }, (_, index) => {
                                const chosen = languageChoices[index] ?? '';
                                return (
                                  <label className="field" key={`language-choice-${index}`}>
                                    <span>Idioma {index + 1}</span>
                                    <select
                                      value={chosen}
                                      disabled={busy}
                                      onChange={(event) =>
                                        setLanguageChoice(index, event.target.value)
                                      }
                                    >
                                      <option value="">— escolha —</option>
                                      {languagePool.map((name) => (
                                        <option
                                          key={name}
                                          value={name}
                                          disabled={
                                            languageChoices.includes(name) && chosen !== name
                                          }
                                        >
                                          {name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="section-note">Escolha uma raça acima para ver os detalhes.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="wizard-race-title">Selecionar Sub-raça</p>

                    <div className="race-grid" role="radiogroup" aria-label="Sub-raça">
                      {raceBaseSubraces.map((lineage) => {
                        const selected = selectedRace?.key === lineage.key;
                        return (
                          <button
                            type="button"
                            key={lineage.key}
                            className={`race-card${selected ? ' is-selected' : ''}`}
                            aria-pressed={selected}
                            disabled={busy}
                            onClick={() => pickSubrace(lineage)}
                          >
                            <span className="race-portrait" aria-hidden="true">
                              <RaceFaceIcon option={lineage} />
                            </span>
                            <span className="race-card-name">{subraceName(lineage)}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* A raça base segue visível durante a escolha da sub-raça,
                        para comparar o que a linhagem acrescenta. */}
                    {raceBaseOption ? (
                      <div className="race-detail">
                        <h3>{raceBaseOption.name}</h3>
                        {raceBaseOption.description ? (
                          <p className="race-detail-note">{raceBaseOption.description}</p>
                        ) : null}

                        <p className="race-bonus">
                          <strong>Bônus de atributo</strong>
                          {raceBonusLabel(raceBaseOption) || '—'}
                        </p>

                        {(raceBaseOption.traits ?? []).length > 0 ? (
                          <>
                            <span className="race-detail-sub">Recursos da raça</span>
                            <div className="race-traits-full">
                              {(raceBaseOption.traits ?? []).map((trait) => (
                                <p className="race-trait-line" key={trait.id}>
                                  <strong>{trait.name}</strong>
                                  {trait.description}
                                </p>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {selectedRace ? (
                      <div className="race-detail">
                        <h3>{selectedRace.name}</h3>
                        {raceBaseOption && subraceBonusLabel(raceBaseOption, selectedRace) ? (
                          <p className="race-bonus">
                            <strong>Bônus da sub-raça</strong>
                            {subraceBonusLabel(raceBaseOption, selectedRace)}
                          </p>
                        ) : null}

                        {subraceOnlyTraits.length > 0 ? (
                          <>
                            <span className="race-detail-sub">Traços da sub-raça</span>
                            <div className="race-traits-full">
                              {subraceOnlyTraits.map((trait) => (
                                <p className="race-trait-line" key={trait.id}>
                                  <strong>{trait.name}</strong>
                                  {trait.description}
                                </p>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <p className="section-note">
                        Escolha uma sub-raça acima para ver o que ela acrescenta.
                      </p>
                    )}
                  </>
                )
              ) : (
                <>
                  <label className="field">
                    <span>Raça</span>
                    <input
                      type="text"
                      value={race}
                      maxLength={60}
                      placeholder="Anão, Elfo, Humano..."
                      onChange={(event) => setRace(event.target.value)}
                    />
                  </label>
                  <p className="section-note">
                    O catálogo de raças ainda não existe: escreva a raça do livro. Quando ele for
                    cadastrado, este passo passa a listar as opções e os bônus de atributo entram
                    automaticamente.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {/* --- 4. Antecedente --------------------------------------------- */}
          {step === 4 ? (
            <div className="wizard-step-body">
              {creation && creation.backgroundCatalog.length > 0 ? (
                <>
                  <label className="field">
                    <span>Antecedente</span>
                    <select
                      value={background}
                      onChange={(event) => selectBackground(event.target.value)}
                    >
                      <option value="">— escolha —</option>
                      {creation.backgroundCatalog.map((option) => {
                        const granted = backgroundSkillNames(option);
                        return (
                          <option key={option.key} value={option.name}>
                            {granted.length > 0
                              ? `${option.name} · ${granted.join(', ')}`
                              : option.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  {selectedBackground ? (
                    <p className="section-note">
                      {selectedBackground.description}
                      {backgroundSkillLabels.length > 0
                        ? ` Perícias concedidas: ${backgroundSkillLabels.join(' e ')}.`
                        : ''}
                      {selectedBackground.feature
                        ? ` Característica: ${selectedBackground.feature.name}.`
                        : ''}
                    </p>
                  ) : null}

                  {/* Ferramentas à escolha por categoria (instrumento, artesão…). */}
                  {selectedBackground && backgroundToolChoiceDefs.length > 0 ? (
                    <div className="wizard-race-choice">
                      <p className="section-note">
                        {selectedBackground.name} pede as ferramentas abaixo.
                      </p>
                      <div className="grid grid-2">
                        {backgroundToolChoiceDefs.map((choice) => (
                          <label className="field" key={choice.id}>
                            <span>{choice.label}</span>
                            <select
                              value={backgroundToolChoices[choice.id] ?? ''}
                              disabled={busy}
                              onChange={(event) =>
                                setBackgroundToolChoice(choice.id, event.target.value)
                              }
                            >
                              <option value="">— escolha —</option>
                              {choice.options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Idiomas à escolha (Acólito e Sábio concedem 2). */}
                  {selectedBackground && backgroundLanguageCount > 0 ? (
                    <div className="wizard-race-choice">
                      <p className="section-note">
                        {selectedBackground.name} concede {backgroundLanguageCount} idioma(s) à
                        sua escolha.
                      </p>
                      <div className="grid grid-2">
                        {Array.from({ length: backgroundLanguageCount }, (_, index) => {
                          const chosen = backgroundLanguageChoices[index] ?? '';
                          return (
                            <label className="field" key={`background-language-${index}`}>
                              <span>Idioma {index + 1}</span>
                              <select
                                value={chosen}
                                disabled={busy}
                                onChange={(event) =>
                                  setBackgroundLanguageChoice(index, event.target.value)
                                }
                              >
                                <option value="">— escolha —</option>
                                {backgroundLanguagePool.map((name) => (
                                  <option
                                    key={name}
                                    value={name}
                                    disabled={
                                      backgroundLanguageChoices.includes(name) && chosen !== name
                                    }
                                  >
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Antecedente</span>
                    <input
                      type="text"
                      value={background}
                      maxLength={120}
                      placeholder="Sábio, Soldado, Criminoso..."
                      onChange={(event) => setBackground(event.target.value)}
                    />
                  </label>
                  <p className="section-note">
                    O catálogo de antecedentes ainda não existe: escreva o antecedente do livro.
                    Quando ele for cadastrado, este passo passa a listar as opções e as perícias
                    concedidas.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {/* --- 5. Classe -------------------------------------------------- */}
          {step === 5 ? (
            <div className="wizard-step-body">
              <p className="section-note">
                A classe inicial. O pré-requisito de atributo do livro é conferido no passo dos
                atributos — é lá que o assistente avisa se algum atributo ainda está abaixo do
                mínimo (13) da classe escolhida.
              </p>
              <ul className="modal-list wizard-classes">
                {(character?.classOptions ?? []).map((option) => (
                  <li key={option.key}>
                    <label className="check-row levelup-choice">
                      <input
                        type="radio"
                        name="creation-class"
                        checked={classKey === option.key}
                        onChange={() => {
                          // Trocar de classe descarta o que era da anterior: a
                          // subclasse, as escolhas e as PERÍCIAS que a nova
                          // lista não aceita (o servidor poda do mesmo jeito).
                          if (option.key !== classKey) {
                            setPicks((current) =>
                              pruneSkillPicksToClass(current, option.skillChoice?.from ?? []),
                            );
                          }
                          setClassKey(option.key);
                          setSubclass('');
                          setChoicePicks({});
                        }}
                      />
                      <span className="check-name">
                        {option.name}
                        <span className="muted">
                          {' '}
                          · d{option.hitDie} · subclasse no nível {option.subclassLevel}
                        </span>
                        {/* Com os atributos já definidos, o motivo do bloqueio
                            ajuda; antes disso ele seria enganoso. */}
                        {abilitiesReady && !option.eligible && option.missing ? (
                          <span className="levelup-blocked"> — {option.missing}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              {/* Clérigo, Feiticeiro e Bruxo escolhem a subclasse já no nível 1. */}
              {classNeedsSubclass && selectedClass ? (
                <div className="wizard-subclass">
                  <h3 className="subsection-title">Subclasse de {selectedClass.name}</h3>
                  <label className="field">
                    <span>Subclasse</span>
                    <select
                      value={subclass}
                      disabled={busy}
                      onChange={(event) => setSubclass(event.target.value)}
                    >
                      <option value="">— escolha —</option>
                      {selectedClass.subclassNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="section-note">
                    {selectedClass.name} escolhe a subclasse já no nível 1: ela entra na ficha junto
                    da classe.
                  </p>
                </div>
              ) : null}

              {/* Escolhas de característica do nível 1 (Estilo de Luta, Inimigo
                  Favorito, Explorador Nato). */}
              {featureChoices.map((item) => (
                <div className="wizard-subclass" key={item.featureId}>
                  <h3 className="subsection-title">
                    {item.prompt} de {selectedClass?.name}
                  </h3>
                  <FeatureChoiceField
                    info={item}
                    values={choicePicks[item.featureId] ?? item.chosen}
                    disabled={busy}
                    onChange={(keys) =>
                      setChoicePicks((current) => ({ ...current, [item.featureId]: keys }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* --- 6. Atributos ----------------------------------------------- */}
          {step === 6 && mode ? (
            <AbilityStep
              mode={mode}
              rolls={creation?.rolls ?? []}
              assigned={assigned}
              racialBonus={racialBonus}
              onRoll={rollAttribute}
              onAssign={(ability, value) =>
                setAssigned((current) => {
                  const next = { ...current };
                  if (value === null) delete next[ability];
                  else next[ability] = value;
                  return next;
                })
              }
              disabled={busy}
            />
          ) : null}

          {/* --- 7. Perícias ------------------------------------------------ */}
          {step === 7 ? (
            <div className="wizard-step-body">
              <p className="section-note">
                A classe concede {skillCount} perícia(s)
                {skillPool.length < SKILLS.length ? ' da lista abaixo' : ' à sua escolha'}.
              </p>

              <div className="grid grid-2 wizard-skills">
                {skillPool.map((skill) => {
                  // Já concedida pelo antecedente ou pela raça: marcada e travada.
                  const fromBackground = backgroundSkillKeys.has(skill.key);
                  const fromRace = raceSkillKeys.has(skill.key);
                  const fromGranted = fromBackground || fromRace;
                  const grantedBy = fromBackground
                    ? `Concedida pelo antecedente ${selectedBackground?.name}`
                    : `Concedida pela raça ${selectedRace?.name}`;
                  const checked = fromGranted || effectivePicks.includes(skill.key);
                  return (
                    <label
                      className={`check-row${fromGranted ? ' is-locked' : ''}`}
                      key={skill.key}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={fromGranted || (!checked && effectivePicks.length >= skillCount)}
                        onChange={() =>
                          setPicks((current) =>
                            current.includes(skill.key)
                              ? current.filter((key) => key !== skill.key)
                              : [...current, skill.key],
                          )
                        }
                      />
                      <span className="check-name">
                        {skill.label}
                        <span className="muted"> · {ABILITY_LABELS[skill.ability]}</span>
                      </span>
                      {fromGranted ? (
                        <span className="info-tip skill-tip">
                          <Icon name="info" size={14} />
                          <span className="info-tip-text" role="tooltip">
                            <strong>{skill.label}</strong>
                            {grantedBy} — entra na ficha sem gastar as escolhas da classe.
                          </span>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {backgroundSkillLabels.length > 0 ? (
                <p className="section-note">
                  O antecedente {selectedBackground?.name} já concede{' '}
                  {backgroundSkillLabels.join(' e ')} — entram na ficha sem gastar as escolhas da
                  classe; as que também aparecem na lista já vêm marcadas e travadas.
                </p>
              ) : null}

              {raceSkillLabels.length > 0 ? (
                <p className="section-note">
                  A raça {selectedRace?.name} já concede {raceSkillLabels.join(' e ')} — entram na
                  ficha sem gastar as escolhas da classe; as que também aparecem na lista já vêm
                  marcadas e travadas.
                </p>
              ) : null}

              <p className="section-note">
                {effectivePicks.length}/{skillCount} escolhida(s)
              </p>

              {expertiseChoice ? (
                <div className="wizard-subclass">
                  <h3 className="subsection-title">{expertiseChoice.prompt}</h3>
                  <FeatureChoiceField
                    info={expertiseChoice}
                    values={choicePicks[expertiseChoice.featureId] ?? expertiseChoice.chosen}
                    disabled={busy}
                    onChange={(keys) =>
                      setChoicePicks((current) => ({
                        ...current,
                        [expertiseChoice.featureId]: keys,
                      }))
                    }
                  />
                  <p className="section-note">
                    A Expertise dobra o bônus de proficiência; só entra o que você já domina.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* --- 8. Nível e progressão -------------------------------------- */}
          {step === 8 ? (
            <div className="wizard-step-body">
              <p className="section-note">
                Esta mesa começa no <strong>nível {startingLevel}</strong>. O assistente aplica os
                níveis do personagem com a mesma regra do Level Up (dado de vida, subclasse,
                aumento de atributo ou talento).
              </p>

              <ul className="levelup-summary">
                <li>
                  <span>Nível atual</span>
                  <strong>{level}</strong>
                </li>
                <li>
                  <span>Nível inicial da mesa</span>
                  <strong>{startingLevel}</strong>
                </li>
              </ul>

              {level < startingLevel ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setLevelUpOpen(true)}
                >
                  <Icon name="sparkle" size={15} /> aplicar nível {level + 1}
                </button>
              ) : (
                <p className="section-note">
                  <Icon name="sparkle" size={14} /> Pronto: o personagem já está no nível inicial
                  da mesa.
                </p>
              )}

              {/* Montada depois do confirmar: mostra o resumo do nível aplicado. */}
              {levelUpOpen && character ? (
                <LevelUpDialog
                  character={character}
                  apply={applyLevelUp}
                  onClose={() => setLevelUpOpen(false)}
                  onApplied={() => undefined}
                />
              ) : null}
            </div>
          ) : null}

          {/* --- 9. Revisão ------------------------------------------------- */}
          {step === 9 && character ? (
            <div className="wizard-step-body">
              <p className="section-note">
                Confira tudo antes de finalizar. Depois disso a montagem só muda pelo Level Up — ou
                pelas mãos do mestre.
              </p>

              <ul className="levelup-summary wizard-review">
                <li>
                  <span>Nome</span>
                  <strong>{character.name}</strong>
                </li>
                <li>
                  <span>Raça · antecedente · alinhamento</span>
                  <strong>
                    {[character.race, character.background, character.alignment]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </strong>
                </li>
                <li>
                  <span>Classe e nível</span>
                  <strong>
                    {character.className || '—'} · nível {character.level}
                    {character.classes[0]?.subclass ? ` · ${character.classes[0].subclass}` : ''}
                  </strong>
                </li>
                <li>
                  <span>Atributos</span>
                  <strong>
                    {ABILITY_KEYS.map(
                      (ability) => `${ABILITY_LABELS[ability]} ${character[ability]}`,
                    ).join(' · ')}
                  </strong>
                </li>
                <li>
                  <span>Pontos de vida</span>
                  <strong>
                    {character.derived.hpMax} (dado de vida {character.derived.hitDie ?? '—'} + Constituição)
                  </strong>
                </li>
                <li>
                  <span>Classe de Armadura</span>
                  <strong>{character.armorClass}</strong>
                </li>
                <li>
                  <span>Perícias com proficiência</span>
                  <strong>
                    {SKILLS.filter((skill) => character.skills[skill.key]?.proficient)
                      .map((skill) => skill.label)
                      .join(', ') || '—'}
                  </strong>
                </li>
              </ul>

              {creation && creation.missing.length > 0 ? (
                <p className="form-error">Ainda falta: {creation.missing.join(', ')}.</p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}
        </div>

        <footer className="wizard-actions">
          <button
            type="button"
            className="btn"
            disabled={step <= 1 || busy}
            onClick={() => {
              setError(null);
              // Sub-raça volta para a grade da raça; voltar do passo 4 cai na 3a.
              if (step === 3 && raceSubStep === 'subrace') {
                setRaceSubStep('race');
                return;
              }
              if (step === 4) setRaceSubStep('race');
              setStep((current) => Math.max(1, current - 1));
            }}
          >
            Voltar
          </button>

          <span className="wizard-progress">
            passo {step} de {LAST_STEP}
          </span>

          {step < LAST_STEP ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canAdvance || busy}
              onClick={() => void next()}
            >
              {busy ? 'salvando...' : 'Próximo'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void finish()}
            >
              <Icon name="scroll" size={15} /> {busy ? 'finalizando...' : 'Finalizar criação'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
