import { useEffect, useState } from 'react';
import type { Creature, CreatureKind, CreaturePatch, Locality } from '../../types';
import { Portrait } from '../Portrait';
import { CreatureEditor } from './CreatureEditor';

interface CreaturesTabProps {
  /** CREATURE (monstros) ou NPC — a lista já vem filtrada pelo painel. */
  kind: CreatureKind;
  creatures: Creature[];
  localities: Locality[];
  onCreate: (localityId: string) => Promise<Creature>;
  onPatch: (id: string, patch: CreaturePatch) => void;
  onDelete: (id: string) => void;
}

const LABELS: Record<CreatureKind, { singular: string; novo: string; vazio: string }> = {
  CREATURE: {
    singular: 'criatura',
    novo: '+ nova criatura',
    vazio: 'Nenhuma criatura cadastrada ainda.',
  },
  NPC: {
    singular: 'NPC',
    novo: '+ novo NPC',
    vazio: 'Nenhum NPC cadastrado ainda.',
  },
};

export function CreaturesTab({
  kind,
  creatures,
  localities,
  onCreate,
  onPatch,
  onDelete,
}: CreaturesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [localityId, setLocalityId] = useState('');

  // Nova entidade nasce na primeira localidade; o mestre pode trocar depois.
  useEffect(() => {
    if (!localityId && localities.length > 0) setLocalityId(localities[0].id);
  }, [localities, localityId]);

  const labels = LABELS[kind];
  const selected = creatures.find((creature) => creature.id === selectedId) ?? null;

  async function handleCreate(): Promise<void> {
    if (!localityId) return;
    setCreating(true);
    try {
      const created = await onCreate(localityId);
      setSelectedId(created.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="master-layout">
      <aside className="master-list">
        <div className="toolbar toolbar-wrap">
          {localities.length === 0 ? (
            <span className="muted">Cadastre uma localidade antes de criar {labels.singular}s.</span>
          ) : (
            <label className="field field-inline">
              <span>Localidade</span>
              <select value={localityId} onChange={(event) => setLocalityId(event.target.value)}>
                {localities.map((locality) => (
                  <option key={locality.id} value={locality.id}>
                    {locality.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={handleCreate}
            disabled={creating || localities.length === 0}
          >
            {creating ? 'criando...' : labels.novo}
          </button>
        </div>

        {creatures.length === 0 ? (
          <p className="empty-hint">{labels.vazio}</p>
        ) : (
          <ul className="character-cards">
            {creatures.map((creature) => (
              <li key={creature.id}>
                <button
                  type="button"
                  className={selected?.id === creature.id ? 'character-card active' : 'character-card'}
                  onClick={() => setSelectedId(creature.id)}
                >
                  <span className="card-head">
                    <Portrait
                      src={creature.imageUrl}
                      alt={creature.name}
                      icon={kind === 'NPC' ? 'crown' : 'flame'}
                    />
                    <span className="card-name">{creature.name}</span>
                  </span>
                  <span className="card-owner">{creature.type || 'sem tipo'}</span>
                  <span className="card-line">
                    {creature.challengeRating ? `ND ${creature.challengeRating} · ` : ''}
                    CA {creature.armorClass}
                  </span>
                  <span className="card-hp">
                    HP {creature.hpCurrent}/{creature.hpMax}
                  </span>
                  {creature.localities.length > 0 ? (
                    <span className="card-line">
                      {creature.localities.map((locality) => locality.name).join(' · ')}
                    </span>
                  ) : null}
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
            localities={localities}
            onPatch={(patch) => onPatch(selected.id, patch)}
            onDelete={() => {
              onDelete(selected.id);
              setSelectedId(null);
            }}
          />
        ) : (
          <p className="empty-hint">
            Selecione {kind === 'NPC' ? 'um NPC' : 'uma criatura'} para editar, ou crie
            {kind === 'NPC' ? ' um novo' : ' uma nova'}.
          </p>
        )}
      </section>
    </div>
  );
}
