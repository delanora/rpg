import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { api } from '../../api';
import {
  categoryLabel,
  isConsumableItem,
  rarityTint,
} from '../../dnd';
import { useSheetAccess } from '../../readonly';
import type {
  Character,
  Creature,
  InventoryItem,
  InventoryMoveRequest,
  InventorySlot,
  Item,
  TransferTarget,
} from '../../types';
import { newId } from '../../utils';
import { Icon, type IconName } from '../Icon';
import { ItemContextMenu, type ItemMenuOption } from '../ItemContextMenu';
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

/**
 * AÇÕES DO DONO do inventário — iguais para personagem e NPC.
 *
 * O que muda é quem ESCREVE: personagem usa os endpoints da própria ficha; o
 * NPC (bloco `npc`) usa as rotas master-only do cadastro. A aparência, os
 * cards, os menus e os gestos são os MESMOS componentes.
 */
interface InventoryCommonProps {
  /** Move/equipa um item no servidor (trata a troca no backend). */
  onMoveItem?: (request: InventoryMoveRequest) => void | Promise<void>;
  /** Usa (consome) 1 unidade de um item consumível (Poção ou marcado). */
  onUseItem?: (itemInventoryId: string) => void | Promise<void>;
  /** Alvos de "Usar em..." (o próprio usuário fica de fora: duplo clique = em si). */
  itemTargets?: { id: string; name: string }[];
  /** Usa o consumível em OUTRA criatura (o servidor valida turno/Ação). */
  onUseItemOn?: (itemInventoryId: string, targetId: string) => void | Promise<void>;
  /** Denominações extras (PL/PE) ligadas pelo mestre na mesa. */
  extraCoins?: boolean;
  /** Destinos possíveis de transferência de moedas (outros jogadores). */
  coinTargets?: TransferTarget[];
  /** Adota a ficha devolvida por uma ação de moedas. */
  onCoinsChange?: (character: Character) => void;
  /** Painel de moedas próprio do dono (inventário de NPC). */
  coinsPanel?: ReactNode;
}

/** Dono PERSONAGEM (jogador ou ficha aberta no painel do mestre). */
export interface InventorySectionProps extends SheetSectionProps, InventoryCommonProps {
  npc?: undefined;
}

/** Dono NPC: as escritas vão para o cadastro do NPC (master-only). */
export interface NpcInventoryPanelProps extends InventoryCommonProps {
  npc: {
    creature: Creature;
    /** Catálogo do Mestre, para adicionar itens prontos. */
    items: Item[];
    onChange: (creature: Creature) => void;
    onError: (message: string) => void;
  };
  character?: undefined;
  update?: undefined;
}

export type InventoryPanelProps = InventorySectionProps | NpcInventoryPanelProps;

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

export function InventorySection(props: InventoryPanelProps) {
  const {
    onMoveItem,
    onUseItem,
    itemTargets = [],
    onUseItemOn,
    extraCoins = false,
    coinTargets = [],
    onCoinsChange,
    coinsPanel,
  } = props;
  // Movimentar/equipar e USAR item são estado de jogo (valem sempre para o
  // jogador); criar, remover e mudar a QUANTIDADE são do mestre — o jogador
  // nunca altera a quantidade (regra do servidor).
  const { readOnly, masterView } = useSheetAccess();
  const inventory = props.npc ? props.npc.creature.inventory : props.character.inventory;
  // No NPC quem escreve é o Mestre (rotas master-only), então a movimentação
  // segue liberada mesmo sem estar "em edição" na ficha.
  const canMove = props.npc ? true : !readOnly && onMoveItem !== undefined;
  // Controles de CONSTRUÇÃO do inventário: só o mestre, e só em modo de edição.
  const canEditItems = props.npc ? true : masterView && !readOnly;
  // O jogador pode usar consumíveis (nunca o mestre, que só administra). No
  // inventário do NPC o Mestre usa pelo mesmo gesto.
  const canUseItems = props.npc ? true : !masterView && !readOnly;

  const draggingRef = useRef<string | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Item aberto na ficha detalhada (modal central). Guarda só o id: o item é
  // lido do inventário, sem cópia.
  const [modalItemId, setModalItemId] = useState<string | null>(null);
  // A mochila NÃO abre junto com o inventário: só ao clicar no ícone dela.
  const [backpackOpen, setBackpackOpen] = useState(false);
  // MENU CONTEXTUAL do item (clique direito) e o seletor compacto dele
  // ("Usar em..." / "Equipar..."). Vive no portal do menu, sem modal.
  const [menu, setMenu] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{
    item: InventoryItem;
    x: number;
    y: number;
    mode: 'target' | 'slot';
  } | null>(null);
  // Trava SÍNCRONA do duplo clique: o estado do React só atualiza no próximo
  // render, então dois cliques no mesmo tick disparariam duas intenções.
  const usingRef = useRef(false);
  // Clique simples abre a ficha detalhada; em consumível ele espera o segundo
  // clique (senão o modal abriria e engoliria o duplo clique).
  const clickTimer = useRef<number | null>(null);
  const [npcBusy, setNpcBusy] = useState(false);
  const [catalogItemId, setCatalogItemId] = useState('');
  const [catalogQuantity, setCatalogQuantity] = useState(1);
  const [manualName, setManualName] = useState('');

  // Um timer pendente não pode abrir o modal depois que a seção sair da tela.
  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

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
  // O NPC não tem "capacidade de carga" derivada: mostra só o peso carregado.
  const npcWeight = props.npc
    ? Number(
        props.npc.creature.inventory
          .reduce((sum, item) => sum + item.weight * item.quantity, 0)
          .toFixed(2),
      )
    : 0;

  /** Item que pode ser consumido (Poção ou marcado como consumível). */
  function isUsable(item: InventoryItem): boolean {
    return isConsumableItem(item.category, item.details);
  }

  /**
   * Efeito AUTOMATIZADO pelo servidor. Fora da cura estruturada, o uso é
   * registrado e o Mestre resolve — a UI diz isso, não inventa efeito.
   */
  function isAutomated(item: InventoryItem): boolean {
    return item.details.potionCategory === 'healing' && Boolean(item.details.healingDice);
  }

  /**
   * Escrita no cadastro do NPC (rotas master-only, com `expectedVersion`).
   * Devolve quando a resposta chega, para o gesto poder segurar o "usando...".
   */
  async function npcWrite(path: string, body: Record<string, unknown>): Promise<void> {
    if (!props.npc) return;
    const { npc: owner } = props;
    setNpcBusy(true);
    try {
      const { creature } = await api<{ creature: Creature }>(
        `/api/creatures/${owner.creature.id}${path}`,
        { method: 'POST', body: { expectedVersion: owner.creature.version, ...body } },
      );
      owner.onChange(creature);
    } catch (error) {
      owner.onError(
        error instanceof Error ? error.message : 'Falha ao alterar o inventário do NPC.',
      );
    } finally {
      setNpcBusy(false);
    }
  }

  function patchItem(id: string, patch: Partial<InventoryItem>): void {
    const { update } = props;
    if (!update) return;
    update({ inventory: inventory.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  function addItem(): void {
    const { update } = props;
    if (!update) return;
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
    if (props.npc) {
      void npcWrite('/inventory/remove', { itemInventoryId: id, quantity: 1 });
      return;
    }
    const { update } = props;
    if (!update) return;
    update({ inventory: inventory.filter((item) => item.id !== id) });
    setModalItemId((current) => (current === id ? null : current));
  }

  /**
   * Usa 1 unidade EM SI MESMO — o gesto do duplo clique.
   *
   * Fora do combate o servidor desconta a unidade (com `operationId`); durante
   * o combate quem manda é o motor de combate (turno + Ação), que chega aqui
   * pelos callbacks do contexto de combate. A trava síncrona impede dois
   * requests do MESMO gesto.
   */
  function useOnSelf(item: InventoryItem): Promise<void> {
    if (usingRef.current) return Promise.resolve();
    usingRef.current = true;
    const run = async (): Promise<void> => {
      try {
        if (onUseItem) await onUseItem(item.id);
        else if (props.npc) await npcWrite('/inventory/use', { itemInventoryId: item.id });
      } finally {
        usingRef.current = false;
      }
    };
    return run();
  }

  /** "Usar em..." — outro alvo; o servidor valida o alcance/turno. */
  function useOnTarget(item: InventoryItem, targetId: string): Promise<void> {
    if (usingRef.current) return Promise.resolve();
    if (!onUseItemOn) return Promise.resolve();
    usingRef.current = true;
    return Promise.resolve(onUseItemOn(item.id, targetId)).finally(() => {
      usingRef.current = false;
    });
  }

  /**
   * Clique: abre a FICHA DETALHADA (modal centralizado). Em consumível espera
   * ~230 ms para o duplo clique (usar em si) não ser engolido pelo modal.
   */
  function openDetail(item: InventoryItem): void {
    setModalItemId(item.id);
  }

  function handleItemClick(item: InventoryItem): void {
    if (!canUseItems || !isUsable(item)) {
      openDetail(item);
      return;
    }
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      openDetail(item);
    }, 230);
  }

  /** Duplo clique no consumível = USAR EM MIM (sem seletor, sem confirmação). */
  function handleItemDoubleClick(item: InventoryItem): void {
    if (!canUseItems || !isUsable(item)) return;
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    void useOnSelf(item);
  }

  function openItemMenu(item: InventoryItem, event: ReactMouseEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ item, x: event.clientX, y: event.clientY });
  }

  /** Move/equipa pelo mesmo motor: coordenadas só existem na ficha do jogador. */
  function moveItemTo(id: string, slot: InventorySlot | null): void {
    if (props.npc) {
      void npcWrite('/inventory/move', { itemInventoryId: id, targetSlot: slot });
      return;
    }
    if (!onMoveItem) return;
    void onMoveItem({ itemInventoryId: id, targetSlot: slot });
  }

  /** Opções do menu contextual: aparecem só as que fazem sentido no contexto. */
  function itemMenuOptions(item: InventoryItem, x: number, y: number): ItemMenuOption[] {
    const options: ItemMenuOption[] = [];
    if (canUseItems && isUsable(item)) {
      options.push({
        id: 'use',
        label: 'Usar',
        icon: 'flask',
        hint: 'Usar em mim mesmo (duplo clique)',
        onSelect: () => void useOnSelf(item),
      });
      if (onUseItemOn && itemTargets.length > 0) {
        options.push({
          id: 'use-on',
          label: 'Usar em...',
          icon: 'users',
          hint: 'O alvo precisa estar ao alcance físico.',
          onSelect: () => setPicker({ item, x, y, mode: 'target' }),
        });
      }
    }

    options.push({ id: 'inspect', label: 'Inspecionar', icon: 'search', onSelect: () => openDetail(item) });

    if (canMove) {
      if (item.slot) {
        options.push({
          id: 'unequip',
          label: 'Desequipar',
          icon: 'bag',
          onSelect: () => moveItemTo(item.id, null),
        });
      } else {
        options.push({
          id: 'equip',
          label: 'Equipar...',
          icon: 'shield',
          onSelect: () => setPicker({ item, x, y, mode: 'slot' }),
        });
      }
    }

    if (props.npc && item.requiresAttunement) {
      options.push({
        id: 'attune',
        label: item.attuned ? 'Dessintonizar' : 'Sintonizar',
        icon: 'sparkle',
        disabled: npcBusy,
        onSelect: () =>
          void npcWrite('/inventory/attune', {
            itemInventoryId: item.id,
            attuned: !item.attuned,
          }),
      });
    }

    if (canEditItems) {
      options.push({
        id: 'remove',
        label: props.npc ? 'Remover 1' : 'Remover',
        icon: 'trash',
        danger: true,
        disabled: npcBusy,
        onSelect: () => removeItem(item.id),
      });
    }

    return options;
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
    if (!id || !canMove) return;
    if (props.npc) {
      // O NPC não guarda posição na grade: soltar na mochila = slot nulo.
      void npcWrite('/inventory/move', {
        itemInventoryId: id,
        targetSlot: request(id).targetSlot ?? null,
      });
      return;
    }
    if (!onMoveItem) return;
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
        onClick={() => handleItemClick(item)}
        // Duplo clique: usar em si. Menu contextual: opções do item.
        onDoubleClick={() => handleItemDoubleClick(item)}
        onContextMenu={(event) => openItemMenu(item, event)}
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
          <div className={props.npc ? 'inventory-toolbar is-npc' : 'inventory-toolbar'}>
            {props.npc ? (
              <>
                <select
                  className="inv-toolbar-select"
                  value={catalogItemId}
                  disabled={npcBusy}
                  aria-label="Item do catálogo"
                  onChange={(event) => setCatalogItemId(event.target.value)}
                >
                  <option value="">— item do catálogo —</option>
                  {props.npc.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({categoryLabel(item.category)})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="inv-toolbar-qty"
                  min={1}
                  value={catalogQuantity}
                  disabled={npcBusy}
                  aria-label="Quantidade"
                  onChange={(event) =>
                    setCatalogQuantity(Math.max(1, Number(event.target.value) || 1))
                  }
                />
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={npcBusy || !catalogItemId}
                  onClick={() => {
                    void npcWrite('/inventory', {
                      itemId: catalogItemId,
                      quantity: catalogQuantity,
                    }).then(() => {
                      setCatalogItemId('');
                      setCatalogQuantity(1);
                    });
                  }}
                >
                  + adicionar
                </button>
                <input
                  className="inv-toolbar-name"
                  value={manualName}
                  maxLength={120}
                  placeholder="Item avulso"
                  disabled={npcBusy}
                  aria-label="Nome do item avulso"
                  onChange={(event) => setManualName(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={npcBusy || !manualName.trim()}
                  onClick={() => {
                    void npcWrite('/inventory', { name: manualName.trim(), quantity: 1 }).then(
                      () => setManualName(''),
                    );
                  }}
                >
                  + avulso
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-small" onClick={addItem}>
                + item avulso
              </button>
            )}
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
            {props.npc
              ? coinsPanel ?? null
              : props.character && onCoinsChange
                ? (
                    <CoinsPanel
                      character={props.character}
                      extraCoins={extraCoins}
                      targets={coinTargets}
                      onCharacter={onCoinsChange}
                    />
                  )
                : null}
          </div>
        ) : null}

        <p className="inventory-weight">
          {props.npc ? (
            <>Peso total: {npcWeight} kg</>
          ) : (
            <>
              Peso total: {props.character.derived.totalWeight} kg · capacidade{' '}
              {props.character.derived.carryingCapacity} kg
            </>
          )}
        </p>

      </div>

      {modalItem ? (
        <ItemDetailModal
          item={modalItem}
          onClose={() => setModalItemId(null)}
          onUse={
            canUseItems && isUsable(modalItem) ? () => useOnSelf(modalItem) : undefined
          }
          onQuantityChange={
            canEditItems && !props.npc
              ? (quantity) => patchItem(modalItem.id, { quantity })
              : undefined
          }
          onRemove={canEditItems ? () => removeItem(modalItem.id) : undefined}
        />
      ) : null}

      {/* MENU CONTEXTUAL do item (clique direito). */}
      {menu ? (
        <ItemContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.item.name}
          note={
            canUseItems && isUsable(menu.item) && !isAutomated(menu.item)
              ? 'Resolução pelo Mestre — nenhum efeito é inventado.'
              : undefined
          }
          options={itemMenuOptions(menu.item, menu.x, menu.y)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {/* SELETOR COMPACTO do próprio menu: alvos de "Usar em..." ou slot. */}
      {picker ? (
        <ItemContextMenu
          x={picker.x}
          y={picker.y}
          title={
            picker.mode === 'target'
              ? `Usar ${picker.item.name} em...`
              : `Equipar ${picker.item.name}`
          }
          note={
            picker.mode === 'target'
              ? 'O alvo precisa estar ao alcance físico. O Mestre resolve o posicionamento quando necessário.'
              : undefined
          }
          options={
            picker.mode === 'target'
              ? itemTargets.map((target) => ({
                  id: target.id,
                  label: target.name,
                  icon: 'users' as const,
                  onSelect: () => void useOnTarget(picker.item, target.id),
                }))
              : (Object.keys(SLOT_LABELS) as InventorySlot[]).map((slot) => ({
                  id: slot,
                  label: SLOT_LABELS[slot],
                  icon: SLOT_ICON[slot],
                  onSelect: () => moveItemTo(picker.item.id, slot),
                }))
          }
          onClose={() => setPicker(null)}
        />
      ) : null}

    </>
  );
}
