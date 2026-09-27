import { useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent, PointerEvent } from 'react';
import { describeItemDetails } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { InventoryItem, InventoryMoveRequest, InventorySlot } from '../../types';
import { clampInt, newId } from '../../utils';
import { Icon, type IconName } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/** Colunas fixas da mochila (as linhas crescem conforme os itens). */
const GRID_COLS = 5;
const MIN_ROWS = 4;

/** Rótulos dos slots (usados em `title`/leitores de tela). */
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
  firstFree: CellPosition;
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

  // Primeira célula livre após acomodar tudo (destino ao soltar na mochila).
  let freeX = 0;
  let freeY = 0;
  while (occupied.has(`${freeX},${freeY}`)) {
    freeX += 1;
    if (freeX >= GRID_COLS) {
      freeX = 0;
      freeY += 1;
    }
  }

  const rows = Math.max(MIN_ROWS, maxY + 1, Math.ceil(backpack.length / GRID_COLS));
  return { cells, rows, firstFree: { x: freeX, y: freeY } };
}

/** Sprite do item ou o ícone genérico quando não há imagem. */
function ItemSprite({ item }: { item: InventoryItem }) {
  if (item.imageUrl) {
    return <img className="inv-sprite" src={item.imageUrl} alt={item.name} draggable={false} />;
  }
  return <Icon name="flask" size={22} />;
}

/** Silhueta do corpo atrás dos slots (decoração do set). */
function BodyDoll() {
  return (
    <svg className="equip-doll" viewBox="0 0 120 260" aria-hidden="true">
      <circle cx="60" cy="24" r="17" />
      <path d="M60 44c-15 0-25 9-27 23l-6 46 13 3 4-30v32h32V86l4 30 13-3-6-46c-2-14-12-23-27-23Z" />
      <path d="M41 118v58l-6 78h15l6-72 3-64Z" />
      <path d="M79 118v58l6 78H70l-6-72-3-64Z" />
    </svg>
  );
}

const EQUIP_SLOTS: InventorySlot[] = [
  'helmet',
  'necklace',
  'chest',
  'hand1',
  'hand2',
  'legs',
  'ring1',
  'ring2',
  'boots',
];

export function InventorySection({ character, update, onMoveItem }: InventorySectionProps) {
  const readOnly = useReadOnly();
  const inventory = character.inventory;
  // Sem o callback do endpoint (ex.: visão do mestre) não há arrastar/soltar.
  const canMove = !readOnly && onMoveItem !== undefined;

  const setRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);

  const [bagPos, setBagPos] = useState<CellPosition | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { cells, rows, firstFree } = useMemo(() => layoutBackpack(inventory), [inventory]);
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

  function openBag(): void {
    const rect = setRef.current?.getBoundingClientRect();
    const width = 296;
    const x = rect ? Math.min(rect.right + 14, window.innerWidth - width - 12) : 40;
    const y = rect ? Math.max(rect.top, 12) : 80;
    setBagPos({ x: Math.max(12, x), y });
  }

  function closeBag(): void {
    setBagPos(null);
  }

  /** Arrasta a janela da mochila pela barra de título. */
  function startWindowDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!bagPos) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = bagPos;

    function onMove(moveEvent: globalThis.PointerEvent): void {
      setBagPos({
        x: Math.max(0, origin.x + moveEvent.clientX - startX),
        y: Math.max(0, origin.y + moveEvent.clientY - startY),
      });
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

  function moveDraggedTo(request: (id: string) => InventoryMoveRequest): void {
    const id = draggingRef.current;
    endDrag();
    if (!id || !canMove || !onMoveItem) return;
    void onMoveItem(request(id));
  }

  function dropOnEquipSlot(event: DragEvent, slot: InventorySlot): void {
    event.preventDefault();
    moveDraggedTo((id) => ({ itemInventoryId: id, targetSlot: slot }));
  }

  function dropOnCell(event: DragEvent, x: number, y: number): void {
    event.preventDefault();
    moveDraggedTo((id) => ({ itemInventoryId: id, targetBackpackX: x, targetBackpackY: y }));
  }

  function dropOnBackpack(event: DragEvent): void {
    event.preventDefault();
    moveDraggedTo((id) => ({
      itemInventoryId: id,
      targetBackpackX: firstFree.x,
      targetBackpackY: firstFree.y,
    }));
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

  function equipSlotNode(slot: InventorySlot) {
    const item = equipped.get(slot);
    const key = `slot:${slot}`;
    return (
      <div
        key={slot}
        className={`equip-slot slot-${slot}${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
        title={SLOT_LABELS[slot]}
        aria-label={SLOT_LABELS[slot]}
        onDragOver={(event) => allowDrop(event, key)}
        onDragLeave={() => setDragOver((value) => (value === key ? null : value))}
        onDrop={(event) => dropOnEquipSlot(event, slot)}
      >
        {item ? (
          itemNode(item)
        ) : (
          <span className="slot-empty">
            <Icon name={SLOT_ICON[slot]} size={20} />
          </span>
        )}
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
        {/* --- Set de equipamento (estilo Tibia) ------------------------- */}
        <div className="equip-set" ref={setRef}>
          <BodyDoll />
          {EQUIP_SLOTS.map((slot) => equipSlotNode(slot))}

          {/* Slot de container: clicar abre a janela da mochila; soltar um
              item equipado aqui o devolve à primeira célula livre. */}
          <button
            type="button"
            className={`equip-slot slot-backpack${dragOver === 'backpack' ? ' is-over' : ''}`}
            title={`Mochila (${backpackCount}) — clique para abrir`}
            aria-label={`Abrir mochila (${backpackCount} itens)`}
            onClick={openBag}
            onDragOver={(event) => allowDrop(event, 'backpack')}
            onDragLeave={() => setDragOver((value) => (value === 'backpack' ? null : value))}
            onDrop={dropOnBackpack}
          >
            <Icon name="bag" size={24} />
            <span className="bag-badge">{backpackCount}</span>
          </button>
        </div>

        <p className="inventory-hint">
          Arraste os itens do set para a mochila e vice-versa. Clique na mochila do set para abrir a
          janela com a grade.
        </p>

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

      {/* --- Janela da mochila (container) ----------------------------- */}
      {bagPos ? (
        <div className="bag-window" style={{ left: bagPos.x, top: bagPos.y }}>
          <div className="bag-window-title" onPointerDown={startWindowDrag}>
            <Icon name="bag" size={16} />
            <span>Mochila</span>
            <span className="bag-window-count">{backpackCount}</span>
            <button
              type="button"
              className="bag-window-close"
              onClick={closeBag}
              aria-label="Fechar mochila"
            >
              ×
            </button>
          </div>

          {backpackCount === 0 ? (
            <p className="bag-window-empty">A mochila está vazia.</p>
          ) : (
            <div className="bag-grid">
              {Array.from({ length: rows * GRID_COLS }, (_, index) => {
                const x = index % GRID_COLS;
                const y = Math.floor(index / GRID_COLS);
                const item = cells.get(`${x},${y}`);
                const key = `cell:${x},${y}`;

                return (
                  <div
                    key={key}
                    className={`bag-cell${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
                    onDragOver={(event) => allowDrop(event, key)}
                    onDragLeave={() => setDragOver((value) => (value === key ? null : value))}
                    onDrop={(event) => dropOnCell(event, x, y)}
                  >
                    {item ? itemNode(item) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

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
