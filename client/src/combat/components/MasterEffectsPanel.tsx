import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { describeEffectModifiers, EFFECT_ROLL_LABELS } from '../../effectModifiers';
import { createManualEffect, endEffect } from '../../effectsApi';
import type {
  AbilityKey,
  EffectDto,
  EffectModifierDto,
  EffectRollType,
  EffectVisibility,
  MechanicalEntity,
} from '../../types';

/**
 * EFEITOS GENÉRICOS — ferramenta do Mestre em "Estado e ajustes".
 *
 * NÃO é Condition nem Concentração: a lista é a tabela própria de instâncias do
 * efeito, com identidade por instância (encerrar um nunca remove outro com o
 * mesmo nome), grupo de aplicação e visibilidade público/privado.
 *
 * Fase 6.5B: o Mestre também pode anexar MODIFICADORES tipados à instância
 * (bônus/dado em rolagem, vantagem/desvantagem, CA e deslocamento). São apenas
 * fixtures de engine — nenhuma magia do PHB é implementada aqui —, e o servidor
 * valida cada um antes de gravar.
 */

type ModifierKind = EffectModifierDto['kind'];

const KIND_LABELS: Record<ModifierKind, string> = {
  'roll-flat': 'Bônus fixo em rolagem',
  'roll-dice': 'Dado extra em rolagem',
  'roll-advantage': 'Vantagem em rolagem',
  'roll-disadvantage': 'Desvantagem em rolagem',
  'ac-flat': 'Bônus de CA',
  'speed-flat': 'Bônus de deslocamento (m)',
};

const ABILITY_OPTIONS: { value: '' | AbilityKey; label: string }[] = [
  { value: '', label: 'Todos os atributos' },
  { value: 'strength', label: 'Força' },
  { value: 'dexterity', label: 'Destreza' },
  { value: 'constitution', label: 'Constituição' },
  { value: 'intelligence', label: 'Inteligência' },
  { value: 'wisdom', label: 'Sabedoria' },
  { value: 'charisma', label: 'Carisma' },
];

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];

function isRollModifier(kind: ModifierKind): boolean {
  return kind.startsWith('roll-');
}

export function MasterEffectsPanel({
  entity,
  targetName,
  effects,
  busy = false,
  onChanged,
}: {
  entity: MechanicalEntity;
  targetName: string;
  effects: EffectDto[];
  busy?: boolean;
  /** Recarrega a lista (o servidor já filtrou pelo papel). */
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<EffectVisibility>('public');
  const [pending, setPending] = useState<EffectModifierDto[]>([]);
  // Construtor compacto de UM modificador por vez.
  const [kind, setKind] = useState<ModifierKind>('roll-flat');
  const [roll, setRoll] = useState<EffectRollType>('attack');
  const [ability, setAbility] = useState<'' | AbilityKey>('');
  const [value, setValue] = useState('2');
  const [count, setCount] = useState('1');
  const [sides, setSides] = useState('4');
  const [negative, setNegative] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const locked = busy || working;

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (locked) return;
    setWorking(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar os efeitos.');
    } finally {
      setWorking(false);
    }
  }

  /** Monta o modificador a partir dos campos; `null` = entrada inválida. */
  function currentModifier(): EffectModifierDto | null {
    const numberValue = Number(value);
    if (kind === 'roll-flat' || kind === 'ac-flat' || kind === 'speed-flat') {
      if (!Number.isInteger(numberValue) || numberValue === 0) return null;
    }
    const abilityFilter = ability === '' ? {} : { ability };
    if (kind === 'roll-flat') return { kind, roll, value: numberValue, ...abilityFilter };
    if (kind === 'roll-advantage' || kind === 'roll-disadvantage') {
      return { kind, roll, ...abilityFilter };
    }
    if (kind === 'roll-dice') {
      const diceCount = Number(count);
      const dieSides = Number(sides);
      if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > 20) return null;
      return {
        kind,
        roll,
        count: diceCount,
        sides: dieSides,
        sign: negative ? -1 : 1,
        ...abilityFilter,
      };
    }
    if (kind === 'ac-flat') return { kind, value: numberValue };
    return { kind: 'speed-flat', value: numberValue };
  }

  const preview = currentModifier();

  return (
    <div className="master-conditions">
      <div className="master-conditions-head">
        <span className="master-conditions-title">
          <Icon name="sparkle" size={13} /> Efeitos — {targetName}
        </span>
      </div>

      {effects.length === 0 ? (
        <p className="field-hint">Nenhum efeito ativo.</p>
      ) : (
        <ul className="master-conditions-list">
          {effects.map((effect) => (
            <li className="master-condition-row" key={effect.id} data-effect-id={effect.id}>
              <span className="master-condition-name">{effect.label}</span>
              <span className="master-condition-origin">
                Origem: {effect.sourceLabel ?? (effect.sourceType === 'manual' ? 'Mestre' : effect.sourceType)}
                {effect.groupId ? ' · grupo' : ''} · {effect.visibility === 'private' ? 'privado' : 'público'}
              </span>
              {effect.modifiers.length > 0 ? (
                <span className="master-condition-origin" data-effect-modifiers>
                  {describeEffectModifiers(effect.modifiers)}
                </span>
              ) : null}
              <button
                type="button"
                className="master-condition-remove"
                disabled={locked}
                aria-label={`Encerrar ${effect.label}`}
                title={`Encerrar ${effect.label} (só esta instância)`}
                onClick={() => void run(() => endEffect(effect.id))}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="hp-controls">
        <input
          aria-label="Nome do efeito manual"
          placeholder="Efeito de teste"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <select
          aria-label="Visibilidade do efeito"
          value={visibility}
          onChange={(event) =>
            setVisibility(event.target.value === 'private' ? 'private' : 'public')
          }
        >
          <option value="public">Público</option>
          <option value="private">Privado (só o Mestre)</option>
        </select>
      </div>

      <div className="hp-controls">
        <select
          aria-label="Tipo de modificador"
          value={kind}
          onChange={(event) => setKind(event.target.value as ModifierKind)}
        >
          {(Object.keys(KIND_LABELS) as ModifierKind[]).map((key) => (
            <option key={key} value={key}>
              {KIND_LABELS[key]}
            </option>
          ))}
        </select>
        {isRollModifier(kind) ? (
          <>
            <select
              aria-label="Rolagem alvo"
              value={roll}
              onChange={(event) => setRoll(event.target.value as EffectRollType)}
            >
              {(Object.keys(EFFECT_ROLL_LABELS) as EffectRollType[]).map((key) => (
                <option key={key} value={key}>
                  {EFFECT_ROLL_LABELS[key]}
                </option>
              ))}
            </select>
            {kind !== 'roll-advantage' && kind !== 'roll-disadvantage' ? (
              <select
                aria-label="Atributo do modificador"
                value={ability}
                onChange={(event) => setAbility(event.target.value as '' | AbilityKey)}
              >
                {ABILITY_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
        {kind === 'roll-dice' ? (
          <>
            <input
              aria-label="Quantidade de dados"
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
            <select
              aria-label="Tipo de dado"
              value={sides}
              onChange={(event) => setSides(event.target.value)}
            >
              {DICE_SIDES.map((die) => (
                <option key={die} value={die}>
                  d{die}
                </option>
              ))}
            </select>
            <label className="field-hint">
              <input
                type="checkbox"
                checked={negative}
                onChange={(event) => setNegative(event.target.checked)}
              />{' '}
              negativo
            </label>
          </>
        ) : kind === 'roll-advantage' || kind === 'roll-disadvantage' ? null : (
          <input
            aria-label="Valor do modificador"
            type="number"
            min="-100"
            max="100"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <button
          type="button"
          className="btn btn-small"
          disabled={locked || preview === null}
          onClick={() => preview && setPending((list) => [...list, preview])}
        >
          <Icon name="plus" size={12} /> Adicionar modificador
        </button>
      </div>

      {pending.length > 0 ? (
        <ul className="master-conditions-list">
          {pending.map((modifier, index) => (
            <li className="master-condition-row" key={`${modifier.kind}-${index}`}>
              <span className="master-condition-name">{describeEffectModifiers([modifier])}</span>
              <button
                type="button"
                className="master-condition-remove"
                aria-label="Remover modificador pendente"
                onClick={() => setPending((list) => list.filter((_, item) => item !== index))}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="hp-controls">
        <button
          type="button"
          className="btn btn-small"
          disabled={locked || label.trim() === ''}
          onClick={() =>
            void run(async () => {
              await createManualEffect({
                label: label.trim(),
                target: entity,
                visibility,
                modifiers: pending,
              });
              setLabel('');
              setPending([]);
            })
          }
        >
          <Icon name="plus" size={13} /> Adicionar efeito manual
        </button>
      </div>
      <p className="field-hint">
        Fixtures de engine: bônus/dado em rolagem, CA e deslocamento entram nos pipelines do
        servidor. Nenhuma magia, duração ou Condition é criada aqui.
      </p>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
