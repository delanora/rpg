import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { createManualEffect, endEffect } from '../../effectsApi';
import type { EffectDto, EffectVisibility, MechanicalEntity } from '../../types';

/**
 * EFEITOS GENÉRICOS (Fase 6.5A) — ferramenta do Mestre em "Estado e ajustes".
 *
 * NÃO é Condition nem Concentração: a lista é a tabela própria de instâncias do
 * efeito, com identidade por instância (encerrar um nunca remove outro com o
 * mesmo nome), grupo de aplicação e visibilidade público/privado.
 *
 * Nesta fase o Mestre só cria efeito MANUAL (nome + visibilidade): sem bônus,
 * sem Condition, sem duração — o motor de modificadores é a 6.5B.
 */
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
        <button
          type="button"
          className="btn btn-small"
          disabled={locked || label.trim() === ''}
          onClick={() =>
            void run(async () => {
              await createManualEffect({ label: label.trim(), target: entity, visibility });
              setLabel('');
            })
          }
        >
          <Icon name="plus" size={13} /> Adicionar efeito manual
        </button>
      </div>
      <p className="field-hint">
        Só registra a instância: nada de bônus, condição ou duração nesta fase.
      </p>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
