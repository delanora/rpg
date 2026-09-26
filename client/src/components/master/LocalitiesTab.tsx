import { useState } from 'react';
import type { Locality, LocalityPatch } from '../../types';
import { Icon } from '../Icon';
import { LocalityEditor } from './LocalityEditor';

interface LocalitiesTabProps {
  localities: Locality[];
  onCreate: () => Promise<Locality>;
  onPatch: (id: string, patch: LocalityPatch) => void;
  onDelete: (id: string) => void;
}

export function LocalitiesTab({ localities, onCreate, onPatch, onDelete }: LocalitiesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected = localities.find((locality) => locality.id === selectedId) ?? null;

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
            {creating ? 'criando...' : '+ nova localidade'}
          </button>
        </div>

        {localities.length === 0 ? (
          <p className="empty-hint">Nenhuma localidade cadastrada ainda.</p>
        ) : (
          <ul className="locality-cards">
            {localities.map((locality) => (
              <li key={locality.id}>
                <button
                  type="button"
                  className={selected?.id === locality.id ? 'locality-card active' : 'locality-card'}
                  onClick={() => setSelectedId(locality.id)}
                >
                  <span className="locality-thumb">
                    {locality.images[0] ? (
                      <img src={locality.images[0].url} alt="" loading="lazy" />
                    ) : (
                      <Icon name="scroll" size={18} />
                    )}
                  </span>
                  <span className="locality-info">
                    <span className="card-name">{locality.name}</span>
                    <span className="card-line">{locality.creatureCount} criatura(s)</span>
                    {locality.description ? (
                      <span className="locality-desc">{locality.description}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="master-detail">
        {selected ? (
          <LocalityEditor
            locality={selected}
            onPatch={(patch) => onPatch(selected.id, patch)}
            onDelete={() => {
              onDelete(selected.id);
              setSelectedId(null);
            }}
          />
        ) : (
          <p className="empty-hint">
            Selecione uma localidade para editar as imagens e a descrição, ou crie uma nova.
          </p>
        )}
      </section>
    </div>
  );
}
