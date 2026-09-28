import { useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, formatModifier } from '../../dnd';
import { Die3D } from '../../dice/Die3D';
import type { AbilityKey, CreationRoll } from '../../types';
import { Icon } from '../Icon';

/** Mesma duração da queda dos dados da janela de rolagem. */
const TUMBLE_MS = 1150;

/** Valor de uma rolagem de 4d6: a soma sem o dado descartado. */
function rollValue(roll: CreationRoll): number {
  return roll.dice.reduce((sum, value, index) => (index === roll.dropped ? sum : sum + value), 0);
}

/** Quantas vezes um valor rolado foi usado na distribuição. */
function usedCount(assigned: Partial<Record<AbilityKey, number>>, value: number): number {
  return ABILITY_KEYS.filter((ability) => assigned[ability] === value).length;
}

interface AbilityStepProps {
  mode: 'new' | 'existing';
  /** Rolagens já feitas (guardadas no rascunho do servidor). */
  rolls: CreationRoll[];
  /** Valor-BASE atribuído a cada atributo. */
  assigned: Partial<Record<AbilityKey, number>>;
  /** Bônus racial da raça escolhida (mostrado no valor final). */
  racialBonus: Partial<Record<AbilityKey, number>>;
  /** Rola 4d6 no servidor e devolve a rolagem nova. */
  onRoll: (restart: boolean) => Promise<CreationRoll | null>;
  onAssign: (ability: AbilityKey, value: number | null) => void;
  disabled?: boolean;
}

/**
 * Passo 6 — Atributos.
 *
 * "Personagem novo": o jogador rola 4d6 descartando o menor, seis vezes, com o
 * MESMO mecanismo da janela de dados (o dado é sorteado no servidor) e distribui
 * os seis resultados entre os atributos como quiser. "Personagem existente":
 * digita os valores direto (1 a 20).
 *
 * As rolagens ficam guardadas no rascunho: dá para fechar o navegador, voltar
 * depois e distribuir os valores já rolados.
 */
export function AbilityStep({
  mode,
  rolls,
  assigned,
  racialBonus,
  onRoll,
  onAssign,
  disabled = false,
}: AbilityStepProps) {
  const [rolling, setRolling] = useState(false);
  const [animating, setAnimating] = useState<CreationRoll | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values = rolls.map(rollValue);
  const lastIndex = rolls.length - 1;

  async function roll(restart: boolean): Promise<void> {
    setRolling(true);
    setError(null);

    try {
      const result = await onRoll(restart);
      if (!result) return;
      // A queda é local: o valor já veio do servidor.
      setAnimating(result);
      window.setTimeout(() => setAnimating(null), TUMBLE_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao rolar os dados.');
    } finally {
      setRolling(false);
      setRestarting(false);
    }
  }

  if (mode === 'existing') {
    return (
      <div className="wizard-step-body">
        <p className="section-note">
          Digite o valor de cada atributo (1 a 20), como ele já é na sua ficha de papel.
        </p>

        <div className="grid grid-3 wizard-abilities">
          {ABILITY_KEYS.map((ability) => (
            <label className="field" key={ability}>
              <span>{ABILITY_LABELS[ability]}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={assigned[ability] ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value;
                  onAssign(ability, raw === '' ? null : Number(raw));
                }}
              />
              <small className="muted">
                modificador{' '}
                {formatModifier(Math.floor(((assigned[ability] ?? 10) - 10) / 2))}
              </small>
            </label>
          ))}
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <p className="section-note">
        Role 4d6 descartando o menor dado, seis vezes — um valor por atributo. Os valores ficam
        guardados e você distribui como quiser. As rolagens não avisam a mesa, mas entram no
        histórico do mestre.
      </p>

      {/* A mesa de rolagem: um palco escuro (pergaminho noturno) onde os dados
          caem, com os controles na cabeceira e o resultado em destaque. */}
      <div className="wizard-roll-stage">
        <div className="wizard-roll-stage-head">
          <span className="wizard-roll-count">
            rolagens <strong>{rolls.length}</strong>
            <small>/6</small>
          </span>

          <div className="wizard-roll-bar">
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled || rolling || rolls.length >= 6}
              onClick={() => void roll(false)}
            >
              <Icon name="die" size={15} />{' '}
              {rolling ? 'rolando...' : `rolar 4d6 (${rolls.length}/6)`}
            </button>

            {rolls.length > 0 ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={disabled || rolling || !restarting}
                onClick={() => void roll(true)}
              >
                {restarting ? 'confirmar: rolar os seis de novo' : 'rolar novamente'}
              </button>
            ) : null}

            {rolls.length > 0 && !restarting && rolls.length < 6 ? (
              <button type="button" className="btn btn-small" onClick={() => setRestarting(true)}>
                começar de novo
              </button>
            ) : null}
          </div>
        </div>

        <div className="wizard-dice">
          {animating ? (
            <>
              {animating.dice.map((_, index) => (
                <Die3D key={`t-${index}`} sides={6} value={null} reveal={false} tumbling />
              ))}
              <span className="wizard-dice-hint">rolando os 4d6...</span>
            </>
          ) : lastIndex >= 0 ? (
            <>
              {rolls[lastIndex].dice.map((value, index) => (
                <Die3D
                  key={`s-${index}`}
                  sides={6}
                  value={value}
                  reveal
                  dropped={index === rolls[lastIndex].dropped}
                />
              ))}
              <span className="wizard-dice-hint">
                <span className="wizard-dice-dropped">
                  descartado <s>{rolls[lastIndex].dice[rolls[lastIndex].dropped]}</s>
                </span>
                <span className="wizard-dice-total">
                  <small>valor</small>
                  <strong>{values[lastIndex]}</strong>
                </span>
              </span>
            </>
          ) : (
            <span className="wizard-dice-hint">Nenhuma rolagem ainda — use "rolar 4d6".</span>
          )}
        </div>
      </div>

      {/* Os seis valores: os já distribuídos aparecem marcados. */}
      <ul className="wizard-roll-list">
        {values.map((value, index) => {
          const used = usedCount(assigned, value) > 0;
          return (
            <li key={`v-${index}`} className={used ? 'wizard-roll used' : 'wizard-roll'}>
              <span className="wizard-roll-value">{value}</span>
              <span className="wizard-roll-dice">
                {rolls[index].dice.map((die, dieIndex) => (
                  <span
                    key={`d-${dieIndex}`}
                    className={dieIndex === rolls[index].dropped ? 'die dropped' : 'die'}
                  >
                    {die}
                  </span>
                ))}
              </span>
              {used ? <span className="tag">em uso</span> : null}
            </li>
          );
        })}
        {Array.from({ length: Math.max(0, 6 - values.length) }, (_, index) => (
          <li key={`empty-${index}`} className="wizard-roll empty">
            —
          </li>
        ))}
      </ul>

      {/* Distribuição: cada valor só pode ir para um atributo. */}
      <h3 className="subsection-title">Distribuir os valores</h3>
      <div className="grid grid-3 wizard-abilities">
        {ABILITY_KEYS.map((ability) => {
          const bonus = racialBonus[ability] ?? 0;
          const base = assigned[ability];
          return (
            <label className="field" key={ability}>
              <span>
                {ABILITY_LABELS[ability]}
                {bonus ? ` (+${bonus} da raça)` : ''}
              </span>
              <select
                value={base === undefined ? '' : String(base)}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value;
                  onAssign(ability, raw === '' ? null : Number(raw));
                }}
              >
                <option value="">— escolha —</option>
                {/* Cada rolagem é uma opção: repetidos aparecem uma vez por rolagem. */}
                {values.map((value, index) => {
                  const taken =
                    usedCount(assigned, value) >=
                    values.filter((item) => item === value).length;
                  const mine = base === value;
                  return (
                    <option key={`o-${index}`} value={value} disabled={taken && !mine}>
                      {value} (dados {rolls[index].dice.join(', ')})
                    </option>
                  );
                })}
              </select>
              <small className="muted">
                total {base === undefined ? '—' : base + bonus} · modificador{' '}
                {formatModifier(Math.floor(((base ?? 10) + bonus - 10) / 2))}
              </small>
            </label>
          );
        })}
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
