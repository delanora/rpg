import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { categoryLabel, rarityColor, rarityLabel, rarityTint } from '../../dnd';
import type { CanonicalWeapon, Character, Compendium, Item, ItemPatch } from '../../types';
import { Portrait } from '../Portrait';
import { CoinsGrantPanel } from './CoinsGrantPanel';
import { DeleteItemDialog } from './DeleteItemDialog';
import { ItemModal, type ItemModalMode } from './ItemModal';
import { SearchField } from './SearchField';
import {
  EMPTY_ITEM_FILTERS,
  categoryFilterOptions,
  damageTypeFilterOptions,
  filterItems,
  itemSummary,
  itemUsage,
  priceLabel,
  rarityFilterOptions,
  type ItemFilters,
} from './itemCatalog';

interface ItemsTabProps {
  items: Item[];
  characters: Character[];
  onCreate: () => Promise<Item>;
  onPatch: (id: string, patch: ItemPatch) => void;
  onDelete: (id: string) => void;
  onSend: (itemId: string, characterId: string, quantity: number) => Promise<void>;
  /** Denominações extras (PL/PE) ligadas pelo mestre na aba Mesa. */
  extraCoins: boolean;
  /**
   * Entrega de moedas devolveu a ficha inteira: a lista do painel adota a
   * versão nova (o jogador recebe o mesmo dado por `sheet:updated`).
   */
  onCoinsChange: (character: Character) => void;
}

/**
 * Catálogo central de itens do mestre.
 *
 * No topo da aba fica o painel **Entregar moedas** (intocado). Abaixo, o
 * catálogo virou um **grid de cards** com busca e filtros rápidos no cabeçalho,
 * altura limitada e rolagem interna. Clicar num card abre o **modal do item**,
 * que começa em visualização e alterna para edição sem trocar de tela; excluir
 * passa por uma confirmação própria.
 */
export function ItemsTab({
  items,
  characters,
  onCreate,
  onPatch,
  onDelete,
  onSend,
  extraCoins,
  onCoinsChange,
}: ItemsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ItemModalMode>('view');
  // Item recém-criado por "Novo item": o modal já abre em edição, vazio.
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_ITEM_FILTERS);
  // Catálogo canônico de armas para o seletor "Arma do PHB" (vem do compêndio).
  const [weapons, setWeapons] = useState<CanonicalWeapon[]>([]);

  useEffect(() => {
    let active = true;
    api<{ compendium: Compendium }>('/api/compendium')
      .then((result) => {
        if (active) setWeapons(result.compendium.weapons ?? []);
      })
      .catch(() => {
        // Sem o catálogo, o seletor fica apenas com a opção vazia (homebrew).
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(() => filterItems(items, filters), [items, filters]);
  const categoryOptions = useMemo(() => categoryFilterOptions(items), [items]);
  const rarityOptions = useMemo(() => rarityFilterOptions(items), [items]);
  const damageOptions = useMemo(() => damageTypeFilterOptions(items), [items]);
  const hasActiveFilters = Boolean(
    filters.query || filters.category || filters.rarity || filters.damageType,
  );

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const usedBy = selected ? itemUsage(selected, characters) : [];

  function openItem(id: string): void {
    setSelectedId(id);
    setMode('view');
    setCreatingId(null);
    setConfirming(false);
  }

  function closeItem(): void {
    setSelectedId(null);
    setMode('view');
    setCreatingId(null);
    setConfirming(false);
  }

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const created = await onCreate();
      setSelectedId(created.id);
      setMode('edit');
      setCreatingId(created.id);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar o item.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selected) return;
    await onDelete(selected.id);
    closeItem();
  }

  return (
    <div className="items-tab">
      <CoinsGrantPanel
        characters={characters}
        extraCoins={extraCoins}
        onCharacter={onCoinsChange}
      />

      <section className="items-catalog" aria-label="Catálogo de itens">
        <header className="items-head">
          <div className="items-toolbar">
            <SearchField
              value={filters.query}
              onChange={(query) => setFilters((prev) => ({ ...prev, query }))}
              placeholder="Buscar por nome, categoria, raridade ou tipo de dano"
              label="Buscar itens"
            />
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? 'criando...' : '+ novo item'}
            </button>
          </div>

          <div className="items-filters">
            <label className="items-filter">
              <span>Categoria</span>
              <select
                value={filters.category}
                aria-label="Filtrar por categoria"
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, category: event.target.value }))
                }
              >
                <option value="">todas</option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="items-filter">
              <span>Raridade</span>
              <select
                value={filters.rarity}
                aria-label="Filtrar por raridade"
                onChange={(event) => setFilters((prev) => ({ ...prev, rarity: event.target.value }))}
              >
                <option value="">todas</option>
                {rarityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="items-filter">
              <span>Tipo de dano</span>
              <select
                value={filters.damageType}
                aria-label="Filtrar por tipo de dano"
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, damageType: event.target.value }))
                }
              >
                <option value="">todos</option>
                {damageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {hasActiveFilters ? (
              <button
                type="button"
                className="btn btn-small items-clear"
                onClick={() => setFilters(EMPTY_ITEM_FILTERS)}
              >
                limpar filtros
              </button>
            ) : null}
          </div>

          {error ? <p className="form-error">{error}</p> : null}
        </header>

        <div className="items-grid">
          {items.length === 0 ? (
            <p className="empty-hint">
              Nenhum item no catálogo ainda. Use <strong>+ novo item</strong> para criar o primeiro.
            </p>
          ) : visible.length === 0 ? (
            <p className="empty-hint">Nenhum item encontrado com os filtros atuais.</p>
          ) : (
            <ul className="items-cards">
              {visible.map((item) => {
                const color = rarityColor(item.rarity);
                const accent = rarityTint(item.rarity, '99');
                const summary = itemSummary(item);
                const price = priceLabel(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="items-card"
                      style={{
                        borderLeftColor: color ?? undefined,
                        background: accent
                          ? `linear-gradient(180deg, ${accent}22, var(--surface-2))`
                          : undefined,
                      }}
                      aria-label={`Abrir detalhes de ${item.name}`}
                      onClick={() => openItem(item.id)}
                    >
                      <Portrait
                        src={item.imageUrl}
                        alt={item.name}
                        size="lg"
                        icon="flask"
                        zoomable={false}
                      />
                      <span className="items-card-body">
                        <span className="items-card-name">{item.name}</span>
                        <span className="items-card-tags">
                          <span className="items-card-tag">{categoryLabel(item.category)}</span>
                          {rarityLabel(item.rarity) ? (
                            <span
                              className="items-card-tag is-rarity"
                              style={
                                color && accent ? { color, borderColor: accent } : undefined
                              }
                            >
                              {rarityLabel(item.rarity)}
                            </span>
                          ) : null}
                          {item.requiresAttunement ? (
                            <span className="items-card-tag is-attunement">sintonização</span>
                          ) : null}
                        </span>
                        <span className="items-card-meta">
                          {item.weight > 0 ? `${item.weight} kg` : 'sem peso'}
                          {' · '}
                          {price || 'sem valor'}
                        </span>
                        {summary ? <span className="items-card-summary">{summary}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <p className="items-count">
            {visible.length} de {items.length} ite{items.length === 1 ? 'm' : 'ns'}
            {hasActiveFilters ? ' com os filtros atuais' : ''}
          </p>
        ) : null}
      </section>

      {selected ? (
        <ItemModal
          item={selected}
          mode={mode}
          creating={selected.id === creatingId}
          characters={characters}
          weapons={weapons}
          suspended={confirming}
          onPatch={(patch) => onPatch(selected.id, patch)}
          onSend={(characterId, quantity) => onSend(selected.id, characterId, quantity)}
          onModeChange={setMode}
          onRequestDelete={() => setConfirming(true)}
          onClose={closeItem}
        />
      ) : null}

      {selected && confirming ? (
        <DeleteItemDialog
          item={selected}
          usedBy={usedBy}
          onCancel={() => setConfirming(false)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}
