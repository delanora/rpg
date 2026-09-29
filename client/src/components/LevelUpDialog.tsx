import { useMemo, useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, SKILLS, formatModifier } from '../dnd';
import { FEATS } from '../feats';
import { levelUpCharacter } from '../levelUpApi';
import type { AbilityKey, Character, LevelUpRequest, ProficienciesState } from '../types';
import { FeatureChoiceField } from './FeatureChoiceField';
import { Icon } from './Icon';

/** Texto curto do que a classe concede ao entrar ("Escudos · Armas simples"). */
function grantLabel(grant: ProficienciesState | undefined): string {
  const items = [...(grant?.armor ?? []), ...(grant?.weapons ?? []), ...(grant?.tools ?? [])];
  return items.length === 0 ? 'Nenhuma proficiência nova' : items.join(' · ');
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
  const [featName, setFeatName] = useState(FEATS[0]?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const pendingChoices = useMemo(() => {
    const source = entry ? entry.featureChoices : (option?.featureChoices ?? []);
    const own = source.filter(
      (item) => item.level === newLevel && item.chosen.length < item.count,
    );

    // A subclasse escolhida AGORA ainda não está na ficha (o DTO da classe só
    // recalcula depois de aplicado), então as escolhas dela neste nível vêm do
    // catálogo: é o caso do Caçador, que pede a Presa do Caçador já no 3º.
    if (!needsSubclass || subclass === '' || option === null) return own;
    const fromSubclass = option.subclassChoices.filter(
      (item) => item.subclass === subclass && item.level === newLevel,
    );
    return [...own, ...fromSubclass];
  }, [entry, option, newLevel, needsSubclass, subclass]);

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

  const feat = FEATS.find((item) => item.name === featName) ?? null;

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
        request.feat = { name: feat.name, description: feat.description };
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

  async function apply(): Promise<void> {
    const request = buildRequest();
    if (!request) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await applyLevelUp(request);
      onApplied(updated);
      onClose();
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
        ? `Talento: ${featName}`
        : abilityMode === 'one'
          ? `${ABILITY_LABELS[abilityA]} +2`
          : `${ABILITY_LABELS[abilityA]} +1, ${ABILITY_LABELS[abilityB]} +1`;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Level Up">
      <div className="modal levelup-modal">
        <h2>
          <Icon name="sparkle" size={20} /> Level Up
        </h2>
        <p className="section-note">
          {character.name} · nível total {character.level} → {character.level + 1}
        </p>

        {/* 1. Escolha da classe */}
        <h3 className="subsection-title">1. Classe</h3>
        {character.classes.length > 0 ? (
          <p className="section-note">
            Subir de nível em uma classe atual ou multiclassar em uma nova?
          </p>
        ) : (
          <p className="section-note">Escolha a primeira classe do personagem.</p>
        )}
        <ul className="modal-list">
          {choices.map((choice) => (
            <li key={choice.key}>
              <label
                className={
                  choice.eligible ? 'check-row levelup-choice' : 'check-row levelup-choice blocked'
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
                  <select value={featName} onChange={(event) => setFeatName(event.target.value)}>
                    {FEATS.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {feat ? <p className="section-note">{feat.description}</p> : null}
                <p className="section-note">
                  O talento fica registrado como texto na aba Características; o efeito mecânico virá
                  em uma etapa futura.
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
