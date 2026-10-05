import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { formatModifier } from '../dnd';
import type { Attack, CombatDto, InventoryItem, SessionUser } from '../types';
import {
  applyManualHp,
  endCombat,
  nextTurn,
  resolveAttack,
  rollInitiativeFor,
  rollMyInitiative,
} from './combatApi';
import { CombatIntro } from './CombatIntro';
import { CombatActionPanel, ManualHpPanel } from './components/CombatActionPanel';
import { CombatDashboard } from './components/CombatDashboard';
import { CombatLog } from './components/CombatLog';
import { CombatTurnPanel } from './components/CombatTurnPanel';
import { InitiativeTimeline } from './components/InitiativeTimeline';
import { TurnResourceBar } from './components/TurnResourceBar';
import type { CombatLogEntry, TurnAlert } from './useCombatState';

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
  /** Mestre: dados de Ataque Furtivo do atacante escolhido (pode ser um Ladino). */
  sneakAttackFor?: (combatantId: string) => string | null;
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

/**
 * Ponto de composição do painel de combate. Continua dono do estado local e das
 * ações (rolagens, ataque, dano manual, turno e encerramento); a reorganização
 * visual roda as colunas Iniciativa · Turno/Ações · Log e a barra de recursos,
 * sem tocar em backend, Socket.io ou regras.
 */
export function CombatTracker({
  combat,
  log,
  user,
  turnAlert,
  onDismissTurnAlert,
  characterAttacks = [],
  sneakAttackExpression = null,
  sneakAttackFor,
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
  const [masterAttacker, setMasterAttacker] = useState('');

  const myCombatant = combat.combatants.find((item) => item.ownerUserId === user.id) ?? null;
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

        <CombatDashboard
          left={
            <InitiativeTimeline
              combat={combat}
              isMaster={isMaster}
              busy={busy}
              onRollFor={(combatantId) => void run(() => rollInitiativeFor(combatantId))}
            />
          }
          center={
            <CombatTurnPanel
              combatant={null}
              round={combat.round}
              isMyTurn={false}
              empty={
                !isMaster && myCombatant && !myCombatant.rolled ? (
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
                ) : !isMaster && myCombatant?.rolled ? (
                  <p className="empty-hint">
                    Você rolou {myCombatant.initiative} de iniciativa. Aguardando os demais...
                  </p>
                ) : !isMaster && !myCombatant ? (
                  <p className="empty-hint">Você não participa deste combate.</p>
                ) : (
                  <p className="empty-hint">
                    A ordem é montada automaticamente assim que todos tiverem rolado.
                  </p>
                )
              }
            />
          }
          right={<CombatLog log={log} />}
          bottom={<TurnResourceBar active={false} />}
        />

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

      <CombatDashboard
        left={
          <InitiativeTimeline
            combat={combat}
            isMaster={isMaster}
            busy={busy}
            onRollFor={(combatantId) => void run(() => rollInitiativeFor(combatantId))}
          />
        }
        center={
          <>
            <CombatTurnPanel combatant={current} round={combat.round} isMyTurn={isMyTurn} />

            {isMaster ? (
              <ManualHpPanel
                combatants={combat.combatants}
                busy={busy}
                onApply={(input) => void run(() => applyManualHp(input))}
              />
            ) : null}

            {isMaster && attacksFor ? (
              <CombatActionPanel
                combat={combat}
                attacker={masterAttackerCombatant}
                attacks={[]}
                attackerChoices={combat.combatants.filter((item) => !item.missing)}
                attacksFor={attacksFor}
                sneakAttackFor={sneakAttackFor}
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
                <CombatActionPanel
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
          </>
        }
        right={<CombatLog log={log} />}
        bottom={<TurnResourceBar active />}
      />
    </section>
  );
}
