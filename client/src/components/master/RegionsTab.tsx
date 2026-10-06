import { useState } from 'react';
import type { Creature, Locality, LocalityPatch, Region, RegionPatch } from '../../types';
import { Icon } from '../Icon';
import { RegionEditor } from './RegionEditor';
import { SearchField } from './SearchField';
import { matchesSearch } from './search';

interface RegionsTabProps {
  regions: Region[];
  /** Todas as localidades da mesa; o painel filtra as da região aberta. */
  localities: Locality[];
  /** Criaturas/NPCs da mesa — usadas para listar quem vive em cada local. */
  creatures: Creature[];
  onCreate: () => Promise<Region>;
  onPatch: (id: string, patch: RegionPatch) => void;
  onDelete: (id: string) => void;
  onCreateLocality: (regionId: string) => Promise<Locality>;
  onPatchLocality: (id: string, patch: LocalityPatch) => void;
  onDeleteLocality: (id: string) => void;
}

/**
 * Aba **Regiões**: as localidades (e, dentro delas, criaturas e NPCs) vivem
 * dentro de uma região, que tem descrição, anotações e imagens próprias.
 */
export function RegionsTab({
  regions,
  localities,
  creatures,
  onCreate,
  onPatch,
  onDelete,
  onCreateLocality,
  onPatchLocality,
  onDeleteLocality,
}: RegionsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected = regions.find((region) => region.id === selectedId) ?? null;
  // Busca local: filtra a lista lateral sem mexer no editor aberto ao lado.
  const visible = regions.filter((region) =>
    matchesSearch(query, region.name, region.description),
  );

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
        <div className="toolbar toolbar-wrap">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome ou descrição"
            label="Buscar regiões"
            className="search-grow"
          />
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? 'criando...' : '+ nova região'}
          </button>
        </div>

        {regions.length === 0 ? (
          <p className="empty-hint">Nenhuma região cadastrada ainda.</p>
        ) : visible.length === 0 ? (
          <p className="empty-hint">Nenhuma região corresponde à busca.</p>
        ) : (
          <ul className="locality-cards">
            {visible.map((region) => (
              <li key={region.id}>
                <button
                  type="button"
                  className={selected?.id === region.id ? 'locality-card active' : 'locality-card'}
                  onClick={() => setSelectedId(region.id)}
                >
                  <span className="locality-thumb">
                    {region.images[0] ? (
                      <img src={region.images[0].url} alt="" loading="lazy" />
                    ) : (
                      <Icon name="book" size={18} />
                    )}
                  </span>
                  <span className="locality-info">
                    <span className="card-name">{region.name}</span>
                    <span className="card-line">
                      {region.localityCount} localidade(s)
                    </span>
                    {region.description ? (
                      <span className="locality-desc">{region.description}</span>
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
          <RegionEditor
            region={selected}
            localities={localities.filter((locality) => locality.regionId === selected.id)}
            creatures={creatures}
            onPatch={(patch) => onPatch(selected.id, patch)}
            onDelete={() => {
              onDelete(selected.id);
              setSelectedId(null);
            }}
            onCreateLocality={() => onCreateLocality(selected.id)}
            onPatchLocality={onPatchLocality}
            onDeleteLocality={onDeleteLocality}
          />
        ) : (
          <p className="empty-hint">
            Selecione uma região para editar a descrição, as anotações e as imagens — ou crie uma
            nova. As localidades e quem vive nelas ficam na sub-aba dela.
          </p>
        )}
      </section>
    </div>
  );
}
