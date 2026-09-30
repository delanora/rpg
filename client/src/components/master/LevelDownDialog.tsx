import { useMemo, useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, SKILLS } from '../../dnd';
import type {
  AbilityKey,
  Character,
  LevelDownRequest,
  LevelDownResult,
  LevelDownSummary,
  LevelHistoryRecord,
} from '../../types';
import { Icon } from '../Icon';

interface LevelDownDialogProps {
  character: Character;
  onClose: () => void;
  /** Opcional: a ficha mudou e o painel já adota a versão nova do servidor. */
  onApplied?: (character: Character) => void;
  /**
   * Como reduzir o nível. O padrão do painel é o endpoint do mestre
   * (`POST /api/characters/:id/level-down`).
   */
  apply: (request: LevelDownRequest) => Promise<LevelDownResult>;
}

/** Nomes das opções escolhidas numa característica, para o resumo. */
function choiceSummary(choiceIds: string[]): string {
  return choiceIds.length === 0 ? '—' : `${choiceIds.length} escolha(s) de característica`;
}

function proficiencyList(record: LevelHistoryRecord): string[] {
  const grant = record.proficiencies;
  if (!grant) return [];
  return [...grant.armor, ...grant.weapons, ...grant.tools];
}

/**
 * Downgrade de nível — a janela do MESTRE.
 *
 * Escolhe a classe que perde UM nível e mostra, antes de confirmar, o que aquele
 * nível tinha concedido (PV, Aumento de Atributo/Talento, escolhas, subclasse,
 * perícia e proficiências) — tudo vindo do histórico gravado no Level Up. Ao
 * confirmar, o servidor reverte exatamente isso; a tela de resultado lista o que
 * saiu da ficha.
 *
 * Níveis anteriores ao histórico não têm registro: aí a janela pede o PV perdido
 * e, se o nível for de Aumento de Atributo, o que desfazer.
 */
export function LevelDownDialog({
  character,
  onClose,
  onApplied,
  apply,
}: LevelDownDialogProps) {
  // O último nível ganho é o mais provável de ser desfeito: começa nele.
  const lastRecord = character.levelHistory[character.levelHistory.length - 1] ?? null;
  const [classKey, setClassKey] = useState<string>(
    lastRecord?.classKey ?? character.classes[0]?.classKey ?? '',
  );
  const [hpInput, setHpInput] = useState('');
  const [abilityA, setAbilityA] = useState<AbilityKey | ''>('');
  const [abilityB, setAbilityB] = useState<AbilityKey | ''>('');
  const [featId, setFeatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LevelDownSummary | null>(null);

  const entry = character.classes.find((item) => item.classKey === classKey) ?? null;

  /** O registro do nível que está sendo perdido (null = sem histórico). */
  const record = useMemo(() => {
    if (!entry) return null;
    const found = [...character.levelHistory]
      .reverse()
      .find((item) => item.classKey === entry.classKey);
    return found && found.classLevel === entry.level ? found : null;
  }, [entry, character.levelHistory]);

  const hitDie = entry?.hitDie ?? 8;
  const conModifier = character.derived.modifiers.constitution;
  const estimatedHp = Math.max(1, Math.floor(hitDie / 2) + 1 + conModifier);

  const onlyClass = character.classes.length === 1 && (entry?.level ?? 0) <= 1;
  const feats = character.features.filter((item) => item.source === 'feat');

  function buildRequest(): LevelDownRequest | null {
    if (!entry) {
      setError('Escolha a classe que perde o nível.');
      return null;
    }

    const request: LevelDownRequest = { classKey: entry.classKey };
    if (record) return request;

    const value = hpInput.trim();
    if (value !== '') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setError('Informe um PV inteiro, de 0 para cima.');
        return null;
      }
      request.hpLost = parsed;
    }

    const decreases = [
      ...(abilityA === '' ? [] : [{ ability: abilityA, amount: 1 as const }]),
      ...(abilityB === '' ? [] : [{ ability: abilityB, amount: 1 as const }]),
    ];
    if (decreases.length > 0) request.abilityDecreases = decreases;
    if (featId !== '') request.removeFeatId = featId;

    return request;
  }

  async function confirm(): Promise<void> {
    const request = buildRequest();
    if (!request) return;

    setBusy(true);
    setError(null);
    try {
      const result = await apply(request);
      onApplied?.(result.character);
      setSummary(result.levelDown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reduzir o nível.');
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Nível reduzido">
        <div className="modal levelup-modal">
          <h2>
            <Icon name="scroll" size={20} /> Nível reduzido
          </h2>
          <p className="section-note">
            {character.name} · {summary.className}{' '}
            {summary.classRemoved
              ? `saiu da ficha (nível ${summary.previousClassLevel} → 0)`
              : `nível ${summary.previousClassLevel} → ${summary.classLevel}`}{' '}
            · nível total agora {summary.totalLevel}
          </p>

          <h3 className="subsection-title">O que saiu da ficha</h3>
          <ul className="levelup-summary">
            <li>
              <span>Pontos de vida</span>
              <strong>{summary.hpLost > 0 ? `−${summary.hpLost}` : '—'}</strong>
            </li>
            {summary.reverted.abilities.length > 0 ? (
              <li>
                <span>Aumento de Atributo</span>
                <strong>
                  {summary.reverted.abilities
                    .map((item) => `${ABILITY_LABELS[item.ability]} −${item.amount}`)
                    .join(', ')}
                </strong>
              </li>
            ) : null}
            {summary.reverted.feats.length > 0 ? (
              <li>
                <span>Talento</span>
                <strong>{summary.reverted.feats.length} removido(s)</strong>
              </li>
            ) : null}
            {summary.reverted.subclass ? (
              <li>
                <span>Subclasse</span>
                <strong>{summary.reverted.subclass}</strong>
              </li>
            ) : null}
            {summary.reverted.choices.length > 0 ? (
              <li>
                <span>Escolhas de característica</span>
                <strong>{choiceSummary(summary.reverted.choices)}</strong>
              </li>
            ) : null}
            {summary.reverted.skills.length > 0 ? (
              <li>
                <span>Perícias</span>
                <strong>
                  {summary.reverted.skills
                    .map((key) => SKILLS.find((skill) => skill.key === key)?.label ?? key)
                    .join(', ')}
                </strong>
              </li>
            ) : null}
            {summary.reverted.proficiencies.armor.length +
            summary.reverted.proficiencies.weapons.length +
            summary.reverted.proficiencies.tools.length >
            0 ? (
              <li>
                <span>Proficiências</span>
                <strong>
                  {[
                    ...summary.reverted.proficiencies.armor,
                    ...summary.reverted.proficiencies.weapons,
                    ...summary.reverted.proficiencies.tools,
                  ].join(' · ')}
                </strong>
              </li>
            ) : null}
          </ul>

          {summary.warnings.length > 0 ? (
            <ul className="leveldown-warnings">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reduzir nível">
      <div className="modal levelup-modal">
        <h2>
          <Icon name="scroll" size={20} /> Reduzir nível
        </h2>
        <p className="section-note">
          {character.name} · nível total {character.level}. O personagem perde o que o nível
          escolhido concedeu.
        </p>

        <h3 className="subsection-title">1. Classe</h3>
        <ul className="modal-list">
          {character.classes.map((item) => (
            <li key={item.classKey}>
              <label className="check-row levelup-choice">
                <input
                  type="radio"
                  name="leveldown-class"
                  checked={classKey === item.classKey}
                  onChange={() => {
                    setClassKey(item.classKey);
                    setHpInput('');
                    setAbilityA('');
                    setAbilityB('');
                    setFeatId('');
                    setError(null);
                  }}
                />
                <span className="check-name">
                  {item.className}
                  <span className="muted">
                    {' '}
                    · nível {item.level} → {item.level - 1}
                    {item.level <= 1 ? ' (sai da ficha)' : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {onlyClass ? (
          <p className="levelup-blocked">
            {entry?.className} é a única classe do personagem: reduzi-la deixaria a ficha sem classe.
            Para desmontar o personagem, use “reabrir criação”.
          </p>
        ) : null}

        <h3 className="subsection-title">2. O que este nível concedeu</h3>
        {record ? (
          <ul className="levelup-summary">
            <li>
              <span>Pontos de vida</span>
              <strong>−{record.hp.total}</strong>
            </li>
            <li>
              <span>Dado de vida</span>
              <strong>
                1d{record.hp.die}{' '}
                <span className="muted">
                  ({record.hp.rolled ? 'rolado' : 'média'} = {record.hp.gained}
                  {record.hp.conDelta !== 0
                    ? ` · CON ${record.hp.conDelta > 0 ? '+' : ''}${record.hp.conDelta}`
                    : ''}
                  )
                </span>
              </strong>
            </li>
            {record.abilityIncreases.length > 0 ? (
              <li>
                <span>Aumento de Atributo</span>
                <strong>
                  {record.abilityIncreases
                    .map((item) => `${ABILITY_LABELS[item.ability]} +${item.amount}`)
                    .join(', ')}
                </strong>
              </li>
            ) : null}
            {record.feat ? (
              <li>
                <span>Talento</span>
                <strong>{record.feat.name}</strong>
              </li>
            ) : null}
            {record.subclass ? (
              <li>
                <span>Subclasse</span>
                <strong>{record.subclass}</strong>
              </li>
            ) : null}
            {Object.keys(record.choices).length > 0 ? (
              <li>
                <span>Escolhas de característica</span>
                <strong>{choiceSummary(Object.keys(record.choices))}</strong>
              </li>
            ) : null}
            {record.skills.length > 0 ? (
              <li>
                <span>Perícias</span>
                <strong>
                  {record.skills
                    .map((key) => SKILLS.find((skill) => skill.key === key)?.label ?? key)
                    .join(', ')}
                </strong>
              </li>
            ) : null}
            {proficiencyList(record).length > 0 ? (
              <li>
                <span>Proficiências</span>
                <strong>{proficiencyList(record).join(' · ')}</strong>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="leveldown-warnings">
            O {entry?.level ?? '—'}º nível de {entry?.className ?? '—'} é anterior ao histórico da
            ficha: o PV perdido cai na média do dado de vida (1d{hitDie} ={' '}
            {Math.max(1, Math.floor(hitDie / 2) + 1)} + {conModifier} de CON = {estimatedHp}) e o
            resto precisa ser informado abaixo.
          </p>
        )}

        {!record && !onlyClass ? (
          <>
            <h3 className="subsection-title">3. Ajustes manuais</h3>
            <label className="field">
              <span>PV perdido (padrão: {estimatedHp})</span>
              <input
                type="number"
                min={0}
                value={hpInput}
                placeholder={String(estimatedHp)}
                onChange={(event) => setHpInput(event.target.value)}
              />
            </label>
            <div className="grid grid-2">
              <label className="field">
                <span>Aumento a desfazer (−1)</span>
                <select
                  value={abilityA}
                  onChange={(event) => setAbilityA(event.target.value as AbilityKey | '')}
                >
                  <option value="">— nenhum —</option>
                  {ABILITY_KEYS.map((ability) => (
                    <option key={ability} value={ability}>
                      {ABILITY_LABELS[ability]} ({character[ability]})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Outro aumento a desfazer (−1)</span>
                <select
                  value={abilityB}
                  onChange={(event) => setAbilityB(event.target.value as AbilityKey | '')}
                >
                  <option value="">— nenhum —</option>
                  {ABILITY_KEYS.filter((ability) => ability !== abilityA).map((ability) => (
                    <option key={ability} value={ability}>
                      {ABILITY_LABELS[ability]} ({character[ability]})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {feats.length > 0 ? (
              <label className="field">
                <span>Talento a remover</span>
                <select value={featId} onChange={(event) => setFeatId(event.target.value)}>
                  <option value="">— nenhum —</option>
                  {feats.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        <p className="section-note">
          {record
            ? 'Tudo o que este nível concedeu é revertido na ficha na hora — inclusive o PV rolado.'
            : 'O histórico não cobre este nível: confira a ficha depois e ajuste o que faltar.'}{' '}
          As magias, os espaços de magia e os ataques derivados se recalculam sozinhos.
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirm()}
            disabled={busy || onlyClass}
          >
            {busy ? 'reduzindo...' : 'reduzir nível'}
          </button>
        </div>
      </div>
    </div>
  );
}
