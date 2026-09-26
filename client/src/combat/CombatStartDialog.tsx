import { useState } from 'react';
import { Icon } from '../components/Icon';
import type { Creature } from '../types';

interface CombatStartDialogProps {
  creatures: Creature[];
  onCancel: () => void;
  onStart: (creatureIds: string[]) => Promise<void>;
}

/**
 * Aberto pelo botão "COMBATE". Os personagens de jogador entram sozinhos;
 * o mestre escolhe quais criaturas entram na luta.
 */
export function CombatStartDialog({ creatures, onCancel, onStart }: CombatStartDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string): void {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  async function handleStart(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onStart(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o combate.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>
          <Icon name="sword" size={20} /> Iniciar combate
        </h2>
        <p className="section-subtitle">
          Todos os personagens de jogador entram automaticamente. Escolha as criaturas que
          participam:
        </p>

        {creatures.length === 0 ? (
          <p className="empty-hint">
            Nenhuma criatura cadastrada — o combate pode começar só com os personagens.
          </p>
        ) : (
          <ul className="modal-list">
            {creatures.map((creature) => (
              <li key={creature.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selected.includes(creature.id)}
                    onChange={() => toggle(creature.id)}
                  />
                  <span className="check-name">{creature.name}</span>
                  <span className="muted">
                    {creature.type || 'sem tipo'} · HP {creature.hpMax} · CA {creature.armorClass}
                  </span>
                </label>
              </li>
            ))}
          </ul>
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
            disabled={busy}
          >
            {busy ? 'iniciando...' : `iniciar combate (${selected.length} criatura(s))`}
          </button>
        </div>
      </div>
    </div>
  );
}
