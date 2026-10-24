import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { describeItemDetails, isConsumableItem, rarityColor, rarityLabel } from '../../dnd';
import type { Character, InventoryItem } from '../../types';
import { ItemContextMenu, type ItemMenuOption } from '../ItemContextMenu';
import { ItemSprite } from './InventorySection';

interface BagListSectionProps {
  character: Character;
  /**
   * Usa 1 unidade EM SI MESMO. É o MESMO motor do inventário (`useItem`): em
   * combate o servidor valida turno e Ação, consome a unidade e aplica a cura.
   * Sem o callback, a lista continua sendo só consulta.
   */
  onUseItem?: (itemInventoryId: string) => void | Promise<void>;
  /** Alvos de "Usar em..." (os OUTROS combatentes); o servidor valida o resto. */
  itemTargets?: { id: string; name: string }[];
  onUseItemOn?: (itemInventoryId: string, targetId: string) => void | Promise<void>;
}

/**
 * A mochila em forma de lista, para consulta rápida durante o combate — em
 * oposição à grade 4x5 do inventário da ficha. Mostra só os itens que estão na
 * mochila (sem slot equipado), em LINHA, e clicar numa linha abre a descrição.
 *
 * Os itens seguem a MESMA lógica de uso do inventário: duplo clique no
 * consumível usa em si e o menu contextual (clique direito) oferece "Usar em..."
 * — nada de painel próprio nem motor paralelo, só a apresentação em lista.
 */
export function BagListSection({
  character,
  onUseItem,
  itemTargets = [],
  onUseItemOn,
}: BagListSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  // MENU CONTEXTUAL do item e o seletor compacto de alvos dele ("Usar em...").
  const [menu, setMenu] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  // Trava SÍNCRONA do gesto: dois cliques no mesmo tick não disparam dois usos.
  const usingRef = useRef(false);
  // Clique simples abre a descrição; em consumível ele espera o duplo clique
  // (mesmo tempo do inventário), senão o detalhe "engoliria" o segundo clique.
  const clickTimer = useRef<number | null>(null);
  const items = character.inventory.filter((item) => item.slot === null);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  /** Consumível (Poção ou item marcado como consumível) — regra única da ficha. */
  function isUsable(item: InventoryItem): boolean {
    return isConsumableItem(item.category, item.details);
  }

  function canUse(item: InventoryItem): boolean {
    return onUseItem !== undefined && isUsable(item);
  }

  function toggleDetail(item: InventoryItem): void {
    setOpenId((value) => (value === item.id ? null : item.id));
  }

  function useOnSelf(item: InventoryItem): void {
    if (!onUseItem || usingRef.current) return;
    usingRef.current = true;
    void Promise.resolve(onUseItem(item.id)).finally(() => {
      usingRef.current = false;
    });
  }

  function useOnTarget(item: InventoryItem, targetId: string): void {
    if (!onUseItemOn || usingRef.current) return;
    usingRef.current = true;
    void Promise.resolve(onUseItemOn(item.id, targetId)).finally(() => {
      usingRef.current = false;
    });
  }

  function handleRowClick(item: InventoryItem): void {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return;
    }
    clickTimer.current = window.setTimeout(
      () => {
        clickTimer.current = null;
        toggleDetail(item);
      },
      canUse(item) ? 230 : 0,
    );
  }

  /** Duplo clique no consumível = usar em si, sem confirmação (como no inventário). */
  function handleRowDoubleClick(item: InventoryItem): void {
    if (!canUse(item)) return;
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    useOnSelf(item);
  }

  function openItemMenu(item: InventoryItem, event: ReactMouseEvent<HTMLElement>): void {
    if (!canUse(item)) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ item, x: event.clientX, y: event.clientY });
  }

  /** Opções do item: as MESMAS do inventário, sem equipar (aqui é só a mochila). */
  function menuOptions(item: InventoryItem, x: number, y: number): ItemMenuOption[] {
    const options: ItemMenuOption[] = [
      {
        id: 'use',
        label: 'Usar',
        icon: 'flask',
        hint: 'Usar em mim mesmo (duplo clique)',
        onSelect: () => useOnSelf(item),
      },
    ];
    if (onUseItemOn && itemTargets.length > 0) {
      options.push({
        id: 'use-on',
        label: 'Usar em...',
        icon: 'users',
        hint: 'O alvo precisa estar ao alcance físico.',
        onSelect: () => setPicker({ item, x, y }),
      });
    }
    options.push({
      id: 'inspect',
      label: 'Ver descrição',
      icon: 'search',
      onSelect: () => setOpenId(item.id),
    });
    return options;
  }

  if (items.length === 0) {
    return <p className="empty-hint">A mochila está vazia.</p>;
  }

  return (
    <>
      <ul className="bag-list">
        {items.map((item) => {
          const isOpen = item.id === openId;
          const effect = describeItemDetails(item.category, item.details);
          const usable = canUse(item);

          return (
            <li key={item.id}>
              <button
                type="button"
                className={isOpen ? 'bag-list-row active' : 'bag-list-row'}
                aria-expanded={isOpen}
                title={usable ? `${item.name} — duplo clique usa; clique direito abre as opções` : item.name}
                onClick={() => handleRowClick(item)}
                onDoubleClick={() => handleRowDoubleClick(item)}
                onContextMenu={(event) => openItemMenu(item, event)}
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

      {/* Menu e seletor de alvos: os MESMOS componentes do inventário. */}
      {menu ? (
        <ItemContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.item.name}
          options={menuOptions(menu.item, menu.x, menu.y)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {picker ? (
        <ItemContextMenu
          x={picker.x}
          y={picker.y}
          title={`Usar ${picker.item.name} em...`}
          options={itemTargets.map((target) => ({
            id: target.id,
            label: target.name,
            icon: 'users' as const,
            onSelect: () => useOnTarget(picker.item, target.id),
          }))}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
