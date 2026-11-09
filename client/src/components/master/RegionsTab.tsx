import { useMemo, useState } from 'react';
import type {
  Creature,
  CreatureKind,
  Locality,
  LocalityPatch,
  Region,
  RegionPatch,
} from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { MasterDetailModal } from './MasterDetailModal';
import { Paginator, paginate, usePager } from './Paginator';
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
  /** Abre a ficha da criatura no bestiário (troca de aba do painel). */
  onOpenCreature: (creature: Creature) => void;
  /** Cria criatura/NPC já vinculado à localidade e abre a ficha dele. */
  onCreateCreature: (localityId: string, kind: CreatureKind) => Promise<Creature>;
}

/**
 * Aba **Regiões**: as localidades (e, dentro delas, criaturas e NPCs) vivem
 * dentro de uma região, que tem descrição, anotações e imagens próprias.
 *
 * A lista ocupa a largura toda em **cards** paginados de 25 em 25, com busca no
 * topo. Clicar num card abre o editor da região numa **janela flutuante** com o
 * assistente numerado (Região → Localidade → Cenas → Habitantes).
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
  onOpenCreature,
  onCreateCreature,
}: RegionsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected = regions.find((region) => region.id === selectedId) ?? null;
  // Busca local: filtra os cards sem mexer no editor aberto na janela.
  const visible = regions.filter((region) =>
    matchesSearch(query, region.name, region.description),
  );
  // 25 regiões por página; a busca reinicia a paginação.
  const pager = usePager(visible.length, query);
  const page = useMemo(() => paginate(visible, pager.page), [visible, pager.page]);

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
    <div className="master-catalog">
      <header className="items-head">
        <div className="items-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome ou descrição"
            label="Buscar regiões"
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
      </header>

      <div className="items-grid">
        {regions.length === 0 ? (
          <p className="empty-hint">Nenhuma região cadastrada ainda.</p>
        ) : visible.length === 0 ? (
          <p className="empty-hint">Nenhuma região corresponde à busca.</p>
        ) : (
          <ul className="items-cards">
            {page.items.map((region) => (
              <li key={region.id}>
                <button
                  type="button"
                  className="items-card"
                  aria-label={`Abrir a região ${region.name}`}
                  onClick={() => setSelectedId(region.id)}
                >
                  <Portrait
                    src={region.images[0]?.url}
                    alt={region.name}
                    size="lg"
                    icon="book"
                    zoomable={false}
                  />
                  <span className="items-card-body">
                    <span className="items-card-name">{region.name}</span>
                    <span className="items-card-tags">
                      <span className="items-card-tag">
                        {region.localityCount} localidade{region.localityCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    {region.description ? (
                      <span className="items-card-summary">{region.description}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {visible.length > 0 ? (
        <Paginator
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          start={page.start}
          end={page.end}
          onPage={pager.setPage}
          one="região"
          many="regiões"
          label="Paginação das regiões"
          detail={query ? `${visible.length} de ${regions.length} com a busca atual` : undefined}
        />
      ) : null}

      {selected ? (
        <MasterDetailModal
          kind="Região"
          title={selected.name}
          subtitle={
            <>
              {selected.localityCount} localidade{selected.localityCount === 1 ? '' : 's'}
              {selected.images.length > 0
                ? ` · ${selected.images.length} imagem${selected.images.length === 1 ? '' : 's'}`
                : ''}
            </>
          }
          onClose={() => setSelectedId(null)}
          actions={
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={() => {
                onDelete(selected.id);
                setSelectedId(null);
              }}
            >
              <Icon name="trash" size={14} /> remover região
            </button>
          }
        >
          <RegionEditor
            embedded
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
            onOpenCreature={onOpenCreature}
            onCreateCreature={onCreateCreature}
          />
        </MasterDetailModal>
      ) : null}
    </div>
  );
}
