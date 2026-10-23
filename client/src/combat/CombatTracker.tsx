import { MechanicalPanel } from '../components/MechanicalPanel';
import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { standUp as standUpRequest } from '../mechanicalApi';
import { Icon, type IconName } from '../components/Icon';
import { formatModifier } from '../dnd';
import { fetchDeath, rollNpcDeathSave } from '../deathApi';
import type { Attack, CombatDto, DeathDto, DeathState, InventoryItem, MechanicalEntity, SessionUser } from '../types';
import {
  applyManualHp,
  endCombat,
  executeEconomyAction,
  fetchActiveCombat,
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
import { DeathSavePanel } from './components/DeathSavePanel';
import { DeathSaveSkipDialog } from './components/DeathSaveSkipDialog';
import { InitiativeTimeline } from './components/InitiativeTimeline';
import { MasterEconomyPanel } from './components/MasterEconomyPanel';
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
  /** Deslocamento do próprio personagem em metros (barra de recursos). */
  movementMeters?: number | null;
  /** Mestre: ataques de qualquer combatente, para escolher o atacante. */
  attacksFor?: (combatantId: string) => Attack[];
  onCombatChange: (combat: CombatDto) => void;
  onCombatEnd: () => void;
  onError: (message: string) => void;
  /** Atalhos para as seções da ficha. Sem isso, os botões não aparecem. */
  onOpenSection?: (target: SheetShortcut) => void;
  /** Atalho aberto no momento (só para marcar o botão correspondente). */
  openSection?: SheetShortcut | null;
  /**
   * Jogador: abre a BANDEJA DE DADOS existente para o Teste contra a Morte
   * (o servidor rola e aplica; a bandeja só anima). Sem isso, o botão não aparece.
   */
  onRollDeathSave?: (entity: MechanicalEntity) => void;
}

/**
 * Ponto de composição do painel de combate. Continua dono do estado local e das
 * ações (rolagens, ataque, dano manual, turno e encerramento).
 *
 * REFINO DE UI: o centro virou o fluxo de ataque (ataque → alvo → modo →
 * resumo → rolar). As Conditions ficam no CARD da iniciativa; o resultado do
 * ataque aparece só no Registro; a economia (Ação/Ação bônus/Reação/
 * Deslocamento/Encerrar) vive na barra persistente. Nada de regra mudou — só a
 * organização e a apresentação.
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
  onRollDeathSave,
}: CombatTrackerProps) {
  const isMaster = user.role === 'MASTER';

  const [busy, setBusy] = useState(false);
  const [masterAttacker, setMasterAttacker] = useState('');
  // Leitura do ciclo de morte do combatente do turno (elegibilidade do Teste).
  const [currentDeath, setCurrentDeath] = useState<DeathDto | null>(null);
  // Confirmação do Mestre para avançar sem o Teste Contra a Morte do turno.
  const [skipDeathConfirm, setSkipDeathConfirm] = useState<{ name: string } | null>(null);

  const myCombatant = combat.combatants.find((item) => item.ownerUserId === user.id) ?? null;
  const current = combat.combatants.find((item) => item.id === combat.currentCombatantId) ?? null;
  const isMyTurn = Boolean(current && current.ownerUserId === user.id);

  const rolledCount = combat.combatants.filter((item) => item.rolled).length;

  const masterAttackerCombatant =
    combat.combatants.find((item) => item.id === masterAttacker) ?? null;
  // Combatente que a barra/economia controla agora: o atacante escolhido pelo
  // Mestre (ou o turno atual) e, para o jogador, o próprio personagem.
  const actingCombatant = isMaster ? (masterAttackerCombatant ?? current) : myCombatant;
  const ownTurn = Boolean(actingCombatant && actingCombatant.id === combat.currentCombatantId);

  // Ciclo de morte do combatente DO TURNO (o único que pode rolar Teste agora).
  const deathLifecycle = (state: DeathState | null): boolean =>
    Boolean(state && (state.dead || state.pending || state.stabilized || state.deathSaves || state.successes > 0 || state.failures > 0));
  // A entidade do ciclo de morte é a INSTÂNCIA de combate: o NPC/criatura tem
  // Death Saves próprios por cópia (nunca no template do bestiário) e o
  // personagem é resolvido para a ficha pelo próprio servidor.
  const deathEntity: MechanicalEntity | null = current ? { kind: 'combatant', id: current.id } : null;
  const needsDeathRead = deathLifecycle(current?.deathState ?? null) && deathEntity !== null;
  // Assinatura do estado de morte que veio no DTO do combate: muda quando o
  // dano/rolagem alteram successes, failures, pending, etc. — e é o gatilho da
  // releitura da ELEGIBILIDADE (o DTO do combate não a carrega).
  const currentDeathKey = current?.deathState
    ? [
        current.deathState.successes,
        current.deathState.failures,
        current.deathState.stabilized ? 1 : 0,
        current.deathState.dead ? 1 : 0,
        current.deathState.deathSaves ? 1 : 0,
        current.deathState.pending?.id ?? '',
      ].join(':')
    : '';
  useEffect(() => {
    if (!needsDeathRead || !deathEntity) {
      setCurrentDeath(null);
      return;
    }
    let live = true;
    fetchDeath(deathEntity)
      .then((entry) => {
        if (live) setCurrentDeath(entry);
      })
      .catch(() => {
        if (live) setCurrentDeath(null);
      });
    return () => {
      live = false;
    };
    // A releitura acompanha a virada de turno, a versão do combate e cada
    // atualização do ciclo de morte (dano, falhas, rolagem do Teste).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDeathRead, deathEntity?.kind, deathEntity?.id, combat.version, currentDeathKey]);

  // O painel central vira MODO TESTE CONTRA A MORTE quando o turno é de um
  // combatente no ciclo de morte. O estado exibido vem SEMPRE do DTO do combate
  // (é o que chega por `combat:updated`, sem refresh); a leitura de `/api/death`
  // só complementa a ELEGIBILIDADE da rolagem.
  const turnDeath = current?.deathState ?? currentDeath?.death ?? null;
  const showDeathTurn = Boolean(current && turnDeath && (turnDeath.dead || turnDeath.pending || turnDeath.stabilized || turnDeath.deathSaves));
  const deathRollAvailable = currentDeath?.deathSave.available ?? false;
  const deathRollReason = currentDeath?.deathSave.reason ?? '';
  const deathOwner = Boolean(current && current.ownerUserId === user.id);
  const deathCanRoll = Boolean(
    showDeathTurn &&
      ((!isMaster && deathOwner && Boolean(onRollDeathSave)) || (isMaster && current?.kind === 'CREATURE')),
  );
  const deathPrivate = isMaster && current?.kind === 'CREATURE';

  // CHAVE DO TURNO atual — mesma fórmula do servidor. O DTO do combate carrega
  // `saveTurnKey`; com ela o cliente sabe, sem adivinhar, se o Teste deste turno
  // já aconteceu (a fonte de verdade continua no SERVIDOR).
  const currentTurnKey = `${combat.id}:${combat.round}:${combat.currentIndex}`;
  const turnDeathState = current?.deathState ?? null;
  const deathSavePending = Boolean(
    turnDeathState &&
      turnDeathState.deathSaves &&
      !turnDeathState.dead &&
      !turnDeathState.stabilized &&
      !turnDeathState.pending &&
      !turnDeathState.relentless &&
      turnDeathState.saveTurnKey !== currentTurnKey,
  );

  // LEVANTAR-SE (PHB 2014): só aparece quando o combatente que age está CAÍDO
  // e pode agir. O custo exibido é informativo — o SERVIDOR recalcula metade do
  // deslocamento efetivo e não gasta Ação.
  const actingProne = Boolean(actingCombatant?.conditionEffects.prone);
  const actingCanAct = Boolean(actingCombatant?.conditionEffects.canAct);
  const standSpeed = actingCombatant?.effectiveSpeed ?? 0;
  const standCost = standSpeed / 2;
  const movementLeft = actingCombatant?.turnEconomy
    ? Number(
        (
          actingCombatant.turnEconomy.movementBudget - actingCombatant.turnEconomy.movementUsed
        ).toFixed(2),
      )
    : 0;
  // O contexto aparece SEMPRE que o combatente ativo está Caído; quando a
  // regra impede (velocidade 0 / movimento insuficiente), o item explica o
  // motivo em vez de simplesmente sumir. O SERVIDOR continua validando.
  const standUpContext =
    actingProne && ownTurn && actingCanAct
      ? {
          cost: standCost,
          available: standSpeed > 0 && movementLeft + 1e-8 >= standCost,
          reason:
            standSpeed <= 0
              ? 'Você não pode se levantar enquanto seu deslocamento efetivo for 0.'
              : movementLeft + 1e-8 < standCost
                ? `Movimento insuficiente: levantar custa ${standCost} m e restam ${movementLeft} m neste turno.`
                : undefined,
        }
      : null;

  // ESTABILIZAR: alvos vivos a 0 PV, sem estabilização nem decisão pendente.
  // Para o jogador, criaturas não entram (vida/ciclo ocultos); personagens sim.
  const stabilizeTargets = actingCombatant
    ? combat.combatants
        .filter((item) => item.id !== actingCombatant.id)
        .filter(
          (item) =>
            item.hpCurrent === 0 &&
            item.deathState !== null &&
            !item.deathState.dead &&
            !item.deathState.stabilized &&
            !item.deathState.pending,
        )
        .map((item) => ({ id: item.id, name: item.name }))
    : [];

  async function rollNpcDeathSaveTurn(): Promise<void> {
    if (!deathEntity) return;
    setBusy(true);
    try {
      await rollNpcDeathSave(deathEntity);
      const fresh = await fetchDeath(deathEntity).catch(() => null);
      if (fresh) setCurrentDeath(fresh);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao rolar o Teste contra a Morte.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Avança o turno. O Mestre pode pular um Teste Contra a Morte pendente, mas
   * só DEPOIS de confirmar (o servidor devolve `DEATH_SAVE_PENDING`). O jogador
   * não tem essa escolha: o primeiro pedido já é recusado.
   */
  async function endTurn(skipDeathSave = false): Promise<void> {
    setBusy(true);
    try {
      onCombatChange(await nextTurn(combat, { skipDeathSave }));
      setSkipDeathConfirm(null);
    } catch (error) {
      if (
        isMaster &&
        !skipDeathSave &&
        error instanceof ApiError &&
        error.code === 'DEATH_SAVE_PENDING'
      ) {
        setSkipDeathConfirm({ name: current?.name ?? 'Este combatente' });
      } else {
        onError(error instanceof Error ? error.message : 'Falha ao avançar o turno.');
      }
    } finally {
      setBusy(false);
    }
  }

  /** Levantar-se gasta metade do deslocamento efetivo (servidor valida). */
  function standUp(): void {
    if (!actingCombatant) return;
    void (async () => {
      setBusy(true);
      try {
        await standUpRequest({
          entity: { kind: 'combatant', id: actingCombatant.id },
          expectedVersion: actingCombatant.mechanicalVersion,
          expectedCombatVersion: combat.version,
        });
        const fresh = await fetchActiveCombat().catch(() => null);
        if (fresh) onCombatChange(fresh);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Falha ao levantar-se.');
      } finally {
        setBusy(false);
      }
    })();
  }

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

  // Resolve um ataque e deixa o Registro (via socket) exibir o desfecho — o
  // centro não duplica mais o resultado.
  function attack(input: Parameters<typeof resolveAttack>[1]): void {
    void (async () => {
      setBusy(true);
      try {
        const { combat: updated } = await resolveAttack(combat, input);
        onCombatChange(updated);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Falha na rolagem.');
      } finally {
        setBusy(false);
      }
    })();
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
          right={<CombatLog log={log} economyLog={[...combat.economyLog, ...combat.combatants.flatMap(item => item.mechanicalState.log)]} />}
          bottom={<TurnResourceBar active={false} isMaster={isMaster} />}
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
              onClick={() => void endTurn()}
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

            {/* Turno em Testes contra a Morte: o fluxo normal do combatente do
                turno dá lugar ao painel dramático (nada de ataque/alvo/ações). */}
            {showDeathTurn && current && turnDeath ? (
              <DeathSavePanel
                name={current.name}
                death={turnDeath}
                rollAvailable={deathRollAvailable}
                rollReason={deathRollReason}
                canRoll={deathCanRoll}
                rollLabel={
                  deathPrivate
                    ? 'Rolar Teste contra a Morte (privado)'
                    : 'Rolar Teste contra a Morte'
                }
                onRoll={
                  deathPrivate
                    ? () => void rollNpcDeathSaveTurn()
                    : onRollDeathSave && deathEntity
                      ? () => onRollDeathSave(deathEntity)
                      : undefined
                }
                busy={busy}
              />
            ) : null}

            {/* O Mestre continua com o painel de ataques (ele conduz a mesa e
                também rola os Testes privados de criaturas). */}
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
                onAttack={attack}
              />
            ) : null}

            {!isMaster && myCombatant && !showDeathTurn ? (
              <>
                {!isMyTurn ? (
                  <p className="section-note">
                    Fora do seu turno, somente ações preparadas com Reação podem ser resolvidas aqui.
                  </p>
                ) : null}
                <CombatActionPanel
                  combat={combat}
                  attacker={myCombatant}
                  attacks={characterAttacks}
                  inventory={characterInventory}
                  sneakAttack={sneakAttackExpression}
                  busy={busy}
                  onAttack={attack}
                />
              </>
            ) : null}

            {isMaster ? (
              <ManualHpPanel
                combatants={combat.combatants}
                busy={busy}
                onApply={(input) => void run(() => applyManualHp(input))}
              />
            ) : null}

            {/* Atalhos da ficha: linha compacta, sem competir com o ataque. */}
            {onOpenSection ? (
              <div className="combat-shortcuts combat-shortcuts-inline">
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
                      <Icon name={shortcut.icon} size={14} /> {shortcut.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/*
              Estado e ajustes (drawer recolhido): notas derivadas, Levantar e a
              administração do Mestre. As ETIQUETAS de condição NÃO vivem aqui —
              elas ficam no card da iniciativa. Fica fora do fluxo de ataque.
            */}
            {actingCombatant ? (
              <details className="combat-status">
                <summary className="combat-status-summary">
                  <Icon name="info" size={14} /> Estado e ajustes — {actingCombatant.name}
                </summary>
                <MechanicalPanel
                  entity={{ kind: 'combatant', id: actingCombatant.id }}
                  refreshVersion={combat.version}
                  sourceChoices={combat.combatants.map((item) => ({
                    entity: { kind: 'combatant' as const, id: item.id },
                    name: item.name,
                  }))}
                />
                {isMaster ? (
                  <MasterEconomyPanel
                    combat={combat}
                    combatant={actingCombatant}
                    busy={busy}
                    onRun={(action) => void run(action)}
                  />
                ) : null}
              </details>
            ) : null}
          </>
        }
        right={<CombatLog log={log} economyLog={[...combat.economyLog, ...combat.combatants.flatMap(item => item.mechanicalState.log)]} />}
        bottom={
          <TurnResourceBar
            active
            isMaster={isMaster}
            isMyTurn={isMyTurn}
            economy={actingCombatant?.turnEconomy}
            busy={busy}
            ownTurn={ownTurn}
            canAct={actingCombatant ? actingCombatant.conditionEffects.canAct : false}
            effectiveSpeed={actingCombatant?.effectiveSpeed}
            deathBlocked={Boolean(actingCombatant && deathLifecycle(actingCombatant.deathState))}
            deathSavePending={!isMaster && deathSavePending}
            standUp={standUpContext}
            onStandUp={standUp}
            stabilizeTargets={stabilizeTargets}
            onStabilize={(targetCombatantId) => {
              if (!actingCombatant) return;
              void run(() =>
                executeEconomyAction(combat, {
                  combatantId: actingCombatant.id,
                  action: 'stabilize',
                  targetCombatantId,
                }),
              );
            }}
            onEconomyAction={(input) => {
              if (!actingCombatant) return;
              void run(() =>
                executeEconomyAction(combat, { combatantId: actingCombatant.id, ...input }),
              );
            }}
            onEndTurn={() => void endTurn()}
          />
        }
      />

      {skipDeathConfirm ? (
        <DeathSaveSkipDialog
          name={skipDeathConfirm.name}
          busy={busy}
          onCancel={() => setSkipDeathConfirm(null)}
          onConfirm={() => void endTurn(true)}
        />
      ) : null}
    </section>
  );
}
