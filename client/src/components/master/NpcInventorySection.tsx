import { useState } from 'react';
import { api } from '../../api';
import { COIN_KEYS, COIN_LABELS } from '../../coins';
import type { CoinKey } from '../../types';
import { categoryLabel } from '../../dnd';
import type { Creature, InventorySlot, Item } from '../../types';
import { Icon } from '../Icon';
import { Section } from '../Section';

/** Slots oferecidos ao NPC (mesma nomenclatura da ficha do jogador). */
const NPC_SLOTS: { key: InventorySlot | ''; label: string }[] = [
  { key: '', label: 'Mochila' },
  { key: 'hand1', label: 'Mão principal' },
  { key: 'hand2', label: 'Mão secundária' },
  { key: 'chest', label: 'Peitoral' },
  { key: 'helmet', label: 'Elmo' },
  { key: 'necklace', label: 'Colar' },
  { key: 'ring1', label: 'Anel 1' },
  { key: 'ring2', label: 'Anel 2' },
  { key: 'legs', label: 'Pernas' },
  { key: 'boots', label: 'Botas' },
  { key: 'ammo', label: 'Munição' },
];

interface NpcInventorySectionProps {
  creature: Creature;
  /** Catálogo do Mestre, para adicionar itens prontos. */
  items: Item[];
  onCreatureChange: (creature: Creature) => void;
  onError: (message: string) => void;
}

/**
 * INVENTÁRIO PERSISTENTE DO NPC — contexto do Mestre.
 *
 * Mesmo domínio da ficha: itens/quantidade/equipamento/sintonização/moedas
 * vivem no NPC (não no combatente) e sobrevivem ao combate. Não é um segundo
 * inventário: as rotas escrevem `Creature.inventory`/`Creature.coins` e usam o
 * MESMO motor de CA, armas e moedas. A seção só aparece para NPC — criatura
 * template continua no statblock.
 *
 * Toda escrita manda `expectedVersion`; um 409 pede para atualizar (o evento
 * `creature:updated` também mantém a tela em sincronia).
 */
export function NpcInventorySection({
  creature,
  items,
  onCreatureChange,
  onError,
}: NpcInventorySectionProps) {
  const [catalogItemId, setCatalogItemId] = useState('');
  const [catalogQuantity, setCatalogQuantity] = useState(1);
  const [manualName, setManualName] = useState('');
  const [manualCategory, setManualCategory] = useState('Item Geral');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [coinDelta, setCoinDelta] = useState<Record<CoinKey, number>>({
    pp: 0,
    gp: 0,
    ep: 0,
    sp: 0,
    cp: 0,
  });
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      const { creature: updated } = await api<{ creature: Creature }>(
        `/api/creatures/${creature.id}${path}`,
        { method: 'POST', body: { expectedVersion: creature.version, ...body } },
      );
      onCreatureChange(updated);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao alterar o inventário do NPC.');
    } finally {
      setBusy(false);
    }
  }

  async function addCatalog(): Promise<void> {
    if (!catalogItemId) return;
    await run('/inventory', { itemId: catalogItemId, quantity: catalogQuantity });
    setCatalogItemId('');
    setCatalogQuantity(1);
  }

  async function addManual(): Promise<void> {
    if (!manualName.trim()) return;
    await run('/inventory', {
      name: manualName.trim(),
      category: manualCategory,
      quantity: manualQuantity,
    });
    setManualName('');
    setManualQuantity(1);
  }

  const attunedCount = creature.inventory.filter((item) => item.attuned).length;
  const derivedAttacks = creature.derivedAttacks ?? [];

  return (
    <Section
      title="Inventário do NPC"
      icon="bag"
      subtitle="Persistente fora do combate · equipamento altera CA e ataques · visível apenas para o Mestre"
    >
      <div className="npc-inventory">
        <p className="section-note">
          CA efetiva: <strong>{creature.effectiveArmorClass}</strong> (base {creature.armorClass}) ·
          Sintonizados: <strong>{attunedCount}/3</strong>
        </p>

        {derivedAttacks.length > 0 ? (
          <p className="section-note">
            Ataques de arma equipada:{' '}
            {derivedAttacks.map((attack) => attack.name).join(' · ')}
          </p>
        ) : null}

        <div className="npc-inventory-add">
          <label className="field field-inline">
            <span>Item do catálogo</span>
            <select value={catalogItemId} onChange={(event) => setCatalogItemId(event.target.value)}>
              <option value="">— escolher —</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({categoryLabel(item.category)})
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline npc-qty">
            <span>Qtd.</span>
            <input
              type="number"
              min={1}
              value={catalogQuantity}
              onChange={(event) => setCatalogQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={busy || !catalogItemId}
            onClick={() => void addCatalog()}
          >
            adicionar
          </button>
        </div>

        <div className="npc-inventory-add">
          <label className="field field-inline">
            <span>Item avulso</span>
            <input
              value={manualName}
              maxLength={120}
              placeholder="Nome do item"
              onChange={(event) => setManualName(event.target.value)}
            />
          </label>
          <label className="field field-inline">
            <span>Categoria</span>
            <select value={manualCategory} onChange={(event) => setManualCategory(event.target.value)}>
              {['Arma', 'Armadura', 'Escudo', 'Poção', 'Anel', 'Cajado', 'Munição', 'Item Geral', 'Tesouro', 'Outro'].map(
                (category) => (
                  <option key={category} value={category}>
                    {categoryLabel(category)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field field-inline npc-qty">
            <span>Qtd.</span>
            <input
              type="number"
              min={1}
              value={manualQuantity}
              onChange={(event) => setManualQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || !manualName.trim()}
            onClick={() => void addManual()}
          >
            adicionar avulso
          </button>
        </div>

        {creature.inventory.length === 0 ? (
          <p className="empty-hint">Nenhum item ainda. Armas equipadas acrescentam ataques; armadura/escudo alteram a CA.</p>
        ) : (
          <ul className="npc-inventory-list">
            {creature.inventory.map((item) => (
              <li key={item.id} className="npc-inventory-row">
                <span className="npc-inventory-name">
                  {item.name}
                  {item.quantity > 1 ? <em> ×{item.quantity}</em> : null}
                  {item.requiresAttunement ? (
                    <span className="tag">sintonização</span>
                  ) : null}
                </span>

                <label className="field field-inline npc-slot">
                  <span>Slot</span>
                  <select
                    value={item.slot ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      void run('/inventory/move', {
                        itemInventoryId: item.id,
                        targetSlot: event.target.value || null,
                      })
                    }
                  >
                    {NPC_SLOTS.map((slot) => (
                      <option key={slot.label} value={slot.key}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </label>

                {item.requiresAttunement ? (
                  <label className="npc-attune">
                    <input
                      type="checkbox"
                      checked={item.attuned === true}
                      disabled={busy}
                      onChange={(event) =>
                        void run('/inventory/attune', {
                          itemInventoryId: item.id,
                          attuned: event.target.checked,
                        })
                      }
                    />
                    sintonizado
                  </label>
                ) : null}

                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() =>
                    void run('/inventory/remove', { itemInventoryId: item.id, quantity: 1 })
                  }
                >
                  −1
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="npc-coins">
          <p className="field-label">
            <Icon name="coin" size={14} /> Moedas do NPC
          </p>
          <p className="npc-coins-current">
            {COIN_KEYS.map((key) => `${creature.coins?.[key] ?? 0} ${COIN_LABELS[key]}`).join(' · ')}
          </p>
          <div className="npc-coins-form">
            {COIN_KEYS.map((key) => (
              <label key={key} className="field field-inline npc-qty">
                <span>{COIN_LABELS[key]} (+/−)</span>
                <input
                  type="number"
                  value={coinDelta[key]}
                  onChange={(event) =>
                    setCoinDelta((prev) => ({ ...prev, [key]: Number(event.target.value) || 0 }))
                  }
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || COIN_KEYS.every((key) => coinDelta[key] === 0)}
              onClick={() => {
                const delta = Object.fromEntries(
                  COIN_KEYS.filter((key) => coinDelta[key] !== 0).map((key) => [key, coinDelta[key]]),
                );
                void run('/coins', { delta });
                setCoinDelta({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
              }}
            >
              aplicar
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
