import { creatureDraft, creaturePayload } from './creatureDraft';
import { ABILITY_KEYS } from '../../dnd';
import { abilityModifier } from '../../../../src/modules/shared/dnd5e';
import './creatures.css';
import { useEffect, useMemo, useState } from 'react';
import type {
  Creature,
  CreatureKind,
  CreaturePatch,
  Item,
  Locality,
  Region,
} from '../../types';
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
  onCreate: (
    input: CreaturePatch & { localityIds: string[] },
  ) => Promise<Creature>;
  onPatch: (id: string, patch: CreaturePatch) => void;
  onDelete: (id: string) => void;
  /** Catálogo de itens do Mestre (inventário do NPC). */
  items?: Item[];
  /** Substitui o NPC após escritas de inventário/moedas. */
  onCreatureChange?: (creature: Creature) => void;
  onError?: (message: string) => void;
  /**
   * Pedido vindo de outra aba (assistente de regiões): abre a ficha desta
   * criatura. Sem limpar o pedido, a seleção voltaria a cada remontagem.
   */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}

const LABELS: Record<
  CreatureKind,
  { singular: string; plural: string; novo: string; vazio: string }
> = {
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
  focusId = null,
  onFocusConsumed,
}: CreaturesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Creature | null>(null);
  const [creationError, setCreationError] = useState('');
  const [filterLocality, setFilterLocality] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  // Pedido vindo do assistente de regiões: abre a ficha uma vez e devolve
  // o pedido ao painel, para não reabrir a cada render.
  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
  }, [focusId, onFocusConsumed]);

  const labels = LABELS[kind];
  // Derivado da lista: atualizações em tempo real refletem no editor aberto.
  const selected =
    creatures.find((creature) => creature.id === selectedId) ?? null;
  // Busca local: filtra os cards sem fechar o editor aberto na janela.
  const visible = creatures.filter(
    (creature) =>
      (!filterLocality ||
        creature.localities.some((l) => l.id === filterLocality)) &&
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
  const pager = usePager(visible.length, `${kind}|${query}|${filterLocality}`);
  const page = useMemo(
    () => paginate(visible, pager.page),
    [visible, pager.page],
  );

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      if (!draft) return;
      await onCreate(creaturePayload(draft));
      setDraft(null);
      setCreationError('');
    } catch (error) {
      setCreationError(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar o cadastro.',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="master-catalog">
      <header className="creature-catalog-heading">
        <div>
          <h2>{kind === 'NPC' ? 'Personagens do Mestre' : 'Bestiário'}</h2>
          <p className="section-subtitle">
            {creatures.length} {labels.plural} · organize os cadastros, ataques
            e imagens de token.
          </p>
        </div>
      </header>
      <header className="items-head">
        <div className="items-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, tipo ou local"
            label={kind === 'NPC' ? 'Buscar NPCs' : 'Buscar criaturas'}
          />

          <label className="field field-inline">
            <span>Filtrar por localidade</span>
            <select
              value={filterLocality}
              onChange={(e) => setFilterLocality(e.target.value)}
            >
              <option value="">Todas as localidades</option>
              {localities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {!localities.length ? (
            <span className="muted">
              Cadastre uma localidade para criar {labels.plural}.
            </span>
          ) : null}

          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => {
              const local =
                localities.find((l) => l.id === filterLocality) ??
                localities[0];
              if (local) {
                setCreationError('');
                setDraft(creatureDraft(kind, local));
              }
            }}
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
                      <span className="items-card-tag">
                        {creature.type || 'sem tipo'}
                      </span>
                      {creature.challengeRating ? (
                        <span className="items-card-tag">
                          ND {creature.challengeRating}
                        </span>
                      ) : null}
                    </span>
                    <span className="items-card-meta">
                      CA {creature.effectiveArmorClass ?? creature.armorClass}
                      {creature.localities.length > 0
                        ? ` · ${creature.localities.map((locality) => locality.name).join(' · ')}`
                        : ''}
                    </span>
                    <span className="items-card-summary">
                      PV {creature.hpCurrent}/{creature.hpMax} ·{' '}
                      {creature.attacks.length} ataques ·{' '}
                      {creature.tokenImages?.length ||
                        (creature.imageUrl ? 1 : 0)}{' '}
                      tokens
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
          label={
            kind === 'NPC' ? 'Paginação dos NPCs' : 'Paginação das criaturas'
          }
          detail={
            query
              ? `${visible.length} de ${creatures.length} com a busca atual`
              : undefined
          }
        />
      ) : null}

      {draft ? (
        <MasterDetailModal
          kind={kind === 'NPC' ? 'Novo NPC' : 'Nova criatura'}
          title={draft.name || 'Novo cadastro'}
          subtitle="Preencha as etapas e revise antes de criar."
          onClose={() => {
            if (!creating) setDraft(null);
          }}
        >
          {creationError ? (
            <p className="form-error" role="alert">
              {creationError}
            </p>
          ) : null}
          <CreatureEditor
            key="novo"
            embedded
            creating
            saving={creating}
            creature={draft}
            localities={localities}
            regions={regions}
            onPatch={(patch) =>
              setDraft((current) => {
                if (!current) return current;
                const next = {
                  ...current,
                  ...patch,
                  ...(patch.hpMax !== undefined &&
                  current.hpCurrent === current.hpMax
                    ? { hpCurrent: patch.hpMax }
                    : {}),
                };
                return {
                  ...next,
                  localities: patch.localityIds
                    ? localities
                        .filter((l) => patch.localityIds!.includes(l.id))
                        .map((l) => ({ id: l.id, name: l.name }))
                    : current.localities,
                  effectiveMaxHp: next.hpMax,
                  effectiveSpeed: next.speed,
                  spatialSize:
                    next.size.toLowerCase() as Creature['spatialSize'],
                  derived: {
                    modifiers: Object.fromEntries(
                      ABILITY_KEYS.map((a) => [a, abilityModifier(next[a])]),
                    ) as Creature['derived']['modifiers'],
                  },
                };
              })
            }
            onDelete={() => setDraft(null)}
            onFinish={() => void handleCreate()}
          />
        </MasterDetailModal>
      ) : null}
      {selected ? (
        <MasterDetailModal
          kind={kind === 'NPC' ? 'NPC' : 'Criatura'}
          title={selected.name}
          subtitle={
            <>
              {selected.type || 'sem tipo'}
              {selected.challengeRating
                ? ` · ND ${selected.challengeRating}`
                : ''}
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
            onFinish={() => setSelectedId(null)}
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
