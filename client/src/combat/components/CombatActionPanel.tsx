import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Portrait } from '../../components/Portrait';
import {
  ammoStackLabel,
  ammoStackTotal,
  ammoStacks,
  availableAttacks as selectAvailableAttacks,
  requiredAmmoType,
  weaponOf,
} from '../../ammo';
import { WEAPON_TYPE_LABELS, damageExpression, formatModifier } from '../../dnd';
import type { Attack, CombatDto, CombatantDto, InventoryItem } from '../../types';
import { clampInt } from '../../utils';

/** Modos de rolagem são mutuamente exclusivos (nenhum/vantagem/desvantagem). */
const ROLL_MODES = [
  { key: 'normal', label: 'Normal', icon: 'die', title: 'Uma rolagem de d20.' },
  {
    key: 'advantage',
    label: 'Vantagem',
    icon: 'sun',
    title: 'Rola 2d20 e mantém o maior. Habilita o Ataque Furtivo do Ladino.',
  },
  {
    key: 'disadvantage',
    label: 'Desvantagem',
    icon: 'moon',
    title: 'Rola 2d20 e mantém o menor. Impede o Ataque Furtivo do Ladino.',
  },
] as const;

type RollMode = (typeof ROLL_MODES)[number]['key'];

/** Alcance legível a partir da arma vinculada (só quando o inventário existe). */
function rangeLabel(weapon: InventoryItem | null): string | null {
  const normal = weapon?.details.rangeNormal;
  if (!normal) return null;
  const long = weapon?.details.rangeLong;
  return long ? `${normal}/${long} m` : `${normal} m`;
}

/** Tipo do ataque: usa o detalhe da arma quando disponível, senão o flag do ataque. */
function attackTypeLabel(attack: Attack, weapon: InventoryItem | null): string {
  const weaponType = weapon?.details.weaponType;
  if (weaponType) return WEAPON_TYPE_LABELS[weaponType];
  return attack.ranged ? WEAPON_TYPE_LABELS.ranged : WEAPON_TYPE_LABELS.melee;
}

/** Cartão visual de um ataque disponível (nome, tipo, bônus, dano, alcance, munição). */
function AttackOption({
  attack,
  inventory,
  selected,
  onSelect,
}: {
  attack: Attack;
  inventory?: InventoryItem[];
  selected: boolean;
  onSelect: () => void;
}) {
  const weapon = inventory ? weaponOf(attack, inventory) : null;
  const range = rangeLabel(weapon);
  const ammo = requiredAmmoType(weapon);
  const damages = [attack.damage, ...(attack.extraDamages ?? [])];

  return (
    <button
      type="button"
      className={selected ? 'attack-card selected' : 'attack-card'}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="attack-card-head">
        <Icon name={attack.ranged ? 'ammo' : 'sword'} size={15} />
        <span className="attack-card-name">{attack.name}</span>
      </span>
      <span className="attack-card-type">{attackTypeLabel(attack, weapon)}</span>
      <span className="attack-card-bonus">{formatModifier(attack.attackBonus)} para acertar</span>
      <span className="attack-card-damage">
        {damages.map((damage, index) => (
          <span key={index} className="attack-card-damage-line">
            {damageExpression(damage)}
            {damage.type ? ` ${damage.type}` : ''}
          </span>
        ))}
      </span>
      {range ? (
        <span className="attack-card-meta">
          <Icon name="wind" size={12} /> Alcance {range}
        </span>
      ) : null}
      {ammo ? (
        <span className="attack-card-meta ammo">
          <Icon name="ammo" size={12} /> Consome munição ({ammo})
        </span>
      ) : null}
    </button>
  );
}

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
 * O QUE POSSO FAZER? Fluxo de ataque visual em três passos — escolher o ataque,
 * escolher o alvo e revisar a rolagem — com os mesmos dados e a mesma validação
 * do backend. Só a apresentação mudou: nada de regra, cálculo ou envio.
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
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [adjacentAlly, setAdjacentAlly] = useState(false);

  const baseAttacks = attackerChoices && attacksFor && attacker ? attacksFor(attacker.id) : attacks;
  // Ataques de arma não equipada somem (só dá para avaliar com o inventário).
  const availableAttacks = inventory ? selectAvailableAttacks(baseAttacks, inventory) : baseAttacks;

  const targets = combat.combatants.filter((item) => item.id !== attacker?.id && !item.missing);

  // Munição do ataque escolhido: arma equipada vinculada + pilhas compatíveis.
  const selectedAttack = availableAttacks.find((item) => item.id === attackId) ?? null;
  const selectedTarget = targets.find((item) => item.id === targetId) ?? null;
  const selectedWeapon = inventory && selectedAttack ? weaponOf(selectedAttack, inventory) : null;
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
  const ammoType = requiredAmmoType(selectedWeapon);
  const stacks = inventory && ammoType ? ammoStacks(inventory, ammoType) : [];
  const ammoTotal = ammoStackTotal(stacks);
  const selectedAmmo = stacks.find((item) => item.id === ammoId) ?? null;
  const ammoMissing = Boolean(ammoType) && ammoTotal === 0;

  const advantage = rollMode === 'advantage';
  const disadvantage = rollMode === 'disadvantage';
  const ready = Boolean(attacker && attackId && targetId) && !ammoMissing;

  return (
    <section className="combat-block attack-panel">
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
          {/* Passo 1 — cartões de ataque. */}
          <div className="attack-step">
            <p className="attack-step-title">
              <span className="attack-step-num">1</span> Escolha o ataque
            </p>
            <div className="attack-options">
              {availableAttacks.map((attack) => (
                <AttackOption
                  key={attack.id}
                  attack={attack}
                  inventory={inventory}
                  selected={attack.id === attackId}
                  onSelect={() => {
                    setAttackId(attack.id);
                    // Trocar de arma invalida a confirmação de aliado adjacente.
                    setAdjacentAlly(false);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Passo 2 — cartões de alvo. */}
          <div className="attack-step">
            <p className="attack-step-title">
              <span className="attack-step-num">2</span> Escolha o alvo
            </p>
            <div className="target-options">
              {targets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === targetId ? 'target-card selected' : 'target-card'}
                  aria-pressed={item.id === targetId}
                  onClick={() => setTargetId(item.id)}
                >
                  <Portrait
                    src={item.imageUrl ?? ''}
                    alt=""
                    size="sm"
                    icon={item.kind === 'CREATURE' ? 'flame' : 'users'}
                  />
                  <span className="target-card-body">
                    <span className="target-card-name">
                      {item.name}
                      {item.missing ? <em className="tag">removido</em> : null}
                    </span>
                    {/* CA/vida só aparecem quando já são reveladas. */}
                    {item.statsHidden ? (
                      <span className="target-card-hidden">
                        <Icon name="eye" size={12} /> vida e CA ocultas
                      </span>
                    ) : (
                      <span className="target-card-meta">
                        CA {item.armorClass} · HP {item.hpCurrent}/{item.hpMax}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Passo 3 — modo de rolagem (mutuamente exclusivo). */}
          <div className="attack-step">
            <p className="attack-step-title">
              <span className="attack-step-num">3</span> Modo de rolagem
            </p>
            <div className="roll-mode" role="radiogroup" aria-label="Modo de rolagem">
              {ROLL_MODES.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  role="radio"
                  aria-checked={rollMode === mode.key}
                  title={mode.title}
                  className={rollMode === mode.key ? 'roll-mode-btn active' : 'roll-mode-btn'}
                  onClick={() => setRollMode(mode.key)}
                >
                  <Icon name={mode.icon} size={14} /> {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Ataque Furtivo disponível (a condição já vem do sistema). */}
          {sneakEligible ? (
            <div className="attack-effect">
              <span className="attack-effect-head">
                <Icon name="sparkle" size={13} /> Ataque Furtivo disponível
                <strong> +{sneakExpression}</strong>
              </span>
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
            </div>
          ) : null}

          {/* Munição: custo e pilha a consumir (lógica preservada). */}
          {ammoType ? (
            <div className="attack-effect ammo">
              <span className="attack-effect-head">
                <Icon name="ammo" size={13} /> Custo: 1 munição ({ammoType})
              </span>
              {stacks.length > 0 ? (
                <>
                  <label className="field">
                    <span>Pilha a consumir</span>
                    <select
                      value={selectedAmmo?.id ?? ''}
                      onChange={(event) => setAmmoId(event.target.value)}
                    >
                      <option value="">automática (sem bônus primeiro)</option>
                      {stacks.map((item) => (
                        <option key={item.id} value={item.id}>
                          {ammoStackLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="field-hint">disponível: {ammoTotal}</span>
                </>
              ) : (
                <span className="ammo-warning">Sem munição para esta arma.</span>
              )}
            </div>
          ) : null}

          {/* Prévia do ataque + botão principal. */}
          <div className="attack-preview">
            <div className="attack-preview-side">
              <span className="attack-preview-label">Ataque selecionado</span>
              <span className="attack-preview-name">{selectedAttack?.name ?? '—'}</span>
              {selectedAttack ? (
                <span className="attack-preview-stats">
                  <span>{formatModifier(selectedAttack.attackBonus)}</span>
                  <span>
                    {damageExpression(selectedAttack.damage)}
                    {selectedAttack.damage.type ? ` ${selectedAttack.damage.type}` : ''}
                  </span>
                  {rangeLabel(inventory ? selectedWeapon : null) ? (
                    <span>alcance {rangeLabel(inventory ? selectedWeapon : null)}</span>
                  ) : null}
                  {sneakEligible ? <span>furtivo +{sneakExpression}</span> : null}
                </span>
              ) : null}
            </div>

            <span className="attack-preview-vs">VS</span>

            <div className="attack-preview-side">
              <span className="attack-preview-label">Alvo</span>
              <span className="attack-preview-name">{selectedTarget?.name ?? '—'}</span>
              {selectedTarget ? (
                <span className="attack-preview-stats">
                  {selectedTarget.statsHidden ? (
                    <span>vida e CA ocultas</span>
                  ) : (
                    <span>
                      CA {selectedTarget.armorClass} · HP {selectedTarget.hpCurrent}/
                      {selectedTarget.hpMax}
                    </span>
                  )}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              className="btn btn-primary attack-roll"
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
              <Icon name="die" size={16} /> Rolar ataque
            </button>
          </div>
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
