import { useMemo, useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, formatModifier } from '../dnd';
import { FEATS } from '../feats';
import { levelUpCharacter } from '../levelUpApi';
import type { AbilityKey, Character, LevelUpRequest } from '../types';
import { Icon } from './Icon';

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

    const request: LevelUpRequest = {
      classKey,
      subclass: needsSubclass ? subclass : '',
      hp,
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
                  }}
                />
                <span className="check-name">
                  {choice.name}
                  <span className="muted"> · {choice.sub}</span>
                  {!choice.eligible && choice.missing ? (
                    <span className="levelup-blocked"> — {choice.missing}</span>
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
              <select value={subclass} onChange={(event) => setSubclass(event.target.value)}>
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
