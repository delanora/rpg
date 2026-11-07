import { useEffect, useState } from 'react';
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
import { fetchEffectOptions } from '../../dice/diceApi';
import { combatantKindIcon } from '../combatVisuals';
import { getSpatialRangePreview } from '../grid/gridApi';
import { rangeSummary } from '../grid/distanceFormat';
import type {
  Attack,
  CombatDto,
  CombatantDto,
  EffectOptionalModifierDto,
  InventoryItem,
  SpatialRangeReading,
} from '../../types';
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
  /**
   * `tactical-tray` (6.6M.5.2) — faixa compacta ABAIXO do grid. É só
   * APRESENTAÇÃO: os cartões, o estado e o envio continuam exatamente os
   * mesmos; nada de segundo `attackId`/`targetId`.
   */
  variant?: 'default' | 'tactical-tray';
  /**
   * HOTBAR (6.6M.6): pedido de pré-seleção vindo de um slot. NÃO é um segundo
   * `attackId`: o estado do ataque continua sendo o daqui e o pedido só chama o
   * MESMO `setAttackId`, abrindo o passo de alvo do fluxo existente.
   */
  preset?: { attackId: string; nonce: number } | null;
  /**
   * 6.6M.6.4 — ALVO CONTROLADO pelo `CombatTracker` (clique no token do grid).
   * `undefined` = estado LOCAL (fluxos do Mestre e da ação preparada); `null` =
   * controlado e sem alvo. Assim nunca existem duas seleções efetivas.
   */
  targetCombatantId?: string | null;
  /** Devolve a escolha ao dono — inclusive quando vem do cartão do painel. */
  onTargetChange?: (combatantId: string) => void;
  /** Fecha o mini fluxo e devolve a faixa de ataque para a hotbar. */
  onClose?: () => void;
  busy: boolean;
  onAttack: (input: {
    prepared?: boolean;
    attackActionId?: string;
    attackId: string;
    targetCombatantId: string;
    attackerCombatantId?: string;
    ammoInventoryId?: string;
    advantage?: boolean;
    disadvantage?: boolean;
    adjacentAlly?: boolean;
    /** IDs dos modificadores OPCIONAIS oferecidos pelo servidor (6.5G). */
    selectedEffectModifiers?: string[];
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
  variant = 'default',
  preset = null,
  targetCombatantId,
  onTargetChange,
  onClose,
  busy,
  onAttack,
}: CombatActionPanelProps) {
  const [attackId, setAttackId] = useState('');
  /**
   * 6.6M.6.4 — o alvo pode ser CONTROLADO de fora (grid). Sem a prop ele segue
   * local, exatamente como antes: uma única seleção efetiva, sem estado paralelo
   * que possa divergir entre o painel e o grid.
   */
  const [localTargetId, setLocalTargetId] = useState('');
  const controlledTarget = targetCombatantId !== undefined;
  const targetId = controlledTarget ? (targetCombatantId ?? '') : localTargetId;
  /** Toda escolha de alvo (cartão do painel) passa por aqui. */
  const chooseTarget = (combatantId: string): void => {
    setLocalTargetId(combatantId);
    onTargetChange?.(combatantId);
  };
  const [ammoId, setAmmoId] = useState('');
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [adjacentAlly, setAdjacentAlly] = useState(false);
  const [prepared, setPrepared] = useState(false);
  // Efeitos OPCIONAIS de ataque (6.5G): o servidor deriva quais existem para
  // este atacante; a UI só oferece a escolha (desmarcada por padrão).
  const [effectOptions, setEffectOptions] = useState<EffectOptionalModifierDto[]>([]);
  const [selectedEffects, setSelectedEffects] = useState<string[]>([]);
  /**
   * 6.6M.2 — ALCANCE da ação JÁ selecionada (ataque + alvo). Reaproveita a
   * seleção existente, sem criar seletor novo: o servidor resolve reach/normal/
   * longo a partir do `attackId` e devolve a faixa pronta.
   */
  const [rangePreview, setRangePreview] = useState<SpatialRangeReading | null>(null);
  const [rangeState, setRangeState] = useState<'idle' | 'error'>('idle');
  /**
   * TRAY — qual lista está desdobrada. É o ÚNICO estado novo: escolher uma
   * arma/alvo cai nos mesmos `setAttackId`/`setTargetId` de sempre.
   */
  const [openStep, setOpenStep] = useState<'attack' | 'target' | null>(null);
  const hasReady = Boolean(attacker?.turnEconomy.ready);
  useEffect(() => setPrepared(false), [attacker?.id, hasReady]);

  /**
   * HOTBAR — o slot escolhido cai no MESMO estado deste painel (nada duplicado).
   * O `nonce` existe só para reabrir o fluxo quando o mesmo slot é clicado de
   * novo; trocar de arma invalida a confirmação de aliado adjacente, como no
   * cartão de ataque.
   */
  useEffect(() => {
    if (!preset) return;
    setAttackId(preset.attackId);
    setAdjacentAlly(false);
    setOpenStep('target');
  }, [preset]);

  useEffect(() => {
    if (!attacker || !attackId || !targetId) {
      setRangePreview(null);
      setRangeState('idle');
      return;
    }
    let live = true;
    getSpatialRangePreview(combat.id, attacker.id, targetId, attackId)
      .then((response) => {
        if (!live) return;
        setRangePreview(response.range);
        setRangeState('idle');
      })
      .catch(() => {
        if (!live) return;
        // Sem leitura confiável: nada de faixa inventada.
        setRangePreview(null);
        setRangeState('error');
      });
    return () => {
      live = false;
    };
  }, [combat.id, combat.version, attacker?.id, attackId, targetId]);

  useEffect(() => {
    setSelectedEffects([]);
    if (!attacker) {
      setEffectOptions([]);
      return;
    }
    let live = true;
    fetchEffectOptions({ kind: 'combatant', id: attacker.id }, 'attack')
      .then((options) => {
        if (live) setEffectOptions(options);
      })
      .catch(() => {
        if (live) setEffectOptions([]);
      });
    return () => {
      live = false;
    };
  }, [attacker?.id]);

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
  const economy = attacker?.turnEconomy;
  const continuation = economy?.attackAction && economy.attackAction.attacksMade < economy.attackAction.attacksAllowed ? economy.attackAction.attackActionId : undefined;
  const offhand = attackId.startsWith('offhand:');
  const executingPrepared = prepared && hasReady;
  const available = executingPrepared
    ? Boolean(economy?.ready && economy.reactionAvailable && !offhand)
    : combat.currentCombatantId === attacker?.id && Boolean(economy && (offhand ? !economy.bonusActionUsed : continuation || economy.actionsUsed < economy.actionsGranted));
  const ready = Boolean(attacker && attackId && targetId) && !ammoMissing && available && Boolean(attacker?.conditionEffects.canAct);

  const tray = variant === 'tactical-tray';
  // Resumo dos modificadores: só o que existe aparece como legenda do bloco.
  const extrasSummary = [
    effectOptions.length > 0 ? `${selectedEffects.length}/${effectOptions.length} efeitos` : null,
    ammoType ? (ammoMissing ? 'sem munição' : `munição ${ammoTotal}`) : null,
    sneakEligible ? `furtivo +${sneakExpression}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join(' · ');
  const hasExtras = effectOptions.length > 0 || Boolean(ammoType) || sneakEligible;

  return (
    <section
      className={tray ? 'combat-block attack-panel is-tray' : 'combat-block attack-panel'}
      aria-label={tray ? 'Atacar' : undefined}
    >
      {tray ? null : (
        <h3>
          <Icon name="sword" size={15} /> Atacar
        </h3>
      )}

      {/* Mini fluxo aberto por um slot: identifica a ação e devolve o espaço. */}
      {onClose ? (
        <div className="attack-tray-head">
          <span className="attack-tray-title">
            <Icon name="sword" size={13} /> {selectedAttack?.name ?? 'Ação escolhida'}
          </span>
          <button
            type="button"
            className="btn btn-small attack-tray-close"
            aria-label="Fechar a ação"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      ) : null}

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

      {attacker?.turnEconomy.ready ? (
        <label className="dice-toggle">
          <input type="checkbox" checked={prepared} onChange={event => setPrepared(event.target.checked)} />
          Executar ataque preparado (Reação; confirme o gatilho com o Mestre)
        </label>
      ) : null}
      {!attacker ? (
        <p className="empty-hint">Escolha o atacante para ver os ataques.</p>
      ) : availableAttacks.length === 0 ? (
        <p className="empty-hint">Nenhum ataque cadastrado para {attacker.name}.</p>
      ) : (
        <>
          {/* Passo 1 — ataques. Na tray o passo mostra um RESUMO clicável e os
              MESMOS cartões abrem abaixo (`AttackOption` sem alteração). */}
          <div className="attack-step">
            <p className="attack-step-title">
              <span className="attack-step-num">1</span> Escolha o ataque
            </p>
            {tray ? (
              <button
                type="button"
                className="tray-chip"
                aria-expanded={openStep === 'attack'}
                onClick={() => setOpenStep((prev) => (prev === 'attack' ? null : 'attack'))}
              >
                <span className="tray-chip-label">
                  {selectedAttack?.name ?? 'escolha o ataque'}
                </span>
                {selectedAttack ? (
                  <span className="tray-chip-meta">
                    <span>{formatModifier(selectedAttack.attackBonus)}</span>
                    <span>
                      {damageExpression(selectedAttack.damage)}
                      {selectedAttack.damage.type ? ` ${selectedAttack.damage.type}` : ''}
                    </span>
                    {rangeLabel(inventory ? selectedWeapon : null) ? (
                      <span>{rangeLabel(inventory ? selectedWeapon : null)}</span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            ) : null}
            {tray && openStep !== 'attack' ? null : (
              <div className={tray ? 'attack-options tray-menu' : 'attack-options'}>
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
                      if (tray) setOpenStep(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Passo 2 — alvos. Mesmo princípio: resumo clicável na tray, com a
              lista de cartões existente logo abaixo (CA/vida seguem ocultas
              quando o alvo ainda não as revelou). */}
          <div className="attack-step">
            <p className="attack-step-title">
              <span className="attack-step-num">2</span> Escolha o alvo
            </p>
            {tray ? (
              <button
                type="button"
                className="tray-chip"
                aria-expanded={openStep === 'target'}
                onClick={() => setOpenStep((prev) => (prev === 'target' ? null : 'target'))}
              >
                <span className="tray-chip-label">
                  {selectedTarget?.name ?? 'escolha o alvo'}
                </span>
                {selectedTarget ? (
                  <span className="tray-chip-meta">
                    {selectedTarget.statsHidden
                      ? 'vida e CA ocultas'
                      : `CA ${selectedTarget.armorClass} · HP ${selectedTarget.hpCurrent}/${selectedTarget.hpMax}`}
                  </span>
                ) : null}
              </button>
            ) : null}
            {tray && openStep !== 'target' ? null : (
              <div className={tray ? 'target-options tray-menu' : 'target-options'}>
                {targets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === targetId ? 'target-card selected' : 'target-card'}
                  aria-pressed={item.id === targetId}
                  onClick={() => {
                    chooseTarget(item.id);
                    if (tray) setOpenStep(null);
                  }}
                >
                  <Portrait
                    src={item.imageUrl ?? ''}
                    alt=""
                    size="sm"
                    icon={combatantKindIcon(item.kind)}
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
            )}
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

          {/* MODIFICADORES — fora da tray ficam abertos; nela viram um resumo
              recolhível (efeitos, munição, Furtivo). O conteúdo é o MESMO:
              checkboxes, pilha de munição e aviso continuam a um clique. */}
          {hasExtras ? (
            <details className="attack-extras" open={tray ? undefined : true}>
              <summary className="attack-extras-summary">
                <Icon name="sparkle" size={12} /> {extrasSummary}
              </summary>
              <div className="attack-extras-body">
          {/* Modificadores OPCIONAIS reais (6.5G): ex.: Bless +1d4. Só aparecem
              quando o servidor oferece algo; a escolha é do ator. */}
          {effectOptions.length > 0 ? (
            <div className="attack-effect">
              <span className="attack-effect-head">
                <Icon name="sparkle" size={13} /> Efeitos opcionais
              </span>
              {effectOptions.map((option) => (
                <label className="dice-toggle" key={option.id}>
                  <input
                    type="checkbox"
                    checked={selectedEffects.includes(option.id)}
                    onChange={() =>
                      setSelectedEffects((prev) =>
                        prev.includes(option.id)
                          ? prev.filter((item) => item !== option.id)
                          : [...prev, option.id],
                      )
                    }
                  />
                  {option.label}{' '}
                  {option.kind === 'roll-dice'
                    ? `+${option.count ?? 1}d${option.sides ?? 4}`
                    : `+${option.value ?? 0}`}
                </label>
              ))}
            </div>
          ) : null}

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
              </div>
            </details>
          ) : null}

          {/* Prévia + botão principal. Na tray o resumo de ataque/alvo já está
              nos chips: aqui ficam só a faixa de ALCANCE (decidida pelo
              servidor) e o botão da execução. */}
          <div className={tray ? 'attack-tray-exec' : 'attack-preview'}>
            {tray ? null : (
              <>
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
              </>
            )}

            <div className="attack-preview-side">
              {tray ? null : (
                <>
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
                </>
              )}
              {/* 6.6M.2 — faixa DECIDIDA pelo servidor (long range já traz a
                  desvantagem; o cliente não compara distância com alcance). */}
              {rangePreview ? (
                <span
                  className={`attack-range is-${rangePreview.status}`}
                  role="status"
                  title={rangePreview.actionName ?? undefined}
                >
                  {rangeSummary(rangePreview)}
                </span>
              ) : rangeState === 'error' ? (
                <span className="attack-range is-unknown">Alcance desconhecido</span>
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
                  ...(executingPrepared ? { prepared: true } : !offhand && continuation ? { attackActionId: continuation } : {}),
                  targetCombatantId: targetId,
                  advantage,
                  disadvantage,
                  ...(adjacentAlly && sneakEligible ? { adjacentAlly: true } : {}),
                  ...(attackerChoices ? { attackerCombatantId: attacker.id } : {}),
                  ...(selectedAmmo ? { ammoInventoryId: selectedAmmo.id } : {}),
                  ...(selectedEffects.length > 0
                    ? { selectedEffectModifiers: selectedEffects }
                    : {}),
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
