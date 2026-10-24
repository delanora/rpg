import { useState } from 'react';
import { api } from '../../api';
import { COIN_KEYS, COIN_LABELS, COIN_METAL, COIN_NAMES, coinsWeight } from '../../coins';
import type { CoinKey, Creature, Item } from '../../types';
import { InventoryDock } from '../InventoryDock';
import { Icon } from '../Icon';
import { Section } from '../Section';

interface NpcInventorySectionProps {
  creature: Creature;
  /** Catálogo do Mestre, para adicionar itens prontos. */
  items: Item[];
  onCreatureChange: (creature: Creature) => void;
  onError: (message: string) => void;
}

/**
 * INVENTÁRIO DO NPC — a MESMA experiência visual do inventário do jogador.
 *
 * Não existe um segundo inventário nem um dropdown simplificado: o painel
 * flutuante (`InventoryDock` → `InventorySection`) é literalmente o mesmo
 * componente, com o dono trocado (`npc`) e as escritas indo para o cadastro do
 * NPC (rotas master-only, versionadas). Equipar, sintonizar, moedas, usar e
 * "Usar em..." seguem o mesmo motor de CA, armas e consumíveis.
 */
export function NpcInventorySection({
  creature,
  items,
  onCreatureChange,
  onError,
}: NpcInventorySectionProps) {
  const attunedCount = creature.inventory.filter((item) => item.attuned).length;
  const derivedAttacks = creature.derivedAttacks ?? [];

  return (
    <>
      <Section
        title="Equipamento do NPC"
        icon="shield"
        subtitle="O inventário e as moedas abrem no painel flutuante — o MESMO da ficha do jogador"
      >
        <p className="section-note">
          CA efetiva: <strong>{creature.effectiveArmorClass}</strong> (base{' '}
          {creature.armorClass}) · Sintonizados: <strong>{attunedCount}/3</strong>
        </p>

        {derivedAttacks.length > 0 ? (
          <p className="section-note">
            Ataques de arma equipada: {derivedAttacks.map((attack) => attack.name).join(' · ')}
          </p>
        ) : null}

        <p className="section-note">
          Use o botão <strong>Inventário</strong> para equipar, sintonizar, usar consumíveis
          (duplo clique usa em si; o menu do item tem “Usar em...”) e gerenciar moedas.
        </p>
      </Section>

      <InventoryDock
        npc={{
          creature,
          items,
          onChange: onCreatureChange,
          onError,
        }}
        coinsPanel={
          <NpcCoinsPanel creature={creature} onCreatureChange={onCreatureChange} onError={onError} />
        }
      />
    </>
  );
}

/**
 * MOEDAS do NPC: mesmas denominações, mesmos cards e mesmo motor de carteira da
 * ficha. O Mestre dá (positivo) ou retira (negativo) por denominação — o saldo
 * nunca fica negativo (o servidor recusa).
 */
function NpcCoinsPanel({
  creature,
  onCreatureChange,
  onError,
}: {
  creature: Creature;
  onCreatureChange: (creature: Creature) => void;
  onError: (message: string) => void;
}) {
  const [delta, setDelta] = useState<Record<CoinKey, number>>({
    pp: 0,
    gp: 0,
    ep: 0,
    sp: 0,
    cp: 0,
  });
  const [busy, setBusy] = useState(false);
  const coins = creature.coins;
  const empty = COIN_KEYS.every((key) => delta[key] === 0);

  async function apply(): Promise<void> {
    if (empty || busy) return;
    const changes = Object.fromEntries(
      COIN_KEYS.filter((key) => delta[key] !== 0).map((key) => [key, delta[key]]),
    );
    setBusy(true);
    try {
      const { creature: updated } = await api<{ creature: Creature }>(
        `/api/creatures/${creature.id}/coins`,
        { method: 'POST', body: { expectedVersion: creature.version, delta: changes } },
      );
      onCreatureChange(updated);
      setDelta({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao alterar as moedas do NPC.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coins-panel">
      <div className="coins-head">
        <span>Moedas</span>
        <span className="coins-weight">{coinsWeight(coins)} kg</span>
      </div>

      <div className="coins-grid">
        {COIN_KEYS.map((key) => (
          <div key={key} className="coin-cell" title={COIN_NAMES[key]}>
            <Icon name="coin" size={15} className={`coin-icon ${COIN_METAL[key]}`} />
            <span className="coin-label">{COIN_LABELS[key]}</span>
            <span className="coin-value">{coins[key]}</span>
          </div>
        ))}
      </div>

      <div className="coin-form">
        <p className="coin-hint">Positivo dá, negativo retira.</p>
        <div className="coin-fields">
          {COIN_KEYS.map((key) => (
            <label key={key} className="coin-field">
              <span title={COIN_NAMES[key]}>{COIN_LABELS[key]}</span>
              <input
                type="number"
                className="coin-input"
                value={delta[key]}
                step={1}
                disabled={busy}
                aria-label={`${COIN_NAMES[key]} (${COIN_LABELS[key]})`}
                onChange={(event) =>
                  setDelta((current) => ({
                    ...current,
                    [key]: Number(event.target.value) || 0,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy || empty}
          onClick={() => void apply()}
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
