import { CreatureAbilitiesPanel } from './components/CreatureAbilitiesPanel';
import { CombatReinforcements } from './components/CombatReinforcements';
import { AssumedCharacterPendings, pendingsForCharacter } from './components/AssumedCharacterPendings';
import { CombatTokenMenu } from './components/CombatTokenMenu';
import { CombatTokenAdjustments } from './components/CombatTokenAdjustments';
import { MasterSpellIntentsPanel } from '../components/MasterSpellIntentsPanel';
import { MechanicalPanel } from '../components/MechanicalPanel';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { standUp as standUpRequest } from '../mechanicalApi';
import { Icon, type IconName } from '../components/Icon';
import { fetchDeath, rollNpcDeathSave } from '../deathApi';
import type { Attack, CombatDto, CombatResolutionCardDto, ConcentrationSave, Creature, DeathDto, DeathState, InventoryItem, Item, MechanicalEntity, SessionUser, SpatialPosition } from '../types';
import {
  declineSpellSaveCard,
  fetchResolutionRequests,
  resolveSpellSaveCard,
} from './resolutionApi';
import { InventoryDock } from '../components/InventoryDock';
import {
  endCombat,
  executeEconomyAction,
  fetchActiveCombat,
  nextTurn,
  resolveAttack,
  rollConcentrationSaveAsMaster,
  rollInitiativeFor,
  rollMyInitiative,
  useCombatItem,
} from './combatApi';
import { CombatIntro } from './CombatIntro';
import { CombatGrid } from './grid/CombatGrid';
import {
  targetStillValid,
  targetableCombatantIds,
  targetingEligible,
  type CombatRollMode,
} from './gridTargeting';
// CSS ISOLADO do grid/workspace (styles.css é WIP alheio e não é tocado).
import './grid/grid.css';
import './workspace.css';
import { BattleWaitingInline, BattleWaitingPanel } from './components/BattleWaitingPanel';
import { CombatActionPanel } from './components/CombatActionPanel';
import { CombatWorkspace } from './components/CombatWorkspace';
import { ActionMenu } from './components/ActionMenu';
import { CombatHotbar } from './components/CombatHotbar';
import { CombatLog } from './components/CombatLog';
import {
  assignHotbarRef,
  buildCombatHotbarEntries,
  opportunityHotbarShortcut,
  clearHotbarRef,
  entriesOutsideLayout,
  filterHotbarView,
  layoutOfSlots,
  moveHotbarRef,
  resolveHotbarSlots,
  sameHotbarLayout,
  selectionSurvivesFilter,
  toggleHotbarPick,
  type HotbarFilter,
  type HotbarLayout,
  type HotbarSlotRef,
} from './hotbar';
import { saveHotbarLayout } from '../hotbarApi';
import { CombatTurnPanel } from './components/CombatTurnPanel';
import { ConcentrationSavePanel } from './components/ConcentrationSavePanel';
import { DeathSaveSkipDialog } from './components/DeathSaveSkipDialog';
import { InitiativeTimeline } from './components/InitiativeTimeline';
import { ReactionPanel } from './components/ReactionPanel';
import { PlayerCombatDock } from './components/PlayerCombatDock';
import { PendingEffectSavePanel } from './components/PendingEffectSavePanel';
import { MovementSpendButton, TurnResourceBar, turnResourceAccess } from './components/TurnResourceBar';
import { TurnToast } from './components/TurnToast';
import { reactionOpportunitiesForViewer, type ReactionOpportunity } from './reactions';
import {
  declineOpportunityReaction,
  adjudicateOpportunityVisibility,
  reactionQuestionsForViewer,
  fetchReactionOpportunities,
  resolveOpportunityAttack,
  type ReactionOpportunitiesReadModel,
  type ServerReactionOpportunity,
} from '../reactionOpportunitiesApi';
import { actingCombatantFor, assumedCharacterFor, currentUserControlsCombatant, movementAuthorityOf } from './turnControl';
import { deathDockLabel, deathLifecycleOf, deathSavePendingFor, endTurnAvailability } from './deathDock';
import type { CombatLogEntry, TurnAlert } from './useCombatState';

/**
 * Seções da ficha que podem ser abertas abaixo do painel de combate. A lista
 * fica aqui para os botões e o painel que os atende não saírem de sincronia.
 */
export const COMBAT_SHORTCUTS = [
  { key: 'spells', label: 'Magias', icon: 'star' },
  { key: 'attacks', label: 'Ataques', icon: 'sword' },
  { key: 'features', label: 'Características', icon: 'book' },
  { key: 'attributes', label: 'Atributos', icon: 'shield' },
  { key: 'inventory', label: 'Mochila', icon: 'bag' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

export type SheetShortcut = (typeof COMBAT_SHORTCUTS)[number]['key'];

interface CombatTrackerProps {
  combat: CombatDto;
  log: CombatLogEntry[];
  user: SessionUser;
  turnAlert: TurnAlert | null;
  /** Contador de `effects:updated` (efeitos vêm de tabela própria, não da ficha). */
  effectsRefresh?: number;
  /** Ataques do próprio personagem (fluxo do jogador). */
  characterAttacks?: Attack[];
  /**
   * PERSONALIZAÇÃO DA HOTBAR (6.6M.6.3.1) — configuração salva do personagem
   * (`null` = nunca personalizada). Sem esta prop o editor NEM APARECE, que é
   * como a visão do Mestre continua intocada.
   */
  characterHotbar?: HotbarLayout | null;
  /** Versão da ficha em mãos (controle de concorrência do salvamento). */
  characterVersion?: number | null;
  /** Confirmação do servidor: o pai atualiza a ficha (hotbar + versão). */
  onHotbarSaved?: (hotbar: { slots: (HotbarSlotRef | null)[] }, version: number) => void;
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
  /**
   * Jogador: rola até a FICHA completa (abaixo do workspace). Ação puramente
   * de navegação — a ficha continua no container próprio dela.
   */
  onOpenSheet?: () => void;
  /** Atalho aberto no momento (só para marcar o botão correspondente). */
  openSection?: SheetShortcut | null;
  /**
   * Jogador: abre a BANDEJA DE DADOS existente para o Teste contra a Morte
   * (o servidor rola e aplica; a bandeja só anima). Sem isso, o botão não aparece.
   */
  onRollDeathSave?: (entity: MechanicalEntity) => void;
  /**
   * Jogador: abre a MESMA bandeja de dados para o Teste de Concentração
   * pendente do próprio personagem (o servidor calcula bônus/CD e aplica).
   */
  onRollConcentrationSave?: (entity: MechanicalEntity, save: ConcentrationSave) => void;
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
  effectsRefresh = 0,
  characterAttacks = [],
  characterHotbar,
  characterVersion = null,
  onHotbarSaved,
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
  onOpenSheet,
  onRollDeathSave,
  onRollConcentrationSave,
  npcInventory,
}: CombatTrackerProps) {
  const isMaster = user.role === 'MASTER';
  const [inspectedToken, setInspectedToken] = useState<{ id: string; point: { x: number; y: number } } | null>(null);
  const [addingAt, setAddingAt] = useState<{ position: SpatialPosition | null; point: { x: number; y: number } } | null>(null);
  const closeAddMenu = useCallback(() => setAddingAt(null), []);
  const openAddMenu = (position: SpatialPosition, point: { x: number; y: number }) => {
    setInspectedToken(null);
    setAddingAt({ position, point });
  };
  const closeTokenMenu = useCallback(() => setInspectedToken(null), []);
  const inspectToken = useCallback((id: string, point: { x: number; y: number }) => {
    setAddingAt(null);
    setInspectedToken({ id, point });
  }, []);


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
  /** 6.6I — cards de resolução ativos do registro lateral (read-model do servidor). */
  const [resolutionRequests, setResolutionRequests] = useState<CombatResolutionCardDto[]>([]);
  /** Card com uma ação em andamento (desabilita duplo clique). */
  const [resolutionBusyId, setResolutionBusyId] = useState<string | null>(null);
  // Confirmação do Mestre para avançar sem o Teste Contra a Morte do turno.
  const [skipDeathConfirm, setSkipDeathConfirm] = useState<{ name: string } | null>(null);
  // Janelas de Reação já RECUSADAS/resolvidas (fecham localmente; o servidor
  // continua dono de qualquer efeito mecânico futuro).
  const [closedReactions, setClosedReactions] = useState<string[]>([]);
  /**
   * HOTBAR (6.6M.6): qual slot foi escolhido. É um PEDIDO para o painel de
   * ataque (dono do `attackId`), não um segundo estado de ataque: nada de
   * resolver ataque a partir daqui.
   */
  const [hotbarPick, setHotbarPick] = useState<{ attackId: string; nonce: number } | null>(
    null,
  );
  /**
   * ALVO DO ATAQUE (6.6M.6.4) — UMA seleção para o grid e o painel.
   *
   * O estado vive AQUI: o `CombatActionPanel` recebe o valor por prop e devolve a
   * escolha pelo mesmo setter, então clicar no token ou no cartão do painel
   * escreve no mesmo lugar. `combatantId` é a identidade — nunca nome, índice da
   * Hotbar ou posição na cena.
   */
  const [targetCombatantId, setTargetCombatantId] = useState<string | null>(null);
  /**
   * CONFIRMAR PELO GRID (6.6M.6.4.2/.4) — o DUPLO CLIQUE no alvo incrementa o
   * `nonce` e o painel aperta o MESMO "Rolar ataque", com o modo já escolhido no
   * menu do token quando existe. O ataque, o alvo e a economia continuam vindo
   * do painel/servidor; aqui não há payload.
   */
  const [attackConfirm, setAttackConfirm] = useState<{
    nonce: number;
    mode?: CombatRollMode;
  } | null>(null);
  /**
   * MODO DE ROLAGEM ESCOLHIDO NO TOKEN (6.6M.6.4.4) — escolher no menu NÃO rola
   * nada: só guarda a escolha, o menu some e o cursor de espada ganha o glifo.
   * O ataque só sai no DUPLO CLIQUE no token do alvo.
   *
   * O alvo viaja junto do modo porque a escolha pertence ÀQUELE alvo: trocar de
   * mira reabre o menu em vez de herdar vantagem/desvantagem de outra seleção.
   */
  const [attackRoll, setAttackRoll] = useState<{
    targetId: string;
    /** `null` = menu aberto e nenhum modo escolhido ainda. */
    mode: CombatRollMode | null;
    /** O menu do token está aberto agora (novo clique REABRE para trocar). */
    menuOpen: boolean;
  } | null>(null);
  /** Prontidão de execução reportada pelo painel (habilita o menu do token). */
  const [attackExecuteReady, setAttackExecuteReady] = useState(false);
  /**
   * FILTRO DA HOTBAR (6.6M.6.2) — navegação pelos três glifos da dock. O estado
   * vive aqui (a dock só apresenta a seleção e a Hotbar só desenha a lista
   * podada); virar de turno limpa o filtro, como já acontecia com a seleção.
   */
  const [hotbarFilter, setHotbarFilter] = useState<HotbarFilter | null>(null);
  /**
   * EDITOR DA HOTBAR (6.6M.6.3.1) — o RASCUNHO vive aqui e só vai ao servidor
   * no "Salvar". `hotbarDraft` é a configuração COMPLETA (48 posições), porque
   * no editor o filtro A/B/R não esconde nada (evita troca acidental).
   */
  const [hotbarEditing, setHotbarEditing] = useState(false);
  const [hotbarDraft, setHotbarDraft] = useState<(HotbarSlotRef | null)[] | null>(null);
  const [hotbarSaving, setHotbarSaving] = useState(false);
  const [hotbarError, setHotbarError] = useState<string | null>(null);

  const myCombatant = combat.combatants.find((item) => item.ownerUserId === user.id) ?? null;
  const current = combat.combatants.find((item) => item.id === combat.currentCombatantId) ?? null;
  const isMyTurn = Boolean(current && current.ownerUserId === user.id);

  // Quem controla o turno AGORA (derivação única — ver `turnControl.ts`).
  const controlsCurrent = currentUserControlsCombatant(current, user);
  const currentId = current?.id ?? '';
  // Identidade compartilhada com o ciclo de morte; não persiste para a próxima rodada.
  const currentTurnKey = `${combat.id}:${combat.round}:${combat.currentIndex}`;
  // Reforços podem mudar o índice sem trocar quem está jogando.
  const currentControlKey = `${combat.id}:${combat.round}:${currentId}`;
  const assumedCharacter = assumedCharacterFor(current, user, masterAssumed, currentControlKey);
  const masterAttackerId =
    masterPick && masterPick.turnId === currentId ? masterPick.combatantId : currentId;
  const masterOverrideActive =
    isMaster &&
    ((masterAttackerId !== currentId && masterAttackerId !== '') ||
      (masterAssumed !== null && masterAssumed === currentControlKey));
  const showOperational = controlsCurrent || masterOverrideActive;

  /**
   * Entradas da Hotbar: MESMA fonte do painel de ataque (`characterAttacks`,
   * filtrada por arma equipada dentro do adapter). Hoje só ataques — nenhuma
   * feature/magia/item do jogador tem execução liberada, então não são
   * inventados slots.
   */
  const hotbarEntries = buildCombatHotbarEntries({
    attacks: characterAttacks,
    inventory: characterInventory,
  });
  /**
   * PERSONALIZAÇÃO (6.6M.6.3.1): a configuração salva define a POSIÇÃO de cada
   * atalho; sem ela o preenchimento automático continua idêntico ao de antes.
   * O filtro A/B/R (6.6M.6.3.1.1) NÃO encolhe a grade: a categoria escolhida
   * vem para o começo e os demais atalhos continuam ali, esmaecidos. É só
   * apresentação — a configuração persistida não é reescrita pelo filtro.
   */
  const hotbarLayout: HotbarLayout | null = characterHotbar ?? null;
  let hotbarSlots = filterHotbarView(
    resolveHotbarSlots({
      entries: hotbarEntries,
      attacks: characterAttacks,
      layout: hotbarLayout,
    }),
    hotbarFilter,
  );
  /** Atalhos disponíveis que ficaram FORA da grade (lista "ver todas"). */
  const hotbarExtraEntries = entriesOutsideLayout(hotbarEntries, hotbarLayout);
  /** Grade AUTOMÁTICA — ponto de partida da primeira personalização. */
  const hotbarAutoLayout = layoutOfSlots(
    resolveHotbarSlots({ entries: hotbarEntries, attacks: characterAttacks, layout: null }),
  );
  const hotbarDraftSlots = hotbarDraft
    ? resolveHotbarSlots({
        entries: hotbarEntries,
        attacks: characterAttacks,
        layout: hotbarDraft,
      })
    : [];
  const hotbarDirty = hotbarDraft
    ? !sameHotbarLayout(hotbarDraft, hotbarLayout ?? hotbarAutoLayout)
    : false;

  /**
   * TROCA DE FILTRO (6.6M.6.2.1) — a seleção pertence à lista VISÍVEL.
   *
   * Se a entrada escolhida não pertence ao recorte novo, a pré-seleção é
   * descartada e o painel tático volta a pedir uma ação; se ela continua na
   * categoria, nada muda. Só isso: nenhum ataque já enviado é tocado (o pedido
   * já saiu daqui e quem resolve é o painel + servidor) e não existe segundo
   * estado de seleção.
   */
  const toggleHotbarFilter = (filter: HotbarFilter): void => {
    const next = hotbarFilter === filter ? null : filter;
    setHotbarFilter(next);
    setHotbarPick((previous) =>
      previous && !selectionSurvivesFilter(hotbarEntries, next, previous.attackId)
        ? null
        : previous,
    );
  };

  /**
   * EDITOR DA HOTBAR (6.6M.6.3.1) — abrir, editar, salvar e cancelar.
   *
   * O rascunho nasce da configuração CONFIRMADA (ou da grade automática, na
   * primeira personalização). Salvar usa o endpoint autorizado com
   * `expectedVersion`; conflito de versão NÃO sobrescreve — o erro aparece na
   * linha do topo e o rascunho continua intacto para nova tentativa.
   */
  const startHotbarEdit = (): void => {
    setHotbarDraft(hotbarLayout ? [...hotbarLayout] : [...hotbarAutoLayout]);
    setHotbarError(null);
    setHotbarEditing(true);
    setHotbarPick(null);
  };

  const cancelHotbarEdit = (): void => {
    setHotbarEditing(false);
    setHotbarDraft(null);
    setHotbarError(null);
  };

  const commitHotbarEdit = (): void => {
    if (!hotbarDraft) return;
    const slots = hotbarDraft;
    setHotbarSaving(true);
    setHotbarError(null);
    void (async () => {
      try {
        const result = await saveHotbarLayout(slots, characterVersion ?? 1);
        onHotbarSaved?.(result.hotbar, result.version);
        setHotbarEditing(false);
        setHotbarDraft(null);
      } catch (error) {
        setHotbarError(
          error instanceof Error ? error.message : 'Não foi possível salvar a Hotbar.',
        );
      } finally {
        setHotbarSaving(false);
      }
    })();
  };

  // Combatente que a interface representa (atacante do Mestre / próprio personagem).
  const actingCombatant = actingCombatantFor(
    combat.combatants,
    current,
    user,
    isMaster ? masterAttackerId : '',
  );
  const masterAttackerCombatant = isMaster ? actingCombatant : null;
  const ownTurn = Boolean(actingCombatant && actingCombatant.id === combat.currentCombatantId);

  /**
   * 6.6M.3 — QUEM PODE MOVER no grid agora (derivação única). O Mestre usa o
   * mesmo fluxo para o movimento MECÂNICO do combatente do turno; Placement
   * administrativo continua fora daqui. O servidor revalida tudo.
   */
  const movementAuthority = movementAuthorityOf({
    status: combat.status,
    currentCombatantId: combat.currentCombatantId,
    combatants: combat.combatants,
    user,
    gridActive: combat.spatial.mode === 'grid-2d',
    assumedCombatantId: isMaster && masterAssumed === currentControlKey ? currentId : null,
  });

  // Inventário do NPC do turno (Mestre): lido do cadastro já carregado no
  // painel. O MESMO componente do jogador desenha o painel flutuante.
  const npcInventoryCreature =
    isMaster && npcInventory && actingCombatant?.creatureId
      ? npcInventory.creatureFor(actingCombatant.creatureId)
      : null;

  // 6.6L.3.1 — JANELA DE REAÇÃO persistida no SERVIDOR: o read model é a
  // verdade (o WebSocket só notifica). Recarregar a página ou reconectar não
  // perde a Opportunity Attack, porque nada depende de estado local.
  const [remoteReactions, setRemoteReactions] = useState<ReactionOpportunitiesReadModel | null>(null);
  const [reactionBusy, setReactionBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetchReactionOpportunities(combat.id)
      .then((model) => {
        if (live) setRemoteReactions(model);
      })
      .catch(() => {
        if (live) setRemoteReactions(null);
      });
    return () => {
      live = false;
    };
  }, [combat.id, combat.version]);

  /** Traduz o read model do servidor para o contrato já existente do painel. */
  const remoteOpportunities: ReactionOpportunity[] = reactionQuestionsForViewer(remoteReactions?.opportunities ?? [])
    .map((entry) => ({
      id: entry.id,
      // O SERVIDOR já filtrou por autoridade: quem recebe pode reagir.
      reactorUserId: user.id,
      reactorCombatantId: entry.reactorCombatantId,
      trigger: entry.trigger,
      sourceCombatantId: entry.moverCombatantId,
      targetCombatantId: entry.reactorCombatantId,
      availableReactions: entry.options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        sourceId: option.attackId,
      })),
      // Sem timeout: a janela fecha por decisão (atacar/recusar), nunca sozinha.
      expiresAt: null,
    }));

  // Oportunidades de Reação DESTE usuário (servidor + extensões locais). Nunca
  // existe barra permanente fora de uma janela concreta.
  const myReactionOpportunities = reactionOpportunitiesForViewer(
    [...remoteOpportunities, ...reactionOpportunities],
    user.id,
  ).filter((opportunity) => !closedReactions.includes(opportunity.id));
  const reactionOpportunity = myReactionOpportunities[0] ?? null;
  const opportunityShortcut = opportunityHotbarShortcut(hotbarEntries, characterAttacks, Boolean(reactionOpportunity));
  if (hotbarFilter === 'reaction' && !hotbarEditing && opportunityShortcut) {
    hotbarSlots = [{ index:1, entry:opportunityShortcut, ref:null, state:'ready' as const }, ...hotbarSlots.slice(0, -1)]
      .map((slot, index) => ({...slot, index:index + 1}));
  }

  const closeReaction = (opportunityId: string): void =>
    setClosedReactions((previous) => [...previous, opportunityId]);
  const serverOpportunityOf = (opportunityId: string): ServerReactionOpportunity | undefined =>
    remoteReactions?.opportunities.find((entry) => entry.id === opportunityId);

  /** Atacar: o SERVIDOR gasta a Reação e rola o ataque na mesma transação. */
  const resolveServerReaction = (opportunityId: string, attackId: string): void => {
    setReactionBusy(true);
    resolveOpportunityAttack(combat.id, opportunityId, attackId, combat.version)
      .then((response) => {
        closeReaction(opportunityId);
        onCombatChange(response.combat);
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : 'Não foi possível executar a Reação.');
      })
      .finally(() => setReactionBusy(false));
  };

  /** Recusar: NÃO gasta a Reação e NÃO rola dado. */
  const declineServerReaction = (opportunityId: string): void => {
    setReactionBusy(true);
    declineOpportunityReaction(combat.id, opportunityId, combat.version)
      .then((response) => {
        closeReaction(opportunityId);
        onCombatChange(response.combat);
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : 'Não foi possível recusar a Reação.');
      })
      .finally(() => setReactionBusy(false));
  };

  const assumedRequests = pendingsForCharacter(resolutionRequests, assumedCharacter);
  const assumedRequestIds = new Set(assumedRequests.map(card => card.id));
  const logRequests = resolutionRequests.filter(card => !assumedRequestIds.has(card.id));
  const rolledCount = combat.combatants.filter((item) => item.rolled).length;

  // Ciclo de morte do combatente DO TURNO (o único que pode rolar Teste agora).
  // A regra é a de `deathDock.ts` — tracker, dock e testes leem a MESMA.
  const deathLifecycle = (state: DeathState | null): boolean => deathLifecycleOf(state);
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

  /**
   * 6.6I — read-model dos cards de resolução do registro lateral.
   *
   * A lista é DERIVADA no servidor (pendências + turno real). O cliente só a
   * relê quando o combate ou os efeitos mudam — nunca monta o card sozinho.
   */
  const refreshResolutions = useCallback(async () => {
    try {
      const payload = await fetchResolutionRequests(combat.id);
      setResolutionRequests(payload.requests);
    } catch {
      // Leitura complementar: sem ela o combate continua utilizável.
    }
  }, [combat.id]);

  useEffect(() => {
    void refreshResolutions();
  }, [refreshResolutions, combat.version, effectsRefresh]);

  // O painel central vira MODO TESTE CONTRA A MORTE quando o turno é de um
  // combatente no ciclo de morte. O estado exibido vem SEMPRE do DTO do combate
  // (é o que chega por `combat:updated`, sem refresh); a leitura de `/api/death`
  // só complementa a ELEGIBILIDADE da rolagem.
  const turnDeath = current?.deathState ?? currentDeath?.death ?? null;
  const showDeathTurn = Boolean(current && turnDeath && (turnDeath.dead || turnDeath.pending || turnDeath.stabilized || turnDeath.deathSaves));

  // Troca de turno (ou de rodada): a Hotbar recomeça vazia — nenhuma ação nem
  // filtro do combatente anterior sobrevive ao próximo turno.
  useEffect(() => {
    setHotbarPick(null);
    setHotbarFilter(null);
    // A escolha de alvo pertence à ação do turno: virar o turno a descarta.
    setTargetCombatantId(null);
    setAttackRoll(null);
    setAttackExecuteReady(false);
  }, [currentControlKey]);

  // DESMARCAR/TROCAR O ATALHO limpa o alvo: a seleção pertence à AÇÃO escolhida.
  // É estado de UI — nada é enviado, nada é gasto e nenhum ataque em voo muda.
  useEffect(() => {
    setTargetCombatantId(null);
    setAttackRoll(null);
    // Pedido de confirmação antigo não sobrevive à troca/remoção do atalho: o
    // painel remontaria com o último `nonce` e rolaria um ataque fantasma.
    setAttackConfirm(null);
    setAttackExecuteReady(false);
  }, [hotbarPick]);

  const turnDeathState = current?.deathState ?? null;
  // Só o Teste OBRIGATÓRIO deste turno bloqueia o encerramento. O ciclo de morte
  // (Estabilizado, morto, decisão do Mestre) NÃO bloqueia pedir o fim do turno:
  // quem autoriza é o SERVIDOR (`next-turn`), e a decisão do Mestre continua
  // dele — encerrar o turno não a resolve nem a substitui.
  const deathSavePending = deathSavePendingFor(turnDeathState, currentTurnKey);
  // Pedido de encerrar turno: mesma derivação pura usada pelos testes. O
  // SERVIDOR continua validando tudo (turno, Teste obrigatório, pendências).
  const endTurnGate = endTurnAvailability({ isMyTurn, busy, deathSavePending });

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
            // `!= null` cobre `null` E `undefined`: um estado de morte ausente
            // derrubava a renderização em vez de só sair da lista de alvos.
            item.deathState != null &&
            !item.deathState.dead &&
            !item.deathState.stabilized &&
            !item.deathState.pending,
        )
        .map((item) => ({ id: item.id, name: item.name }))
    : [];

  /**
   * 6.6I — resolve a salvaguarda de magia pelo MESMO endpoint de dados.
   * O card só escolhe os IDs de modificadores opcionais; atributo, CD, bônus,
   * dados e resultado são do servidor.
   */
  async function rollSpellSave(card: CombatResolutionCardDto, selected: string[], visibility: 'public' | 'private' | null): Promise<void> {
    if (resolutionBusyId) return;
    setResolutionBusyId(card.id);
    try {
      await resolveSpellSaveCard(card, {
        ...(selected.length > 0 ? { selectedEffectModifiers: selected } : {}),
        ...(visibility ? { visibility } : {}),
      });
      await refreshResolutions();
      const fresh = await fetchActiveCombat().catch(() => null);
      if (fresh) onCombatChange(fresh);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao resolver a salvaguarda.');
      await refreshResolutions();
      const updated = await fetchActiveCombat().catch(() => null);
      if (updated) onCombatChange(updated);
    } finally {
      setResolutionBusyId(null);
    }
  }

  /** Recusa legítima da salvaguarda OPCIONAL de fim de turno (nunca `initial`). */
  async function declineResolution(card: CombatResolutionCardDto): Promise<void> {
    if (resolutionBusyId) return;
    setResolutionBusyId(card.id);
    try {
      await declineSpellSaveCard(card);
      await refreshResolutions();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao recusar a salvaguarda.');
      await refreshResolutions();
    } finally {
      setResolutionBusyId(null);
    }
  }

  /**
   * 6.6I — Teste contra a Morte pelo fluxo EXISTENTE.
   * Jogador: a bandeja de dados anima e o servidor rola (mesma rota). Mestre:
   * rola o Teste de criatura/NPC com audiência privada.
   */
  async function rollDeathSaveCard(card: CombatResolutionCardDto): Promise<void> {
    const entity = card.reference.entity;
    if (!entity) return;
    if (!isMaster && onRollDeathSave) {
      onRollDeathSave(entity);
      return;
    }
    if (resolutionBusyId) return;
    setResolutionBusyId(card.id);
    try {
      await rollNpcDeathSave(entity);
      await refreshResolutions();
      const freshCombat = await fetchActiveCombat().catch(() => null);
      if (freshCombat) onCombatChange(freshCombat);
      if (deathEntity) {
        const freshDeath = await fetchDeath(deathEntity).catch(() => null);
        if (freshDeath) setCurrentDeath(freshDeath);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha ao rolar o Teste contra a Morte.');
      await refreshResolutions();
      const updated = await fetchActiveCombat().catch(() => null);
      if (updated) onCombatChange(updated);
    } finally {
      setResolutionBusyId(null);
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
      } else if (
        error instanceof ApiError &&
        (error.code === 'TURN_END_TRIGGER_PENDING' ||
          // 6.6J.2: salvaguardas INICIAIS da conjuração ainda abertas. O turno
          // não avança e a mensagem orienta a resolver os cards pendentes.
          error.code === 'SPELL_RESOLUTION_PENDING')
      ) {
        // O turno NÃO avançou porque existem salvaguardas pendentes. A mensagem
        // do servidor diz o que fazer (rolar, recusar ou fechar a conjuração).
        onError(error.message);
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

  /**
   * Entidade CANÔNICA do estado mecânico: personagem usa a ficha, criatura usa
   * a própria instância do combate. É onde a pendência de concentração mora.
   */
  const pendingCombatant = assumedCharacter ?? (isMaster && actingCombatant?.kind === 'CHARACTER' ? null : actingCombatant);
  const concentrationEntity: MechanicalEntity | null = pendingCombatant
    ? pendingCombatant.characterId
      ? { kind: 'character', id: pendingCombatant.characterId }
      : { kind: 'combatant', id: pendingCombatant.id }
    : null;
  const concentrationSaves = pendingCombatant?.mechanicalState.pendingConcentrationSaves ?? [];
  const hasAssumedPendings = Boolean(assumedCharacter && (assumedRequests.length || concentrationSaves.length));
  const canRollOwnConcentration = Boolean(
    !isMaster && actingCombatant && myCombatant && actingCombatant.id === myCombatant.id,
  );

  /**
   * Mestre: rola o teste de concentração de criatura/NPC escolhendo a
   * visibilidade NA HORA. O servidor resolve CD/bônus/concentração e republica
   * o combate; aqui só revalidamos o estado para quem está com socket lento.
   */
  async function rollConcentrationForMaster(
    save: ConcentrationSave,
    visibility: 'public' | 'private',
  ): Promise<void> {
    if (!concentrationEntity || busy) return;
    setBusy(true);
    try {
      await rollConcentrationSaveAsMaster({
        entity: concentrationEntity,
        pendingConcentrationSaveId: save.id,
        visibility,
      });
      const updated = await fetchActiveCombat().catch(() => null);
      if (updated) onCombatChange(updated);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha no teste de concentração.');
      const updated = await fetchActiveCombat().catch(() => null);
      if (updated) onCombatChange(updated);
    } finally {
      setBusy(false);
    }
  }

  /**
   * FIM DO FLUXO DE ATAQUE (6.6M.6.4.6) — o MESMO encerramento do Esc: alvo,
   * modo de rolagem e ação escolhida na Hotbar saem juntos (o grid deixa de
   * oferecer alvos). Sem faixa abaixo do grid, os gestos de saída são o Esc, o
   * duplo clique que executa e o clique de novo no slot escolhido. Nada aqui
   * cancela ataque em voo: o pedido já enviado continua sendo aplicado quando
   * a resposta chega.
   */
  function endAttackFlow(): void {
    setTargetCombatantId(null);
    setAttackRoll(null);
    setHotbarPick(null);
  }

  function attack(input: Parameters<typeof resolveAttack>[1]): void {
    void (async () => {
      setBusy(true);
      try {
        const { combat: updated } = await resolveAttack(combat, input);
        onCombatChange(updated);
        // Ataque EXECUTADO: o fluxo termina aqui, como no Esc. Recusa ou falha
        // do servidor NÃO encerram nada (o `catch` abaixo), então alvo, modo e
        // painel continuam montados para o jogador tentar de novo.
        if (hotbarPick) endAttackFlow();
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Falha na rolagem.');
      } finally {
        setBusy(false);
      }
    })();
  }

  /**
   * PRÉ-INICIATIVA (6.6M.7) — o personagem participa do combate e ainda NÃO
   * rolou: a dock fica montada com o miolo temporariamente indisponível e o
   * CTA flutua sobre a Hotbar. É apresentação pura: rolar continua sendo o
   * MESMO pedido (`rollMyInitiative`) e o servidor segue dono da ordem.
   */
  const preInitiativeRoll =
    !isMaster && myCombatant && !myCombatant.rolled
      ? myCombatant
      : null;
  const awaitingInitiative = preInitiativeRoll !== null;
  /**
   * DOCK DO JOGADOR (6.6M.6.2) — montada enquanto o personagem participa do
   * combate ativo, inclusive FORA do próprio turno (estado de espera).
   *
   * Retrato, estado mecânico, utilitários e decisões urgentes não podem
   * desaparecer só porque outro combatente está agindo. A autoridade continua
   * derivada do turno (`ownTurn` → `dockAccess`) e validada pelo SERVIDOR.
   *
   * 6.6M.8 — O CICLO DE MORTE TAMBÉM NÃO DESMONTA A DOCK. Antes, o turno de
   * Teste contra a Morte do próprio personagem zerava `dockCombatant` e a tela
   * voltava para a composição antiga (barra persistente + atalhos soltos). Agora
   * a dock continua montada e o que muda é a DISPONIBILIDADE: `dockDeathLabel`
   * diz o estado e a Hotbar fica visível, porém inerte.
   */
  const dockCombatant = !isMaster && myCombatant ? myCombatant : null;
  const dockDeathLabel = deathDockLabel(dockCombatant?.deathState ?? null);
  const dockDeathBlocked = dockDeathLabel !== null;
  // ENTRAR NO CICLO DE MORTE encerra o fluxo de ataque: ficar Inconsciente a
  // 0 PV não convive com alvo/modo/painel de ataque em aberto. É estado de UI —
  // nenhuma rota é chamada e nenhum ataque em voo é cancelado.
  useEffect(() => {
    if (!dockDeathBlocked) return;
    setTargetCombatantId(null);
    setAttackRoll(null);
    setHotbarPick(null);
  }, [dockDeathBlocked]);
  /**
   * Espera: a dock existe, mas o turno é de outro combatente. Na
   * PRÉ-INICIATIVA a espera NÃO entra — ali o estado próprio é o miolo
   * bloqueado com o CTA de rolagem por cima.
   */
  const dockWaiting =
    Boolean(dockCombatant) && !ownTurn && !awaitingInitiative && !dockDeathBlocked;
  const dockAccess = dockCombatant
    ? turnResourceAccess({
        active: true,
        hasActionHandler: true,
        economy: dockCombatant.turnEconomy,
        // Ciclo de morte: a economia está bloqueada NO SERVIDOR e a dock não
        // oferece Ação/Bônus/Movimento — sem desmontar a interface.
        canAct: dockCombatant.conditionEffects.canAct && !dockDeathBlocked,
        ownTurn: ownTurn && !dockDeathBlocked,
        effectiveSpeed: dockCombatant.effectiveSpeed,
        hasContext: Boolean(standUpContext) || stabilizeTargets.length > 0,
      })
    : null;

  /**
   * TARGETING DIRETO DO GRID (6.6M.6.4) — DERIVADO, nunca um segundo estado.
   *
   * A lista de elegíveis vem do DTO visível e o alvo só vale enquanto continuar
   * nela: realtime pode remover o combatente, escondê-lo do jogador ou trocar de
   * combate, e a seleção cai sem gerar operação. Sem ataque escolhido, fora do
   * turno próprio, com a Hotbar em edição ou em Teste Contra a Morte o grid
   * continua exatamente como antes e os cartões do painel seguem valendo.
   */
  const gridTargetIds = targetableCombatantIds(combat.combatants, myCombatant?.id ?? null);
  const gridTargetId = targetStillValid(targetCombatantId, gridTargetIds)
    ? targetCombatantId
    : null;
  /** Modo já escolhido para ESTE alvo (o menu só reabre para outro alvo). */
  const gridRollMode =
    attackRoll && attackRoll.targetId === gridTargetId ? attackRoll.mode : null;
  /**
   * MENU DO TOKEN VISÍVEL (6.6M.6.4.5) — além do primeiro clique, um clique no
   * alvo que JÁ tem modo escolhido reabre o menu para TROCAR a rolagem; o modo
   * guardado continua valendo no duplo clique enquanto o menu está aberto.
   */
  const gridRollMenuOpen = Boolean(
    attackRoll && attackRoll.targetId === gridTargetId && attackRoll.menuOpen,
  );
  const gridTargetingActive = targetingEligible({
    isMaster,
    ownTurn: isMyTurn,
    attackSelected: Boolean(hotbarPick),
    awaitingInitiative,
    hotbarEditing,
    deathSavePending,
  });

  /** Painel do jogador: reaproveitado no retrato. A administração do Mestre
   * fica exclusivamente no menu contextual do token inspecionado. */
  const statusPanelCombatant = dockCombatant ?? actingCombatant;
  const statusPanel = !isMaster && statusPanelCombatant ? (
    <MechanicalPanel
      entity={{ kind: 'combatant', id: statusPanelCombatant.id }}
      refreshVersion={combat.version}
      effectsRefresh={effectsRefresh}
      variant={dockCombatant ? 'dock' : 'combat'}
      sourceChoices={combat.combatants.map((item) => ({
        entity: { kind: 'combatant' as const, id: item.id },
        name: item.name,
      }))}
    />
  ) : null;

  let dockNode: ReactNode = undefined;
  if (dockCombatant && dockAccess) {
    const dockEconomy = dockCombatant.turnEconomy;
    const dockEconomyAction = (input: {
      action: Parameters<typeof executeEconomyAction>[1]['action'];
      description?: string;
      trigger?: string;
      intent?: string;
      distance?: number;
    }): void => {
      void run(() =>
        executeEconomyAction(combat, { combatantId: dockCombatant.id, ...input }),
      );
    };

    dockNode = (
      <PlayerCombatDock
        name={dockCombatant.name}
        imageUrl={dockCombatant.imageUrl}
        hpCurrent={dockCombatant.hpCurrent}
        hpMax={dockCombatant.hpMax}
        armorClass={dockCombatant.armorClass}
        mechanicalState={dockCombatant.mechanicalState}
        conditionEffects={dockCombatant.conditionEffects}
        economy={dockEconomy}
        concentration={dockCombatant.mechanicalState.concentration ?? null}
        deathBlocked={dockDeathBlocked}
        // Identificação discreta sobre a Hotbar: a dock não desmonta no ciclo.
        deathLabel={dockDeathLabel}
        deathSavePending={deathSavePending}
        busy={busy}
        // ESPERA (6.6M.6.2): a Hotbar dá lugar à animação da bandeja tática e
        // os glifos passam a consulta — sem ação executável fora do turno.
        waiting={dockWaiting || awaitingInitiative}
        // PRÉ-INICIATIVA (6.6M.7): o MESMO pedido de rolagem de sempre, agora
        // ancorado na Hotbar — sem segundo fluxo de iniciativa.
        awaitingInitiative={
          preInitiativeRoll
            ? {
                modifier: preInitiativeRoll.dexterityMod,
                busy,
                onRoll: () => void run(rollMyInitiative),
              }
            : null
        }
        // LÁPIS do editor da Hotbar junto do retrato (6.6M.6.3.1). Só o
        // jogador com configuração fornecida vê o gesto — o Mestre não.
        // O MESMO gesto fecha o editor: clicar no lápis em edição equivale a
        // cancelar (o rascunho é descartado, nada é enviado).
        onPersonalizeHotbar={
          characterHotbar !== undefined ? (hotbarEditing ? cancelHotbarEdit : startHotbarEdit) : undefined
        }
        personalizeActive={hotbarEditing}
        onSaveHotbar={commitHotbarEdit}
        saveDisabled={!hotbarDirty || hotbarSaving}
        personalizeDisabled={busy || hotbarSaving || awaitingInitiative || dockWaiting}
        hotbarFilter={hotbarFilter}
        onToggleHotbarFilter={toggleHotbarFilter}
        // O MENU DE AÇÃO de sempre: Disparada, Esquivar, Preparar, Levantar e
        // Estabilizar continuam existindo (nada foi removido da dock).
        actionMenu={
          <ActionMenu
            compact
            disabled={busy || !dockAccess.canOpenMenu}
            actionsDisabled={busy || !dockAccess.canUseAction}
            onSelect={(action, extra) => dockEconomyAction({ action, ...extra })}
            standUp={standUpContext}
            onStandUp={standUp}
            stabilizeTargets={stabilizeTargets}
            onStabilize={(targetCombatantId) =>
              dockEconomyAction({ action: 'stabilize', ...{ targetCombatantId } })
            }
            busy={busy}
          />
        }
        hotbar={
          dockWaiting ? (
            <BattleWaitingInline name={current?.name ?? ''} />
          ) : hotbarEntries.length > 0 || hotbarFilter || hotbarLayout || hotbarEditing ? (
            // COM FILTRO a Hotbar é montada mesmo sem NENHUMA entrada base: a
            // categoria vazia é resposta honesta (oito slots + frase curta +
            // "ver todas"), nunca o aviso legado de "sem ataques".
            <CombatHotbar
              slots={hotbarSlots}
              // Antes da iniciativa os slots são APRESENTAÇÃO: `busy` os desabilita
              // (o miolo ainda recebe véu/desfoque e fica `inert` na dock).
              busy={busy || awaitingInitiative || dockDeathBlocked}
              // Economia do PRÓPRIO turno (vem do servidor): só escurece o que já
              // gastou Ação/Bônus/Reação. Nenhuma cobrança acontece aqui.
              economy={ownTurn && !dockDeathBlocked ? dockEconomy : null}
              filter={hotbarFilter}
              selectedId={hotbarPick ? `attack:${hotbarPick.attackId}` : null}
              // Clique TOGGLE (6.6M.6.2.2): o mesmo slot que abre o painel o
              // fecha — sem segundo estado de seleção e sem tocar em nada já
              // enviado ao servidor (a identidade é o `sourceId` do fluxo).
              onSelect={(entry) => {
                if (entry.sourceId === 'context:opportunity') { document.querySelector<HTMLElement>('.reaction-panel')?.focus(); return; }
                setHotbarPick((prev) => toggleHotbarPick(prev, entry.sourceId));
              }}
              // EDITOR (6.6M.6.3.1): o gesto de abrir vive na dock, ao lado do
              // retrato; aqui só existe o editor já aberto.
              editing={hotbarEditing}
              draftSlots={hotbarDraftSlots}
              choices={hotbarEntries}
              // ATENÇÃO ao índice: a Hotbar mostra posições de 1 a 48, mas o
              // rascunho é um array — a conversão (posição − 1) acontece AQUI,
              // num único lugar. Sem ela, remover a posição 3 apagaria a 4.
              onAssign={(position, ref) =>
                setHotbarDraft((draft) =>
                  draft ? assignHotbarRef(draft, position - 1, ref) : draft,
                )
              }
              onMove={(from, to) =>
                setHotbarDraft((draft) =>
                  draft ? moveHotbarRef(draft, from - 1, to - 1) : draft,
                )
              }
              onRemove={(position) =>
                setHotbarDraft((draft) =>
                  draft ? clearHotbarRef(draft, position - 1) : draft,
                )
              }
              saving={hotbarSaving}
              error={hotbarError}
              extraEntries={hotbarExtraEntries}
            />
          ) : (
            <p className="dock-empty">
              Nenhum ataque disponível — equipe uma arma na mochila.
            </p>
          )
        }
        utilities={
          <>
            {onOpenSection
              ? COMBAT_SHORTCUTS.map((shortcut) => {
                  const isOpen = shortcut.key === openSection;
                  return (
                    <button
                      key={shortcut.key}
                      type="button"
                      className={isOpen ? 'dock-utility active' : 'dock-utility'}
                      aria-expanded={isOpen}
                      title={shortcut.label}
                      onClick={() => onOpenSection(shortcut.key)}
                    >
                      <Icon name={shortcut.icon} size={14} />
                      <span className="dock-utility-label">{shortcut.label}</span>
                    </button>
                  );
                })
              : null}
            {onOpenSheet ? (
              <button
                type="button"
                className="dock-utility"
                title="Ficha completa"
                onClick={onOpenSheet}
              >
                <Icon name="quill" size={14} />
                <span className="dock-utility-label">Ficha</span>
              </button>
            ) : null}
            {/* O botão continua no lugar (geometria do v4) e fica DESABILITADO
                na espera: fora do turno o jogador não encerra turno nenhum e o
                servidor recusaria de qualquer forma. */}
            <button
              type="button"
              className="end-turn dock-end-turn"
              // `dockDeathBlocked` (Hotbar inerte no ciclo de morte) NÃO entra
              // aqui: bloquear Ação/Ataque/Movimento é uma coisa, encerrar o
              // próprio turno é outra — o servidor valida (`DEATH_SAVE_PENDING`,
              // `TURN_END_TRIGGER_PENDING`, ...).
              disabled={endTurnGate.disabled}
              onClick={() => void endTurn()}
              aria-label={endTurnGate.reason ?? 'Encerrar turno'}
              title={endTurnGate.reason ?? undefined}
            >
              <span className="end-turn-text">Encerrar turno</span>
              <span className="end-turn-arrow" aria-hidden="true">
                <svg viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 6h13" />
                  <path d="M9.5 1.5 15 6l-5.5 4.5" />
                </svg>
              </span>
            </button>
          </>
        }
        movement={{
          remaining: dockAccess.remaining,
          budget: dockEconomy.movementBudget,
        }}
        // ESTADO DO PERSONAGEM no retrato (6.6M.6.1.4): o MESMO MechanicalPanel,
        // sem buscar nada de novo — a dock só apresenta.
        statusPanel={statusPanel}
        // SALVAGUARDA PENDENTE (6.5H/6.6H) FORA do retrato: o jogador resolve
        // sem abrir o painel e existe UMA instância do formulário.
        urgent={
          <PendingEffectSavePanel
            entity={{ kind: 'combatant', id: dockCombatant.id }}
            refreshKey={combat.version + effectsRefresh}
            isMaster={false}
            busy={busy}
            onChanged={async () => {
              const fresh = await fetchActiveCombat().catch(() => null);
              if (fresh) onCombatChange(fresh);
            }}
          />
        }
        // O GASTO de deslocamento é o MESMO controle da barra persistente.
        movementControl={
          <MovementSpendButton
            canMove={!busy && dockAccess.canMove}
            onSpend={(distance) => dockEconomyAction({ action: 'move', distance })}
          />
        }
      />
    );
  }

  /**
   * FAIXA DE FERRAMENTAS — atalhos da ficha + "Estado e ajustes".
   *
   * 6.6M.6.1.4: com a dock montada ela NÃO entra no fluxo (nem vazia): o estado
   * do personagem foi para o retrato e os atalhos já estão nos utilitários da
   * dock. Para o Mestre e para o jogador sem dock nada muda.
   */
  const toolsNode = dockCombatant ? undefined : (
    <>
      {/* Atalhos da ficha: linha compacta, sem competir com o ataque.
          Estes NÃO são ferramentas administrativas: continuam aqui para
          os dois papéis, conforme a autoridade de cada um. */}
      {/* Para o jogador os atalhos vivem na DOCK (uma superfície só);
          aqui eles continuam para o Mestre e para os casos sem dock. */}
      {onOpenSection && (isMaster || !dockCombatant) ? (
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
      {!isMaster && actingCombatant ? (
        <details className="combat-status">
          <summary className="combat-status-summary">
            <Icon name="info" size={14} /> Estado e ajustes — {actingCombatant.name}
          </summary>
          {statusPanel}
        </details>
      ) : null}
    </>
  );

  // --- Aguardando iniciativas ------------------------------------------------
  /**
   * PRÉ-INICIATIVA (6.6M.7) — a MESMA dock, a MESMA geometria.
   *
   * O jogador que ainda não rolou deixa de ver a composição herdada: iniciativa,
   * grid, registro e a dock nova convivem desde o primeiro frame. A única
   * diferença é o MIOLO da dock — os slots ficam visivelmente indisponíveis e o
   * CTA de rolagem flutua sobre a Hotbar (nunca como card solto no corpo).
   *
   * Quem já rolou e espera os demais cai na espera normal, sem overlay; o Mestre
   * continua exatamente como estava (a dock e o overlay são só do jogador).
   */
  const inspectedCombatant = isMaster && inspectedToken
    ? combat.combatants.find(item => item.id === inspectedToken.id && !item.missing)
    : null;
  const tokenMenu = addingAt && isMaster ? (
    <CombatTokenMenu name="Adicionar participante" kind="Encontro" subtitle="Reforços para o combate" point={addingAt.point} onClose={closeAddMenu}>
      <CombatReinforcements combat={combat} position={addingAt.position} onError={onError} onAdded={updated => { onCombatChange(updated); setAddingAt(null); }} />
    </CombatTokenMenu>
  ) : inspectedToken && inspectedCombatant ? (
    <CombatTokenMenu key={inspectedCombatant.id} name={inspectedCombatant.name}
      kind={inspectedCombatant.kind === 'CHARACTER' ? 'Personagem' : inspectedCombatant.kind === 'NPC' ? 'NPC' : 'Criatura'}
      point={inspectedToken.point} onClose={closeTokenMenu}>
      <CombatTokenAdjustments combat={combat} combatant={inspectedCombatant} busy={busy}
        effectsRefresh={effectsRefresh} onRun={action => void run(action)} />
    </CombatTokenMenu>
  ) : null;

  // Disponível desde a preparação; a autorização continua no servidor.
  const endCombatControl = isMaster ? (
    <>
    <button type="button" className="btn btn-small" disabled={busy} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setAddingAt({ position: null, point: {x:rect.left,y:rect.bottom} }); }}>Adicionar participante</button>
    <button
      type="button"
      className="btn btn-small combat-end-button"
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
      <Icon name="sword" size={13} /> Encerrar combate
    </button>
    </>
  ) : null;

  if (combat.status === 'PENDING_INITIATIVE') {
    return (
      <section className="combat-panel">
        <CombatIntro combatId={combat.id} />
        {tokenMenu}

        <CombatWorkspace
          isMaster={isMaster}
          turnKey={`${combat.id}:${combat.round}:${currentId}`}
          header={
            <>
              <div className="combat-workspace-title">
                <h2>
                  <Icon name="sword" size={18} /> Combate — iniciativa
                </h2>
              </div>
              <span className="combat-round">
                {rolledCount}/{combat.combatants.length} rolaram
              </span>
              <CombatTurnPanel
                variant="compact"
                combatant={null}
                round={combat.round}
                isMyTurn={false}
                empty={<span className="empty-hint">A ordem nasce quando todos rolarem.</span>}
              />
              {isMaster ? <div className="combat-actions">{endCombatControl}</div> : null}
            </>
          }
          initiative={
            <InitiativeTimeline
              combat={combat}
              isMaster={isMaster}
              busy={busy}
              ownCombatantId={myCombatant?.id}
              onRollFor={(combatantId) => void run(() =>
                isMaster ? rollInitiativeFor(combatantId) : rollMyInitiative(),
              )}
              onAnticipate={isMaster ? (combatantId) => {
                if (window.confirm('Encerrar o turno atual e conceder um turno extra a este reforço?')) {
                  void run(() => nextTurn(combat, { extraCombatantId: combatantId }));
                }
              } : undefined}
            />
          }
          scene={
            /* 6.6M.1 — cena espacial também na preparação (placement é setup). */
            <CombatGrid
              combat={combat}
              onInspectToken={isMaster ? inspectToken : undefined}
              onEmptyContext={isMaster ? openAddMenu : undefined}
              isMaster={isMaster}
              busy={busy}
              relationReferenceId={isMaster ? currentId : myCombatant?.id}
              movement={movementAuthority}
              onCombatChange={onCombatChange}
              onError={onError}
            />
          }
          log={
            <CombatLog
              log={log}
              economyLog={[...combat.economyLog, ...combat.combatants.flatMap(item => item.mechanicalState.log)]}
              requests={logRequests}
              resolutionBusyId={resolutionBusyId}
              onRollSpellSave={(card, selected, visibility) =>
                void rollSpellSave(card, selected, visibility)
              }
              onDeclineSpellSave={(card) => void declineResolution(card)}
              onRollDeathSave={(card) => void rollDeathSaveCard(card)}
            />
          }
          action={
            /* O CTA do jogador saiu do corpo da tela: ele flutua sobre a Hotbar
               da dock. Sem ele aqui a tray nem é montada e o grid herda a altura. */
            !isMaster && awaitingInitiative ? null : (
              <div className="combat-block">
                <p className="empty-hint">
                  {!isMaster && myCombatant?.rolled
                    ? `Você rolou ${myCombatant.initiative} de iniciativa. Aguardando os demais...`
                    : !isMaster && !myCombatant
                      ? 'Você não participa deste combate.'
                      : 'A ordem é montada automaticamente assim que todos tiverem rolado.'}
                </p>
              </div>
            )
          }
          masterTools={isMaster ? <MasterSpellIntentsPanel /> : undefined}
          masterToolsLabel="Conjurações"
          tools={
            isMaster ? (
              <p className="section-note">
                Role pelas criaturas e por quem estiver ausente. A ordem é montada
                automaticamente assim que todos tiverem rolado.
              </p>
            ) : undefined
          }
          dock={dockNode}
          resourceBar={
            /* Com a dock montada ela é a superfície do jogador nesta fase; a
               barra persistente continua só para o Mestre. */
            dockCombatant ? undefined : <TurnResourceBar active={false} isMaster={isMaster} />
          }
        />
      </section>
    );
  }

  // --- Combate ativo ----------------------------------------------------------
  return (
    <section className="combat-panel">
      <CombatIntro combatId={combat.id} />
        {tokenMenu}

      {/* Toast central (2 s, sem clique, sem bloquear a interface). */}
      <TurnToast alert={turnAlert} />


      <CombatWorkspace
        isMaster={isMaster}
        turnKey={`${combat.id}:${combat.round}:${currentId}`}
        header={
          <>
            <div className="combat-workspace-title">
              <h2>
                <Icon name="sword" size={18} /> Combate
              </h2>
              <span className="combat-round">Rodada {combat.round}</span>
            </div>

            {/* Contexto do turno em UMA linha, no cabeçalho do workspace. */}
            <CombatTurnPanel
              variant="compact"
              combatant={current}
              round={combat.round}
              isMyTurn={isMyTurn}
            />

            {isMaster ? (
              <div className="combat-actions">
                {current?.kind === 'CHARACTER' ? <button type="button" className="btn btn-small combat-assume-turn"
                  disabled={busy} aria-pressed={Boolean(assumedCharacter)}
                  onClick={() => {
                    setMasterAssumed(assumedCharacter ? null : currentControlKey);
                    setMasterPick({turnId: currentId, combatantId: currentId});
                  }}><Icon name="crown" size={13} /> {assumedCharacter ? `Encerrar controle de ${current.name}` : `Assumir o turno de ${current.name}`}</button> : null}
                <button
                  type="button"
                  className="btn btn-primary btn-small combat-next-turn"
                  disabled={busy}
                  onClick={() => void endTurn()}
                >
                  Próximo turno →
                </button>
                {endCombatControl}
              </div>
            ) : null}
          </>
        }
        initiative={
          <InitiativeTimeline
            combat={combat}
            isMaster={isMaster}
            busy={busy}
            ownCombatantId={myCombatant?.id}
              onRollFor={(combatantId) => void run(() =>
                isMaster ? rollInitiativeFor(combatantId) : rollMyInitiative(),
              )}
              onAnticipate={isMaster ? (combatantId) => {
                if (window.confirm('Encerrar o turno atual e conceder um turno extra a este reforço?')) {
                  void run(() => nextTurn(combat, { extraCombatantId: combatantId }));
                }
              } : undefined}
          />
        }
        scene={
          <CombatGrid
            combat={combat}
            onInspectToken={isMaster ? inspectToken : undefined}
            onEmptyContext={isMaster ? openAddMenu : undefined}
            isMaster={isMaster}
            busy={busy}
            relationReferenceId={isMaster ? currentId : myCombatant?.id}
            movement={movementAuthority}
            targeting={
              gridTargetingActive
                ? {
                    active: true,
                    targetableIds: gridTargetIds,
                    selectedTargetId: gridTargetId,
                    // Clique no token: escolhe o alvo e ABRE o menu. No alvo que
                    // já tem modo escolhido o clique REABRE para trocar — o modo
                    // guardado só cai quando a mira muda de alvo.
                    onPickTarget: (combatantId) => {
                      setTargetCombatantId(combatantId);
                      setAttackRoll((previous) => ({
                        targetId: combatantId,
                        mode:
                          previous && previous.targetId === combatantId ? previous.mode : null,
                        menuOpen: true,
                      }));
                    },
                    onClearTarget: () => {
                      setTargetCombatantId(null);
                      setAttackRoll(null);
                    },
                    // Duplo clique: escolhe o alvo e pede UM envio ao painel,
                    // com o modo que foi escolhido no menu (se houve).
                    onExecuteTarget: (combatantId) => {
                      setTargetCombatantId(combatantId);
                      const chosen =
                        attackRoll && attackRoll.targetId === combatantId
                          ? attackRoll.mode
                          : null;
                      // Confirmou: o menu fecha e o modo escolhido continua
                      // guardado para o próximo ataque neste alvo.
                      setAttackRoll((previous) =>
                        previous && previous.targetId === combatantId
                          ? { ...previous, menuOpen: false }
                          : previous,
                      );
                      setAttackConfirm((previous) => ({
                        nonce: (previous?.nonce ?? 0) + 1,
                        ...(chosen ? { mode: chosen } : {}),
                      }));
                    },
                    // Menu do token: só GUARDA o modo escolhido. Nada é enviado
                    // — o menu some, a espada ganha o glifo e o duplo clique
                    // no token do alvo é quem confirma o ataque.
                    onChooseRollMode: (combatantId: string, mode: CombatRollMode) => {
                      setTargetCombatantId(combatantId);
                      setAttackRoll({ targetId: combatantId, mode, menuOpen: false });
                    },
                    rollMode: gridRollMode,
                    rollMenuOpen: gridRollMenuOpen,
                    executeReady: attackExecuteReady,
                    // Esc encerra o fluxo inteiro pelo MESMO caminho de um
                    // ataque executado (um único encerramento, dois gatilhos).
                    onCancelFlow: endAttackFlow,
                  }
                : null
            }
            onCombatChange={onCombatChange}
            onError={onError}
          />
        }
        context={
          hasAssumedPendings || (concentrationEntity && concentrationSaves.length > 0) || reactionOpportunity ? (
            <>

            {/* CONCENTRAÇÃO (PHB 2014): dano em quem está concentrando abre este
                teste. O jogador rola pela bandeja; o Mestre escolhe público ×
                privado por teste de criatura/NPC. */}
            {hasAssumedPendings && assumedCharacter ? <AssumedCharacterPendings character={assumedCharacter}
              cards={assumedRequests} busy={busy || Boolean(resolutionBusyId)}
              onRollDeath={card => void rollDeathSaveCard(card)}
              onRollSpell={(card, selected, visibility) => void rollSpellSave(card, selected, visibility)}
              onDecline={card => void declineResolution(card)}
              onRollConcentration={save => void rollConcentrationForMaster(save, 'public')} /> : null}
            {!assumedCharacter && concentrationEntity && concentrationSaves.length > 0 ? (
              <ConcentrationSavePanel
                name={pendingCombatant?.name ?? ''}
                saves={concentrationSaves}
                isMaster={isMaster}
                canRoll={canRollOwnConcentration}
                busy={busy}
                onRollPlayer={
                  onRollConcentrationSave
                    ? (save) => onRollConcentrationSave(concentrationEntity, save)
                    : undefined
                }
                onRollMaster={(save, visibility) =>
                  void rollConcentrationForMaster(save, visibility)
                }
              />
            ) : null}

            {/* Janela de Reação: SÓ com oportunidade concreta para este usuário. */}
            {reactionOpportunity ? (
              <ReactionPanel
                opportunity={reactionOpportunity}
                reactorName={combat.combatants.find(unit => unit.id === reactionOpportunity.reactorCombatantId)?.name}
                needsVisibility={serverOpportunityOf(reactionOpportunity.id)?.visibilityStatus === 'unknown'}
                onVisibility={visible => {
                  setReactionBusy(true);
                  void adjudicateOpportunityVisibility(combat.id, reactionOpportunity.id, visible, combat.version)
                    .then(result => { onCombatChange(result.combat); if(!visible) closeReaction(reactionOpportunity.id); })
                    .catch(error => onError(error instanceof Error ? error.message : 'Não foi possível confirmar a visão.')).finally(() => setReactionBusy(false));
                }}
                busy={busy || reactionBusy}
                onChoose={(optionId) => {
                  const entry = serverOpportunityOf(reactionOpportunity.id);
                  const option = entry?.options.find((item) => item.id === optionId);
                  if (!entry || !option) {
                    // Janela de extensão local (sem servidor): nada é aplicado.
                    closeReaction(reactionOpportunity.id);
                    onError('Esta janela de Reação não está mais disponível.');
                    return;
                  }
                  resolveServerReaction(entry.id, option.attackId);
                }}
                onDecline={() => {
                  const entry = serverOpportunityOf(reactionOpportunity.id);
                  if (!entry) {
                    closeReaction(reactionOpportunity.id);
                    return;
                  }
                  declineServerReaction(entry.id);
                }}
              />
            ) : null}
            </>
          ) : undefined
        }
        action={
          <>
            {/* Turno em Testes contra a Morte mantém ataques bloqueados. Os
                cards ficam no registro ou no contexto do personagem assumido,
                sempre em uma única superfície para o Mestre. O gate
                permanece para o fluxo de ataque não reaparecer num turno que
                não permite atacar. Para criatura/NPC o ciclo é privado: o DTO
                do jogador não traz `deathState`. */}
            {showDeathTurn ? null : showOperational ? (
              <>
                {/* Mestre: painel de ataques do combatente que ele controla
                    (criatura/NPC do turno ou override explícito). */}
                {isMaster && attacksFor && masterAttackerCombatant ? (
                  <>
                  <CombatActionPanel
                    variant="tactical-tray"
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
                  {masterAttackerCombatant.abilities?.length ? <details className="combat-creature-ability-tray" key={masterAttackerCombatant.id}>
                    <summary>Habilidades especiais ({masterAttackerCombatant.abilities.length})</summary>
                    <CreatureAbilitiesPanel combat={combat} combatant={masterAttackerCombatant} busy={busy} onRun={action => void run(action)} />
                  </details> : null}
                  </>
                ) : null}
              </>
            ) : (
              <>
                {/* Quem NÃO controla o turno: apresentação neutra, sem ataques,
                    bônus, economia, alvos ou Encerrar Turno. */}
                {/* Com a dock em espera a MESMA animação já está na Hotbar:
                    um único painel de espera para o jogador (o Mestre segue
                    com o dele) e nada de duas superfícies concorrentes. */}
                {current && (isMaster || !dockCombatant) ? (
                  <BattleWaitingPanel
                    name={current.name}
                    kind={current.kind}
                    isMaster={isMaster}
                  />
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
                      variant="tactical-tray"
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
          </>
        }
        masterTools={isMaster ? <MasterSpellIntentsPanel /> : undefined}
        masterToolsLabel="Conjurações"
        masterInventory={
          <>
            {/*
              INVENTÁRIO DO NPC — MESMO painel flutuante da ficha do jogador.
              O Mestre abre o inventário do NPC do turno e usa por duplo clique
              ou "Usar em..."; o servidor continua validando turno/Ação.
            */}
            {isMaster && showOperational && npcInventory && npcInventoryCreature?.kind === 'NPC' ? (
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
          </>
        }
        tools={toolsNode}
        log={
          <CombatLog
            log={log}
            economyLog={[...combat.economyLog, ...combat.combatants.flatMap(item => item.mechanicalState.log)]}
            requests={logRequests}
            resolutionBusyId={resolutionBusyId}
            onRollSpellSave={(card, selected, visibility) =>
              void rollSpellSave(card, selected, visibility)
            }
            onDeclineSpellSave={(card) => void declineResolution(card)}
            onRollDeathSave={(card) => void rollDeathSaveCard(card)}
          />
        }
        dock={dockNode}
        resourceBar={
          // A barra persistente legada é do MESTRE. Para o JOGADOR ela dá lugar
          // à dock em TODOS os estados — inclusive no ciclo de morte (6.6M.8):
          // nunca as duas juntas.
          showOperational && actingCombatant && isMaster ? (
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

      {/*
        MOTOR DO FLUXO DE ATAQUE DO JOGADOR (`headless`) — o GRID é a
        superfície: alvo no token, modo de rolagem no menu do token e execução
        no duplo clique. A faixa de ataque abaixo do mapa não existe mais.

        O painel continua MONTADO (e de propósito FORA do workspace: montado
        aqui ele não ocupa a faixa operacional) porque ele é o dono do
        `attackId` vindo da Hotbar, do `confirm` do token e do envio —
        `onReadyChange` e o payload continuam exatamente os mesmos. Com ele
        `null` o grid não teria o que executar.
      */}
      {!isMaster && myCombatant && hotbarPick ? (
        <CombatActionPanel
          variant="headless"
          combat={combat}
          attacker={myCombatant}
          attacks={characterAttacks}
          inventory={characterInventory}
          sneakAttack={sneakAttackExpression}
          preset={hotbarPick}
          // ALVO COMPARTILHADO: o clique no token escreve no MESMO estado do
          // tracker (nunca um segundo alvo).
          targetCombatantId={gridTargetId}
          onTargetChange={setTargetCombatantId}
          confirm={attackConfirm}
          onReadyChange={setAttackExecuteReady}
          busy={busy}
          onAttack={attack}
        />
      ) : null}

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
