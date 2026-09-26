import { useReadOnly } from '../../readonly';
import type { InventoryItem } from '../../types';
import { clampFloat, clampInt, newId } from '../../utils';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function InventorySection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const inventory = character.inventory;

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
        },
      ],
    });
  }

  function removeItem(id: string): void {
    update({ inventory: inventory.filter((item) => item.id !== id) });
  }

  return (
    <Section
      title="Inventário"
      subtitle={`Peso total: ${character.derived.totalWeight} lb · capacidade ${character.derived.carryingCapacity} lb`}
      actions={
        readOnly ? undefined : (
          <button type="button" className="btn btn-small" onClick={addItem}>
            + item
          </button>
        )
      }
    >
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
                    <InlineField
                      value={item.name}
                      ariaLabel="Nome do item"
                      onCommit={(value) => {
                        const name = value.trim();
                        if (name) patchItem(item.id, { name });
                      }}
                    />
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
