import { useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { isConsumableItem, rarityTint } from '../../dnd';
import { useSheetAccess } from '../../readonly';
import type {
  Character,
  InventoryItem,
  InventoryMoveRequest,
  InventorySlot,
  TransferTarget,
} from '../../types';
import { newId } from '../../utils';
import { Icon, type IconName } from '../Icon';
import { ItemDetailModal } from '../ItemDetailModal';
import { CoinsPanel } from './CoinsPanel';
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
  ammo: 'Munição',
};

/** Ícone de placeholder de um slot vazio (o que o campo representa). */
const SLOT_ICON: Record<InventorySlot, IconName> = {
  helmet: 'helmet',
  necklace: 'necklace',
  chest: 'armor',
  ring1: 'ring',
  ring2: 'ring',
  hand1: 'sword',
  hand2: 'shield',
  legs: 'legs',
  boots: 'boots',
  ammo: 'ammo',
};

export interface InventorySectionProps extends SheetSectionProps {
  /** Move/equipa um item no servidor (trata a troca no backend). */
  onMoveItem?: (request: InventoryMoveRequest) => void | Promise<void>;
  /** Usa (consome) 1 unidade de um item consumível (Poção ou marcado). */
  onUseItem?: (itemInventoryId: string) => void | Promise<void>;
  /** Denominações extras (PL/PE) ligadas pelo mestre na mesa. */
  extraCoins?: boolean;
  /** Destinos possíveis de transferência de moedas (outros jogadores). */
  coinTargets?: TransferTarget[];
  /** Adota a ficha devolvida por uma ação de moedas. */
  onCoinsChange?: (character: Character) => void;
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
export function ItemSprite({ item }: { item: InventoryItem }) {
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

export function InventorySection({
  character,
  update,
  onMoveItem,
  onUseItem,
  extraCoins = false,
  coinTargets = [],
  onCoinsChange,
}: InventorySectionProps) {
  // Movimentar/equipar e USAR item são estado de jogo (valem sempre para o
  // jogador); criar, remover e mudar a QUANTIDADE são do mestre — o jogador
  // nunca altera a quantidade (regra do servidor).
  const { readOnly, masterView } = useSheetAccess();
  const inventory = character.inventory;
  // Sem o callback do endpoint (ex.: visão do mestre) não há arrastar/soltar.
  const canMove = !readOnly && onMoveItem !== undefined;
  // Controles de CONSTRUÇÃO do inventário: só o mestre, e só em modo de edição.
  const canEditItems = masterView && !readOnly;
  // O jogador pode usar consumíveis (nunca o mestre, que só administra).
  const canUseItems = !masterView && !readOnly;

  const draggingRef = useRef<string | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Item aberto na ficha detalhada (modal central). Guarda só o id: o item é
  // lido do inventário, sem cópia.
  const [modalItemId, setModalItemId] = useState<string | null>(null);
  // A mochila NÃO abre junto com o inventário: só ao clicar no ícone dela.
  const [backpackOpen, setBackpackOpen] = useState(false);

  const { cells, rows, firstFree } = useMemo(() => layoutBackpack(inventory), [inventory]);
  const equipped = useMemo(() => {
    const map = new Map<InventorySlot, InventoryItem>();
    for (const item of inventory) {
      if (item.slot) map.set(item.slot, item);
    }
    return map;
  }, [inventory]);

  const backpackCount = inventory.filter((item) => item.slot === null).length;
  const modalItem = inventory.find((item) => item.id === modalItemId) ?? null;

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
          rarity: null,
          requiresAttunement: false,
          details: {},
        },
      ],
    });
  }

  function removeItem(id: string): void {
    update({ inventory: inventory.filter((item) => item.id !== id) });
    setModalItemId((current) => (current === id ? null : current));
  }

  /**
   * Consome 1 unidade do item (o servidor é quem desconta). Devolve a promessa
   * para o modal do item poder segurar o botão "usando..." até a resposta.
   */
  function useItem(id: string): Promise<void> {
    if (!onUseItem) return Promise.resolve();
    return Promise.resolve(onUseItem(id));
  }

  /**
   * Clique: abre a FICHA DETALHADA (modal centralizado). Para o jogador, o modal
   * ganha o botão "Usar" quando o item é consumível; para o mestre, os controles
   * de quantidade e remoção.
   */
  function openDetail(item: InventoryItem): void {
    setModalItemId(item.id);
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

  /** Nó do item: arrastável, com os detalhes abertos no clique. */
  function itemNode(item: InventoryItem) {
    // Indicação discreta da raridade: um anel interno na cor, bem translúcido.
    const rarityRing = rarityTint(item.rarity, '88');
    return (
      <div
        className={`inv-item${draggingId === item.id ? ' is-dragging' : ''}`}
        style={rarityRing ? { boxShadow: `inset 0 0 0 1.5px ${rarityRing}` } : undefined}
        draggable={canMove}
        onDragStart={(event) => beginDrag(event, item.id)}
        onDragEnd={endDrag}
        onClick={() => openDetail(item)}
        aria-label={`${item.name}${item.quantity > 1 ? ` (${item.quantity})` : ''}`}
      >
        <ItemSprite item={item} />
        {item.quantity > 1 ? <span className="inv-qty">{item.quantity}</span> : null}
        {/* Proficiência do personagem com o item (vem calculada do servidor). */}
        {item.proficiency ? (
          <span
            className={`inv-prof${item.proficiency.proficient ? ' is-ok' : ' is-warn'}`}
            title={
              item.proficiency.proficient
                ? 'Proficiente com este item'
                : 'Sem proficiência com este item'
            }
            aria-hidden="true"
          >
            {item.proficiency.proficient ? '✓' : '⚠'}
          </span>
        ) : null}
      </div>
    );
  }

  function equipSlotNode(slot: InventorySlot) {
    const item = equipped.get(slot);
    const key = `slot:${slot}`;
    return (
      <div
        key={slot}
        className={`equip-slot${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
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
            <Icon name={SLOT_ICON[slot]} size={22} />
          </span>
        )}
      </div>
    );
  }

  /** Célula "Anel": abriga os dois slots de anel lado a lado. */
  function ringSlotNode() {
    const rings: InventorySlot[] = ['ring1', 'ring2'];
    return (
      <div className="equip-slot is-double" title="Anéis">
        {rings.map((slot) => {
          const item = equipped.get(slot);
          const key = `slot:${slot}`;
          return (
            <div
              key={slot}
              className={`equip-subslot${item ? ' is-filled' : ''}${dragOver === key ? ' is-over' : ''}`}
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
                  <Icon name="ring" size={17} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="inventory-board">
        {canEditItems ? (
          <div className="inventory-toolbar">
            <button type="button" className="btn btn-small" onClick={addItem}>
              + item avulso
            </button>
          </div>
        ) : null}

        {/* --- Set de equipamento (estilo Tibia) ------------------------- */}
        <div className="equip-set">
          <BodyDoll />              {/* Grade principal 3×3, célula a célula como o set clássico:
              amuleto | elmo | mochila
              arma    | peitoral | escudo
              anéis   | calças | munição (slot real: aceita pilhas de munição) */}
          <div className="equip-grid">
            {equipSlotNode('necklace')}
            {equipSlotNode('helmet')}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={backpackOpen}
              aria-label={`Mochila (${backpackCount} itens) — clique para abrir`}
              className={`equip-slot slot-backpack${backpackOpen ? ' is-open' : ''}${dragOver === 'backpack' ? ' is-over' : ''}`}
              title={`Mochila (${backpackCount}) — clique para abrir e solte um item aqui para guardar`}
              onClick={() => setBackpackOpen((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setBackpackOpen((value) => !value);
                }
              }}
              onDragOver={(event) => allowDrop(event, 'backpack')}
              onDragLeave={() => setDragOver((value) => (value === 'backpack' ? null : value))}
              onDrop={dropOnBackpack}
            >
              <Icon name="bag" size={24} />
              <span className="bag-badge">{backpackCount}</span>
            </div>
            {equipSlotNode('hand1')}
            {equipSlotNode('chest')}
            {equipSlotNode('hand2')}
            {ringSlotNode()}
            {equipSlotNode('legs')}
            {equipSlotNode('ammo')}
          </div>

          {/* Botas, sozinhas e centralizadas abaixo da grade. */}
          <div className="equip-extra-row">{equipSlotNode('boots')}</div>
        </div>

        {/* A mochila abre só pelo ícone dela no set (nunca junto do inventário),
            logo abaixo do grid de equipamento — e as moedas vivem DENTRO dela,
            num bloco separado abaixo do grid. */}
        {backpackOpen ? (
          <div className="bag-panel">
            <div className="bag-panel-title">
              <Icon name="bag" size={16} />
              <span>Mochila</span>
              <span className="bag-panel-count">{backpackCount}</span>
            </div>

            {/* Mostra sempre 4 fileiras de 5 células; o excedente rola aqui. */}
            <div className="bag-scroll">
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
            </div>

            {/* Moedas: campo aparte do grid, abaixo dele (só quando alguém pode
                movimentá-las ou o mestre está vendo a ficha). */}
            {onCoinsChange ? (
              <CoinsPanel
                character={character}
                extraCoins={extraCoins}
                targets={coinTargets}
                onCharacter={onCoinsChange}
              />
            ) : null}
          </div>
        ) : null}

        <p className="inventory-weight">
          Peso total: {character.derived.totalWeight} kg · capacidade{' '}
          {character.derived.carryingCapacity} kg
        </p>

      </div>

      {modalItem ? (
        <ItemDetailModal
          item={modalItem}
          onClose={() => setModalItemId(null)}
          onUse={
            canUseItems && isConsumableItem(modalItem.category, modalItem.details)
              ? () => useItem(modalItem.id)
              : undefined
          }
          onQuantityChange={
            canEditItems
              ? (quantity) => patchItem(modalItem.id, { quantity })
              : undefined
          }
          onRemove={canEditItems ? () => removeItem(modalItem.id) : undefined}
        />
      ) : null}
    </>
  );
}
