import { useState } from 'react';
import { Icon } from '../../components/Icon';
import {
  ammoStackLabel,
  ammoStackTotal,
  ammoStacks,
  availableAttacks as selectAvailableAttacks,
  requiredAmmoType,
  weaponOf,
} from '../../ammo';
import { damageExpression, formatModifier } from '../../dnd';
import type { Attack, CombatDto, CombatantDto, InventoryItem } from '../../types';
import { clampInt } from '../../utils';

interface CombatActionPanelProps {
  combat: CombatDto;
  attacker: CombatantDto | null;
  attacks: Attack[];
  /** O mestre pode escolher com quem atacar; o jogador sempre usa o próprio. */
  attackerChoices?: CombatantDto[];
  onSelectAttacker?: (combatantId: string) => void;
  attacksFor?: (combatantId: string) => Attack[];
  /** Dados de Ataque Furtivo a exibir em armas que qualificam (ex.: "2d6"). */
  sneakAttack?: string | null;
  /**
   * Mestre: resolve os dados de Ataque Furtivo do atacante escolhido (qualquer
   * combatente, inclusive uma ficha de Ladino). Só o jogador usa `sneakAttack`.
   */
  sneakAttackFor?: (combatantId: string) => string | null;
  /** Inventário do próprio personagem (para munição e vínculo de arma). */
  inventory?: InventoryItem[];
  busy: boolean;
  onAttack: (input: {
    attackId: string;
    targetCombatantId: string;
    attackerCombatantId?: string;
    ammoInventoryId?: string;
    advantage?: boolean;
    disadvantage?: boolean;
    adjacentAlly?: boolean;
  }) => void;
}

/**
 * O QUE POSSO FAZER? Formulário de ataque (jogador e mestre). Componente apenas
 * de apresentação: toda a resolução continua acontecendo no backend via
 * `onAttack`, exatamente como antes.
 */
export function CombatActionPanel({
  combat,
  attacker,
  attacks,
  attackerChoices,
  onSelectAttacker,
  attacksFor,
  sneakAttack,
  sneakAttackFor,
  inventory,
  busy,
  onAttack,
}: CombatActionPanelProps) {
  const [attackId, setAttackId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [ammoId, setAmmoId] = useState('');
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [adjacentAlly, setAdjacentAlly] = useState(false);

  const baseAttacks = attackerChoices && attacksFor && attacker ? attacksFor(attacker.id) : attacks;
  // Ataques de arma não equipada somem (só dá para avaliar com o inventário).
  const availableAttacks = inventory ? selectAvailableAttacks(baseAttacks, inventory) : baseAttacks;

  const targets = combat.combatants.filter((item) => item.id !== attacker?.id && !item.missing);

  // Munição do ataque escolhido: arma equipada vinculada + pilhas compatíveis.
  const selectedAttack = availableAttacks.find((item) => item.id === attackId) ?? null;
  // No painel do mestre o atacante pode ser a ficha de qualquer Ladino; resolve
  // os dados do Furtivo dela quando não vierem por prop (caso do jogador).
  const sneakExpression =
    sneakAttack ?? (sneakAttackFor && attacker ? sneakAttackFor(attacker.id) : null);
  // O Ataque Furtivo só é possível com uma arma que qualifica (sutil ou à
  // distância) e quando o personagem tem a feature — mesma condição do servidor.
  const sneakEligible =
    Boolean(sneakExpression) &&
    selectedAttack !== null &&
    (selectedAttack.finesse || selectedAttack.ranged);
  const weapon = inventory && selectedAttack ? weaponOf(selectedAttack, inventory) : null;
  const ammoType = requiredAmmoType(weapon);
  const stacks = inventory && ammoType ? ammoStacks(inventory, ammoType) : [];
  const ammoTotal = ammoStackTotal(stacks);
  const selectedAmmo = stacks.find((item) => item.id === ammoId) ?? null;
  const ammoMissing = Boolean(ammoType) && ammoTotal === 0;

  const ready = Boolean(attacker && attackId && targetId) && !ammoMissing;

  return (
    <section className="combat-block">
      <h3>
        <Icon name="sword" size={15} /> Atacar
      </h3>

      {attackerChoices ? (
        <label className="field">
          <span>Atacante</span>
          <select
            value={attacker?.id ?? ''}
            onChange={(event) => {
              setAttackId('');
              onSelectAttacker?.(event.target.value);
            }}
          >
            <option value="">escolha o atacante</option>
            {attackerChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!attacker ? (
        <p className="empty-hint">Escolha o atacante para ver os ataques.</p>
      ) : availableAttacks.length === 0 ? (
        <p className="empty-hint">Nenhum ataque cadastrado para {attacker.name}.</p>
      ) : (
        <>
          <label className="field">
            <span>Ataque</span>
            <select
              value={attackId}
              onChange={(event) => {
                setAttackId(event.target.value);
                // Trocar de arma invalida a confirmação de aliado adjacente.
                setAdjacentAlly(false);
              }}
            >
              <option value="">escolha o ataque</option>
              {availableAttacks.map((attack) => (
                <option key={attack.id} value={attack.id}>
                  {attack.name} — dano {damageExpression(attack.damage)}
                  {attack.damage.type ? ` (${attack.damage.type})` : ''}, acerto{' '}
                  {formatModifier(attack.attackBonus)}
                  {sneakExpression && (attack.finesse || attack.ranged)
                    ? ` · +${sneakExpression} furtivo`
                    : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Alvo</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">escolha o alvo</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.statsHidden
                    ? ''
                    : ` — CA ${item.armorClass}, HP ${item.hpCurrent}/${item.hpMax}`}
                </option>
              ))}
            </select>
          </label>

          <div className="dice-controls">
            <label className="dice-toggle" title="Rola 2d20 e mantém o maior. Habilita o Ataque Furtivo do Ladino.">
              <input
                type="checkbox"
                checked={advantage}
                onChange={(event) => setAdvantage(event.target.checked)}
              />
              Vantagem
            </label>
            <label className="dice-toggle" title="Rola 2d20 e mantém o menor. Impede o Ataque Furtivo do Ladino.">
              <input
                type="checkbox"
                checked={disadvantage}
                onChange={(event) => setDisadvantage(event.target.checked)}
              />
              Desvantagem
            </label>
          </div>

          {sneakEligible ? (
            <label
              className="dice-toggle"
              title="O sistema não tem grid: confirme marcando se houver um aliado seu adjacente ao alvo. Com isso o Ataque Furtivo se aplica mesmo sem vantagem."
            >
              <input
                type="checkbox"
                checked={adjacentAlly}
                onChange={(event) => setAdjacentAlly(event.target.checked)}
              />
              Tenho um aliado adjacente ao alvo
            </label>
          ) : null}

          {ammoType ? (
            <label className="field">
              <span>Munição ({ammoType})</span>
              {stacks.length > 0 ? (
                <select value={selectedAmmo?.id ?? ''} onChange={(event) => setAmmoId(event.target.value)}>
                  <option value="">automática (sem bônus primeiro)</option>
                  {stacks.map((item) => (
                    <option key={item.id} value={item.id}>
                      {ammoStackLabel(item)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="ammo-warning">Sem munição para esta arma.</span>
              )}
              {stacks.length > 0 ? (
                <span className="field-hint">disponível: {ammoTotal}</span>
              ) : null}
            </label>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !ready}
            title={ammoMissing ? 'Sem munição para esta arma.' : undefined}
            onClick={() => {
              onAttack({
                attackId,
                targetCombatantId: targetId,
                advantage,
                disadvantage,
                ...(adjacentAlly && sneakEligible ? { adjacentAlly: true } : {}),
                ...(attackerChoices ? { attackerCombatantId: attacker.id } : {}),
                ...(selectedAmmo ? { ammoInventoryId: selectedAmmo.id } : {}),
              });
            }}
          >
            <Icon name="die" size={15} /> Rolar ataque
          </button>
        </>
      )}
    </section>
  );
}

interface ManualHpPanelProps {
  combatants: CombatantDto[];
  busy: boolean;
  onApply: (input: { combatantId: string; amount: number; mode: 'damage' | 'heal' }) => void;
}

/** Mestre: dano/cura manual. Mesmo comportamento do bloco anterior. */
export function ManualHpPanel({ combatants, busy, onApply }: ManualHpPanelProps) {
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('5');

  return (
    <section className="combat-block">
      <h3>
        <Icon name="heart" size={15} /> Dano / cura manual
      </h3>
      <div className="hp-controls">
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">escolha o combatente</option>
          {combatants.map((combatant) => (
            <option key={combatant.id} value={combatant.id}>
              {combatant.name} ({combatant.hpCurrent}/{combatant.hpMax})
            </option>
          ))}
        </select>

        <input
          type="number"
          min={1}
          max={9999}
          value={amount}
          aria-label="Quantidade"
          onChange={(event) => setAmount(event.target.value)}
        />

        <button
          type="button"
          className="btn btn-danger btn-small"
          disabled={busy || !target}
          onClick={() =>
            onApply({ combatantId: target, amount: clampInt(amount, 1, 9999, 1), mode: 'damage' })
          }
        >
          aplicar dano
        </button>

        <button
          type="button"
          className="btn btn-small"
          disabled={busy || !target}
          onClick={() =>
            onApply({ combatantId: target, amount: clampInt(amount, 1, 9999, 1), mode: 'heal' })
          }
        >
          curar
        </button>
      </div>
    </section>
  );
}
