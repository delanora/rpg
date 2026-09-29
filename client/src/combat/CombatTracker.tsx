import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import {
  ammoStackLabel,
  ammoStackTotal,
  ammoStacks,
  availableAttacks as selectAvailableAttacks,
  requiredAmmoType,
  weaponOf,
} from '../ammo';
import { damageExpression, formatModifier } from '../dnd';
import type { Attack, CombatDto, CombatantDto, InventoryItem, SessionUser } from '../types';
import { clampInt } from '../utils';
import {
  applyManualHp,
  endCombat,
  nextTurn,
  resolveAttack,
  rollInitiativeFor,
  rollMyInitiative,
} from './combatApi';
import { CombatIntro } from './CombatIntro';
import type { CombatLogEntry, TurnAlert } from './useCombatState';

interface AttackPanelProps {
  combat: CombatDto;
  attacker: CombatantDto | null;
  attacks: Attack[];
  /** O mestre pode escolher com quem atacar; o jogador sempre usa o próprio. */
  attackerChoices?: CombatantDto[];
  onSelectAttacker?: (combatantId: string) => void;
  attacksFor?: (combatantId: string) => Attack[];
  /** Dados de Ataque Furtivo a exibir em armas que qualificam (ex.: "2d6"). */
  sneakAttack?: string | null;
  /** Inventário do próprio personagem (para munição e vínculo de arma). */
  inventory?: InventoryItem[];
  busy: boolean;
  onAttack: (input: {
    attackId: string;
    targetCombatantId: string;
    attackerCombatantId?: string;
    ammoInventoryId?: string;
  }) => void;
}

function AttackPanel({
  combat,
  attacker,
  attacks,
  attackerChoices,
  onSelectAttacker,
  attacksFor,
  sneakAttack,
  inventory,
  busy,
  onAttack,
}: AttackPanelProps) {
  const [attackId, setAttackId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [ammoId, setAmmoId] = useState('');

  const baseAttacks = attackerChoices && attacksFor && attacker ? attacksFor(attacker.id) : attacks;
  // Ataques de arma não equipada somem (só dá para avaliar com o inventário).
  const availableAttacks = inventory ? selectAvailableAttacks(baseAttacks, inventory) : baseAttacks;

  const targets = combat.combatants.filter((item) => item.id !== attacker?.id && !item.missing);

  // Munição do ataque escolhido: arma equipada vinculada + pilhas compatíveis.
  const selectedAttack = availableAttacks.find((item) => item.id === attackId) ?? null;
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
            <select value={attackId} onChange={(event) => setAttackId(event.target.value)}>
              <option value="">escolha o ataque</option>
              {availableAttacks.map((attack) => (
                <option key={attack.id} value={attack.id}>
                  {attack.name} — dano {damageExpression(attack.damage)}
                  {attack.damage.type ? ` (${attack.damage.type})` : ''}, acerto{' '}
                  {formatModifier(attack.attackBonus)}
                  {sneakAttack && (attack.finesse || attack.ranged)
                    ? ` · +${sneakAttack} furtivo`
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

/**
 * Seções da ficha que podem ser abertas abaixo do painel de combate. A lista
 * fica aqui para os botões e o painel que os atende não saírem de sincronia.
 */
export const COMBAT_SHORTCUTS = [
  { key: 'spells', label: 'Magias', icon: 'star' },
  { key: 'attacks', label: 'Ataques', icon: 'sword' },
  { key: 'features', label: 'Características', icon: 'book' },
  { key: 'inventory', label: 'Mochila', icon: 'bag' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

export type SheetShortcut = (typeof COMBAT_SHORTCUTS)[number]['key'];

interface CombatTrackerProps {
  combat: CombatDto;
  log: CombatLogEntry[];
  user: SessionUser;
  turnAlert: TurnAlert | null;
  onDismissTurnAlert: () => void;
  /** Ataques do próprio personagem (fluxo do jogador). */
  characterAttacks?: Attack[];
  /** Dados de Ataque Furtivo do próprio personagem (ex.: "2d6"). */
  sneakAttackExpression?: string | null;
  /** Inventário do próprio personagem (munição e vínculo de arma). */
  characterInventory?: InventoryItem[];
  /** Mestre: ataques de qualquer combatente, para escolher o atacante. */
  attacksFor?: (combatantId: string) => Attack[];
  onCombatChange: (combat: CombatDto) => void;
  onCombatEnd: () => void;
  onError: (message: string) => void;
  /** Atalhos para as seções da ficha. Sem isso, os botões não aparecem. */
  onOpenSection?: (target: SheetShortcut) => void;
  /** Atalho aberto no momento (só para marcar o botão correspondente). */
  openSection?: SheetShortcut | null;
}

export function CombatTracker({
  combat,
  log,
  user,
  turnAlert,
  onDismissTurnAlert,
  characterAttacks = [],
  sneakAttackExpression = null,
  characterInventory,
  attacksFor,
  onCombatChange,
  onCombatEnd,
  onError,
  onOpenSection,
  openSection = null,
}: CombatTrackerProps) {
  const isMaster = user.role === 'MASTER';

  const [busy, setBusy] = useState(false);
  const [hpTarget, setHpTarget] = useState('');
  const [hpAmount, setHpAmount] = useState('5');
  const [masterAttacker, setMasterAttacker] = useState('');

  const myCombatant =
    combat.combatants.find((item) => item.ownerUserId === user.id) ?? null;
  const current = combat.combatants.find((item) => item.id === combat.currentCombatantId) ?? null;
  const isMyTurn = Boolean(current && current.ownerUserId === user.id);

  const rolledCount = combat.combatants.filter((item) => item.rolled).length;

  async function run(action: () => Promise<CombatDto>): Promise<void> {
    setBusy(true);
    try {
      onCombatChange(await action());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha na ação de combate.');
    } finally {
      setBusy(false);
    }
  }

  // --- Aguardando iniciativas ------------------------------------------------
  if (combat.status === 'PENDING_INITIATIVE') {
    return (
      <section className="combat-panel">
        <CombatIntro combatId={combat.id} />
        <header className="combat-head">
          <h2>
            <Icon name="sword" size={20} /> Combate — iniciativa
          </h2>
          <span className="combat-round">
            {rolledCount}/{combat.combatants.length} rolaram
          </span>
        </header>

        {!isMaster && myCombatant && !myCombatant.rolled ? (
          <div className="initiative-prompt">
            <p>
              <Icon name="bolt" size={16} /> Role sua iniciativa:{' '}
              <strong>1d20 {formatModifier(myCombatant.dexterityMod)}</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void run(rollMyInitiative)}
            >
              <Icon name="die" size={15} /> Rolar iniciativa
            </button>
          </div>
        ) : null}

        {!isMaster && myCombatant?.rolled ? (
          <p className="empty-hint">
            Você rolou {myCombatant.initiative} de iniciativa. Aguardando os demais...
          </p>
        ) : null}

        {!isMaster && !myCombatant ? (
          <p className="empty-hint">Você não participa deste combate.</p>
        ) : null}

        <ul className="combat-list">
          {combat.combatants.map((combatant) => (
            <li key={combatant.id} className="combat-row">
              <span className="combat-name">
                <Portrait
                  src={combatant.imageUrl ?? ''}
                  alt=""
                  size="sm"
                  icon={combatant.kind === 'CREATURE' ? 'flame' : 'users'}
                />
                <span className="name-text">{combatant.name}</span>
              </span>
              <span className="combat-kind">
                {combatant.kind === 'CREATURE' ? 'criatura' : 'personagem'}
              </span>

              {combatant.rolled ? (
                <span className="combat-init">{combatant.initiative}</span>
              ) : isMaster ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void run(() => rollInitiativeFor(combatant.id))}
                >
                  rolar
                </button>
              ) : (
                <span className="combat-waiting">aguardando</span>
              )}
            </li>
          ))}
        </ul>

        {isMaster ? (
          <p className="section-note">
            Role pelas criaturas e por quem estiver ausente. A ordem é montada
            automaticamente assim que todos tiverem rolado.
          </p>
        ) : null}
      </section>
    );
  }

  // --- Combate ativo ----------------------------------------------------------
  const masterAttackerCombatant =
    combat.combatants.find((item) => item.id === masterAttacker) ?? null;

  return (
    <section className="combat-panel">
      <CombatIntro combatId={combat.id} />

      {turnAlert ? (
        <div className="turn-alert" role="alert">
          <Icon name="sword" size={22} />
          <strong>É o seu turno!</strong>
          <span>
            {turnAlert.combatantName} — rodada {turnAlert.round}
          </span>
          <button type="button" className="btn btn-small" onClick={onDismissTurnAlert}>
            entendido
          </button>
        </div>
      ) : null}

      <header className="combat-head">
        <h2>
          <Icon name="sword" size={20} /> Combate
        </h2>
        <span className="combat-round">Rodada {combat.round}</span>

        {isMaster ? (
          <div className="combat-actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy}
              onClick={() => void run(nextTurn)}
            >
              Próximo turno →
            </button>
            <button
              type="button"
              className="btn btn-danger btn-small"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await endCombat();
                    onCombatEnd();
                  } catch (error) {
                    onError(error instanceof Error ? error.message : 'Falha ao encerrar.');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              encerrar combate
            </button>
          </div>
        ) : null}
      </header>

      <p className={isMyTurn ? 'turn-banner mine' : 'turn-banner'}>
        {isMyTurn ? 'É o seu turno!' : `Turno de ${current?.name ?? '—'}`}
      </p>

      <ol className="turn-order">
        {combat.combatants.map((combatant, index) => {
          const hpCurrent = combatant.hpCurrent ?? 0;
          const hpMax = combatant.hpMax ?? 0;
          const percent =
            hpMax > 0 ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0;

          return (
            <li
              key={combatant.id}
              className={
                combatant.id === combat.currentCombatantId ? 'turn-row current' : 'turn-row'
              }
            >
              <span className="turn-index">{index + 1}</span>
              <span className="turn-name">
                <Portrait
                  src={combatant.imageUrl ?? ''}
                  alt=""
                  size="sm"
                  icon={combatant.kind === 'CREATURE' ? 'flame' : 'users'}
                />
                <span className="name-text">{combatant.name}</span>
                {combatant.missing ? <em className="tag">removido</em> : null}
              </span>
              <span className="turn-init">{combatant.initiative}</span>

              {/* Vida e CA de criaturas ficam ocultas para os jogadores. */}
              {combatant.statsHidden ? (
                <span className="turn-hp">
                  <span className="turn-hidden" title="Vida e CA visíveis apenas para o mestre">
                    <Icon name="eye" size={13} /> vida e CA ocultas
                  </span>
                </span>
              ) : (
                <span className="turn-hp">
                  <span className="hp-bar">
                    <span className="hp-fill" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="hp-text">
                    {hpCurrent}/{hpMax}
                  </span>
                  <span className="turn-ac">CA {combatant.armorClass}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {isMaster ? (
        <section className="combat-block">
          <h3>
            <Icon name="heart" size={15} /> Dano / cura manual
          </h3>
          <div className="hp-controls">
            <select value={hpTarget} onChange={(event) => setHpTarget(event.target.value)}>
              <option value="">escolha o combatente</option>
              {combat.combatants.map((combatant) => (
                <option key={combatant.id} value={combatant.id}>
                  {combatant.name} ({combatant.hpCurrent}/{combatant.hpMax})
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              max={9999}
              value={hpAmount}
              aria-label="Quantidade"
              onChange={(event) => setHpAmount(event.target.value)}
            />

            <button
              type="button"
              className="btn btn-danger btn-small"
              disabled={busy || !hpTarget}
              onClick={() =>
                void run(() =>
                  applyManualHp({
                    combatantId: hpTarget,
                    amount: clampInt(hpAmount, 1, 9999, 1),
                    mode: 'damage',
                  }),
                )
              }
            >
              aplicar dano
            </button>

            <button
              type="button"
              className="btn btn-small"
              disabled={busy || !hpTarget}
              onClick={() =>
                void run(() =>
                  applyManualHp({
                    combatantId: hpTarget,
                    amount: clampInt(hpAmount, 1, 9999, 1),
                    mode: 'heal',
                  }),
                )
              }
            >
              curar
            </button>
          </div>
        </section>
      ) : null}

      {isMaster && attacksFor ? (
        <AttackPanel
          combat={combat}
          attacker={masterAttackerCombatant}
          attacks={[]}
          attackerChoices={combat.combatants.filter((item) => !item.missing)}
          attacksFor={attacksFor}
          onSelectAttacker={setMasterAttacker}
          busy={busy}
          onAttack={(input) => {
            void (async () => {
              setBusy(true);
              try {
                const { combat: updated } = await resolveAttack(input);
                onCombatChange(updated);
              } catch (error) {
                onError(error instanceof Error ? error.message : 'Falha na rolagem.');
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      ) : null}

      {!isMaster && myCombatant ? (
        <>
          {!isMyTurn ? (
            <p className="section-note">
              Você pode atacar a qualquer momento; o mestre controla a ordem dos turnos.
            </p>
          ) : null}
          <AttackPanel
            combat={combat}
            attacker={myCombatant}
            attacks={characterAttacks}
            inventory={characterInventory}
            sneakAttack={sneakAttackExpression}
            busy={busy}
            onAttack={(input) => {
              void (async () => {
                setBusy(true);
                try {
                  const { combat: updated } = await resolveAttack(input);
                  onCombatChange(updated);
                } catch (error) {
                  onError(error instanceof Error ? error.message : 'Falha na rolagem.');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        </>
      ) : null}

      <section className="combat-block">
        <h3>
          <Icon name="scroll" size={15} /> Registro
        </h3>
        {log.length === 0 ? (
          <p className="empty-hint">Sem rolagens ainda.</p>
        ) : (
          <ul className="combat-log">
            {log.map((entry) => (
              <li key={entry.id} className={entry.crit ? 'log-entry crit' : 'log-entry'}>
                <span className="log-text">{entry.text}</span>
                {entry.detail ? <span className="log-detail">{entry.detail}</span> : null}
                <span className="log-time">
                  {new Date(entry.at).toLocaleTimeString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Atalhos: levam direto às seções da ficha sem sair do combate. */}
      {onOpenSection ? (
        <section className="combat-block">
          <h3>
            <Icon name="book" size={15} /> Atalhos da ficha
          </h3>
          <div className="combat-shortcuts">
            {COMBAT_SHORTCUTS.map((shortcut) => {
              const isOpen = shortcut.key === openSection;
              return (
                <button
                  key={shortcut.key}
                  type="button"
                  className={isOpen ? 'btn btn-small active' : 'btn btn-small'}
                  aria-expanded={isOpen}
                  onClick={() => onOpenSection(shortcut.key)}
                >
                  <Icon name={shortcut.icon} size={15} /> {shortcut.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}
