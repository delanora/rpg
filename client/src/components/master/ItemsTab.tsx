import { useState } from 'react';
import { describeItemDetails } from '../../dnd';
import type { Character, Item, ItemPatch } from '../../types';
import { Portrait } from '../Portrait';
import { CoinsGrantPanel } from './CoinsGrantPanel';
import { ItemEditor } from './ItemEditor';

/** Preço resumido (PO/PP/PC) — visível apenas no painel do mestre. */
function priceLabel(item: Item): string {
  if (!item.price) return '';
  const parts: string[] = [];
  if (item.price.gold) parts.push(`${item.price.gold} PO`);
  if (item.price.silver) parts.push(`${item.price.silver} PP`);
  if (item.price.copper) parts.push(`${item.price.copper} PC`);
  return parts.length > 0 ? parts.join(' · ') : 'sem valor';
}

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
 * Catálogo central de itens: cards com sprite + editor + envio ao jogador.
 *
 * No topo da aba fica o painel **Entregar moedas**: é por aqui que o mestre dá
 * (ou retira) dinheiro dos jogadores sem abrir a ficha de cada um — antes isso
 * só era possível pelo bloco de moedas dentro da ficha.
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
  const [creating, setCreating] = useState(false);

  const selected = items.find((item) => item.id === selectedId) ?? null;

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
    <div className="items-tab">
      <CoinsGrantPanel
        characters={characters}
        extraCoins={extraCoins}
        onCharacter={onCoinsChange}
      />

      <div className="master-layout">
        <aside className="master-list">
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'criando...' : '+ novo item'}
            </button>
          </div>

          {items.length === 0 ? (
            <p className="empty-hint">Nenhum item no catálogo ainda.</p>
          ) : (
            <ul className="item-cards">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={selected?.id === item.id ? 'item-card active' : 'item-card'}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <Portrait src={item.imageUrl} alt={item.name} icon="flask" />
                    <span className="item-info">
                      <span className="card-name">{item.name}</span>
                      <span className="card-line">
                        {item.category}
                        {item.weight > 0 ? ` · ${item.weight} kg` : ''}
                      </span>
                      {describeItemDetails(item.category, item.details) ? (
                        <span className="card-line">
                          {describeItemDetails(item.category, item.details)}
                        </span>
                      ) : null}
                      <span className="card-owner">{priceLabel(item)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="master-detail">
          {selected ? (
            <ItemEditor
              item={selected}
              characters={characters}
              onPatch={(patch) => onPatch(selected.id, patch)}
              onDelete={() => {
                onDelete(selected.id);
                setSelectedId(null);
              }}
              onSend={(characterId, quantity) => onSend(selected.id, characterId, quantity)}
            />
          ) : (
            <p className="empty-hint">
              Selecione um item para editar o sprite e a descrição, ou crie um novo.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
