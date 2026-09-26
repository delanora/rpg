import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { describeItemDetails } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { InventoryItem, Item } from '../../types';
import { clampFloat, clampInt, newId } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function InventorySection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const inventory = character.inventory;

  // Catálogo do mestre: usado para buscar itens e puxar sprite/peso/descrição.
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (readOnly) return;
    let active = true;
    api<{ items: Item[] }>('/api/items')
      .then((result) => {
        if (active) setCatalog(result.items);
      })
      .catch(() => {
        // Sem catálogo a ficha continua funcionando com itens avulsos.
      });
    return () => {
      active = false;
    };
  }, [readOnly]);

  /** Recarrega o catálogo (mantém as sugestões atualizadas em tempo real). */
  function refreshCatalog(): void {
    api<{ items: Item[] }>('/api/items')
      .then((result) => setCatalog(result.items))
      .catch(() => {});
  }

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pool = term ? catalog.filter((item) => item.name.toLowerCase().includes(term)) : catalog;
    return pool.slice(0, 8);
  }, [query, catalog]);

  function patchItem(id: string, patch: Partial<InventoryItem>): void {
    update({ inventory: inventory.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  function addItem(): void {
    update({
      inventory: [
        ...inventory,
        {
          id: newId(),
          name: 'Novo item',
          description: '',
          quantity: 1,
          weight: 0,
          equipped: false,
          imageUrl: '',
          itemId: '',
          category: '',
          details: {},
        },
      ],
    });
  }

  /** Adiciona um item do catálogo; se já existir, apenas soma a quantidade. */
  function addFromCatalog(item: Item): void {
    const existing = inventory.find((entry) => entry.itemId === item.id);
    if (existing) {
      patchItem(existing.id, { quantity: existing.quantity + 1 });
    } else {
      update({
        inventory: [
          ...inventory,
          {
            id: newId(),
            itemId: item.id,
            name: item.name,
            description: item.description,
            quantity: 1,
            weight: item.weight,
            equipped: false,
            imageUrl: item.imageUrl,
            category: item.category,
            details: item.details,
          },
        ],
      });
    }
    setQuery('');
  }

  function removeItem(id: string): void {
    update({ inventory: inventory.filter((item) => item.id !== id) });
  }

  return (
    <Section
      title="Inventário"
      icon="flask"
      subtitle={`Peso total: ${character.derived.totalWeight} lb · capacidade ${character.derived.carryingCapacity} lb`}
      actions={
        readOnly ? undefined : (
          <button type="button" className="btn btn-small" onClick={addItem}>
            + item avulso
          </button>
        )
      }
    >
      {!readOnly ? (
        <div className="catalog-search">
          <Icon name="flask" size={15} />
          <input
            type="search"
            className="inline-input"
            value={query}
            placeholder="Buscar item no catálogo do mestre..."
            aria-label="Buscar item no catálogo"
            onFocus={refreshCatalog}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" className="btn btn-small" onClick={() => setQuery('')}>
              limpar
            </button>
          ) : null}

          {query ? (
            <ul className="suggestion-list catalog-suggestions">
              {suggestions.length === 0 ? (
                <li>
                  <span className="empty-hint">Nenhum item no catálogo com esse nome.</span>
                </li>
              ) : (
                suggestions.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="suggestion" onClick={() => addFromCatalog(item)}>
                      <Portrait src={item.imageUrl} alt={item.name} size="sm" icon="flask" />
                      <span className="suggestion-name">{item.name}</span>
                      <span className="muted">
                        {item.category}
                        {describeItemDetails(item.category, item.details)
                          ? ` · ${describeItemDetails(item.category, item.details)}`
                          : ''}
                        {item.weight > 0 ? ` · ${item.weight} lb` : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      {inventory.length === 0 ? (
        <p className="empty-hint">Nenhum item ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="col-narrow">Qtd.</th>
                <th className="col-narrow">Peso</th>
                <th>Descrição</th>
                <th className="col-narrow">Equip.</th>
                {!readOnly ? <th className="col-narrow" /> : null}
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="item-cell">
                      <Portrait src={item.imageUrl} alt={item.name} size="sm" icon="flask" />
                      <span className="item-cell-body">
                        <InlineField
                          value={item.name}
                          ariaLabel="Nome do item"
                          onCommit={(value) => {
                            const name = value.trim();
                            if (name) patchItem(item.id, { name });
                          }}
                        />
                        {describeItemDetails(item.category, item.details) ? (
                          <span className="item-detail-hint">
                            {describeItemDetails(item.category, item.details)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td>
                    <InlineField
                      value={item.quantity}
                      mode="number"
                      min={0}
                      ariaLabel="Quantidade"
                      onCommit={(value) =>
                        patchItem(item.id, { quantity: clampInt(value, 0, 9999, item.quantity) })
                      }
                    />
                  </td>
                  <td>
                    <InlineField
                      value={item.weight}
                      mode="number"
                      min={0}
                      ariaLabel="Peso"
                      onCommit={(value) =>
                        patchItem(item.id, { weight: clampFloat(value, 0, 100000, item.weight) })
                      }
                    />
                  </td>
                  <td>
                    <InlineField
                      value={item.description}
                      placeholder="descrição"
                      ariaLabel="Descrição do item"
                      onCommit={(value) => patchItem(item.id, { description: value })}
                    />
                  </td>
                  <td className="col-center">
                    <input
                      type="checkbox"
                      checked={item.equipped}
                      disabled={readOnly}
                      aria-label={`Equipado: ${item.name}`}
                      onChange={(event) => patchItem(item.id, { equipped: event.target.checked })}
                    />
                  </td>
                  {!readOnly ? (
                    <td className="col-center">
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remover ${item.name}`}
                      >
                        ×
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
