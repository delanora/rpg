import { useCallback, useEffect, useMemo, useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, SKILLS, expertiseEligibleOptions, formatModifier } from '../dnd';
import { FEATS } from '../feats';
import { levelUpCharacter } from '../levelUpApi';
import type {
  AbilityKey,
  Character,
  FeatureChoiceInfo,
  LevelUpRequest,
  ProficienciesState,
} from '../types';
import { FeatureChoiceField } from './FeatureChoiceField';
import { Icon } from './Icon';

/** Texto curto do que a classe concede ao entrar ("Escudos · Armas simples"). */
function grantLabel(grant: ProficienciesState | undefined): string {
  const items = [...(grant?.armor ?? []), ...(grant?.weapons ?? []), ...(grant?.tools ?? [])];
  return items.length === 0 ? 'Nenhuma proficiência nova' : items.join(' · ');
}

/**
 * O que a janela mostra DEPOIS de confirmar: o que foi escolhido e o que o
 * nível trouxe de fato (PV ganho e características novas do livro).
 */
interface LevelUpResult {
  className: string;
  /** Nível da classe antes/depois; `isNew` marca a entrada por multiclasse. */
  classSteps: { from: number; to: number; isNew: boolean };
  totalFrom: number;
  totalTo: number;
  hpGained: number;
  hpDetail: string;
  subclass: string;
  skill: string;
  choices: { prompt: string; picks: string }[];
  asi: string;
  proficiencies: string;
  features: { id: string; name: string; description: string; source: 'class' | 'subclass' }[];
}

interface LevelUpDialogProps {
  character: Character;
  onClose: () => void;
  onApplied: (character: Character) => void;
  /**
   * Como aplicar o nível. O padrão é o Level Up da ficha (liberado pelo mestre);
   * o assistente de criação passa a rota de criação, que aplica os níveis
   * iniciais da mesa sem depender de liberação.
   */
  apply?: (request: LevelUpRequest) => Promise<Character>;
}

type HpMode = 'roll' | 'average';
type AsiMode = 'ability' | 'feat';

/**
 * Assistente de Level Up (janela/pergaminho).
 *
 * Conduz o jogador por classe (subir ou multiclassar), pontos de vida
 * (rolar/média), subclasse quando o nível a libera e Aumento de Atributo/
 * Talento nos níveis certos. O resumo confirma tudo de uma vez; o servidor
 * rola o dado e aplica as regras. Ao concluir, o botão Level Up se desabilita
 * para este jogador até o mestre liberar de novo.
 */
export function LevelUpDialog({
  character,
  onClose,
  onApplied,
  apply: applyLevelUp = levelUpCharacter,
}: LevelUpDialogProps) {
  const [classKey, setClassKey] = useState<string>(character.classes[0]?.classKey ?? '');
  const [subclass, setSubclass] = useState('');
  const [skillChoice, setSkillChoice] = useState('');
  /** Escolhas de característica do nível novo (Estilo de Luta, Inimigo Favorito). */
  const [choicePicks, setChoicePicks] = useState<Record<string, string[]>>({});
  const [hp, setHp] = useState<HpMode>('average');
  const [asiMode, setAsiMode] = useState<AsiMode>('ability');
  const [abilityMode, setAbilityMode] = useState<'one' | 'two'>('two');
  const [abilityA, setAbilityA] = useState<AbilityKey>(ABILITY_KEYS[0]);
  const [abilityB, setAbilityB] = useState<AbilityKey>(ABILITY_KEYS[1]);
  const [featId, setFeatId] = useState(FEATS[0]?.id ?? '');
  /** Atributo escolhido nos "meio-talentos" (Atleta, Resiliente...). */
  const [featAbility, setFeatAbility] = useState<AbilityKey | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A lista de classes só abre pelo botão multiclasse (o padrão é a principal). */
  const [classesOpen, setClassesOpen] = useState(false);
  /** Preenchido ao confirmar: troca o formulário pelo resumo do que veio. */
  const [result, setResult] = useState<LevelUpResult | null>(null);

  const entry = character.classes.find((item) => item.classKey === classKey) ?? null;
  const option = character.classOptions.find((item) => item.key === classKey) ?? null;

  const info = entry
    ? {
        name: entry.className,
        hitDie: entry.hitDie,
        subclassLevel: entry.subclassLevel,
        subclassNames: entry.subclassNames,
        asiLevels: entry.asiLevels,
        currentLevel: entry.level,
        currentSubclass: entry.subclass,
      }
    : option
      ? {
          name: option.name,
          hitDie: option.hitDie,
          subclassLevel: option.subclassLevel,
          subclassNames: option.subclassNames,
          asiLevels: option.asiLevels,
          currentLevel: 0,
          currentSubclass: '',
        }
      : null;

  const newLevel = info ? info.currentLevel + 1 : 0;
  /**
   * Por padrão o Level Up segue a CLASSE PRINCIPAL (a primeira da ficha). A
   * lista com as outras classes — inclusive as novas, por multiclasse — só
   * aparece depois do clique no botão homônimo do cabeçalho.
   */
  const hasClasses = character.classes.length > 0;
  const isNewClassPick = entry === null;
  const canMulticlass = character.classOptions.some(
    (item) => !character.classes.some((current) => current.classKey === item.key),
  );
  const showClassList = !hasClasses || classesOpen;
  const needsSubclass = info !== null && info.currentSubclass === '' && newLevel >= info.subclassLevel;
  const isAsi = info !== null && info.asiLevels.includes(newLevel);

  // Entrada numa classe NOVA (multiclasse de verdade): Bardo, Patrulheiro e
  // Ladino concedem uma perícia à escolha do livro. A primeira classe do
  // personagem não passa por aqui (lá as perícias vêm da criação).
  const multiclassSkill =
    character.classes.length > 0 && entry === null
      ? (option?.multiclassSkillChoice ?? null)
      : null;

  /**
   * Letra do primeiro passo de ESCOLHA do bloco 1: 1a é a própria classe, 1b é a
   * subclasse e a perícia de multiclasse vem em seguida — as escolhas ganham as
   * letras livres depois desses passos, para nenhum cabeçalho repetir.
   */
  const fixedSubSteps = (needsSubclass ? 1 : 0) + (multiclassSkill ? 1 : 0);
  const choiceLetterStart =
    'a'.charCodeAt(0) + (fixedSubSteps > 0 ? fixedSubSteps + 1 : 0);

  /**
   * Escolhas que ESTE nível libera e ainda não foram feitas: Estilo de Luta do
   * guerreiro (1º) e do paladino/patrulheiro (2º), Inimigo Favorito e Explorador
   * Nato do patrulheiro (1º e melhorias do 6º/10º/14º).
   */
  /**
   * A Expertise só pode escolher o que o personagem JÁ domina. O DTO da classe
   * que já está na ficha (`entry.featureChoices`) chega filtrado pelo servidor;
   * o catálogo de uma classe NOVA (multiclasse) traz a lista completa, então a
   * restrição também é feita aqui.
   */
  const restrictExpertise = useCallback(
    (item: FeatureChoiceInfo): FeatureChoiceInfo => {
      if (item.apply !== 'expertise') return item;
      const proficient = Object.entries(character.skills)
        .filter(([, skill]) => skill.proficient)
        .map(([key]) => key);
      const allowed = new Set(
        expertiseEligibleOptions(proficient, character.proficiencies.tools).map(
          (option) => option.key,
        ),
      );
      return { ...item, options: item.options.filter((option) => allowed.has(option.key)) };
    },
    [character.skills, character.proficiencies.tools],
  );

  const pendingChoices = useMemo(() => {
    const source = entry ? entry.featureChoices : (option?.featureChoices ?? []);
    const own = source
      .filter((item) => item.level === newLevel && item.chosen.length < item.count)
      .map(restrictExpertise);

    // A subclasse escolhida AGORA ainda não está na ficha (o DTO da classe só
    // recalcula depois de aplicado), então as escolhas dela neste nível vêm do
    // catálogo: é o caso do Caçador, que pede a Presa do Caçador já no 3º.
    if (!needsSubclass || subclass === '' || option === null) return own;
    const fromSubclass = option.subclassChoices
      .filter((item) => item.subclass === subclass && item.level === newLevel)
      .map(restrictExpertise);
    return [...own, ...fromSubclass];
  }, [entry, option, newLevel, needsSubclass, subclass, restrictExpertise]);

  /** Perícias oferecidas: as da lista da classe, menos as que já são proficientes. */
  const skillOptions = useMemo(() => {
    if (!multiclassSkill) return [];
    const pool = multiclassSkill.from.length === 0 ? null : new Set(multiclassSkill.from);
    return SKILLS.filter(
      (skill) =>
        (pool === null || pool.has(skill.key)) && !character.skills[skill.key]?.proficient,
    );
  }, [multiclassSkill, character.skills]);
  const conModifier = character.derived.modifiers.constitution;
  const averageDie = info ? Math.floor(info.hitDie / 2) + 1 : 0;
  const averageGain = Math.max(1, averageDie + conModifier);

  // Esc fecha a janela, como o X do cabeçalho — nunca no meio de uma aplicação.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const choices = useMemo(
    () => [
      ...character.classes.map((item) => ({
        key: item.classKey,
        name: item.className,
        sub: `nível ${item.level} → ${item.level + 1}`,
        eligible: true,
        missing: '',
      })),
      ...character.classOptions
        .filter((item) => !character.classes.some((entry) => entry.classKey === item.key))
        .map((item) => ({
          key: item.key,
          name: item.name,
          sub: 'nova classe (multiclasse)',
          eligible: item.eligible,
          missing: item.missing,
        })),
    ],
    [character.classes, character.classOptions],
  );

  const feat = FEATS.find((item) => item.id === featId) ?? null;

  function abilityOptions(amount: number): AbilityKey[] {
    return ABILITY_KEYS.filter((ability) => character[ability] + amount <= 20);
  }

  function buildRequest(): LevelUpRequest | null {
    if (!classKey) {
      setError('Escolha a classe que vai subir de nível.');
      return null;
    }
    if (needsSubclass && !subclass) {
      setError(`Escolha a subclasse de ${info?.name ?? ''}.`);
      return null;
    }
    if (multiclassSkill && !skillChoice) {
      setError(`Escolha a perícia concedida por ${info?.name ?? ''}.`);
      return null;
    }
    for (const choice of pendingChoices) {
      const picks = (choicePicks[choice.featureId] ?? []).filter(Boolean);
      if (picks.length < choice.count) {
        setError(`Escolha ${choice.prompt} de ${info?.name ?? ''}.`);
        return null;
      }
    }

    const request: LevelUpRequest = {
      classKey,
      subclass: needsSubclass ? subclass : '',
      hp,
      skillChoice: multiclassSkill ? skillChoice : '',
      choices: Object.fromEntries(
        pendingChoices.map((choice) => [
          choice.featureId,
          (choicePicks[choice.featureId] ?? []).filter(Boolean),
        ]),
      ),
    };

    if (isAsi) {
      if (asiMode === 'feat') {
        if (!feat) {
          setError('Escolha um talento.');
          return null;
        }
        if (feat.abilityChoice && !featAbility) {
          setError(`${feat.name} concede +1 em um atributo à escolha — escolha o atributo.`);
          return null;
        }
        request.feat = {
          id: feat.id,
          name: feat.name,
          description: feat.description,
          ...(feat.abilityChoice && featAbility ? { ability: featAbility } : {}),
        };
      } else if (abilityMode === 'one') {
        request.abilityIncreases = [{ ability: abilityA, amount: 2 }];
      } else {
        if (abilityA === abilityB) {
          setError('Escolha dois atributos diferentes para o +1/+1.');
          return null;
        }
        request.abilityIncreases = [
          { ability: abilityA, amount: 1 },
          { ability: abilityB, amount: 1 },
        ];
      }
    }

    return request;
  }

  /**
   * Resumo do que foi escolhido e do que o nível trouxe, montado com a ficha
   * ANTES e DEPOIS da aplicação (o servidor devolve a ficha já atualizada).
   */
  function summarize(updated: Character): LevelUpResult {
    return {
      className: info?.name ?? '—',
      // `isNew` só vale para a entrada por multiclasse; no assistente de criação
      // a primeira classe também tem `currentLevel` zero, mas não é multiclasse.
      classSteps: { from: info?.currentLevel ?? 0, to: newLevel, isNew: isNewClassPick && hasClasses },
      totalFrom: character.level,
      totalTo: updated.level,
      // Diferença real de PV máximo: já inclui o que um +2 de CON soma retroativamente.
      hpGained: Math.max(0, updated.hpMax - character.hpMax),
      hpDetail:
        hp === 'roll'
          ? `1d${info?.hitDie ?? '—'} ${formatModifier(conModifier)} de CON (mín. 1)`
          : `média ${averageDie} ${formatModifier(conModifier)} de CON`,
      subclass: needsSubclass ? subclass : '',
      skill: multiclassSkill ? SKILLS.find((item) => item.key === skillChoice)?.label ?? '' : '',
      choices: pendingChoices.map((choice) => ({
        prompt: choice.prompt,
        picks: (choicePicks[choice.featureId] ?? [])
          .filter(Boolean)
          .map((key) => choice.options.find((item) => item.key === key)?.name ?? key)
          .join(', '),
      })),
      asi: isAsi ? asiSummary : '',
      proficiencies: multiclassSkill ? grantLabel(option?.multiclassProficiencies) : '',
      // As características DESSE nível da classe escolhida (classe e subclasse).
      features: updated.activeFeatures
        .filter((item) => item.classKey === classKey && item.level === newLevel)
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          source: item.source,
        })),
    };
  }

  async function apply(): Promise<void> {
    const request = buildRequest();
    if (!request) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await applyLevelUp(request);
      // A janela NÃO fecha: mostra o resumo do que foi aplicado e o que veio junto.
      setResult(summarize(updated));
      onApplied(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao subir de nível.');
    } finally {
      setBusy(false);
    }
  }

  const asiSummary =
    !isAsi
      ? ''
      : asiMode === 'feat'
        ? `Talento: ${feat?.name ?? '—'}`
        : abilityMode === 'one'
          ? `${ABILITY_LABELS[abilityA]} +2`
          : `${ABILITY_LABELS[abilityA]} +1, ${ABILITY_LABELS[abilityB]} +1`;

  // Confirmação: o formulário dá lugar ao resumo do que foi aplicado.
  if (result) {
    return (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Level Up concluído"
      >
        <div className="modal levelup-modal">
          <header className="levelup-header">
            <h2>
              <Icon name="sparkle" size={20} /> Level Up concluído
            </h2>
            <div className="levelup-header-actions">
              <button
                type="button"
                className="levelup-close"
                title="Fechar (Esc)"
                aria-label="Fechar"
                onClick={onClose}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          </header>

          <p className="section-note">
            {character.name} agora está no nível total {result.totalTo}.
          </p>

          <h3 className="subsection-title">O que foi escolhido</h3>
          <ul className="levelup-summary">
            <li>
              <span>{result.classSteps.isNew ? 'Nova classe (multiclasse)' : 'Classe'}</span>
              <strong>
                {result.classSteps.isNew || result.classSteps.from === 0
                  ? `${result.className} · nível ${result.classSteps.to}`
                  : `${result.className} ${result.classSteps.from} → ${result.classSteps.to}`}
              </strong>
            </li>
            <li>
              <span>Nível total</span>
              <strong>
                {result.totalFrom} → {result.totalTo}
              </strong>
            </li>
            <li>
              <span>Pontos de vida</span>
              <strong>
                +{result.hpGained} ({result.hpDetail})
              </strong>
            </li>
            {result.subclass ? (
              <li>
                <span>Subclasse</span>
                <strong>{result.subclass}</strong>
              </li>
            ) : null}
            {result.skill ? (
              <li>
                <span>Perícia de multiclasse</span>
                <strong>{result.skill}</strong>
              </li>
            ) : null}
            {result.choices.map((choice) => (
              <li key={choice.prompt}>
                <span>{choice.prompt}</span>
                <strong>{choice.picks || '—'}</strong>
              </li>
            ))}
            {result.asi ? (
              <li>
                <span>Progressão</span>
                <strong>{result.asi}</strong>
              </li>
            ) : null}
            {result.proficiencies ? (
              <li>
                <span>Proficiências</span>
                <strong>{result.proficiencies}</strong>
              </li>
            ) : null}
          </ul>

          <h3 className="subsection-title">O que você ganhou</h3>
          {result.features.length > 0 ? (
            <ul className="levelup-gains">
              {result.features.map((feature) => (
                <li key={`${feature.id}-${feature.source}`}>
                  <strong>
                    {feature.name}
                    {feature.source === 'subclass' ? (
                      <span className="muted"> · subclasse</span>
                    ) : null}
                  </strong>
                  <span>{feature.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="section-note">Este nível não libera características novas.</p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Level Up">
      <div className="modal levelup-modal">
        {/*
         * Cabeçalho: à direita, o atalho para a lista de classes (multiclasse)
         * e o X que fecha a janela — o Esc faz o mesmo.
         */}
        <header className="levelup-header">
          <h2>
            <Icon name="sparkle" size={20} /> Level Up
          </h2>
          <div className="levelup-header-actions">
            {hasClasses && canMulticlass ? (
              <button
                type="button"
                className={
                  classesOpen
                    ? 'btn btn-small levelup-multiclass is-on'
                    : 'btn btn-small levelup-multiclass'
                }
                aria-expanded={classesOpen}
                title="Subir de nível em uma classe nova (multiclasse)"
                onClick={() => setClassesOpen((open) => !open)}
              >
                <Icon name="users" size={14} /> multiclasse
              </button>
            ) : null}
            <button
              type="button"
              className="levelup-close"
              title="Fechar (Esc)"
              aria-label="Fechar a janela de Level Up"
              onClick={onClose}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        </header>

        <p className="section-note">
          {character.name} · nível total {character.level} → {character.level + 1}
        </p>

        {/*
         * 1. Classe: por padrão segue a CLASSE PRINCIPAL (a primeira da ficha).
         * A lista completa (outras classes atuais e as novas, por multiclasse)
         * só aparece depois do clique no botão "multiclasse" do cabeçalho.
         */}
        <h3 className="subsection-title">1. Classe</h3>
        {hasClasses ? (
          <ul className="levelup-summary levelup-class-summary">
            <li>
              <span>{isNewClassPick ? 'Multiclasse' : 'Classe principal'}</span>
              <strong>
                {info?.name ?? '—'}
                {isNewClassPick
                  ? ' · nova classe · nível 1'
                  : ` · nível ${info?.currentLevel ?? 0} → ${newLevel}`}
              </strong>
            </li>
          </ul>
        ) : (
          <p className="section-note">Escolha a primeira classe do personagem.</p>
        )}

        {showClassList ? (
          <>
            {hasClasses ? (
              <p className="section-note">
                Subir em uma classe que já é sua ou entrar em uma nova — a multiclasse segue o
                capítulo 6 do PHB (as perícias e proficiências de entrada entram na ficha).
              </p>
            ) : null}
            <ul className="modal-list">
              {choices.map((choice) => (
                <li key={choice.key}>
                  <label
                    className={
                      choice.eligible
                        ? 'check-row levelup-choice'
                        : 'check-row levelup-choice blocked'
                    }
                  >
                    <input
                      type="radio"
                      name="levelup-class"
                      checked={classKey === choice.key}
                      disabled={!choice.eligible}
                      onChange={() => {
                        setClassKey(choice.key);
                        setSubclass('');
                        setSkillChoice('');
                        setChoicePicks({});
                        // Escolheu: a lista volta a ficar fechada.
                        if (hasClasses) setClassesOpen(false);
                      }}
                    />
                    <span className="check-name">
                      {choice.name}
                      <span className="muted"> · {choice.sub}</span>
                      {!choice.eligible && choice.missing ? (
                        <span className="levelup-blocked">{choice.missing}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* Subclasse, quando o nível libera */}
        {needsSubclass ? (
          <>
            <h3 className="subsection-title">1b. Subclasse de {info?.name}</h3>
            <label className="field">
              <span>Subclasse</span>
              <select
                value={subclass}
                onChange={(event) => {
                  setSubclass(event.target.value);
                  // Trocar de subclasse descarta as escolhas dela (cada uma tem
                  // as próprias características).
                  setChoicePicks({});
                }}
              >
                <option value="">— escolha —</option>
                {info?.subclassNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {/* Perícia concedida pela entrada por multiclasse */}
        {multiclassSkill ? (
          <>
            <h3 className="subsection-title">
              1{needsSubclass ? 'c' : 'b'}. Perícia de {info?.name}
            </h3>
            <p className="section-note">
              Entrar em {info?.name} concede {multiclassSkill.count} perícia à sua escolha
              {multiclassSkill.from.length === 0
                ? ' (qualquer uma)'
                : ' (da lista da classe)'}
              .
            </p>
            <label className="field">
              <span>Perícia</span>
              <select value={skillChoice} onChange={(event) => setSkillChoice(event.target.value)}>
                <option value="">— escolha —</option>
                {skillOptions.map((skill) => (
                  <option key={skill.key} value={skill.key}>
                    {skill.label}
                  </option>
                ))}
              </select>
            </label>
            {skillOptions.length === 0 ? (
              <p className="section-note">
                Todas as perícias oferecidas por esta classe já são proficientes.
              </p>
            ) : null}
            <p className="section-note">
              Proficiências concedidas pela entrada:{' '}
              {grantLabel(option?.multiclassProficiencies)}. Multiclasse nunca concede salvaguardas.
            </p>
          </>
        ) : null}

        {/* Escolhas de característica liberadas por este nível */}
        {pendingChoices.length > 0 ? (
          <>
            {pendingChoices.map((choice, index) => (
              <div key={choice.featureId}>
                <h3 className="subsection-title">
                  1{String.fromCharCode(choiceLetterStart + index)}. {choice.prompt}
                </h3>
                <FeatureChoiceField
                  info={choice}
                  values={choicePicks[choice.featureId] ?? choice.chosen}
                  onChange={(keys) =>
                    setChoicePicks((current) => ({ ...current, [choice.featureId]: keys }))
                  }
                />
              </div>
            ))}
          </>
        ) : null}

        {/* 2. Pontos de vida */}
        <h3 className="subsection-title">2. Pontos de vida</h3>
        <ul className="modal-list">
          <li>
            <label className="check-row levelup-choice">
              <input
                type="radio"
                name="levelup-hp"
                checked={hp === 'roll'}
                onChange={() => setHp('roll')}
              />
              <span className="check-name">
                Rolar o Dado de Vida (1d{info?.hitDie ?? '—'})
                <span className="muted">
                  {' '}
                  · {formatModifier(conModifier)} de CON · mínimo 1
                </span>
              </span>
            </label>
          </li>
          <li>
            <label className="check-row levelup-choice">
              <input
                type="radio"
                name="levelup-hp"
                checked={hp === 'average'}
                onChange={() => setHp('average')}
              />
              <span className="check-name">
                Usar a média ({averageDie})
                <span className="muted">
                  {' '}
                  · {formatModifier(conModifier)} de CON = +{averageGain} PV
                </span>
              </span>
            </label>
          </li>
        </ul>

        {/* 3. Aumento de Atributo / Talento */}
        {isAsi ? (
          <>
            <h3 className="subsection-title">3. Aumento de Atributo ou Talento</h3>
            <div className="levelup-toggle">
              <button
                type="button"
                className={asiMode === 'ability' ? 'btn btn-small active' : 'btn btn-small'}
                onClick={() => setAsiMode('ability')}
              >
                Aumento de Atributo
              </button>
              <button
                type="button"
                className={asiMode === 'feat' ? 'btn btn-small active' : 'btn btn-small'}
                onClick={() => setAsiMode('feat')}
              >
                Talento
              </button>
            </div>

            {asiMode === 'ability' ? (
              <>
                <div className="levelup-toggle">
                  <button
                    type="button"
                    className={abilityMode === 'two' ? 'btn btn-small active' : 'btn btn-small'}
                    onClick={() => setAbilityMode('two')}
                  >
                    +1 em dois
                  </button>
                  <button
                    type="button"
                    className={abilityMode === 'one' ? 'btn btn-small active' : 'btn btn-small'}
                    onClick={() => setAbilityMode('one')}
                  >
                    +2 em um
                  </button>
                </div>
                <div className="grid grid-2">
                  <label className="field">
                    <span>{abilityMode === 'one' ? 'Atributo (+2)' : 'Atributo 1 (+1)'}</span>
                    <select
                      value={abilityA}
                      onChange={(event) => setAbilityA(event.target.value as AbilityKey)}
                    >
                      {abilityOptions(abilityMode === 'one' ? 2 : 1).map((ability) => (
                        <option key={ability} value={ability}>
                          {ABILITY_LABELS[ability]} ({character[ability]})
                        </option>
                      ))}
                    </select>
                  </label>
                  {abilityMode === 'two' ? (
                    <label className="field">
                      <span>Atributo 2 (+1)</span>
                      <select
                        value={abilityB}
                        onChange={(event) => setAbilityB(event.target.value as AbilityKey)}
                      >
                        {abilityOptions(1).map((ability) => (
                          <option key={ability} value={ability}>
                            {ABILITY_LABELS[ability]} ({character[ability]})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Talento</span>
                  <select
                    value={featId}
                    onChange={(event) => {
                      setFeatId(event.target.value);
                      setFeatAbility('');
                    }}
                  >
                    {FEATS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {feat ? <p className="section-note">{feat.description}</p> : null}
                {feat?.abilityChoice ? (
                  <label className="field">
                    <span>
                      Atributo (+{feat.abilityChoice.amount}) — {feat.name}
                    </span>
                    <select
                      value={featAbility}
                      onChange={(event) => setFeatAbility(event.target.value as AbilityKey)}
                    >
                      <option value="">Escolha o atributo…</option>
                      {feat.abilityChoice.options.map((ability) => (
                        <option key={ability} value={ability}>
                          {ABILITY_LABELS[ability]} ({character[ability]})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="section-note">
                  O talento fica registrado na aba Características e seus efeitos numéricos são
                  aplicados automaticamente à ficha.
                </p>
              </>
            )}
          </>
        ) : null}

        {/* 4. Resumo */}
        <h3 className="subsection-title">{isAsi ? '4' : '3'}. Resumo</h3>
        <ul className="levelup-summary">
          <li>
            <span>Nível {info?.name ?? '—'}</span>
            <strong>
              {info ? `${info.currentLevel} → ${newLevel}` : '—'}
            </strong>
          </li>
          <li>
            <span>Nível total</span>
            <strong>
              {character.level} → {character.level + 1}
            </strong>
          </li>
          <li>
            <span>Pontos de vida</span>
            <strong>
              {hp === 'roll' ? `1d${info?.hitDie ?? '—'} + ${conModifier} (mín. 1)` : `+${averageGain}`}
            </strong>
          </li>
          {needsSubclass ? (
            <li>
              <span>Subclasse</span>
              <strong>{subclass || '—'}</strong>
            </li>
          ) : null}
          {multiclassSkill ? (
            <li>
              <span>Perícia de multiclasse</span>
              <strong>
                {SKILLS.find((skill) => skill.key === skillChoice)?.label ?? '—'}
              </strong>
            </li>
          ) : null}
          {pendingChoices.map((choice) => (
            <li key={choice.featureId}>
              <span>{choice.prompt}</span>
              <strong>
                {(choicePicks[choice.featureId] ?? [])
                  .filter(Boolean)
                  .map(
                    (key) => choice.options.find((option) => option.key === key)?.name ?? key,
                  )
                  .join(', ') || '—'}
              </strong>
            </li>
          ))}
          {isAsi ? (
            <li>
              <span>Progressão</span>
              <strong>{asiSummary}</strong>
            </li>
          ) : null}
        </ul>
        <p className="section-note">
          As características de classe e subclasse do novo nível são aplicadas automaticamente.
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
            {busy ? 'subindo...' : 'confirmar Level Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
