import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import {
  cancelPendingEffectSave,
  fetchPendingEffectSaves,
  rollPendingEffectSave,
} from '../../effectsApi';
import type {
  AbilityKey,
  EffectOptionalModifierDto,
  MechanicalEntity,
  PendingEffectSaveDto,
} from '../../types';

/**
 * APLICAÇÃO DE EFEITO AGUARDANDO SALVAGUARDA (Fase 6.5H).
 *
 * Aparece para o ALVO (na própria ficha) e para o Mestre (criatura/NPC) entre
 * "a magia foi direcionada" e "o save foi rolado". Nada mecânico existe ainda:
 * nem Paralyzed, nem Effect, nem Concentração.
 *
 * • O atributo e a CD vêm do SERVIDOR (pendência persistida); o cliente não os
 *   envia nem os altera.
 * • A rolagem passa pelo MESMO endpoint de salvaguarda — o servidor rola o d20,
 *   calcula o bônus e resolve a pendência.
 * • Modificadores OPCIONAIS (ex.: Bless +1d4) são oferecidos pelo servidor e só
 *   entram se marcados; o cliente devolve apenas IDs.
 * • Criatura/NPC: o Mestre escolhe público × privado AO ROLAR.
 */
export function PendingEffectSavePanel({
  entity,
  refreshKey,
  isMaster,
  busy,
  onChanged,
}: {
  entity: MechanicalEntity;
  /** Muda quando ficha/efeitos são republicados — refaz a leitura. */
  refreshKey: number;
  isMaster: boolean;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState<PendingEffectSaveDto[]>([]);
  const [options, setOptions] = useState<EffectOptionalModifierDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = await fetchPendingEffectSaves(entity);
      setPending(list);
      const ability = list[0]?.ability;
      if (!ability) {
        setOptions([]);
        return;
      }
      const query = new URLSearchParams({ roll: 'save', ability });
      const result = await api<{ options: EffectOptionalModifierDto[] }>(
        `/api/dice/options/${entity.kind}/${entity.id}?${query.toString()}`,
      );
      setOptions(result.options);
    } catch {
      // Leitura complementar: a ficha não quebra sem a pendência.
    }
  }, [entity.kind, entity.id]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const locked = busy || working;

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (locked) return;
    setWorking(true);
    setError('');
    try {
      await action();
      setSelected([]);
      await reload();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao resolver a salvaguarda.');
      await reload();
    } finally {
      setWorking(false);
    }
  }

  if (pending.length === 0) return null;

  const abilityLabel = (ability: AbilityKey): string =>
    (
      {
        strength: 'Força',
        dexterity: 'Destreza',
        constitution: 'Constituição',
        intelligence: 'Inteligência',
        wisdom: 'Sabedoria',
        charisma: 'Carisma',
      } as Record<AbilityKey, string>
    )[ability];

  return (
    <section className="reaction-panel" aria-label="Salvaguarda pendente" data-pending-effect>
      <p className="reaction-panel-eyebrow">
        <Icon name="flame" size={13} /> Salvaguarda pendente
      </p>
      {pending.map((item) => (
        <div key={item.id} className="concentration-save" data-pending-effect-id={item.id}>
          <p className="reaction-panel-trigger">
            <strong>{item.label}</strong>
            {item.casterName ? ` de ${item.casterName}` : ''} — salvaguarda de{' '}
            {abilityLabel(item.ability)} · CD {item.dc}
          </p>
          {options.length > 0 ? (
            <div className="hp-controls">
              {options.map((option) => (
                <label key={option.id} className="field-hint">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.id)}
                    onChange={(event) =>
                      setSelected((list) =>
                        event.target.checked
                          ? [...list, option.id]
                          : list.filter((id) => id !== option.id),
                      )
                    }
                  />{' '}
                  {option.label}
                  {option.kind === 'roll-dice' ? ` +${option.count ?? 1}d${option.sides ?? 4}` : ''}
                </label>
              ))}
            </div>
          ) : null}
          <div className="hp-controls">
            {isMaster ? (
              <>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={locked}
                  onClick={() =>
                    void run(() =>
                      rollPendingEffectSave({ pendingId: item.id, visibility: 'public' }),
                    )
                  }
                >
                  Rolar público
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={locked}
                  onClick={() =>
                    void run(() =>
                      rollPendingEffectSave({ pendingId: item.id, visibility: 'private' }),
                    )
                  }
                >
                  Rolar privado
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={locked}
                  title="Cancela a aplicação sem rolar o save (nenhum efeito é criado)."
                  onClick={() => void run(() => cancelPendingEffectSave(item.id))}
                >
                  Cancelar aplicação
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-small"
                disabled={locked}
                onClick={() =>
                  void run(() =>
                    rollPendingEffectSave({
                      pendingId: item.id,
                      selectedEffectModifiers: selected,
                    }),
                  )
                }
              >
                Rolar salvaguarda de {abilityLabel(item.ability)} (CD {item.dc})
              </button>
            )}
          </div>
        </div>
      ))}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
