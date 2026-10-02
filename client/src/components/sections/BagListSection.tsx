import { useState } from 'react';
import { describeItemDetails, rarityColor, rarityLabel } from '../../dnd';
import type { Character } from '../../types';
import { ItemSprite } from './InventorySection';

interface BagListSectionProps {
  character: Character;
}

/**
 * A mochila em forma de lista, para consulta rápida durante o combate — em
 * oposição à grade 4x5 do inventário da ficha. Só lê os itens que estão na
 * mochila (sem slot equipado); clicar numa linha abre a descrição completa.
 */
export function BagListSection({ character }: BagListSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = character.inventory.filter((item) => item.slot === null);

  if (items.length === 0) {
    return <p className="empty-hint">A mochila está vazia.</p>;
  }

  return (
    <ul className="bag-list">
      {items.map((item) => {
        const isOpen = item.id === openId;
        const effect = describeItemDetails(item.category, item.details);

        return (
          <li key={item.id}>
            <button
              type="button"
              className={isOpen ? 'bag-list-row active' : 'bag-list-row'}
              aria-expanded={isOpen}
              onClick={() => setOpenId((value) => (value === item.id ? null : item.id))}
            >
              <span className="bag-list-sprite">
                <ItemSprite item={item} />
              </span>
              <span className="bag-list-name">{item.name}</span>
              {item.rarity ? (
                <span
                  className="bag-list-rarity"
                  style={{ color: rarityColor(item.rarity) ?? undefined }}
                >
                  {rarityLabel(item.rarity)}
                </span>
              ) : null}
              <span className="bag-list-qty">×{item.quantity}</span>
              <span className="bag-list-weight">{item.weight} kg</span>
            </button>

            {isOpen ? (
              <div className="bag-list-detail">
                {effect ? <p className="inv-detail-effect">{effect}</p> : null}
                <p className="inv-detail-desc">{item.description || 'Sem descrição.'}</p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
