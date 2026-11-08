import { useEffect, useMemo, useState } from 'react';
import type { Creature, CreatureKind, CreaturePatch, Item, Locality, Region } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { CreatureEditor } from './CreatureEditor';
import { MasterDetailModal } from './MasterDetailModal';
import { Paginator, paginate, usePager } from './Paginator';
import { SearchField } from './SearchField';
import { matchesSearch } from './search';

interface CreaturesTabProps {
  /** CREATURE (monstros) ou NPC — a lista já vem filtrada pelo painel. */
  kind: CreatureKind;
  creatures: Creature[];
  localities: Locality[];
  /** Regiões, para agrupar/identificar as localidades no seletor. */
  regions: Region[];
  onCreate: (localityId: string) => Promise<Creature>;
  onPatch: (id: string, patch: CreaturePatch) => void;
  onDelete: (id: string) => void;
  /** Catálogo de itens do Mestre (inventário do NPC). */
  items?: Item[];
  /** Substitui o NPC após escritas de inventário/moedas. */
  onCreatureChange?: (creature: Creature) => void;
  onError?: (message: string) => void;
}

const LABELS: Record<CreatureKind, { singular: string; plural: string; novo: string; vazio: string }> = {
  CREATURE: {
    singular: 'criatura',
    plural: 'criaturas',
    novo: '+ nova criatura',
    vazio: 'Nenhuma criatura cadastrada ainda.',
  },
  NPC: {
    singular: 'NPC',
    plural: 'NPCs',
    novo: '+ novo NPC',
    vazio: 'Nenhum NPC cadastrado ainda.',
  },
};

/**
 * Aba **Criaturas** e aba **NPCs** (o mesmo componente, separado pelo `kind`).
 *
 * A lista ocupa a largura toda em **cards** paginados de 25 em 25, com busca no
 * topo e o seletor de localidade ao lado do botão de criar. Clicar num card abre
 * o editor numa **janela flutuante** — o cadastro completo (statblock, ataques,
 * inventário do NPC, estado mecânico) sem dividir a tela com uma coluna lateral.
 */
export function CreaturesTab({
  kind,
  creatures,
  localities,
  regions,
  onCreate,
  onPatch,
  onDelete,
  items = [],
  onCreatureChange,
  onError,
}: CreaturesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [localityId, setLocalityId] = useState('');

  // Nova entidade nasce na primeira localidade; o mestre pode trocar depois.
  useEffect(() => {
    if (!localityId && localities.length > 0) setLocalityId(localities[0].id);
  }, [localities, localityId]);

  const labels = LABELS[kind];
  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected = creatures.find((creature) => creature.id === selectedId) ?? null;
  // Busca local: filtra os cards sem fechar o editor aberto na janela.
  const visible = creatures.filter((creature) =>
    matchesSearch(
      query,
      creature.name,
      creature.type,
      creature.challengeRating,
      ...creature.localities.map((locality) => locality.name),
    ),
  );
  // 25 por página; trocar de aba (Criaturas ↔ NPCs) ou buscar reinicia a
  // paginação — são recortes diferentes da mesma lista.
  const pager = usePager(visible.length, `${kind}|${query}`);
  const page = useMemo(() => paginate(visible, pager.page), [visible, pager.page]);

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
    <div className="master-catalog">
      <header className="items-head">
        <div className="items-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, tipo ou local"
            label={kind === 'NPC' ? 'Buscar NPCs' : 'Buscar criaturas'}
          />

          {localities.length === 0 ? (
            <span className="muted">Cadastre uma localidade antes de criar {labels.singular}s.</span>
          ) : (
            <label className="field field-inline">
              <span>Localidade</span>
              <select value={localityId} onChange={(event) => setLocalityId(event.target.value)}>
                {localities.map((locality) => {
                  // Com mais de uma região, o nome dela ajuda a achar o lugar.
                  const region = regions.find((item) => item.id === locality.regionId);
                  const prefix = regions.length > 1 && region ? `${region.name} · ` : '';

                  return (
                    <option key={locality.id} value={locality.id}>
                      {prefix}
                      {locality.name}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => void handleCreate()}
            disabled={creating || localities.length === 0}
          >
            {creating ? 'criando...' : labels.novo}
          </button>
        </div>
      </header>

      <div className="items-grid">
        {creatures.length === 0 ? (
          <p className="empty-hint">{labels.vazio}</p>
        ) : visible.length === 0 ? (
          <p className="empty-hint">Nenhum resultado para a busca.</p>
        ) : (
          <ul className="items-cards">
            {page.items.map((creature) => (
              <li key={creature.id}>
                <button
                  type="button"
                  className="items-card"
                  aria-label={`Abrir ${creature.name}`}
                  onClick={() => setSelectedId(creature.id)}
                >
                  <Portrait
                    src={creature.imageUrl}
                    alt={creature.name}
                    size="lg"
                    icon={kind === 'NPC' ? 'crown' : 'flame'}
                    zoomable={false}
                  />
                  <span className="items-card-body">
                    <span className="items-card-name">{creature.name}</span>
                    <span className="items-card-tags">
                      <span className="items-card-tag">{creature.type || 'sem tipo'}</span>
                      {creature.challengeRating ? (
                        <span className="items-card-tag">ND {creature.challengeRating}</span>
                      ) : null}
                    </span>
                    <span className="items-card-meta">
                      CA {creature.effectiveArmorClass ?? creature.armorClass}
                      {creature.localities.length > 0
                        ? ` · ${creature.localities.map((locality) => locality.name).join(' · ')}`
                        : ''}
                    </span>
                    <span className="items-card-summary">
                      HP {creature.hpCurrent}/{creature.hpMax}
                    </span>
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
          one={kind === 'NPC' ? 'NPC' : 'criatura'}
          many={labels.plural}
          label={kind === 'NPC' ? 'Paginação dos NPCs' : 'Paginação das criaturas'}
          detail={query ? `${visible.length} de ${creatures.length} com a busca atual` : undefined}
        />
      ) : null}

      {selected ? (
        <MasterDetailModal
          kind={kind === 'NPC' ? 'NPC' : 'Criatura'}
          title={selected.name}
          subtitle={
            <>
              {selected.type || 'sem tipo'}
              {selected.challengeRating ? ` · ND ${selected.challengeRating}` : ''}
              {selected.localities.length > 0
                ? ` · ${selected.localities.map((locality) => locality.name).join(' · ')}`
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
              <Icon name="trash" size={14} /> remover {labels.singular}
            </button>
          }
        >
          <CreatureEditor
            embedded
            creature={selected}
            localities={localities}
            regions={regions}
            onPatch={(patch) => onPatch(selected.id, patch)}
            onDelete={() => {
              onDelete(selected.id);
              setSelectedId(null);
            }}
            items={items}
            onCreatureChange={onCreatureChange}
            onError={onError}
          />
        </MasterDetailModal>
      ) : null}
    </div>
  );
}
