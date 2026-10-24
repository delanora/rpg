import { MechanicalPanel } from '../components/MechanicalPanel';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { standUp as standUpRequest } from '../mechanicalApi';
import { Icon, type IconName } from '../components/Icon';
import { formatModifier } from '../dnd';
import { fetchDeath, rollNpcDeathSave } from '../deathApi';
import type { Attack, CombatDto, Creature, DeathDto, DeathState, InventoryItem, Item, MechanicalEntity, SessionUser } from '../types';
import { InventoryDock } from '../components/InventoryDock';
import {
  applyManualHp,
  endCombat,
  executeEconomyAction,
  fetchActiveCombat,
  nextTurn,
  resolveAttack,
  rollInitiativeFor,
  rollMyInitiative,
  useCombatItem,
} from './combatApi';
import { CombatIntro } from './CombatIntro';
import { BattleWaitingPanel } from './components/BattleWaitingPanel';
import { CombatActionPanel, ManualHpPanel } from './components/CombatActionPanel';
import { CombatDashboard } from './components/CombatDashboard';
import { CombatLog } from './components/CombatLog';
import { CombatTurnPanel } from './components/CombatTurnPanel';
import { DeathSavePanel } from './components/DeathSavePanel';
import { DeathSaveSkipDialog } from './components/DeathSaveSkipDialog';
import { InitiativeTimeline } from './components/InitiativeTimeline';
import { MasterEconomyPanel } from './components/MasterEconomyPanel';
import { ReactionPanel } from './components/ReactionPanel';
import { TurnResourceBar } from './components/TurnResourceBar';
import { TurnToast } from './components/TurnToast';
import { reactionOpportunitiesForViewer, type ReactionOpportunity } from './reactions';
import { actingCombatantFor, currentUserControlsCombatant } from './turnControl';
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
  /**
   * REACTION WINDOW (arquitetura): oportunidades concretas para ESTE usuário.
   * Vazio por padrão — nenhuma interface de Reação é renderizada sem uma
   * oportunidade real (nada de barra permanente fora do turno).
   */
  reactionOpportunities?: ReactionOpportunity[];
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
  /**
   * MESTRE: inventário persistente do NPC do turno, no MESMO painel flutuante
   * da ficha. O consumo em combate continua passando pelo motor de combate
   * (turno + Ação), então "Usar Item" saiu do menu de Ações.
   */
  npcInventory?: {
    creatureFor: (creatureId: string) => Creature | null;
    items: Item[];
    onCreatureChange: (creature: Creature) => void;
  };
}

/**
 * Ponto de composição do painel de combate. Continua dono do estado local e das
 * ações (rolagens, ataque, dano manual, turno e encerramento).
 *
 * PRIVACIDADE DE TURNO: a interface OPERACIONAL (ataques, alvos, bônus,
 * economia, movimento, Encerrar Turno) só é renderizada para quem controla o
 * combatente atual (`currentUserControlsCombatant`). Quem assiste vê o
 * `BattleWaitingPanel` — animação de espada × escudo e o nome do turno, sem
 * detalhes operacionais. O Mestre mantém os controles administrativos (dano
 * manual, ajustes e o avanço do turno) sem receber a barra do jogador.
 */
export function CombatTracker({
  combat,
  log,
  user,
  turnAlert,
  characterAttacks = [],
  sneakAttackExpression = null,
  sneakAttackFor,
  characterInventory,
  attacksFor,
  reactionOpportunities = [],
  onCombatChange,
  onCombatEnd,
  onError,
  onOpenSection,
  openSection = null,
  onRollDeathSave,
  npcInventory,
}: CombatTrackerProps) {
  const isMaster = user.role === 'MASTER';

  const [busy, setBusy] = useState(false);
  /**
   * OVERRIDE MANUAL DO MESTRE, preso AO TURNO em que foi feito.
   *
   * Quando o turno vira, `turnId` não bate mais e a seleção volta sozinha para
   * o novo combatente atual — sem efeito nem frame intermediário. Para o Mestre,
   * criaturas/NPCs são auto-selecionados; trocar é possível, mas não persiste.
   */
  const [masterPick, setMasterPick] = useState<{ turnId: string; combatantId: string } | null>(
    null,
  );
  // OVERRIDE explícito: o Mestre assume o turno de um personagem de jogador
  // (jogador ausente). Vale só para AQUELE turno — nada de virar controlador
  // permanente, e nada de mostrar a barra do jogador sem intenção declarada.
  const [masterAssumed, setMasterAssumed] = useState<string | null>(null);
  // Leitura do ciclo de morte do combatente do turno (elegibilidade do Teste).
  const [currentDeath, setCurrentDeath] = useState<DeathDto | null>(null);
  // Confirmação do Mestre para avançar sem o Teste Contra a Morte do turno.
  const [skipDeathConfirm, setSkipDeathConfirm] = useState<{ name: string } | null>(null);
  // Janelas de Reação já RECUSADAS/resolvidas (fecham localmente; o servidor
  // continua dono de qualquer efeito mecânico futuro).
  const [closedReactions, setClosedReactions] = useState<string[]>([]);

  const myCombatant = combat.combatants.find((item) => item.ownerUserId === user.id) ?? null;
  const current = combat.combatants.find((item) => item.id === combat.currentCombatantId) ?? null;
  const isMyTurn = Boolean(current && current.ownerUserId === user.id);

  // Quem controla o turno AGORA (derivação única — ver `turnControl.ts`).
  const controlsCurrent = currentUserControlsCombatant(current, user);
  const currentId = current?.id ?? '';
  const masterAttackerId =
    masterPick && masterPick.turnId === currentId ? masterPick.combatantId : currentId;
  const masterOverrideActive =
    isMaster &&
    ((masterAttackerId !== currentId && masterAttackerId !== '') ||
      (masterAssumed !== null && masterAssumed === currentId));
  const showOperational = controlsCurrent || masterOverrideActive;

  // Combatente que a interface representa (atacante do Mestre / próprio personagem).
  const actingCombatant = actingCombatantFor(
    combat.combatants,
    current,
    user,
    isMaster ? masterAttackerId : '',
  );
  const masterAttackerCombatant = isMaster ? actingCombatant : null;
  const ownTurn = Boolean(actingCombatant && actingCombatant.id === combat.currentCombatantId);

  // Inventário do NPC do turno (Mestre): lido do cadastro já carregado no
  // painel. O MESMO componente do jogador desenha o painel flutuante.
  const npcInventoryCreature =
    isMaster && npcInventory && actingCombatant?.creatureId
      ? npcInventory.creatureFor(actingCombatant.creatureId)
      : null;

  // Oportunidades de Reação DESTE usuário (hoje sempre vazio: a janela é o
  // ponto de extensão, ver `reactions.ts`). Nunca existe barra permanente.
  const myReactionOpportunities = reactionOpportunitiesForViewer(
    reactionOpportunities,
    user.id,
  ).filter((opportunity) => !closedReactions.includes(opportunity.id));
  const reactionOpportunity = myReactionOpportunities[0] ?? null;
  const closeReaction = (opportunityId: string): void =>
    setClosedReactions((previous) => [...previous, opportunityId]);

  const rolledCount = combat.combatants.filter((item) => item.rolled).length;

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
  // Criatura/NPC: só o Mestre rola (Teste privado). Personagem: só o dono.
  const deathPrivate = isMaster && Boolean(current && current.kind !== 'CHARACTER');
  const deathCanRoll = Boolean(
    showDeathTurn &&
      ((!isMaster && deathOwner && Boolean(onRollDeathSave)) || deathPrivate),
  );

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
  // Para o jogador, criaturas/NPCs não entram (vida/ciclo ocultos); personagens sim.
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
  /**
   * Trava SÍNCRONA contra duplo clique no consumível: o estado `busy` só
   * desabilita no próximo render, então dois cliques no mesmo tick gerariam
   * dois pedidos. O servidor continua sendo a autoridade (turno/Ação/quantidade
   * e `operationId`), mas o cliente não dispara a segunda intenção.
   */
  const itemBusyRef = useRef(false);

  /**
   * Usar consumível (duplo clique ou "Usar em..."): o servidor valida
   * turno/Ação, consome a unidade e aplica — nunca pelo menu de Ações.
   */
  async function useItem(itemInventoryId: string, targetCombatantId?: string): Promise<void> {
    if (!actingCombatant || itemBusyRef.current) return;
    itemBusyRef.current = true;
    setBusy(true);
    try {
      const { combat: updated } = await useCombatItem(combat, {
        combatantId: actingCombatant.id,
        itemInventoryId,
        ...(targetCombatantId ? { targetCombatantId } : {}),
      });
      onCombatChange(updated);
    } catch (error) {
      // Mensagens do servidor: "Você já usou sua Ação neste turno." /
      // "Você só pode usar este item no seu turno."
      onError(error instanceof Error ? error.message : 'Falha ao usar o item.');
    } finally {
      itemBusyRef.current = false;
      setBusy(false);
    }
  }

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

      {/* Toast central (2 s, sem clique, sem bloquear a interface). */}
      <TurnToast alert={turnAlert} />

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

            {/* Janela de Reação: SÓ com oportunidade concreta para este usuário. */}
            {reactionOpportunity ? (
              <ReactionPanel
                opportunity={reactionOpportunity}
                busy={busy}
                onChoose={() => {
                  // Nenhuma reação mecânica existe hoje: NÃO aplicamos um efeito
                  // falso. A janela fecha e a limitação é dita com clareza.
                  closeReaction(reactionOpportunity.id);
                  onError(
                    'A execução mecânica de Reações entra com a Spell Engine; nenhum efeito foi aplicado.',
                  );
                }}
                onDecline={() => {
                  // Recusar NÃO gasta a Reação e fecha a janela.
                  closeReaction(reactionOpportunity.id);
                }}
              />
            ) : null}

            {/* Turno em Testes contra a Morte: o fluxo normal do combatente do
                turno dá lugar ao painel dramático (nada de ataque/alvo/ações).
                Para criatura/NPC o ciclo é privado: o DTO do jogador não traz
                `deathState`, então este painel nem aparece para ele. */}
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
            ) : showOperational ? (
              <>
                {/* Mestre: painel de ataques do combatente que ele controla
                    (criatura/NPC do turno ou override explícito). */}
                {isMaster && attacksFor && masterAttackerCombatant ? (
                  <CombatActionPanel
                    combat={combat}
                    attacker={masterAttackerCombatant}
                    attacks={[]}
                    attackerChoices={combat.combatants.filter((item) => !item.missing)}
                    attacksFor={attacksFor}
                    sneakAttackFor={sneakAttackFor}
                    onSelectAttacker={(combatantId) =>
                      setMasterPick({ turnId: currentId, combatantId })
                    }
                    busy={busy}
                    onAttack={attack}
                  />
                ) : null}

                {!isMaster && myCombatant ? (
                  <CombatActionPanel
                    combat={combat}
                    attacker={myCombatant}
                    attacks={characterAttacks}
                    inventory={characterInventory}
                    sneakAttack={sneakAttackExpression}
                    busy={busy}
                    onAttack={attack}
                  />
                ) : null}
              </>
            ) : (
              <>
                {/* Quem NÃO controla o turno: apresentação neutra, sem ataques,
                    bônus, economia, alvos ou Encerrar Turno. */}
                {current ? (
                  <BattleWaitingPanel
                    name={current.name}
                    kind={current.kind}
                    isMaster={isMaster}
                  />
                ) : null}

                {/* Autoridade do Mestre preservada de forma EXPLÍCITA: ele
                    pode assumir o turno de um personagem (jogador ausente). */}
                {isMaster && current ? (
                  <button
                    type="button"
                    className="btn btn-small combat-assume-turn"
                    disabled={busy}
                    onClick={() => {
                      setMasterAssumed(currentId);
                      setMasterPick({ turnId: currentId, combatantId: currentId });
                    }}
                  >
                    <Icon name="crown" size={13} /> Assumir o turno de {current.name}
                  </button>
                ) : null}

                {/* EXCEÇÃO — REAÇÃO já suportada pelo motor: uma ação preparada
                    só pode ser resolvida fora do próprio turno. Enquanto ela
                    existir, a janela contextual reaproveita o painel de ataque
                    do PRÓPRIO personagem (nunca o de outro jogador). */}
                {!isMaster && myCombatant?.turnEconomy.ready ? (
                  <>
                    <p className="section-note">
                      Você tem uma ação preparada. Resolvê-la consome a sua Reação.
                    </p>
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
              </>
            )}

            {/* Administração do Mestre: sempre disponível, sem virar a interface
                operacional do jogador do turno. */}
            {isMaster ? (
              <ManualHpPanel
                combatants={combat.combatants}
                busy={busy}
                onApply={(input) => void run(() => applyManualHp(input))}
              />
            ) : null}

            {/*
              INVENTÁRIO DO NPC — MESMO painel flutuante da ficha do jogador.
              O Mestre abre o inventário do NPC do turno e usa por duplo clique
              ou "Usar em..."; o servidor continua validando turno/Ação.
            */}
            {showOperational && npcInventory && npcInventoryCreature?.kind === 'NPC' ? (
              <InventoryDock
                npc={{
                  creature: npcInventoryCreature,
                  items: npcInventory.items,
                  onChange: npcInventory.onCreatureChange,
                  onError,
                }}
                onUseItem={(itemInventoryId) => useItem(itemInventoryId)}
                itemTargets={
                  actingCombatant
                    ? combat.combatants
                        .filter((item) => item.id !== actingCombatant.id && !item.missing)
                        .map((item) => ({ id: item.id, name: item.name }))
                    : []
                }
                onUseItemOn={(itemInventoryId, targetCombatantId) =>
                  useItem(itemInventoryId, targetCombatantId)
                }
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
          // A barra persistente NÃO é renderizada para quem não controla o
          // turno (nem para o Mestre observando o personagem de um jogador).
          showOperational && actingCombatant ? (
            <TurnResourceBar
              active
              isMaster={isMaster}
              isMyTurn={isMyTurn}
              economy={actingCombatant.turnEconomy}
              busy={busy}
              ownTurn={ownTurn}
              canAct={actingCombatant.conditionEffects.canAct}
              effectiveSpeed={actingCombatant.effectiveSpeed}
              deathBlocked={deathLifecycle(actingCombatant.deathState)}
              deathSavePending={!isMaster && deathSavePending}
              standUp={standUpContext}
              onStandUp={standUp}
              stabilizeTargets={stabilizeTargets}
              onStabilize={(targetCombatantId) => {
                void run(() =>
                  executeEconomyAction(combat, {
                    combatantId: actingCombatant.id,
                    action: 'stabilize',
                    targetCombatantId,
                  }),
                );
              }}
              onEconomyAction={(input) => {
                void run(() =>
                  executeEconomyAction(combat, { combatantId: actingCombatant.id, ...input }),
                );
              }}
              onEndTurn={() => void endTurn()}
            />
          ) : undefined
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
