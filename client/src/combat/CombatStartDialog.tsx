import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import type { Creature, Locality } from '../types';
import type { CombatCreatureEntry } from './combatApi';

interface CombatStartDialogProps {
  localities: Locality[];
  /** Apenas monstros (kind CREATURE); NPCs não entram em combate. */
  creatures: Creature[];
  onCancel: () => void;
  onStart: (input: {
    localityId?: string;
    entries: CombatCreatureEntry[];
  }) => Promise<void>;
}

const MAX_QUANTITY = 30;

/**
 * Preparação do combate: o mestre busca a localidade (autocomplete), vê apenas
 * as criaturas daquele lugar e escolhe quantas cópias de cada uma entram. Cada
 * unidade vira um combatente com a própria vida.
 */
export function CombatStartDialog({
  localities,
  creatures,
  onCancel,
  onStart,
}: CombatStartDialogProps) {
  const [query, setQuery] = useState('');
  const [localityId, setLocalityId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = localities.find((locality) => locality.id === localityId) ?? null;

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pool = term
      ? localities.filter((locality) => locality.name.toLowerCase().includes(term))
      : localities;
    return pool.slice(0, 8);
  }, [query, localities]);

  const available = useMemo(
    () => (selected ? creatures.filter((c) => c.localities.some((l) => l.id === selected.id)) : []),
    [creatures, selected],
  );

  const total = available.reduce((sum, creature) => sum + (quantities[creature.id] ?? 0), 0);

  function choose(locality: Locality): void {
    setLocalityId(locality.id);
    setQuery(locality.name);
    setQuantities({});
  }

  function setQuantity(id: string, value: number): void {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(value))) : 0;
    setQuantities((previous) => ({ ...previous, [id]: safe }));
  }

  async function handleStart(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const entries = available
        .map((creature) => ({ creatureId: creature.id, quantity: quantities[creature.id] ?? 0 }))
        .filter((entry) => entry.quantity > 0);

      await onStart({ ...(localityId ? { localityId } : {}), entries });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o combate.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <h2>
          <Icon name="sword" size={20} /> Preparar combate
        </h2>
        <p className="section-subtitle">
          Escolha onde a batalha acontece e quantas criaturas entram. Os personagens de
          jogador entram automaticamente.
        </p>

        {localities.length === 0 ? (
          <p className="empty-hint">
            Cadastre uma localidade primeiro na aba “Localidades” para poder iniciar combates.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Localidade</span>
              <input
                type="search"
                className="inline-input"
                value={query}
                placeholder="digite para buscar..."
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLocalityId('');
                }}
              />
            </label>

            {selected ? (
              <p className="section-note">
                Local escolhido: <strong>{selected.name}</strong>
              </p>
            ) : suggestions.length === 0 ? (
              <p className="empty-hint">Nenhuma localidade encontrada.</p>
            ) : (
              <ul className="suggestion-list">
                {suggestions.map((locality) => (
                  <li key={locality.id}>
                    <button type="button" className="suggestion" onClick={() => choose(locality)}>
                      <Icon name="scroll" size={14} />
                      <span className="suggestion-name">{locality.name}</span>
                      <span className="muted">{locality.creatureCount} criatura(s)</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected ? (
              available.length === 0 ? (
                <p className="empty-hint">
                  Nenhuma criatura cadastrada nesta localidade. Vincule criaturas a ela no
                  bestiário.
                </p>
              ) : (
                <ul className="modal-list">
                  {available.map((creature) => (
                    <li key={creature.id}>
                      <label className="check-row quantity-row">
                        <span className="check-name">
                          <Portrait src={creature.imageUrl} alt="" size="sm" icon="flame" />
                          <span className="name-text">{creature.name}</span>
                        </span>
                        <span className="muted">
                          {creature.type || 'sem tipo'} · HP {creature.hpMax} · CA{' '}
                          {creature.armorClass}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={MAX_QUANTITY}
                          value={quantities[creature.id] ?? 0}
                          aria-label={`Quantidade de ${creature.name}`}
                          onChange={(event) => setQuantity(creature.id, Number(event.target.value))}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleStart()}
            disabled={busy || localities.length === 0}
          >
            {busy ? 'iniciando...' : `iniciar combate (${total} criatura(s))`}
          </button>
        </div>
      </div>
    </div>
  );
}
