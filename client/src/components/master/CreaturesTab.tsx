import { useState } from 'react';
import type { Creature } from '../../types';
import { CreatureEditor } from './CreatureEditor';

interface CreaturesTabProps {
  creatures: Creature[];
  onCreate: () => Promise<Creature>;
  onPatch: (id: string, patch: Partial<Creature>) => void;
  onDelete: (id: string) => void;
}

export function CreaturesTab({ creatures, onCreate, onPatch, onDelete }: CreaturesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected = creatures.find((creature) => creature.id === selectedId) ?? null;

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      const created = await onCreate();
      setSelectedId(created.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="master-layout">
      <aside className="master-list">
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'criando...' : '+ nova criatura'}
          </button>
        </div>

        {creatures.length === 0 ? (
          <p className="empty-hint">Nenhuma criatura cadastrada ainda.</p>
        ) : (
          <ul className="character-cards">
            {creatures.map((creature) => (
              <li key={creature.id}>
                <button
                  type="button"
                  className={selected?.id === creature.id ? 'character-card active' : 'character-card'}
                  onClick={() => setSelectedId(creature.id)}
                >
                  <span className="card-name">{creature.name}</span>
                  <span className="card-owner">{creature.type || 'sem tipo'}</span>
                  <span className="card-line">
                    {creature.challengeRating ? `ND ${creature.challengeRating} · ` : ''}
                    CA {creature.armorClass}
                  </span>
                  <span className="card-hp">
                    HP {creature.hpCurrent}/{creature.hpMax}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="master-detail">
        {selected ? (
          <CreatureEditor
            creature={selected}
            onPatch={(patch) => onPatch(selected.id, patch)}
            onDelete={() => {
              onDelete(selected.id);
              setSelectedId(null);
            }}
          />
        ) : (
          <p className="empty-hint">
            Selecione uma criatura para editar, ou crie uma nova.
          </p>
        )}
      </section>
    </div>
  );
}
