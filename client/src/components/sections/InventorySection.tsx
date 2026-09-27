import { useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { describeItemDetails } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { InventoryItem, InventoryMoveRequest, InventorySlot } from '../../types';
import { clampInt, newId } from '../../utils';
import { Icon, type IconName } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/** Colunas fixas da grade da mochila (as linhas crescem conforme os itens). */
const GRID_COLS = 5;
const MIN_ROWS = 5;

/** Rótulos dos slots do paperdoll (também usados em leitores de tela). */
const SLOT_LABELS: Record<InventorySlot, string> = {
  helmet: 'Elmo',
  necklace: 'Colar',
  chest: 'Peitoral',
  ring1: 'Anel 1',
  ring2: 'Anel 2',
  hand1: 'Mão esquerda',
  hand2: 'Mão direita',
  legs: 'Calças',
  boots: 'Botas',
};

/** Ícone de placeholder de um slot vazio. */
const SLOT_ICON: Record<InventorySlot, IconName> = {
  helmet: 'shield',
  necklace: 'star',
  chest: 'shield',
  ring1: 'star',
  ring2: 'star',
  hand1: 'sword',
  hand2: 'sword',
  legs: 'shield',
  boots: 'shield',
};

interface InventorySectionProps extends SheetSectionProps {
  /** Move/equipa um item no servidor (trata a troca no backend). */
  onMoveItem?: (request: InventoryMoveRequest) => void | Promise<void>;
}

interface CellPosition {
  x: number;
  y: number;
}

/**
 * Calcula a grade da mochila: itens com posição gravada ficam onde estão e os
 * que ainda não têm posição ocupam as primeiras células livres (ordem do
 * inventário). A posição calculada só é persistida quando o item é arrastado.
 */
function layoutBackpack(inventory: InventoryItem[]): {
  cells: Map<string, InventoryItem>;
  rows: number;
} {
  const backpack = inventory.filter((item) => item.slot === null);
  const placed = new Map<string, CellPosition>();
  const occupied = new Set<string>();
  let maxY = -1;

  for (const item of backpack) {
    if (item.backpackX !== null && item.backpackY !== null) {
      placed.set(item.id, { x: item.backpackX, y: item.backpackY });
      occupied.add(`${item.backpackX},${item.backpackY}`);
      maxY = Math.max(maxY, item.backpackY);
    }
  }

  for (const item of backpack) {
    if (placed.has(item.id)) continue;
    let x = 0;
    let y = 0;
    while (occupied.has(`${x},${y}`)) {
      x += 1;
      if (x >= GRID_COLS) {
        x = 0;
        y += 1;
      }
    }
    occupied.add(`${x},${y}`);
    placed.set(item.id, { x, y });
    maxY = Math.max(maxY, y);
  }

  const cells = new Map<string, InventoryItem>();
  for (const item of backpack) {
    const position = placed.get(item.id);
    if (position) cells.set(`${position.x},${position.y}`, item);
  }

  const rows = Math.max(MIN_ROWS, maxY + 1, Math.ceil(backpack.length / GRID_COLS));
  return { cells, rows };
}

/** Sprite do item ou o ícone genérico quando não há imagem. */
function ItemSprite({ item }: { item: InventoryItem }) {
  if (item.imageUrl) {
    return <img className="inv-sprite" src={item.imageUrl} alt={item.name} draggable={false} />;
  }
  return <Icon name="flask" size={22} />;
}

/**
 * Silhueta do paperdoll: só decoração de fundo, atrás dos slots.
 */
function Silhouette() {
  return (
    <svg className="paperdoll-silhouette" viewBox="0 0 120 260" aria-hidden="true">
      <circle cx="60" cy="24" r="17" />
      <path d="M60 44c-15 0-25 9-27 23l-6 46 13 3 4-30v32h32V86l4 30 13-3-6-46c-2-14-12-23-27-23Z" />
      <path d="M41 118v58l-6 78h15l6-72 3-64Z" />
      <path d="M79 118v58l6 78H70l-6-72-3-64Z" />
    </svg>
  );
}

export function InventorySection({ character, update, onMoveItem }: InventorySectionProps) {
  const readOnly = useReadOnly();
  const inventory = character.inventory;
  // Sem o callback do endpoint (ex.: visão do mestre) não há arrastar/soltar.
  const canMove = !readOnly && onMoveItem !== undefined;

  const [backpackOpen, setBackpackOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Espelho síncrono do item arrastado: o estado do React pode não ter
  // atualizado antes do primeiro `dragover`, então o `drop` usa o ref.
  const draggingRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);

  const { cells, rows } = useMemo(() => layoutBackpack(inventory), [inventory]);
  const equipped = useMemo(() => {
    const map = new Map<InventorySlot, InventoryItem>();
    for (const item of inventory) {
      if (item.slot) map.set(item.slot, item);
    }
    return map;
  }, [inventory]);

  const backpackCount = inventory.filter((item) => item.slot === null).length;
  const selected = inventory.find((item) => item.id === selectedId) ?? null;

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
          slot: null,
          backpackX: null,
          backpackY: null,
          imageUrl: '',
          itemId: '',
          category: '',
          details: {},
        },
      ],
    });
  }

  function removeItem(id: string): void {
    update({ inventory: inventory.filter((item) => item.id !== id) });
    setSelectedId(null);
  }

  function beginDrag(event: DragEvent, id: string): void {
    if (!canMove) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    draggingRef.current = id;
    setDraggingId(id);
    setTooltip(null);
  }

  function endDrag(): void {
    draggingRef.current = null;
    setDraggingId(null);
    setDragOver(null);
  }

  function allowDrop(event: DragEvent, key: string): void {
    if (!canMove || !draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOver !== key) setDragOver(key);
  }

  function dropOn(event: DragEvent, target: { slot?: InventorySlot; x?: number; y?: number }): void {
    event.preventDefault();
    const id = draggingRef.current ?? event.dataTransfer.getData('text/plain');
    endDrag();
    if (!id || !canMove || !onMoveItem) return;

    if (target.slot !== undefined) {
      void onMoveItem({ itemInventoryId: id, targetSlot: target.slot });
    } else {
      void onMoveItem({
        itemInventoryId: id,
        targetBackpackX: target.x ?? 0,
        targetBackpackY: target.y ?? 0,
      });
    }
  }

  function showTooltip(event: MouseEvent, item: InventoryItem): void {
    setTooltip({ item, x: event.clientX, y: event.clientY });
  }

  /** Nó do item: arrastável, clicável e com tooltip. */
  function itemNode(item: InventoryItem) {
    return (
      <div
        className={`inv-item${draggingId === item.id ? ' is-dragging' : ''}`}
        draggable={canMove}
        onDragStart={(event) => beginDrag(event, item.id)}
        onDragEnd={endDrag}
        onClick={() => setSelectedId(item.id)}
        onMouseEnter={(event) => showTooltip(event, item)}
        onMouseLeave={() => setTooltip(null)}
        aria-label={`${item.name}${item.quantity > 1 ? ` (${item.quantity})` : ''}`}
      >
        <ItemSprite item={item} />
        {item.quantity > 1 ? <span className="inv-qty">{item.quantity}</span> : null}
      </div>
    );
  }

  function slotNode(slot: InventorySlot) {
    const item = equipped.get(slot);
    const key = `slot:${slot}`;
    return (
      <div
        key={slot}
        className={`paperdoll-slot pos-${slot}${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
        onDragOver={(event) => allowDrop(event, key)}
        onDragLeave={() => setDragOver((value) => (value === key ? null : value))}
        onDrop={(event) => dropOn(event, { slot })}
        aria-label={SLOT_LABELS[slot]}
      >
        {item ? (
          itemNode(item)
        ) : (
          <span className="slot-empty">
            <Icon name={SLOT_ICON[slot]} size={18} />
          </span>
        )}
        <span className="slot-caption">{SLOT_LABELS[slot]}</span>
      </div>
    );
  }

  return (
    <Section
      title="Inventário"
      icon="bag"
      subtitle={`Peso total: ${character.derived.totalWeight} kg · capacidade ${character.derived.carryingCapacity} kg`}
      actions={
        readOnly ? undefined : (
          <button type="button" className="btn btn-small" onClick={addItem}>
            + item avulso
          </button>
        )
      }
    >
      <div className="inventory-board">
        {/* --- Paperdoll ------------------------------------------------- */}
        <div className="paperdoll">
          <Silhouette />
          <div className="paperdoll-grid">
            {slotNode('helmet')}
            {slotNode('necklace')}
            {slotNode('hand1')}
            {slotNode('chest')}
            {slotNode('hand2')}
            <div className="paperdoll-rings">
              {slotNode('ring1')}
              {slotNode('ring2')}
            </div>
            {slotNode('legs')}
            {slotNode('boots')}
          </div>
        </div>

        {/* --- Mochila --------------------------------------------------- */}
        <div className="backpack">
          <button
            type="button"
            className={backpackOpen ? 'backpack-toggle is-open' : 'backpack-toggle'}
            aria-expanded={backpackOpen}
            onClick={() => setBackpackOpen((value) => !value)}
          >
            <Icon name="bag" size={18} />
            <span>Mochila</span>
            <span className="backpack-count">{backpackCount}</span>
          </button>

          {backpackOpen ? (
            <div className="backpack-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}>
              {Array.from({ length: rows * GRID_COLS }, (_, index) => {
                const x = index % GRID_COLS;
                const y = Math.floor(index / GRID_COLS);
                const item = cells.get(`${x},${y}`);
                const key = `cell:${x},${y}`;

                return (
                  <div
                    key={key}
                    className={`backpack-cell${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
                    onDragOver={(event) => allowDrop(event, key)}
                    onDragLeave={() => setDragOver((value) => (value === key ? null : value))}
                    onDrop={(event) => dropOn(event, { x, y })}
                  >
                    {item ? itemNode(item) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty-hint">Mochila fechada.</p>
          )}

          {selected ? (
            <div className="inv-detail">
              <div className="inv-detail-head">
                <span className="inv-detail-sprite">
                  <ItemSprite item={selected} />
                </span>
                <div className="inv-detail-title">
                  <strong>{selected.name}</strong>
                  <span className="inv-detail-meta">
                    {selected.weight} kg
                    {selected.itemId ? ' · catálogo' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setSelectedId(null)}
                  aria-label="Fechar detalhes"
                >
                  ×
                </button>
              </div>

              {describeItemDetails(selected.category, selected.details) ? (
                <p className="inv-detail-effect">
                  {describeItemDetails(selected.category, selected.details)}
                </p>
              ) : null}
              <p className="inv-detail-desc">{selected.description || 'Sem descrição.'}</p>

              <div className="inv-detail-actions">
                <label className="inv-detail-qty">
                  Qtd.
                  <InlineField
                    className="inv-detail-qty-field"
                    value={selected.quantity}
                    mode="number"
                    min={0}
                    readOnly={readOnly}
                    ariaLabel="Quantidade"
                    onCommit={(value) =>
                      patchItem(selected.id, { quantity: clampInt(value, 0, 9999, selected.quantity) })
                    }
                  />
                </label>
                {!readOnly ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={() => removeItem(selected.id)}
                  >
                    remover
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {tooltip ? (
        <div className="inv-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
          <strong>{tooltip.item.name}</strong>
          <span>
            {tooltip.item.weight} kg
            {tooltip.item.quantity > 1 ? ` · ${tooltip.item.quantity}×` : ''}
          </span>
          <p>{tooltip.item.description || 'Sem descrição.'}</p>
        </div>
      ) : null}
    </Section>
  );
}
