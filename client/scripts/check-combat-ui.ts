/**
 * Verificação do REFINO DA UI DE COMBATE (compactação, interatividade e padrão
 * visual). O projeto NÃO tem framework de teste de componentes e não há
 * navegador neste ambiente; então combinamos:
 *
 *   1. Renderização server-side (`react-dom/server`) de `ConditionBadges`, que
 *      é um módulo de apresentação PURO (sem contexto) — cobre as etiquetas,
 *      tooltip e cor semântica;
 *   2. Checagens estáticas nos arquivos-fonte, para garantir que o centro do
 *      combate não reintroduza painéis removidos (Conditions, resultado do
 *      ataque, economia duplicada) e que a barra persistente é quem hospeda as
 *      ações/movimento.
 *
 * Sai com código 1 se qualquer item falhar. Rode com `npm run test:combat-ui`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConditionBadges } from '../src/combat/components/ConditionBadges';
import { CombatStateBadges } from '../src/combat/components/CombatStateBadges';
import { DeathCounter } from '../src/death/DeathCounter';
import { DeathSavePanel } from '../src/combat/components/DeathSavePanel';
import { BattleWaitingPanel } from '../src/combat/components/BattleWaitingPanel';
import { ReactionPanel } from '../src/combat/components/ReactionPanel';
import { TurnToast } from '../src/combat/components/TurnToast';
import { reactionOpportunitiesForViewer, type ReactionOpportunity } from '../src/combat/reactions';
import { currentUserControlsCombatant, movementAuthorityOf } from '../src/combat/turnControl';
import { GridMovementOverlay } from '../src/combat/grid/GridMovementOverlay';
import { GridMovementTrace } from '../src/combat/grid/GridMovementTrace';
import { MovementHud } from '../src/combat/grid/MovementHud';
import { GridRuler } from '../src/combat/grid/GridRuler';
import { anchorStepFeet, contiguousAnchors } from '../src/combat/grid/movementPath';
import { CombatGrid } from '../src/combat/grid/CombatGrid';
import {
  MOVEMENT_STEP_MS,
  movementPointAt,
  planMovementVisual,
} from '../src/combat/grid/movementVisual';
import {
  IDENTITY_CAMERA,
  cameraIsUsable,
  centerCamera,
  clampCamera,
  feetToScenePixel,
  fitCamera,
  autoPanCameraDelta,
  panBy,
  revealIntentAt,
  sceneToScreen,
  screenToFeet,
  screenToScene,
  zoomAt,
  type GridCamera,
} from '../src/combat/grid/gridCamera';
import { gridPhaseOf } from '../src/combat/grid/gridLifecycle';
import { rulerEndpointKey, rulerLabelText, rulerMidpoint } from '../src/combat/grid/gridRuler';
import { distanceLabel, formatFeet, formatMeters, rangeSummary } from '../src/combat/grid/distanceFormat';
import { GridToken, type GridUnit } from '../src/combat/grid/GridToken';
import { Icon } from '../src/components/Icon';
import { UnplacedCombatantsTray } from '../src/combat/grid/UnplacedCombatantsTray';
import {
  SIZE_FOOTPRINT_FEET,
  centeredFootprintFeet,
  containingCellFeet,
  feetToPx,
  pixelToPlacementFeet,
  scenePixels,
  splitByPlacement,
  tokenArtSize,
} from '../src/combat/grid/gridMath';
import type { CombatantSpatial, SpatialScene, SpatialSize } from '../src/types';
import {
  COMBAT_STATE_VISUALS,
  CONDITION_VISUALS,
  ECONOMY_ACTION_VISUALS,
  combatStatesOf,
  conditionDamageFamily,
  conditionDescription,
} from '../src/combat/combatVisuals';
import type {
  CombatantDto,
  ConditionEffects,
  DeathState,
  MechanicalState,
  MovementPathReading,
  SessionUser,
} from '../src/types';

/** Fixture do ciclo de morte usada nas verificações de UI. */
function deathOf(patch: Partial<DeathState> = {}): DeathState {
  return {
    successes: 0,
    failures: 0,
    stabilized: false,
    dead: false,
    deathSaves: false,
    pending: null,
    relentless: null,
    saveTurnKey: null,
    log: [],
    ...patch,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string =>
  readFileSync(resolve(here, '..', relative), 'utf8');

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) failures += 1;
  console.log(
    `  ${condition ? '✔' : '✘'} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
}

/** Efeitos mínimos usados pelas etiquetas (só apresentação). */
function effectsOf(labels: Record<string, string>, extra: Partial<ConditionEffects> = {}): ConditionEffects {
  return {
    exhaustionEnabled: true,
    exhaustionSummary: [],
    assistedNotes: [],
    labels,
    active: Object.keys(labels),
    canAct: true,
    canReact: true,
    canBonusAct: true,
    incapacitated: false,
    prone: false,
    speedZero: false,
    poisonSuspended: false,
    fatalByExhaustion: false,
    fearRequiresLineOfSight: false,
    proximityCritical: false,
    proneTargetRequiresDistance: false,
    sightChecksAutoFail: false,
    hearingChecksAutoFail: false,
    dropsHeldObjects: false,
    ...extra,
  };
}

function stateOf(conditions: string[], exhaustionLevel = 0): MechanicalState {
  return {
    conditions: conditions.map((condition, index) => ({
      id: `c${index}`,
      condition,
      sourceLabel: 'Teste',
      appliedAt: '2026-10-12T00:00:00.000Z',
    })),
    exhaustionLevel,
    log: [],
  };
}

const LABELS: Record<string, string> = {
  blinded: 'Cego',
  charmed: 'Enfeitiçado',
  deafened: 'Surdo',
  frightened: 'Amedrontado',
  grappled: 'Agarrado',
  incapacitated: 'Incapacitado',
  invisible: 'Invisível',
  paralyzed: 'Paralisado',
  petrified: 'Petrificado',
  poisoned: 'Envenenado',
  prone: 'Caído',
  restrained: 'Contido',
  stunned: 'Atordoado',
  unconscious: 'Inconsciente',
};

console.log('Check-combat-ui — refino da UI de combate');

// --- A. A condição aparece associada (o card recebe o estado do combatente) --
{
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  check('A) etiqueta da condição aparece com o nome vindo do servidor', markup.includes('Envenenado'));
}

// --- B. O tooltip usa a descrição PHB 2014 da condição ----------------------
{
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  const description = conditionDescription('poisoned');
  check('B) hover na etiqueta mostra a descrição correspondente', markup.includes(description), description);
  check('B) etiqueta não exige ícone "i"', !markup.includes('info-tip-icon'));
}

// --- C. Poisoned usa a família visual de Poison -----------------------------
{
  check('C) Envenenado referencia a família de dano Veneno', conditionDamageFamily('poisoned') === 'poison');
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  check('C) chip carrega data-condition e data-damage-family', markup.includes('data-condition="poisoned"') && markup.includes('data-damage-family="poison"'));
}

// --- D. Condição sem relação com dano recebe cor própria --------------------
{
  check('D) Caído não força família de dano', conditionDamageFamily('prone') === null);
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['prone']), effects: effectsOf(LABELS) }),
  );
  check('D) chip de Caído tem data-condition e NENHUMA família de dano', markup.includes('data-condition="prone"') && !markup.includes('data-damage-family'));
}

// --- Overflow: muitas condições resumem em "+N" -----------------------------
{
  const markup = renderToStaticMarkup(
    ConditionBadges({
      state: stateOf(['poisoned', 'prone', 'stunned', 'blinded', 'restrained', 'frightened']),
      effects: effectsOf(LABELS),
    }),
  );
  check('Condições: 6 viram 4 etiquetas + "+2"', markup.includes('+2'));
}

// --- E–H. A barra persistente hospeda Ação e Deslocamento -------------------
{
  const bar = source('src/combat/components/TurnResourceBar.tsx');
  const tracker = source('src/combat/CombatTracker.tsx');
  check('E) barra persistente renderiza o menu de Ação', bar.includes('<ActionMenu'));
  check('F) menu lista as ações suportadas', ['dash', 'disengage', 'dodge', 'hide', 'ready'].every((id) => ECONOMY_ACTION_VISUALS.some((item) => item.id === id)));
  check('G) deslocamento tem popover inline', bar.includes('move-popover'));
  check('H) gasto de movimento envia a distância ao mecanismo existente', bar.includes("action: 'move'") && bar.includes('onSpend') && tracker.includes('executeEconomyAction'));
}

// --- I–L. O centro não duplica o que já tem lugar próprio -------------------
{
  const tracker = source('src/combat/CombatTracker.tsx');
  check('I) resultado do ataque não é mais exibido no centro', !tracker.includes('AttackResultPanel'));
  check('J) o Registro continua recebendo o ataque resolvido', source('src/combat/useCombatState.ts').includes('onAttackResolved') && source('src/combat/components/CombatLog.tsx').includes("entry.kind === 'result'"));
  check('K) sem painel separado de Conditions no centro (etiquetas vivem no card)', !tracker.includes('ConditionBadges') && tracker.includes('combat-status'));
  check('L) sem painel duplicado de Action Economy no centro', !tracker.includes('EconomyControls'));
}

// --- Coerência do source of truth visual ------------------------------------
{
  check('Toda condição do PHB 2014 tem descrição', Object.keys(LABELS).every((id) => (CONDITION_VISUALS[id]?.description ?? '').length > 0));
  check('Só Envenenado compartilha família com tipo de dano', Object.entries(CONDITION_VISUALS).filter(([, value]) => value.damageFamily).map(([id]) => id).join(',') === 'poisoned');
}

// --- Fase 6.3: Testes contra a Morte no combate (UI) ------------------------
{
  // AB. Contador usa corações (sucessos) e caveiras (falhas), com tooltip.
  const counter = renderToStaticMarkup(
    createElement(DeathCounter, { successes: 2, failures: 1, showNumbers: true }),
  );
  check('AB) contador tem sucessos (corações) e falhas (caveiras)', counter.includes('Sucessos: 2 de 3') && counter.includes('Falhas: 1 de 3') && counter.includes('death-pips-success') && counter.includes('death-pips-failure'));

  // AB2. Acessibilidade: contagem em texto (não só cor) e o MESMO ícone preenchido.
  check(
    'AB2) contador expõe aria-label/title "N de 3" e preenche o próprio ícone',
    counter.includes('aria-label="Sucessos: 2 de 3"') &&
      counter.includes('title="Falhas: 1 de 3"') &&
      (counter.match(/death-pip filled/g) ?? []).length === 3 &&
      (counter.match(/death-pip"/g) ?? []).length === 3 &&
      !counter.includes('background'),
    counter.match(/death-pip[^"]*/g)?.slice(0, 6),
  );

  // AB3. CSS: coração verde / caveira cinza, SEM quadrado (nada de background).
  {
    const css = source('src/styles.css');
    const filledHeart = /(^|\n)\.death-pips-success \.death-pip\.filled\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const filledSkull = /(^|\n)\.death-pips-failure \.death-pip\.filled\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const filledIcon = /\.death-pip\.filled \.icon\s*\{[^}]*fill:\s*currentColor/.test(css);
    check(
      'AB3) sucesso preenche o coração de VERDE e falha preenche a caveira de CINZA (sem background/quadrado)',
      filledIcon &&
        filledHeart.includes('var(--ok)') &&
        !filledHeart.includes('background') &&
        /#[0-9a-f]{6}/i.test(filledSkull) &&
        !filledSkull.includes('background') &&
        !/\.death-pip[^{]*\{[^}]*background:\s*var\(--(ok|danger)\)/.test(css),
      { filledHeart, filledSkull, filledIcon },
    );
  }

  // AB4. Menu de Ação: LEVANTAR-SE/ESTABILIZAR só existem com contexto.
  {
    const menu = source('src/combat/components/ActionMenu.tsx');
    check(
      'AB4) menu contextual: Levantar-se só quando Caído e Estabilizar só com alvo elegível',
      menu.includes('canStand') &&
        menu.includes('stabilizeTargets.length > 0') &&
        menu.includes('canStand ?') &&
        menu.includes('canStabilize ?') &&
        menu.includes('metade do deslocamento') &&
        menu.includes('Custo: 1 Ação') &&
        menu.includes('alcance físico'),
    );
  }

  // AB5. Encerrar turno: bloqueio + confirmação do Mestre.
  {
    const bar = source('src/combat/components/TurnResourceBar.tsx');
    check(
      'AB5) Encerrar turno bloqueia sem o Teste Contra a Morte e avisa o motivo',
      bar.includes('deathSavePending') &&
        bar.includes('Você precisa realizar seu Teste Contra a Morte antes de encerrar o turno.'),
    );
  }

  // AB6. Registro lateral reconhece Teste contra a Morte / estabilização.
  {
    const log = source('src/combat/components/CombatLog.tsx');
    check(
      'AB6) Registro rotula Teste contra a Morte e estabilização (persistidos)',
      log.includes("action === 'death-save'") &&
        log.includes('Teste contra a Morte') &&
        log.includes("action === 'stabilize'"),
    );
  }

  // AB7. "Deixar estabilizado" no modal do Mestre.
  check(
    'AB7) modal do Mestre oferece "Deixar estabilizado"',
    source('src/death/DeathResolutionModal.tsx').includes("decide('leave-stabilized')"),
  );

  // AB8. Bandeja do Teste contra a Morte fecha em 3 s e interação cancela.
  {
    const roller = source('src/dice/useDiceRoller.ts');
    const dock = source('src/dice/DiceDock.tsx');
    check(
      'AB8) bandeja do Teste contra a Morte fecha 3 s após o resultado; interação cancela',
      roller.includes('DEATH_SAVE_AUTO_CLOSE_MS = 3000') &&
        roller.includes("phase !== 'settled'") &&
        roller.includes("context?.kind !== 'death-save'") &&
        roller.includes('cancelAutoClose') &&
        dock.includes('onPointerDown={cancelAutoClose}') &&
        dock.includes('onMouseEnter={cancelAutoClose}'),
    );
  }

  // AC. O card da iniciativa mostra o estado de morte.
  const card = source('src/combat/components/CombatantCard.tsx');
  check('AC) card da iniciativa renderiza o contador/estado de morte', card.includes("from '../../death/DeathCounter'") && card.includes('<DeathCounter') && card.includes('death-status'));

  // AD. O painel central substitui o fluxo normal no turno.
  const tracker = source('src/combat/CombatTracker.tsx');
  const savesPanel = renderToStaticMarkup(
    createElement(DeathSavePanel, {
      name: 'TESTE-DRACONATO',
      death: deathOf({ deathSaves: true, successes: 1 }),
    }),
  );
  check(
    'AD) painel central de morte substitui o fluxo de ataque e NÃO tem botão de rolagem',
    tracker.includes('<DeathSavePanel') &&
      !savesPanel.includes('Escolha o ataque') &&
      savesPanel.includes('Teste contra a Morte') &&
      !savesPanel.includes('<button'),
  );

  // AE. Pending mostra a mensagem apropriada (sem botões de decisão).
  const pending = renderToStaticMarkup(
    createElement(DeathSavePanel, {
      name: 'Umbrae',
      death: deathOf({ pending: { id: 'p', kind: 'failures', reason: '', createdAt: '', cause: null } }),
    }),
  );
  check('AE) pendente mostra "mãos do Mestre" e não oferece rolagem', pending.includes('mãos do Mestre') && !pending.includes('Rolar Teste contra a Morte'));

  // AF. Estabilizado mostra o estado; AG. Morto mostra o estado.
  const stabilized = renderToStaticMarkup(
    createElement(DeathSavePanel, { name: 'Razzil', death: deathOf({ stabilized: true, successes: 3 }) }),
  );
  const dead = renderToStaticMarkup(
    createElement(DeathSavePanel, { name: 'Razzil', death: deathOf({ dead: true, failures: 3 }) }),
  );
  check('AF) estabilizado é mostrado', stabilized.includes('ESTABILIZADO') && !stabilized.includes('death-turn-roll'));
  check('AG) morto é mostrado', dead.includes('MORTO'));

  // AH. Economia bloqueada no ciclo de morte.
  check('AH) barra persistente fica bloqueada em death state', source('src/combat/components/TurnResourceBar.tsx').includes('death-blocked') && tracker.includes('deathBlocked'));

  // Privacidade: o DTO do jogador zera o ciclo de morte de criaturas.
  check('AI) DTO esconde deathState de criatura do jogador', source('../src/modules/combat/combat.dto.ts').includes('deathState: null'));

  // Bindings: o jogador rola pelo dice tray e o Mestre abre o modal do pendente.
  check('AJ) SheetPage liga o dice tray ao CombatTracker', source('src/pages/SheetPage.tsx').includes('onRollDeathSave') && source('src/pages/SheetPage.tsx').includes("kind: 'death-save'"));
  check('AK) MasterPanel abre a resolução ao surgir pendente', source('src/pages/MasterPanel.tsx').includes('if (entry.pending) return entry;'));
}

// ============================================================================
// HOTFIX DE TURNO — auto-seleção, privacidade da interface, toast, NPC, busca
// e arquitetura de Reaction Window. Nada aqui exige navegador.
// ============================================================================
{
  const tracker = source('src/combat/CombatTracker.tsx');
  const control = source('src/combat/turnControl.ts');
  const state = source('src/combat/useCombatState.ts');
  const service = source('../src/modules/combat/combat.service.ts');
  const turnOrder = source('../src/modules/combat/turn-order.ts');
  const dto = source('../src/modules/combat/combat.dto.ts');
  const dialog = source('src/combat/CombatStartDialog.tsx');
  const bar = source('src/combat/components/TurnResourceBar.tsx');
  // `here` = client/scripts; a raiz do repositório está dois níveis acima.
  const root = (relative: string): string => readFileSync(resolve(here, '..', '..', relative), 'utf8');

  const master = { id: 'master-1', role: 'MASTER' } as unknown as SessionUser;
  const playerB = { id: 'player-b', role: 'PLAYER' } as unknown as SessionUser;
  const creature = { kind: 'CREATURE', ownerUserId: null } as unknown as CombatantDto;
  const npc = { kind: 'NPC', ownerUserId: null } as unknown as CombatantDto;
  const playerA = { kind: 'CHARACTER', ownerUserId: 'player-a' } as unknown as CombatantDto;

  // WA/WB. currentUserControlsCombatant é a derivação ÚNICA.
  check(
    'WA) Mestre controla criatura/NPC, mas NÃO o personagem de jogador',
    currentUserControlsCombatant(creature, master) &&
      currentUserControlsCombatant(npc, master) &&
      !currentUserControlsCombatant(playerA, master),
  );
  check(
    'WB) Jogador controla só o próprio combatente',
    currentUserControlsCombatant(playerA, playerB) === false &&
      currentUserControlsCombatant(
        { kind: 'CHARACTER', ownerUserId: 'player-b' } as unknown as CombatantDto,
        playerB,
      ) === true,
  );
  check(
    'WB2) auto-seleção do Mestre é derivada do turno e o override morre na virada',
    control.includes('actingCombatantFor') &&
      tracker.includes('masterPick') &&
      tracker.includes('masterPick.turnId === currentId') &&
      tracker.includes('turnId: currentId') &&
      tracker.includes('masterAttackerId') &&
      // Override do Mestre para o turno de um jogador é EXPLÍCITO e temporário.
      tracker.includes('masterAssumed') &&
      tracker.includes('Assumir o turno de'),
  );

  // WC/WD. Aviso de turno: TELA CHEIA para o jogador, toast curto para o Mestre.
  const playerTurn = renderToStaticMarkup(
    createElement(TurnToast, {
      alert: { title: 'É SEU TURNO!', combatantName: 'Razzil', round: 2, role: 'PLAYER' },
    }),
  );
  const masterTurn = renderToStaticMarkup(
    createElement(TurnToast, {
      alert: { title: 'TURNO DO MESTRE', combatantName: 'Goblin', round: 2, role: 'MASTER' },
    }),
  );
  check(
    'WC) o turno do jogador é uma tomada de TELA CHEIA, como o início da batalha',
    playerTurn.includes('combat-intro') &&
      playerTurn.includes('is-turn') &&
      playerTurn.includes('É SEU TURNO!') &&
      playerTurn.includes('Razzil') &&
      playerTurn.includes('Rodada 2'),
  );
  check(
    'WD) Mestre mantém o toast; 2 s, sem clique e com o chamado de batalha',
    masterTurn.includes('turn-toast') &&
      masterTurn.includes('TURNO DO MESTRE') &&
      state.includes('export const TURN_TOAST_MS = 2000') &&
      state.includes('setTimeout') &&
      state.includes('playTurnHorn()') &&
      source('src/sound.ts').includes('export function playTurnHorn()') &&
      !playerTurn.includes('<button') &&
      !masterTurn.includes('<button') &&
      tracker.includes('<TurnToast') &&
      !tracker.includes('turn-alert'),
  );
  check(
    'WE) audiência: jogador só o próprio turno; Mestre só criatura/NPC',
    state.includes("payload.ownerUserId === userId && payload.kind === 'CHARACTER'") &&
      state.includes("role === 'MASTER' && payload.ownerUserId === null && payload.kind !== 'CHARACTER'") &&
      state.includes("title: ownCharacter ? 'É SEU TURNO!' : 'TURNO DO MESTRE'"),
  );

  // WF/WG. Painel neutro do espectador e gate da interface operacional.
  const waiting = renderToStaticMarkup(
    createElement(BattleWaitingPanel, { name: 'Goblin', kind: 'CREATURE', isMaster: false }),
  );
  check(
    'WF) painel neutro tem espada × escudo, nome do turno e NENHUM controle operacional',
    waiting.includes('battle-waiting') &&
      waiting.includes('battle-waiting-sword') &&
      waiting.includes('battle-waiting-shield') &&
      waiting.includes('Goblin') &&
      !waiting.includes('Atacar') &&
      !waiting.includes('Encerrar turno') &&
      !waiting.includes('Deslocamento'),
  );
  check(
    'WG) tracker só renderiza o painel operacional/barra para quem controla o turno',
    tracker.includes('showOperational = controlsCurrent') &&
      tracker.includes('<BattleWaitingPanel') &&
      tracker.includes('showOperational && actingCombatant') &&
      source('src/styles.css').includes('@keyframes waiting-sword'),
  );

  // WH. Barra persistente some no turno alheio.
  check(
    'WH) turno alheio não renderiza a barra normal nem o Encerrar Turno',
    tracker.includes('showOperational && actingCombatant ? (') &&
      tracker.includes('bottom={') &&
      !tracker.includes('onDismissTurnAlert'),
  );

  // WI–WK. Privacidade de morte no SERVIDOR (não via CSS).
  check(
    'WI) DTO do jogador remove vida/CA/deathState/condições de 0 PV de criatura e NPC',
    dto.includes('hasPrivateMechanicalState(combatant.kind)') &&
      dto.includes('HP_ZERO_SOURCE') &&
      dto.includes('HP_ZERO_PRONE_LABEL') &&
      dto.includes('economyLog: dto.economyLog.filter') &&
      dto.includes('deathState: null') &&
      dto.includes('conditionEffects: deriveConditionEffects(privateState)'),
  );
  check(
    'WJ) entrada da iniciativa PERMANECE (nada é removido do combate ao morrer)',
    !service.includes('combatant.delete') &&
      dto.includes('combatants: dto.combatants.map') &&
      tracker.includes('combat.combatants.map'),
  );
  check(
    'WK) Estabilizar/override de criatura/NPC entram como linha PRIVADA no Registro',
    service.includes('{ private: hasPrivateMechanicalState(targetCombatant.kind) }') &&
      service.includes("{ private: hasPrivateMechanicalState(outgoing.kind) }") &&
      source('../src/modules/death/death.service.ts').includes("private: target.kind !== 'character'"),
  );

  // WL/WM. Skip de mortos e estabilizados, com laço limitado.
  check(
    'WL) turno pula morto e estabilizado a 0 com laço LIMITADO e fallback reportável',
    turnOrder.includes('step < total') &&
      turnOrder.includes('return null;') &&
      service.includes('planNextTurn(') &&
      service.includes('receivesTurn(ordered[position])') &&
      service.includes('autoSkippedAtZero(candidate)') &&
      service.includes("'NO_ELIGIBLE_COMBATANT'") &&
      service.includes('onTurnStartDeath(deathEntityOf(candidate), db)'),
  );
  check(
    'WM) 0 PV com Death Saves ATIVOS NÃO é pulado (a regra pura só conhece `stabilized`)',
    service.includes('death.stabilized && !death.pending') && !turnOrder.includes('deathSaves'),
  );

  // WN–WP. NPC: tipo próprio, unicidade e engine completa.
  check(
    'WN) NPC é tipo PRÓPRIO de combatente (schema + migration)',
    /enum CombatantKind \{[^}]*NPC/s.test(root('prisma/schema.prisma')) &&
      root('prisma/migrations/20261023120000_add_npc_combatant_kind/migration.sql').includes("'NPC'"),
  );
  check(
    'WO) mesmo NPC persistente só entra UMA vez (índice parcial + checagem)',
    root('prisma/migrations/20261023120100_unique_npc_combatant/migration.sql').includes('WHERE "kind" = \'NPC\'') &&
      service.includes('npcSeen.has(creature.id)') &&
      service.includes("entry.quantity !== 1"),
  );
  check(
    'WP) criatura-template mantém múltiplas cópias independentes',
    service.includes("kind: creature.kind === 'NPC' ? ('NPC' as const) : ('CREATURE' as const)") &&
      service.includes('`${creature.name} ${index + 1}`'),
  );
  check(
    'WP2) NPC usa a MESMA engine (HP da instância, iniciativa e ciclo de morte)',
    source('../src/modules/combat/damage-resolution.ts').includes("target.kind === 'CHARACTER'") &&
      source('../src/modules/combat/damage-resolution.ts').includes('creature?.hpMax') &&
      service.includes('deathEntityOf(incoming)'),
  );

  // WQ–WS. Busca + tipo + localidade cumulativos.
  check(
    'WQ) filtros TIPO + LOCALIDADE + NOME são cumulativos',
    dialog.includes("kindFilter !== 'ALL'") &&
      dialog.includes('creature.localities.some') &&
      dialog.includes('nameQuery') &&
      dialog.includes('toLowerCase().includes(term)'),
  );
  check(
    'WR) sem localidade a busca é global e cada resultado mostra nome/tipo/localidade',
    dialog.includes('Sem localidade selecionada, a busca procura entre todas') &&
      dialog.includes("{isNpc ? 'NPC' : 'Criatura'}") &&
      dialog.includes("join(', ')"),
  );
  check(
    'WS) NPC é selecionado uma vez; criatura aceita quantidade',
    dialog.includes("creature.kind === 'NPC' ? 1 : MAX_QUANTITY") &&
      dialog.includes("creature.kind === 'NPC' ? Math.min(1") &&
      dialog.includes('MAX_QUANTITY = 30'),
  );

  // WT–WV. Crossbones (não caveira simples) e sem quadrado.
  const failuresMarkup = renderToStaticMarkup(
    createElement(DeathCounter, { successes: 0, failures: 2, showNumbers: false }),
  );
  check(
    'WT) falha usa CAVEIRA COM OSSOS CRUZADOS (não a caveira simples)',
    source('src/death/DeathCounter.tsx').includes("kind === 'success' ? 'heart' : 'crossbones'") &&
      source('src/components/Icon.tsx').includes('crossbones') &&
      failuresMarkup.includes('death-pips-failure') &&
      !failuresMarkup.includes('death-icon-square'),
  );
  check(
    'WU) ossos cruzados são traço (fill="none"); preenchimento pinta só o interior',
    source('src/components/Icon.tsx').includes('d="M4 20 20 4" fill="none"') &&
      source('src/styles.css').includes('.death-pip.filled .icon { fill: currentColor; }') &&
      !/\.death-pip[^{]*\{[^}]*background:\s*var\(--(ok|danger)\)/.test(source('src/styles.css')),
  );

  // WW–WY. Reaction Window: arquitetura pronta, SEM UI permanente.
  const opportunity: ReactionOpportunity = {
    id: 'r1',
    reactorUserId: 'player-b',
    reactorCombatantId: 'cb',
    trigger: 'Você foi alvo de um ataque.',
    sourceCombatantId: 'ca',
    targetCombatantId: 'cb',
    availableReactions: [{ id: 'shield', label: 'Escudo', description: '+5 CA até o início do próximo turno.' }],
    expiresAt: null,
  };
  const reactionMarkup = renderToStaticMarkup(
    createElement(ReactionPanel, {
      opportunity,
      onChoose: () => undefined,
      onDecline: () => undefined,
    }),
  );
  check(
    'WW) ReactionPanel é contextual: só as opções do reactor + "Não reagir"',
    reactionMarkup.includes('Reação disponível') &&
      reactionMarkup.includes('Escudo') &&
      reactionMarkup.includes('Não reagir') &&
      !reactionMarkup.includes('Ação bônus') &&
      !reactionMarkup.includes('Encerrar turno') &&
      !reactionMarkup.includes('Deslocamento'),
  );
  check(
    'WX) sem oportunidade não existe UI de Reação (nada permanente fora do turno)',
    !bar.includes('Reação disponível') &&
      tracker.includes('myReactionOpportunities[0]') &&
      tracker.includes('<ReactionPanel') &&
      tracker.includes('reactionOpportunities = []'),
  );
  check(
    'WY) oportunidades são filtradas por identidade e aceitam VÁRIOS reactores',
    reactionOpportunitiesForViewer(
      [opportunity, { ...opportunity, id: 'r2', reactorUserId: 'player-a' }],
      'player-b',
    ).length === 1 &&
      reactionOpportunitiesForViewer([], 'player-b').length === 0,
  );

  // WZ. Nada de contra-ataque genérico/Shield falso.
  check(
    'WZ) nenhum "Contra-ataque" genérico nem Shield executável inventado',
    !tracker.includes('Contra-ataque') &&
      !tracker.includes('contra-ataque') &&
      source('src/combat/reactions.ts').includes('Enquanto nenhuma regra concreta'),
  );
}

// ============================================================================
// HOTFIX — ESTADOS DE COMBATE, PRONE, INVENTÁRIO DE NPC E USAR ITEM.
// ============================================================================
{
  // CB1. Dodge e Ready aparecem no card como estados PRÓPRIOS (não Conditions).
  const dodge = renderToStaticMarkup(
    createElement(CombatStateBadges, { turnEconomy: { dodging: true, ready: null } }),
  );
  const ready = renderToStaticMarkup(
    createElement(CombatStateBadges, {
      turnEconomy: { dodging: false, ready: { trigger: 'x', intent: 'y' } },
    }),
  );
  check(
    'CB1) Esquiva ativa mostra ESQUIVANDO com tooltip próprio',
    dodge.includes('ESQUIVANDO') &&
      dodge.includes(COMBAT_STATE_VISUALS.dodging.description) &&
      dodge.includes('data-combat-state="dodging"'),
  );
  check(
    'CB2) Ready pendente mostra PREPARANDO AÇÃO; sem Ready/Dodge não há etiqueta',
    ready.includes('PREPARANDO AÇÃO') &&
      ready.includes(COMBAT_STATE_VISUALS.ready.description) &&
      renderToStaticMarkup(
        createElement(CombatStateBadges, { turnEconomy: { dodging: false, ready: null } }),
      ) === '',
  );
  check(
    'CB3) estados terminam quando o estado mecânico termina (derivação, sem flag visual)',
    combatStatesOf({ dodging: true, ready: null }).join(',') === 'dodging' &&
      combatStatesOf({ dodging: false, ready: null }).length === 0 &&
      source('src/combat/components/CombatantCard.tsx').includes('<CombatStateBadges'),
  );
  check(
    'CB4) NÃO são Conditions: componente/classes separados e Hidden não é inventado',
    !dodge.includes('condition-chip') &&
      dodge.includes('combat-state-chip') &&
      combatStatesOf({ dodging: false, ready: null }).length === 0 &&
      !source('../src/modules/shared/conditions.ts').includes("active.has('hidden')"),
  );
  check(
    'CB5) cores semânticas vêm de COMBAT_STATE_VISUALS/data-attribute (sem cor aleatória)',
    ['hidden', 'dodging', 'ready', 'concentrating'].every(
      (id) => COMBAT_STATE_VISUALS[id as keyof typeof COMBAT_STATE_VISUALS].tone === id,
    ) &&
      source('src/styles.css').includes(".combat-state-chip[data-combat-state='dodging']") &&
      source('src/styles.css').includes(".combat-state-chip[data-combat-state='ready']"),
  );

  // CB6. Prone: vantagem melee / desvantagem ranged, por MODO do ataque.
  const conditions = source('../src/modules/shared/conditions.ts');
  const combatService = source('../src/modules/combat/combat.service.ts');
  check(
    'CB6) regra de Caído usa o modo do ataque (nunca o tipo de dano)',
    conditions.includes("context.attackRanged === true ? 'prone-ranged' : 'prone-melee'") &&
      conditions.includes('attackRanged: attack.ranged') === false &&
      combatService.includes('attackRanged: attack.ranged'),
  );

  // CB7. USO DIRETO pelo inventário: "Usar Item" saiu do menu de Ações.
  const menu = source('src/combat/components/ActionMenu.tsx');
  const inventory = source('src/components/sections/InventorySection.tsx');
  const itemMenu = source('src/components/ItemContextMenu.tsx');
  check(
    'CB7) consumível é usado pelo inventário (duplo clique); o menu de Ações não tem "Usar Item"',
    !menu.includes('Usar Item') &&
      !menu.includes('usableItems') &&
      !source('src/combat/components/TurnResourceBar.tsx').includes('usableItems') &&
      inventory.includes('handleItemDoubleClick') &&
      inventory.includes('onDoubleClick') &&
      inventory.includes('Resolução pelo Mestre'),
  );
  check(
    'CB8) duplo clique = usar em si; "Usar em..." abre o seletor COMPACTO de alvos',
    inventory.includes("label: 'Usar em...'") &&
      inventory.includes('itemTargets.map') &&
      itemMenu.includes('role="menu"') &&
      inventory.includes('O alvo precisa estar ao alcance físico'),
  );
  check(
    'CB9) o uso em combate continua no motor do servidor (turno + Ação), também no NPC',
    source('src/combat/CombatTracker.tsx').includes('useCombatItem') &&
      source('src/combat/CombatTracker.tsx').includes('InventoryDock') &&
      source('../src/modules/combat/combat.service.ts').includes(
        'Você já usou sua Ação neste turno.',
      ) &&
      source('../src/modules/combat/combat.service.ts').includes(
        'Você só pode usar este item no seu turno.',
      ),
  );
  check(
    'CB9b) inventário do NPC usa o MESMO painel flutuante (sem dropdown simplificado)',
    source('src/components/master/NpcInventorySection.tsx').includes('<InventoryDock') &&
      !source('src/components/master/NpcInventorySection.tsx').includes('npc-inventory-row'),
  );

  // CB10. Inventário do NPC é master-only e reutiliza o motor existente.
  const creatureRoutes = source('../src/modules/creatures/creatures.routes.ts');
  const creatureService = source('../src/modules/creatures/creatures.service.ts');
  check(
    'CB10) rotas do inventário de NPC são master-only e exigem versão',
    creatureRoutes.includes("creaturesRouter.use(authenticate, requireRole('MASTER'))") &&
      creatureRoutes.includes('/inventory/attune') &&
      creatureRoutes.includes('/coins') &&
      creatureService.includes('requireNpc(creature)'),
  );
  check(
    'CB11) NPC equipa arma/armadura pelo MESMO motor (CA e ataques derivados)',
    source('../src/modules/creatures/npc-sheet.ts').includes('deriveWeaponAttacks(') &&
      source('../src/modules/creatures/npc-sheet.ts').includes('computeArmorClass(') &&
      source('../src/modules/creatures/creatures.service.ts').includes('itemRarityOf(item.rarity)'),
  );
  check(
    'CB12) sintonização usa limite único de 3 e moedas usam o motor existente',
    source('../src/modules/shared/attunement.ts').includes('ATTUNEMENT_LIMIT = 3') &&
      creatureService.includes('attunementError(') &&
      creatureService.includes('normalizeCoins('),
  );
  check(
    'CB13) inventário de NPC não entra no DTO do jogador (estado operacional oculto)',
    source('../src/modules/combat/combat.dto.ts').includes('dodging: false, ready: null') &&
      !source('../src/modules/combat/combat.dto.ts').includes('inventory:'),
  );

  // CB14. WIP histórico preservado (o commit não pode engolir a hover card).
  check(
    'CB14) inventário do jogador (WIP) não foi redesenhado pelo hotfix',
    !source('src/components/sections/InventorySection.tsx').includes('NpcInventorySection'),
  );

  // CB15–CB17. Mochila do combate: LINHA (como antes), com uso pelo mesmo motor.
  const bagList = source('src/components/sections/BagListSection.tsx');
  const sheetPage = source('src/pages/SheetPage.tsx');
  check(
    'CB15) a mochila do combate continua em LINHA (sem modal/portal)',
    sheetPage.includes("combatView === 'inventory'") &&
      sheetPage.includes('<BagListSection') &&
      bagList.includes('<ul className="bag-list">') &&
      !bagList.includes('createPortal') &&
      !bagList.includes('combat-modal'),
  );
  check(
    'CB16) a linha usa o MESMO motor de uso do inventário (duplo clique + Usar em...)',
    bagList.includes('isConsumableItem(') &&
      bagList.includes('ItemContextMenu') &&
      bagList.includes('onDoubleClick') &&
      bagList.includes("label: 'Usar em...'") &&
      sheetPage.includes('onUseItem={useItem}') &&
      sheetPage.includes('onUseItemOn={useItemOn}') &&
      sheetPage.includes('itemTargets={inventoryTargets}'),
  );
  check(
    'CB17) o uso na lista reaproveita o motor de combate (turno + Ação) do SheetPage',
    bagList.includes('onUseItem?: (itemInventoryId: string)') &&
      bagList.includes('usingRef') &&
      !bagList.includes('useCombatItem(') &&
      sheetPage.includes('useCombatItem(combat, {'),
  );

  // CB18–CB21. CONDIÇÕES do Mestre dentro de "Estado e ajustes".
  const conditionsPanel = source('src/combat/components/MasterConditionsPanel.tsx');
  const mechanicalPanel = source('src/components/MechanicalPanel.tsx');
  const styles = source('src/styles.css');
  const mechanicalService = source('../src/modules/mechanical/mechanical.service.ts');
  check(
    'CB18) a ferramenta de Conditions é do Mestre e vive na variante de combate',
    mechanicalPanel.includes("isMaster && variant === 'combat'") &&
      mechanicalPanel.includes('<MasterConditionsPanel') &&
      mechanicalPanel.includes('onApply={(condition, source) =>') &&
      mechanicalPanel.includes("onRemove={(instanceId) => void execute({ action: 'remove'") &&
      !conditionsPanel.includes('fetch('),
  );
  check(
    'CB19) catálogo único (labels do servidor), com busca e fonte opcional',
    conditionsPanel.includes('Object.entries(effects.labels)') &&
      conditionsPanel.includes('Buscar condição') &&
      conditionsPanel.includes('Fonte (opcional)') &&
      conditionsPanel.includes('Adicionar condição') &&
      conditionsPanel.includes('Condições — {name}') &&
      !conditionsPanel.includes("'blinded'") &&
      !conditionsPanel.includes('exhaustionLevel'),
  );
  check(
    'CB20) derived (0 PV) protegida: cadeado e sem remoção manual',
    conditionsPanel.includes('protectedInstanceIds') &&
      conditionsPanel.includes('Esta condição é mantida por outro estado') &&
      conditionsPanel.includes('master-condition-lock') &&
      mechanicalPanel.includes('protectedInstanceIds={current.protectedInstanceIds ?? []}') &&
      mechanicalService.includes('protectedInstanceIds') &&
      mechanicalService.includes("'CONDITION_DERIVED'"),
  );
  check(
    'CB21) aplicação manual tem fonte rastreável e o log/real-time existentes',
    mechanicalService.includes("sourceLabel = 'Mestre'") &&
      mechanicalService.includes("sourceType = input.sourceType ?? (manual ? 'manual' : undefined)") &&
      mechanicalService.includes('input.operationId') &&
      mechanicalService.includes('ServerEvents.MECHANICAL_UPDATED') &&
      mechanicalService.includes('toCombatDto('),
  );
  check(
    'CB22) o seletor de Conditions não inclui Exaustão (controles próprios)',
    mechanicalPanel.includes('exhaustionControls') &&
      mechanicalPanel.includes("action: 'exhaustion'") &&
      conditionsPanel.includes('effects.labels') &&
      !conditionsPanel.includes('exhaustion'),
  );
  check(
    'CB23) estilos da ferramenta usam os tokens existentes (sem paleta nova)',
    styles.includes('.master-conditions {') &&
      styles.includes('.condition-picker-list') &&
      styles.includes('.master-condition-lock') &&
      !styles.includes('#ff0000'),
  );

  // CB26–CB31. CONCENTRAÇÃO (Fase 6.4): estado próprio, CD, dano e bandeja.
  const sharedConditions = source('../src/modules/shared/conditions.ts');
  const diceService = source('../src/modules/dice/dice.service.ts');
  const concentrationShared = source('../src/modules/shared/concentration.ts');
  const concentrationService = source('../src/modules/concentration/concentration.service.ts');
  const concentrationPanel = source('../client/src/combat/components/ConcentrationSavePanel.tsx');
  const combatStateBadges = source('../client/src/combat/components/CombatStateBadges.tsx');
  const combatVisuals = source('../client/src/combat/combatVisuals.ts');
  const combatTrackerCode = source('../client/src/combat/CombatTracker.tsx');
  const diceRoller = source('../client/src/dice/useDiceRoller.ts');
  const smokeConcentration = source('../src/scripts/smoke-concentration.ts');
  check(
    'CB26) Concentração é estado mecânico PRÓPRIO (nunca uma Condition)',
    sharedConditions.includes('concentration: concentrationStateSchema.nullable()') &&
      sharedConditions.includes('pendingConcentrationSaves') &&
      concentrationShared.includes('concentrationStateSchema') &&
      !/CONDITION_LABELS[\s\S]{0,400}concentration/.test(sharedConditions),
  );
  check(
    'CB27) CD = max(10, floor(dano / 2)), o dano é o FINAL e o eventId vem do evento',
    concentrationShared.includes('return Math.max(10, Math.floor(Math.max(0, damage) / 2));') &&
      concentrationService.includes('const dc = concentrationDc(damage);') &&
      // O dano passado é o FINAL (total do ataque / amount do ajuste) e o id do
      // evento vem do chamador — nunca gerado dentro do hook de concentração.
      combatService.includes('noteDamageConcentration(entity, total, db, {') &&
      combatService.includes('eventId: input.operationId') &&
      combatService.includes('noteDamageConcentration(entity, input.amount, db, {') &&
      combatService.includes('eventId: damageEventId') &&
      !concentrationService.includes('eventId: randomUUID()'),
  );
  check(
    'CB28) uma pendência por evento, fila preservada e Incapacitado/0 PV encerram SEM save',
    concentrationService.includes('pendingConcentrationSaves = [...state.pendingConcentrationSaves, save]') &&
      concentrationService.includes('deriveConditionEffects(state).incapacitated || zeroHp') &&
      concentrationService.includes('state.concentration = null;\n    state.pendingConcentrationSaves = [];') &&
      mechanicalService.includes('perdeu a concentração em ${state.concentration.label} ao ') &&
      mechanicalService.includes('derived.incapacitated || derived.fatalByExhaustion'),
  );
  check(
    'CB29) o teste usa o MESMO pipeline de salvaguarda (Constituição) e a bandeja existente',
    diceService.includes("kind === 'concentration'") &&
      diceService.includes("deriveSaveEffects(target.state, 'constitution', [], [], {") &&
      diceService.includes('await concentrationSaveBonus(entity)') &&
      // O bônus de efeito entra como fonte SERVER-SIDE, nunca do payload.
      diceService.includes("rollModifiersFor(\n    await effectModifierSetFor(entity),\n    'save',\n    'constitution',") &&
      diceRoller.includes('pendingConcentrationSaveId') &&
      concentrationPanel.includes('Rolar teste de Constituição (CD') &&
      !source('../client/src/dice/DiceDock.tsx').includes('ConcentrationSavePanel'),
  );
  check(
    'CB30) etiqueta CONCENTRANDO deriva do estado real, com nome no tooltip',
    combatVisuals.includes("if (concentrating) states.push('concentrating');") &&
      combatStateBadges.includes('Concentrando em: {concentration.label}') &&
      combatStateBadges.includes('Concentrando em: ') &&
      combatTrackerCode.includes('concentration={combatant.mechanicalState.concentration}') === false &&
      source('../client/src/combat/components/CombatantCard.tsx').includes('concentration={combatant.mechanicalState.concentration}'),
  );
  check(
    'CB32) Effects são um módulo PRÓPRIO (não Condition) e têm tabela separada',
    source('../src/modules/effects/effects.service.ts').includes('export async function createEffect') &&
      source('../src/modules/effects/effects.service.ts').includes('export async function endEffectGroup') &&
      source('../src/modules/effects/effects.service.ts').includes('targetEntityKind') &&
      source('../prisma/schema.prisma').includes('model EffectInstance') &&
      source('../prisma/schema.prisma').includes('@@map(\"effect_instances\")') &&
      // Effect NÃO entra no catálogo de Conditions do PHB.
      !/CONDITION_LABELS[\s\S]{0,400}effect/.test(sharedConditions) &&
      !source('../src/modules/shared/conditions.ts').includes('effect:'),
  );
  check(
    'CB33) a privacidade dos efeitos é filtrada no SERVIDOR (DTO), não no CSS',
    source('../src/modules/effects/effects.dto.ts').includes("row.visibility === 'public'") &&
      source('../src/modules/effects/effects.dto.ts').includes('effectsVisibleTo') &&
      source('../src/modules/effects/effects.service.ts').includes('effectsVisibleTo(rows, false)'),
  );
  check(
    'CB34) UI de efeitos existe no "Estado e ajustes" do Mestre, com encerrar por instância',
    source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('Adicionar efeito manual') &&
      source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('endEffect(effect.id)') &&
      source('../client/src/components/MechanicalPanel.tsx').includes('<MasterEffectsPanel') &&
      source('../client/src/effectsApi.ts').includes("api<{ effect: EffectDto }>('/api/effects'") &&
      source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('describeEffectModifiers') &&
      !source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('condition:'),
  );
  check(
    'CB36) modificadores de Effect são tipados, validados e consumidos pelos pipelines reais',
    source('../src/modules/effects/effect-modifiers.ts').includes('discriminatedUnion') &&
      source('../src/modules/effects/effect-modifiers.ts').includes('MAX_EFFECT_MODIFIERS') &&
      source('../src/modules/effects/effect-modifiers.ts').includes('export function publicEffectLabel') &&
      source('../src/modules/effects/effects.service.ts').includes('export async function effectModifierSetsFor') &&
      source('../src/modules/dice/dice.service.ts').includes("rollModifiersFor") &&
      source('../src/modules/combat/combat.service.ts').includes('attackerEffectMods') &&
      source('../src/modules/combat/combat.service.ts').includes('effectArmorClassBonuses') &&
      // Nenhum pipeline conhece nome de magia: a regra vem só do modificador.
      !source('../src/modules/dice/dice.service.ts').includes("label === 'Bless'") &&
      !source('../src/modules/combat/combat.service.ts').includes('definitionId'),
  );
  check(
    'CB39) Effect → Condition usa o MESMO conditionSchema e rastreia sourceType/sourceId',
    source('../src/modules/effects/effect-modifiers.ts').includes('z.array(conditionSchema)') &&
      source('../src/modules/effects/effect-conditions.ts').includes("sourceType: 'effect'") &&
      source('../src/modules/effects/effect-conditions.ts').includes('sourceId: effect.id') &&
      source('../src/modules/mechanical/condition-instances.ts').includes("instance.sourceType === sourceType") &&
      // Cleanup NUNCA usa condition/label como identidade.
      !source('../src/modules/mechanical/condition-instances.ts').includes('sourceLabel ==='),
  );
  check(
    'CB40) Conditions do Effect entram na criação e saem no lifecycle (sem cópia no service)',
    source('../src/modules/effects/effects.service.ts').includes('applyEffectConditions(row, target.entity, db)') &&
      source('../src/modules/effects/effects.service.ts').includes('endEffectsForConcentration(applied.endedConcentration, db)') &&
      source('../src/modules/effects/effects.service.ts').includes('export async function endEffectGroup') &&
      source('../src/modules/effects/effect-lifecycle.ts').includes('removeEffectConditions(rows.map(toCleanupItem), db, context)') &&
      // A limpeza NÃO é duplicada no service: ela mora no lifecycle.
      !source('../src/modules/effects/effects.service.ts').includes('conditions: row.conditions') &&
      source('../prisma/schema.prisma').includes('conditions Json @default(\"[]\")'),
  );
  check(
    'CB41) UI do Mestre configura Conditions e a origem privada é sanitizada na GRAVAÇÃO',
    source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('Condições aplicadas') &&
      source('../client/src/combat/components/MasterEffectsPanel.tsx').includes('conditions,') &&
      source('../src/modules/effects/effect-conditions.ts').includes("sourceLabel: isPrivate ? 'Efeito' : effect.label") &&
      source('../src/modules/effects/effects.dto.ts').includes('parseEffectConditions(row.conditions)'),
  );
  check(
    'CB38) a Esquiva valida pelo deslocamento EFETIVO (inclui speed-flat dos efeitos)',
    source('../src/modules/dice/dice.service.ts').includes('dodgeBenefitForSave(entity, effectSet?.speedBonus ?? 0)') &&
      source('../src/modules/dice/dice.service.ts').includes('effectiveSpeed(baseSpeed, mechanical, effectSpeedBonus)') &&
      source('../src/modules/combat/combat.service.ts').includes('targetSpeed: effectiveSpeed(\n          combatantSpeed(target),\n          combatantMechanicalState(target),\n          targetEffectMods.speedBonus,') &&
      source('../src/modules/shared/conditions.ts').includes('effectSpeedBonus'),
  );
  check(
    'CB37) CA/deslocamento com efeito são DERIVADOS (nunca gravados na ficha)',
    source('../src/modules/characters/characters.dto.ts').includes('effectArmorClassBonuses(effectModifiers)') &&
      source('../src/modules/characters/characters.dto.ts').includes('effectModifiers?.speedBonus') &&
      source('../src/modules/shared/conditions.ts').includes('effectSpeedBonus') &&
      source('../src/modules/shared/armor-class.ts').includes('effectBonuses') &&
      source('../src/modules/characters/characters.service.ts').includes('effectModifierSetFor'),
  );
  check(
    'CB35) efeito NÃO depende de combate (sem combatId na criação) e reusa o evento effects:updated',
    !source('../src/modules/effects/effects.schema.ts').includes('combatId') &&
      source('../src/realtime/events.ts').includes("EFFECTS_UPDATED: 'effects:updated'") &&
      source('../client/src/useRealtime.ts').includes("socket.on('effects:updated'") &&
      source('../client/src/pages/SheetPage.tsx').includes('onEffectsUpdated'),
  );
  check(
    'CB31) NPC: teste privado não vaza CD/rolagem e o Mestre escolhe ao rolar',
    source('../src/modules/combat/combat.dto.ts').includes('pendingConcentrationSaves: []') &&
      source('../src/modules/combat/combat.dto.ts').includes('concentration.visibility === \'public\'') &&
      concentrationPanel.includes("onRollMaster?.(save, 'private')") &&
      concentrationPanel.includes("onRollMaster?.(save, 'public')") &&
      smokeConcentration.includes("audience === 'masters'"),
  );

  // CB42–CB46. Lifecycle de encerramento (Fase 6.5D).
  const effectLifecycle = source('../src/modules/effects/effect-lifecycle.ts');
  const effectsServiceSource = source('../src/modules/effects/effects.service.ts');
  const creaturesService = source('../src/modules/creatures/creatures.service.ts');
  const charactersService = source('../src/modules/characters/characters.service.ts');
  const effectLifecycleSmoke = source('../src/scripts/smoke-effect-lifecycle.ts');
  check(
    'CB42) encerramento tem UM pipeline: endEffect e endEffectGroup usam o mesmo lifecycle',
    effectLifecycle.includes('export async function endEffectInstances') &&
      effectsServiceSource.includes('endEffectInstances({ id: effectId }, reason, db)') &&
      effectsServiceSource.includes('endEffectInstances({ groupId }, reason, db, context)') &&
      !effectsServiceSource.includes('updateMany({\n    where: { groupId, status'),
  );
  check(
    'CB43) cleanup remove por sourceId e NÃO usa label/condition como identidade',
    effectLifecycle.includes('removeEffectConditions(rows.map(toCleanupItem), db, context)') &&
      effectLifecycle.includes("status: 'active'") &&
      !effectLifecycle.includes('sourceLabel') &&
      !effectLifecycle.includes('parseEffectConditions(row.conditions).forEach'),
  );
  check(
    'CB44) remoção ESTRUTURAL de entidade encerra efeitos (target-removed/source-removed)',
    effectLifecycle.includes('export async function endEffectsTargetingEntity') &&
      effectLifecycle.includes('export async function endEffectsSourcedByEntity') &&
      creaturesService.includes('endEffectsTargetingEntity({ kind: \'creature\', id }, db)') &&
      creaturesService.includes('endEffectsSourcedByEntity({ kind: \'creature\', id }, db)') &&
      charactersService.includes('endEffectsTargetingEntity({ kind: \'character\', id: characterId }, tx)') &&
      charactersService.includes('endEffectsSourcedByEntity({ kind: \'character\', id: characterId }, tx)') &&
      source('../src/modules/effects/effects.schema.ts').includes("'source-removed'") &&
      source('../src/modules/effects/effects.schema.ts').includes("'target-removed'"),
  );
  check(
    'CB45) endReason é histórico/auditoria e não ramifica a limpeza',
    effectLifecycle.includes('reason: EffectEndReason') &&
      !effectLifecycle.includes("reason === 'concentration'") &&
      !effectLifecycle.includes("reason === 'manual'") &&
      source('../src/modules/effects/effects.service.ts').includes("endEffectGroup(concentration.sourceId, 'concentration', db, context)"),
  );
  check(
    'CB46) invariante de lifecycle é diagnóstico READ-ONLY e tem smoke próprio',
    effectLifecycle.includes('export async function findEndedEffectsWithLiveConditions') &&
      !effectLifecycle.includes('prisma.$transaction') &&
      effectLifecycleSmoke.includes('findEndedEffectsWithLiveConditions') &&
      effectLifecycleSmoke.includes('72.L)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeEffectLifecycle(BASE_URL, check)'),
  );

  // CB47–CB51. Primeiro efeito REAL: Bless (Fase 6.5G).
  const blessDefinition = source('../src/modules/effects/definitions/bless.ts');
  const blessService = source('../src/modules/effects/bless.service.ts');
  const effectOptional = source('../src/modules/dice/effect-optional.ts');
  const spellExecutionRegistry = source('../src/modules/spells/execution/spell-execution-registry.ts');
  check(
    'CB47) Bless é DEFINIÇÃO genérica (+1d4 opcional em ataque/save, stacking) sem hardcode nos resolvers',
    blessDefinition.includes("export const BLESS_DEFINITION_ID = `spell.${BLESS_SPELL_ID}`") &&
      blessDefinition.includes("kind: 'roll-dice'") &&
      blessDefinition.includes("sides: 4") &&
      blessDefinition.includes("roll: 'attack'") &&
      blessDefinition.includes("roll: 'save'") &&
      blessDefinition.includes('optional: true') &&
      blessDefinition.includes('stackingKey: BLESS_DEFINITION_ID') &&
      // Nenhum resolver conhece o `definitionId` da magia (comentário não é regra).
      !source('../src/modules/dice/dice.service.ts').includes('spell.bless') &&
      !source('../src/modules/combat/combat.service.ts').includes('spell.bless') &&
      !source('../src/modules/concentration/concentration.service.ts').includes('spell.bless'),
  );
  check(
    'CB48) aplicação de Bless é MASTER-only, 1–3 alvos e DELEGADA ao contrato de conjuração (6.6A)',
    blessService.includes('castProofSpell(') &&
      spellExecutionRegistry.includes('targetCount: { base: 3, baseSlotLevel: 1, additionalPerSlotLevel: 1 }') &&
      spellExecutionRegistry.includes("kind: 'immediate-effect'") &&
      spellExecutionRegistry.includes('BLESS_DEFINITION_ID') &&
      source('../src/modules/effects/effects.routes.ts').includes("effectsRouter.post('/bless', requireRole('MASTER')") &&
      source('../src/modules/effects/effects.schema.ts').includes('.min(1).max(12)'),
  );
  check(
    'CB49) modificador OPCIONAL é server-derived e o cliente devolve apenas IDs',
    effectOptional.includes('selectOptionalModifiers') &&
      effectOptional.includes("'INVALID_EFFECT_MODIFIER'") &&
      effectOptional.includes('autoFail') &&
      source('../src/modules/dice/dice.schema.ts').includes('selectedEffectModifiers') &&
      source('../src/modules/combat/combat.schema.ts').includes('selectedEffectModifiers') &&
      source('../client/src/dice/DiceDock.tsx').includes('selectedEffectModifiers.includes(option.id)') &&
      !source('../client/src/dice/useDiceRoller.ts').includes('selectedEffectModifiers: [{'),
  );
  check(
    'CB50) Bless NÃO cria Condition/flag: é EffectInstance + modificadores',
    !/blessed/i.test(source('../src/modules/shared/conditions.ts')) &&
      !/blessed/i.test(source('../prisma/schema.prisma')) &&
      !blessDefinition.includes("condition: 'blessed'"),
  );
  check(
    'CB51) Bless tem smoke próprio e cobre os dois Bless sem acumular (stackingKey)',
    source('../src/scripts/smoke-bless-effect.ts').includes('Bless') &&
      source('../src/scripts/smoke-bless-effect.ts').includes('73.I.1)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeBlessEffect(BASE_URL, check)'),
  );

  // CB52–CB56. Segundo efeito REAL: Imobilizar Pessoa (Fase 6.5H).
  const holdPersonDefinition = source('../src/modules/effects/definitions/hold-person.ts');
  const holdPersonService = source('../src/modules/effects/hold-person.service.ts');
  const pendingEffectSaves = source('../src/modules/effects/pending-effect-saves.ts');
  check(
    'CB52) Hold Person é DEFINIÇÃO canônica (Sabedoria + Paralyzed + Concentração) sem hardcode nos motores',
    holdPersonDefinition.includes("HOLD_PERSON_DEFINITION_ID = `spell.${HOLD_PERSON_SPELL_ID}`") &&
      holdPersonDefinition.includes("HOLD_PERSON_SAVE_ABILITY = 'wisdom'") &&
      holdPersonDefinition.includes("HOLD_PERSON_CONDITIONS: Condition[] = ['paralyzed']") &&
      holdPersonDefinition.includes('requiresConcentration: true') &&
      // Nenhum resolver genérico conhece a magia (o caminho do import não é regra).
      !source('../src/modules/dice/dice.service.ts').includes('spell.hold-person') &&
      !source('../src/modules/combat/combat.service.ts').includes('spell.hold-person') &&
      !source('../src/modules/shared/conditions.ts').includes('hold-person') &&
      !source('../src/modules/effects/effect-conditions.ts').includes('hold-person') &&
      !/condition:\s*'held'/.test(holdPersonDefinition) &&
      !/held-person|'held'/i.test(source('../src/modules/shared/conditions.ts')),
  );
  check(
    'CB53) aplicação é MASTER-only, delega ao cast service e valida humanoide ANTES do commit',
    holdPersonService.includes('castProofSpell(') &&
      spellExecutionRegistry.includes("filters: [{ kind: 'creature-type', value: 'humanoid' }]") &&
      source('../src/modules/spells/execution/spell-targeting.service.ts').includes(
        'isHumanoidEntity(target.entity, db)',
      ) &&
      source('../src/modules/spells/execution/spell-targeting.service.ts').includes(
        "'SPELL_TARGET_TYPE_INVALID'",
      ) &&
      source('../src/modules/effects/effects.routes.ts').includes("effectsRouter.post('/hold-person', requireRole('MASTER')") &&
      source('../src/modules/effects/effects.schema.ts').includes('applyHoldPersonSchema'),
  );
  check(
    'CB54) save pendente é server-authoritative: atributo/CD da pendência e bônus calculado no servidor',
    source('../src/modules/dice/dice.schema.ts').includes('pendingEffectSaveId') &&
      source('../src/modules/dice/dice.service.ts').includes('loadPendingEffectSaveForRoll(') &&
      source('../src/modules/dice/dice.service.ts').includes('savingThrowBonus(targetEntity, ability)') &&
      source('../src/modules/dice/dice.service.ts').includes(
        'resolvePendingEffectSave(pending.id, total, actor.displayName)',
      ) &&
      !source('../src/modules/dice/dice.service.ts').includes('input.ability ?? pending') &&
      source('../src/modules/shared/saving-throws.ts').includes('export async function savingThrowBonus'),
  );
  check(
    'CB55) falha cria Effect→Paralyzed e Concentração via grupo; sucesso só fecha o cast como no-effect',
    source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
      'conditions: effect.conditions()',
    ) &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes("sourceType: 'spell'") &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes('sourceId: groupId') &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
        'applyEffectConditions(row, target.entity, db)',
      ) &&
      holdPersonService.includes('tryFinalizeSaveEffectCast(row.spellCastId, db)') &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
        "await closeCast(db, cast.id, 'no-effect')",
      ) &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
        "await closeCast(db, cast.id, 'effect', groupId)",
      ),
  );
  check(
    'CB56) pendência sobrevive a reconnect, é cancelada na remoção estrutural e tem smoke próprio',
    pendingEffectSaves.includes('pendingEffectSavesForEntity') &&
      pendingEffectSaves.includes('export async function cancelPendingEffectSavesForEntity') &&
      source('../src/modules/effects/effect-lifecycle.ts').includes('cancelPendingEffectSavesForEntity(key, db)') &&
      source('../src/modules/effects/pending-effect-saves.ts').includes("EFFECTS_PENDING") &&
      source('../src/scripts/smoke-hold-person-effect.ts').includes('74.G)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeHoldPersonEffect(BASE_URL, check)'),
  );

  // CB57–CB62. Fundação de conjuração (Fase 6.6A).
  const spellCastService = source('../src/modules/spells/execution/spell-cast.service.ts');
  const spellExecutionDefinition = source('../src/modules/spells/execution/spell-execution-definition.ts');
  const spellCastMigration = source(
    '../prisma/migrations/20261102080000_add_spell_casting_foundation/migration.sql',
  );
  check(
    'CB57) SpellCast persistente (status/outcome, targets snapshot) com migration aditiva e vínculo à pendência',
    source('../prisma/schema.prisma').includes('model SpellCast') &&
      source('../prisma/schema.prisma').includes('spellCastId String?') &&
      spellCastMigration.includes('spell_casts') &&
      spellCastMigration.includes('spell_casts_one_resolving_per_caster') &&
      spellCastService.includes("status: 'resolving'") &&
      spellCastService.includes("outcome: 'effect'") &&
      spellCastService.includes("outcome: 'cancelled'") &&
      source('../src/modules/spells/execution/spell-cast.dto.ts').includes('targetEntities'),
  );
  check(
    'CB58) contrato ÚNICO validate → commit → resolve, registry por spellId e núcleo SEM nome de magia',
    spellCastService.includes('export async function validateSpellCast') &&
      spellCastService.includes('async function commitSpellCast') &&
      spellCastService.includes('castProofSpell') &&
      spellCastService.includes('spellExecutionDefinition(input.spellId)') &&
      spellCastService.includes('findEffectDefinition(resolution.effectDefinitionId)') &&
      !spellCastService.includes('spell.bless') &&
      !spellCastService.includes('spell.hold-person') &&
      spellExecutionRegistry.includes('SPELL_EXECUTION_DEFINITIONS') &&
      spellExecutionDefinition.includes("kind: 'immediate-effect'") &&
      spellExecutionDefinition.includes("kind: 'save-effect'") &&
      spellExecutionRegistry.includes("applyOn: 'failure'") &&
      !spellExecutionRegistry.includes('manualSaveDc') &&
      spellExecutionDefinition.includes('profile: SpellcastingProfile') &&
      // 6.6F: o perfil passou a ser resolvido na AUTORIZAÇÃO (por fonte), não no
      // core — mesma pipeline, um só lugar.
      source('../src/modules/spells/execution/spell-authorization.service.ts').includes(
        'characterSpellcastingProfile(',
      ),
  );
  check(
    'CB59) COMMIT encerra a Concentração anterior ANTES de resolver; nova Concentração só com Effect durável',
    spellCastService.includes('releasePreviousConcentration') &&
      spellCastService.includes('if (!state.concentration) return [];') &&
      spellCastService.includes('state.concentration = null') &&
      spellCastService.indexOf('await releasePreviousConcentration(db, context)') >
        spellCastService.indexOf('const cast = await commitSpellCast(db, context, fingerprint)') &&
      spellCastService.includes('if (context.execution.requiresConcentration)') &&
      spellCastService.includes('if (!deriveConditionEffects(fresh.state).incapacitated && fresh.hpCurrent > 0)'),
  );
  check(
    'CB60) rotas de prova são wrappers finos; a API genérica NÃO é exclusiva do Mestre e o controle do conjurador é do SERVIDOR',
    blessService.includes('castProofSpell(') &&
      holdPersonService.includes('castProofSpell(') &&
      !blessService.includes('endEffectsForConcentration') &&
      !blessService.includes("sourceType: 'effect'") &&
      // 6.6F: quem conjura é decidido por `assertCasterControl` (PLAYER = próprio
      // personagem; MASTER = ferramenta), nunca por um guard de role no route.
      source('../src/modules/spells/execution/spell-authorization.service.ts').includes(
        'export async function assertCasterControl',
      ) &&
      source('../src/modules/spells/execution/spell-intent.service.ts').includes(
        'SPELL_SPATIAL_CONFIRMATION_FORBIDDEN',
      ) &&
      source('../src/modules/spells/execution/spell-cast.routes.ts').includes(
        "spellsRouter.post('/cast-proof', requireRole('MASTER')",
      ) &&
      source('../src/http/routes/index.ts').includes("apiRouter.use('/spells', spellsRouter)"),
  );
  check(
    'CB61) pendência ligada ao SpellCast; cancelar/remover não restaura a concentração anterior',
    pendingEffectSaves.includes('spellCastId') &&
      holdPersonService.includes('cancelSpellCastForPending(row.spellCastId, db)') &&
      spellCastService.includes('export async function cancelSpellCastForPending') &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
        'enforceCasterConcentration',
      ) &&
      pendingEffectSaves.includes('db.spellCast.updateMany') &&
      pendingEffectSaves.includes("outcome: 'cancelled'"),
  );
  check(
    'CB62) lock de UM cast resolving por caster vive no BANCO (índice parcial), nunca em Map do processo',
    spellCastMigration.includes("WHERE \"status\" = 'resolving'") &&
      spellCastService.includes('SPELL_CAST_IN_PROGRESS') &&
      spellCastService.includes('spellCast.findFirst') &&
      !spellCastService.includes('new Map(') &&
      source('../src/scripts/smoke-spell-casting-foundation.ts').includes('75.F)') &&
      source('../src/scripts/smoke-spell-casting-foundation.ts').includes('75.P)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeSpellCastingFoundation(BASE_URL, check)'),
  );

  // CB63–CB67. PERFIL DE CONJURAÇÃO server-side (Fase 6.6B).
  const spellcastingSource = source('../src/modules/spells/execution/spellcasting-source.ts');
  const spellcastingProfileService = source(
    '../src/modules/spells/execution/spellcasting-profile.service.ts',
  );
  const profileMigration = source(
    '../prisma/migrations/20261102120000_add_spellcasting_profile/migration.sql',
  );
  const masterEffectsPanel = source('src/combat/components/MasterEffectsPanel.tsx');
  check(
    'CB63) CD/ataque mágico DERIVADOS por fonte (8 + PB + atributo) — classe/subclasse e statblock, nunca label',
    spellcastingSource.includes('spellcastingSourcesForCharacter') &&
      spellcastingSource.includes('characterSpellcastingProfile') &&
      spellcastingSource.includes('spellSaveDcFrom') &&
      spellcastingSource.includes('spellAttackBonusFrom') &&
      spellcastingSource.includes('creatureSpellcastingProfile') &&
      spellcastingSource.includes('CREATURE_STATBLOCK_SOURCE_ID') &&
      spellcastingSource.includes('spellcastingStartsAtLevel') &&
      spellcastingSource.includes('proficiencyBonus(characterLevelOf(character.classes))') &&
      spellcastingSource.includes("mode: 'explicit'") &&
      !spellcastingSource.includes("className === 'Wizard'")
  );
  check(
    'CB64) payload de prova NÃO tem CD/atributo/PB e o perfil é resolvido ANTES do commit',
    !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('dc:') &&
      !spellcastingSource.includes('input.dc') &&
      !source('../src/modules/effects/effects.schema.ts').includes('dc: z.number()') &&
      // 6.6F: a resolução do perfil vive na autorização e roda na fase VALIDATE,
      // ANTES de qualquer custo.
      spellCastService.includes('resolveSpellAuthorization(') &&
      spellCastService.indexOf('resolveSpellAuthorization(') > 0 &&
      spellcastingProfileService.includes('SPELLCASTING_SOURCE_REQUIRED') &&
      spellcastingProfileService.includes('SPELLCASTING_SOURCE_INVALID') &&
      spellcastingProfileService.includes('SPELLCASTING_SOURCE_NOT_AVAILABLE') &&
      !spellcastingProfileService.includes("className ===") &&
      !spellcastingProfileService.includes('new Map(')
  );
  // CB81–CB85. Conjuração do JOGADOR e repertório (Fase 6.6F).
  const spellRoutes66f = source('../src/modules/spells/execution/spell-cast.routes.ts');
  const spellIntentService = source('../src/modules/spells/execution/spell-intent.service.ts');
  const spellAuth66f = source('../src/modules/spells/execution/spell-authorization.service.ts');
  const repertoireDomain = source('../src/modules/shared/spells/repertoire.ts');
  const repertoireService = source('../src/modules/spells/execution/spell-repertoire.service.ts');
  const intentMigration66f = source(
    '../prisma/migrations/20261104120000_add_spell_repertoire_and_intents/migration.sql',
  );
  check(
    'CB81) rota genérica /api/spells/cast usa o MESMO core; controle do conjurador e confirmação espacial são do SERVIDOR',
    spellRoutes66f.includes("spellsRouter.post('/cast',") &&
      spellRoutes66f.includes('await castSpell(actorOf(req), parsed.data)') &&
      spellIntentService.includes('await executeCast(') &&
      !spellIntentService.includes('new Map(') &&
      spellAuth66f.includes('export async function assertCasterControl') &&
      spellAuth66f.includes('SPELL_CASTER_FORBIDDEN') &&
      spellIntentService.includes('SPELL_SPATIAL_CONFIRMATION_FORBIDDEN') &&
      spellRoutes66f.includes("'/cast-proof', requireRole('MASTER')"),
  );
  check(
    'CB82) elegibilidade por FONTE: lista + known/prepared/grimório, nível da própria classe (slot combinado não define acesso)',
    repertoireDomain.includes('maxSpellLevelForSource') &&
      !repertoireDomain.includes('spellSlotsForClasses') &&
      repertoireDomain.includes('preparedActive') &&
      repertoireDomain.includes('recorded') &&
      repertoireService.includes('spellOnList(') &&
      spellAuth66f.includes('resolveSpellAvailability(') &&
      spellAuth66f.includes('SPELLCASTING_SOURCE_REQUIRED') &&
      spellAuth66f.includes('SPELL_NOT_AVAILABLE_FROM_SOURCE'),
  );
  check(
    'CB83) PLANEJADO ≠ ACTIVE: o cast lê o ACTIVE e o Descanso Longo (só ele) ativa o plano revalidado',
    repertoireDomain.includes('planPreparationProblem') &&
      spellAuth66f.includes('preparedActive: row.preparedActive') &&
      source('../src/modules/spells/execution/preparation-plan.ts').includes(
        'export function activatePreparationPlans',
      ) &&
      source('../src/modules/rest/long-rest-completion.ts').includes(
        'activatePreparationPlans({',
      ) &&
      source('../src/modules/spells/execution/spell-preparation.service.ts').includes(
        'expectedVersion',
      ),
  );
  check(
    'CB84) intenção PRÉ-COMMIT não gasta nada e a aprovação revalida antes do cast (um pending por caster no BANCO)',
    intentMigration66f.includes('spell_cast_intents_one_pending_per_caster') &&
      intentMigration66f.includes('spellRepertoire') &&
      spellIntentService.includes("status: 'pending'") &&
      spellIntentService.includes('deferUnknown: true') &&
      spellIntentService.includes('commitIntent(') &&
      spellIntentService.includes('SPELL_CAST_INTENT_PENDING') &&
      !spellIntentService.includes('spellCast.create(') &&
      spellRoutes66f.includes("'/intents/:id/approve', requireRole('MASTER')"),
  );
  check(
    'CB85) repertório na ficha (ACTIVE × PLANEJADO) e fila de confirmação do Mestre; jogador nunca confirma espaço',
    source('src/components/SpellRepertoirePanel.tsx').includes('savePreparationPlan') &&
      !source('src/components/SpellRepertoirePanel.tsx').includes('spatialConfirmation') &&
      source('src/components/MasterSpellIntentsPanel.tsx').includes('approveIntent') &&
      source('../src/scripts/smoke-realtime.ts').includes(
        'smokePlayerSpellcasting(BASE_URL, check)',
      ) &&
      source('../src/scripts/smoke-player-spellcasting.ts').includes('SPELL_CAST_INTENT_PENDING'),
  );
  check(
    'CB65) snapshot IMUTÁVEL do perfil no SpellCast (migration aditiva) e criatura com perfil explícito',
    source('../prisma/schema.prisma').includes('spellcastingSourceKind') &&
      source('../prisma/schema.prisma').includes('spellcastingProfile Json') &&
      profileMigration.includes('ADD COLUMN "spellSaveDc"') &&
      profileMigration.includes('ADD COLUMN "spellcastingProfile" JSONB') &&
      spellCastService.includes('spellcastingAbilityScore: context.profile.abilityScore') &&
      spellCastService.includes('spellSaveDc: context.saveDc') &&
      source('../src/modules/spells/execution/spell-cast.dto.ts').includes('spellcasting') &&
      // O DTO NÃO expõe metadado interno (o comentário pode citar o campo, a
      // atribuição/tipo não pode existir).
      !/fingerprint\s*[:?]/.test(source('../src/modules/spells/execution/spell-cast.dto.ts'))
  );
  check(
    'CB66) painel do Mestre SEM CD manual: seletor de fonte (só multiclasse) e CD/ataque read-only',
    !masterEffectsPanel.includes('holdPersonDc') &&
      !masterEffectsPanel.includes('CD manual de prova') &&
      masterEffectsPanel.includes('fetchSpellcastingSources') &&
      masterEffectsPanel.includes('data-spellcasting-derived') &&
      masterEffectsPanel.includes('spellcastingSource: { kind: selectedSource.kind, id: selectedSource.id }') &&
      masterEffectsPanel.includes('Sem fonte de conjuração utilizável.') &&
      source('../src/modules/effects/hold-person.service.ts').includes('input.spellcastingSource') &&
      source('../src/modules/effects/bless.service.ts').includes('input.spellcastingSource')
  );
  check(
    'CB67) smoke da 6.6B cobre fórmulas/multiclasse/statblock/snapshot e está ligado ao npm run smoke',
    source('../src/scripts/smoke-spellcasting-profile.ts').includes('76.D)') &&
      source('../src/scripts/smoke-spellcasting-profile.ts').includes('76.L)') &&
      source('../src/scripts/smoke-spellcasting-profile.ts').includes('76.N)') &&
      source('../src/scripts/smoke-spellcasting-profile.ts').includes('SPELLCASTING_SOURCE_REQUIRED') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeSpellcastingProfile(BASE_URL, check)') &&
      source('../src/scripts/smoke-hold-person-effect.ts').includes('forceSave') &&
      source('../src/scripts/smoke-hold-person-effect.ts').includes("forceSave('success'") &&
      source('../src/scripts/smoke-hold-person-effect.ts').includes("forceSave('failure'")
  );

  // CB68–CB71. ESPAÇOS DE MAGIA / RECURSOS DE CONJURAÇÃO (Fase 6.6C).
  const castingResource = source('../src/modules/spells/execution/casting-resource.ts');
  const castingResourceService = source(
    '../src/modules/spells/execution/casting-resource.service.ts',
  );
  const slotsMigration = source(
    '../prisma/migrations/20261102130000_add_casting_resources/migration.sql',
  );
  check(
    'CB68) recurso é ORTOGONAL à fonte: kind spell-slot/pact-slot, escolha por kind+level e nível mágico vem do catálogo',
    castingResource.includes("CASTING_RESOURCE_KINDS = ['spell-slot', 'pact-slot']") &&
      castingResource.includes('SPELL_SLOT_SOURCE_ID') &&
      castingResource.includes('PACT_SLOT_SOURCE_ID') &&
      castingResource.includes('selectCastingResource') &&
      castingResource.includes('resource.level >= spellLevel') &&
      !castingResource.includes('spellSaveDc') &&
      castingResourceService.includes('spellSlotsForClasses') &&
      castingResourceService.includes('pactMagicSlots') &&
      !castingResourceService.includes('className ===')
  );
  check(
    'CB69) gasto no COMMIT na MESMA transação, com guarda de versão e sem segunda fonte de verdade',
    spellCastService.indexOf('spendCastingResource(context.caster.entity, context.resource, db)') >
      0 &&
      spellCastService.indexOf('spendCastingResource(context.caster.entity, context.resource, db)') <
        spellCastService.indexOf('db.spellCast.create') &&
      spellCastService.includes('castingResourceKind: spent?.kind') &&
      castingResourceService.includes('updateMany') &&
      castingResourceService.includes('version: row.version') &&
      castingResourceService.includes('mechanicalVersion: row.mechanicalVersion') &&
      source('../src/modules/spells/execution/spell-cast.service.ts').includes(
        'castingResource: input.castingResource ?? null',
      ) &&
      !source('../src/modules/spells/execution/casting-resource.service.ts').includes('new Map(')
  );
  check(
    'CB70) migration aditiva guarda o snapshot do recurso e o uso do NPC na instância',
    slotsMigration.includes('ADD COLUMN "castingResourceKind" TEXT') &&
      slotsMigration.includes('ADD COLUMN "spellLevel" INTEGER') &&
      slotsMigration.includes('ADD COLUMN "spellcastingResources" JSONB') &&
      slotsMigration.includes('ALTER TABLE "combatants"') &&
      source('../prisma/schema.prisma').includes('spellcastingUsed Json') &&
      source('../src/modules/effects/effects.schema.ts').includes('castingResource: castingResourceRefSchema')
  );
  check(
    'CB71) UI escolhe o espaço (sem remaining editável) e o smoke da 6.6C está ligado ao npm run smoke',
    masterEffectsPanel.includes('fetchCastingState') &&
      masterEffectsPanel.includes('data-casting-resource="bless"') &&
      masterEffectsPanel.includes('data-casting-resource="hold-person"') &&
      !masterEffectsPanel.includes('remaining:') &&
      source('../client/src/effectsApi.ts').includes('fetchCastingResources') &&
      source('../src/scripts/smoke-spell-slots.ts').includes('76.5.J)') &&
      source('../src/scripts/smoke-spell-slots.ts').includes('76.5.L)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeSpellSlots(BASE_URL, check)')
  );

  // CB72–CB75. CASTING TIME & ACTION ECONOMY (Fase 6.6D).
  const castingEconomy = source(
    '../src/modules/spells/execution/spell-casting-economy.ts',
  );
  const economyMigration = source(
    '../prisma/migrations/20261102140000_add_casting_time_economy/migration.sql',
  );
  check(
    'CB72) casting time tipado: traduz para a economia existente, long NÃO vira Ação e o cliente nunca escolhe o custo',
    castingEconomy.includes('castingEconomyFor') &&
      castingEconomy.includes('SPELL_CASTING_TIME_NOT_IMPLEMENTED') &&
      castingEconomy.includes("kind === 'action'") &&
      castingEconomy.includes("kind === 'bonusAction'") &&
      castingEconomy.includes("kind === 'reaction'") &&
      !castingEconomy.includes("kind === 'minute'") &&
      !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('castingTime:') &&
      !source('../src/modules/effects/effects.schema.ts').includes('turnSequence')
  );
  check(
    'CB73) Ação/Ação Bônus consumidas no COMMIT, depois da revalidação e antes do espaço, com guarda de versão',
    spellCastService.indexOf('commitCastingEconomy(db, context.turnContext, context.economyCost)') >
      0 &&
      spellCastService.indexOf('commitCastingEconomy(db, context.turnContext, context.economyCost)') <
        spellCastService.indexOf('spendCastingResource(context.caster.entity, context.resource, db)') &&
      castingEconomy.includes('spendEconomy(economy, cost)') &&
      castingEconomy.includes('mechanicalVersion: combatant.mechanicalVersion') &&
      castingEconomy.includes('SPELL_ACTION_UNAVAILABLE') &&
      castingEconomy.includes('SPELL_BONUS_ACTION_UNAVAILABLE')
  );
  check(
    'CB74) regra da Bonus Action server-side, derivada do histórico do turno (sem "1 leveled spell por turno")',
    castingEconomy.includes('bonusActionSpellViolation') &&
      castingEconomy.includes("item.castingTime === 'action' && item.spellLevel === 0") &&
      castingEconomy.includes('committedCastsOnTurn') &&
      castingEconomy.includes('turnSequence') &&
      castingEconomy.includes('SPELL_CAST_OUT_OF_TURN') &&
      castingEconomy.includes('BONUS_ACTION_SPELL_RESTRICTION') &&
      !castingEconomy.toLowerCase().includes('one leveled spell') &&
      !spellCastService.includes('BONUS_ACTION_SPELL_RESTRICTION') &&
      !spellCastService.includes('actionsUsed +=')
  );
  check(
    'CB75) identidade de turno no BANCO (turnSequence), migration aditiva, UI read-only e smoke ligado',
    economyMigration.includes('ADD COLUMN "turnSequence" INTEGER NOT NULL DEFAULT 0') &&
      economyMigration.includes('ADD COLUMN "castingTimeKind" TEXT') &&
      source('../prisma/schema.prisma').includes('turnSequence Int          @default(0)') &&
      !castingEconomy.includes('combat.version') &&
      source('../src/modules/combat/combat.service.ts').includes('turnSequence: { increment: 1 }') &&
      masterEffectsPanel.includes('Conjuração: Ação') &&
      masterEffectsPanel.includes('Não é o turno do conjurador') &&
      masterEffectsPanel.includes('Ação já utilizada') &&
      source('../src/scripts/smoke-spell-action-economy.ts').includes('76.6.I)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeSpellActionEconomy(BASE_URL, check)') &&
      !source('../src/modules/spells/execution/spell-execution-registry.ts').includes('counterspell') &&
      !source('../src/modules/spells/execution/spell-execution-registry.ts').includes('shield')
  );

  // CB76–CB80. TARGETING & RANGE ASSISTIDO (Fase 6.6E).
  const spellTargeting = source('../src/modules/spells/execution/spell-targeting.ts');
  const spatialValidation = source('../src/modules/spells/execution/spatial-validation.ts');
  const targetingService = source('../src/modules/spells/execution/spell-targeting.service.ts');
  const saveEffectFinalizer = source(
    '../src/modules/spells/execution/save-effect-finalizer.ts',
  );
  const targetingMigration = source(
    '../prisma/migrations/20261103120000_add_spell_targeting/migration.sql',
  );
  const targetingSmoke = source('../src/scripts/smoke-spell-targeting.ts');
  check(
    'CB76) targeting é DECLARATIVO por magia; máximo de alvos DERIVADO do espaço, nunca do cliente',
    spellTargeting.includes('export function maximumTargets') &&
      spellTargeting.includes('additionalPerSlotLevel') &&
      spellTargeting.includes('targetingRangeFeet') &&
      spellExecutionRegistry.includes(
        'targetCount: { base: 3, baseSlotLevel: 1, additionalPerSlotLevel: 1 }',
      ) &&
      spellExecutionRegistry.includes(
        'targetCount: { base: 1, baseSlotLevel: 2, additionalPerSlotLevel: 1 }',
      ) &&
      spellExecutionRegistry.includes("range: { kind: 'distance', feet: 30 }") &&
      spellExecutionRegistry.includes("range: { kind: 'distance', feet: 60 }") &&
      !spellExecutionRegistry.includes('maxTargets:') &&
      spellCastService.includes('validateTargeting({') &&
      spellCastService.includes('targetingSnapshot: context.targeting') &&
      !spellCastService.includes("if (input.spellId === 'bless')") &&
      !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('maxTargets')
  );
  check(
    'CB77) validação espacial TRI-STATE: UNKNOWN exige confirmação do Mestre e um FAIL autoritativo não é sobrescrito',
    spatialValidation.includes("export type SpatialResult = 'pass' | 'fail' | 'unknown'") &&
      spatialValidation.includes('assistedSpatialProvider') &&
      spatialValidation.includes('spatialConfirmationSchema') &&
      targetingService.includes("if (result === 'fail')") &&
      targetingService.includes('canSee(caster.state, target.state)') &&
      targetingService.includes("'SPELL_TARGET_NOT_VISIBLE'") &&
      targetingService.includes("'SPELL_TARGET_RANGE_CONFIRMATION_REQUIRED'") &&
      targetingService.includes("'SPELL_TARGET_GROUP_CONFIRMATION_REQUIRED'") &&
      targetingService.includes('validationMode') &&
      source('../src/modules/effects/effects.schema.ts').includes(
        'spatialConfirmation: spatialConfirmationSchema.optional()',
      ) &&
      !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('rangeFeet')
  );
  check(
    'CB78) um cast multi-alvo = N pendências, UMA barreira transacional e UM Effect Group (unique no BANCO)',
    spellCastService.includes('async function beginPendingSaves') &&
      spellCastService.includes('for (const target of context.targets)') &&
      saveEffectFinalizer.includes('pg_advisory_xact_lock') &&
      saveEffectFinalizer.includes('pendings.some((row) => row.status ===') &&
      saveEffectFinalizer.includes("await closeCast(db, cast.id, 'effect', groupId)") &&
      source('../prisma/schema.prisma').includes(
        '@@unique([spellCastId, targetEntityKind, targetEntityId])',
      ) &&
      targetingMigration.includes('ADD COLUMN "targetingSnapshot" JSONB') &&
      targetingMigration.includes('pending_effect_saves_spellCastId_targetEntityKind_targetEntityId_key') &&
      pendingEffectSaves.includes('spellCastId: { in: castIds }, status')
  );
  check(
    'CB79) UI do Mestre: multi-select por máximo DERIVADO, contagem visível e confirmações espaciais sem distância inventada',
    masterEffectsPanel.includes('fetchSpellTargeting') &&
      masterEffectsPanel.includes('data-targeting-confirmation') &&
      masterEffectsPanel.includes('Alvos:') &&
      masterEffectsPanel.includes('data-targeting-max') &&
      !masterEffectsPanel.includes('distância em metros') &&
      !masterEffectsPanel.includes('distanceFeet:') &&
      source('../client/src/effectsApi.ts').includes('/spells/targeting/')
  );
  check(
    'CB80) smoke da 6.6E cobre contagem/upcast/visão/barreira/concorrência e PLAYER continua sem targeting',
    targetingSmoke.includes('76.7.A)') &&
      targetingSmoke.includes('76.7.C)') &&
      targetingSmoke.includes('76.7.E)') &&
      targetingSmoke.includes('76.7.G)') &&
      targetingSmoke.includes('76.7.L)') &&
      source('../src/scripts/smoke-realtime.ts').includes('smokeSpellTargeting(BASE_URL, check)') &&
      source('../src/modules/spells/execution/spell-cast.routes.ts').includes(
        "spellsRouter.get('/targeting/:spellId', requireRole('MASTER')",
      ) &&
      !spellCastService.includes('new Map(')
  );
  // ------------------------------------------------------------------ //
  // 6.6F.1 — WIRING DA CONJURAÇÃO NA FICHA                              //
  // ------------------------------------------------------------------ //
  const repertoirePanel = source('../client/src/components/SpellRepertoirePanel.tsx');
  const castApiClient = source('../client/src/spellcastingApi.ts');
  const castOptionsService = source(
    '../src/modules/spells/execution/spell-cast-options.service.ts',
  );
  const newIdUses = repertoirePanel.split('operationId: newId()').length - 1;

  check(
    'CB86) a ficha conjura pela rota GENÉRICA (`/api/spells/cast`) e nunca pelas proof routes',
    repertoirePanel.includes('await castSpell({') &&
      castApiClient.includes("'/api/spells/cast'") &&
      !repertoirePanel.includes('/effects/bless') &&
      !repertoirePanel.includes('/effects/hold-person') &&
      !repertoirePanel.includes('/spells/cast-proof')
  );
  check(
    'CB87) fonte ambígua NUNCA é auto-escolhida: selector só existe com mais de uma fonte autorizada',
    repertoirePanel.includes('sourceAmbiguous') &&
      repertoirePanel.includes('options.sources.length === 1') &&
      castOptionsService.includes('availability.authorized.map')
  );
  check(
    'CB88) o cliente NÃO envia `castAtLevel` nem `maxTargets` — só o espaço escolhido',
    castApiClient.includes('castingResource?: { kind:') &&
      !castApiClient.includes('castAtLevel?:') &&
      !castApiClient.includes('maxTargets?:') &&
      !repertoirePanel.includes('castAtLevel:')
  );
  check(
    'CB89) máximo de alvos é DERIVADO do espaço (por `castAtLevel`), sem hardcode por nome de magia',
    repertoirePanel.includes('item.castAtLevel === castAtLevel') &&
      castOptionsService.includes('spellTargetingSummary(execution.targeting, at)') &&
      !castOptionsService.includes("'bless'") &&
      !castOptionsService.includes("'hold-person'")
  );
  check(
    'CB90) PLAYER não tem confirmação espacial: nenhum checkbox de alcance/visão/caminho',
    !repertoirePanel.includes('spatialConfirmation') &&
      !repertoirePanel.includes('withinRange') &&
      !repertoirePanel.includes('clearPath') &&
      source('../src/modules/spells/execution/spell-cast-options.service.ts').includes(
        'SPELL_CASTER_FORBIDDEN',
      )
  );
  check(
    'CB91) intenção pendente aparece como "aguardando o Mestre" e pode ser cancelada pelo jogador',
    repertoirePanel.includes('aguardando confirmação do Mestre') &&
      repertoirePanel.includes('await cancelIntent(intent.id)') &&
      repertoirePanel.includes('Nenhum espaço, Ação ou Concentração foi usada')
  );
  check(
    'CB92) `operationId` é gerado UMA vez por tentativa (retry reusa o mesmo id)',
    newIdUses === 1 && repertoirePanel.includes('operationId: draft.operationId') &&
      !repertoirePanel.includes('newId()}')
  );
  check(
    'CB93) nenhum gasto otimista: slots/Ação/Concentração só mudam por estado autoritativo',
    !repertoirePanel.includes('remaining - 1') &&
      !repertoirePanel.includes('setSlots') &&
      repertoirePanel.includes('await load();') &&
      repertoirePanel.includes('subscribeSpellIntents(')
  );
  check(
    'CB94) `cast-options` é READ-ONLY e protegido por ownership (não cria Intent/cast/gasto)',
    source('../src/modules/spells/execution/spell-cast.routes.ts').includes(
      "spellsRouter.get('/cast-options/:characterId/:spellId'",
    ) &&
      castOptionsService.includes('assertCharacterAccess') &&
      !castOptionsService.includes('.create(') &&
      !castOptionsService.includes('spendEconomy') &&
      !castOptionsService.includes('spendSlot')
  );

  // ------------------------------------------------------------------------
  // 6.6G — COMPONENTES V/S/M
  // ------------------------------------------------------------------------
  const componentsDomain = source('../src/modules/shared/spells/components.ts');
  const componentsService = source(
    '../src/modules/spells/execution/spell-components.service.ts',
  );
  const castingFocus = source('../src/modules/shared/spells/casting-focus.ts');
  const castService = source('../src/modules/spells/execution/spell-cast.service.ts');
  const castSchema = source('../src/modules/spells/execution/spell-cast.schema.ts');
  check(
    'CB95) componentes vêm do CATÁLOGO estruturado (nenhum parser de "V, S, M (...)”)',
    componentsDomain.includes('spellComponentRequirement') &&
      !componentsDomain.includes('.split(') &&
      !componentsDomain.includes('.match(') &&
      !componentsService.includes('.split(') &&
      !componentsService.includes('.match(') &&
      componentsDomain.includes('costGp') &&
      componentsDomain.includes('consumed')
  );
  check(
    'CB96) o serviço de componentes não conhece nome de magia (Bless/Hold Person)',
    !componentsService.includes("'bless'") && !componentsService.includes("'hold-person'")
  );
  check(
    'CB97) foco é específico da FONTE e o Patrulheiro do PHB 2014 não ganha foco',
    castingFocus.includes('focusKindsForSource') &&
      source('../src/modules/shared/classes/ranger.ts').includes('focusKinds: []') &&
      !castingFocus.includes("=== 'bless'")

  );
  check(
    'CB98) S + M pode usar a MESMA mão do foco/material (e S sem M não ganha mão)',
    componentsService.includes("materialHand === 'device'") &&
      componentsService.includes("hand: 'material'")
  );
  check(
    'CB99) material consumido é debitado no COMMIT, com guarda de versão',
    castService.includes('consumeSpellComponents(') &&
      componentsService.includes('version: row.version') &&
      componentsService.includes('SPELL_COMPONENT_MATERIAL_UNAVAILABLE')
  );
  check(
    'CB100) o cliente NÃO informa componente (sem hasFocus/freeHand/materialOk no request)',
    !castSchema.includes('hasFocus') &&
      !castSchema.includes('freeHand') &&
      !castSchema.includes('materialOk') &&
      !repertoirePanel.includes('hasFocus:') &&
      !repertoirePanel.includes('freeHand:')
  );
  check(
    'CB101) a UI exibe o resumo de componentes e não consome material otimisticamente',
    repertoirePanel.includes('castableNow') &&
      repertoirePanel.includes('spell-components') &&
      !repertoirePanel.includes('quantity - 1')
  );

  // ------------------------------------------------------------------------
  // 6.6H — DURAÇÃO, EXPIRAÇÃO E LIFECYCLE POR TURNO
  // ------------------------------------------------------------------------
  const durationDomain = source('../src/modules/spells/execution/spell-duration.ts');
  const durationService = source(
    '../src/modules/spells/execution/effect-duration.service.ts',
  );
  const turnTriggerService = source('../src/modules/effects/turn-trigger.service.ts');
  const groupLifecycle = source('../src/modules/effects/effect-group-lifecycle.ts');
  const holdPersonTriggerDefinition = source(
    '../src/modules/effects/definitions/hold-person.ts',
  );
  const combatServiceSource = source('../src/modules/combat/combat.service.ts');
  const pendingSavePanel = source(
    'src/combat/components/PendingEffectSavePanel.tsx',
  );
  check(
    'CB102) duração é DADO ESTRUTURADO — nenhum parser do texto da magia',
    durationDomain.includes('SpellDurationDefinition') &&
      !durationDomain.includes('At the end of') &&
      !durationService.includes('At the end of') &&
      !durationDomain.includes('.split(') &&
      !durationDomain.includes('.match(')
  );
  check(
    'CB103) 1 minuto de combate = 10 rounds; nenhum timer/wall clock real',
    durationDomain.includes('minute: 10') &&
      durationDomain.includes('hour: 600') &&
      !durationDomain.includes('setTimeout(') &&
      !durationDomain.includes('setInterval(') &&
      !durationDomain.includes('Date.now(') &&
      !durationService.includes('setTimeout(') &&
      !durationService.includes('setInterval(') &&
      !durationService.includes('Date.now(')
  );
  check(
    'CB104) a duração começa no COMMIT e o Effect herda o snapshot',
    castService.includes('buildDurationSnapshot') &&
      castService.includes('commitSpellCast') &&
      source('../src/modules/spells/execution/save-effect-finalizer.ts').includes(
        'cast.durationSnapshot',
      )
  );
  check(
    'CB105) Hold Person declara o trigger na DEFINIÇÃO (sem hardcode no motor)',
    holdPersonTriggerDefinition.includes("key: 'repeat-save'") &&
      holdPersonTriggerDefinition.includes('end-of-target-turn') &&
      !combatServiceSource.includes('hold-person') &&
      !turnTriggerService.includes('hold-person')
  );
  check(
    'CB106) salvaguarda repetida NÃO cria SpellCast nem gasta Ação/espaço',
    turnTriggerService.includes("phase: 'ongoing'") &&
      turnTriggerService.includes('spellCastId: null') &&
      !turnTriggerService.includes('spendCastingResource') &&
      !turnTriggerService.includes('spendEconomy') &&
      turnTriggerService.includes('spellSaveDc')
  );
  check(
    'CB107) `nextTurn` bloqueia com pendência de fim de turno',
    combatServiceSource.includes('openEndOfTurnTriggers') &&
      combatServiceSource.includes('TURN_END_TRIGGER_PENDING')
  );
  check(
    'CB108) recusa só existe em `ongoing` + opcional e é registrada como `declined`',
    turnTriggerService.includes("phase !== 'ongoing'") &&
      turnTriggerService.includes("status: 'declined'") &&
      turnTriggerService.includes('declinedAt') &&
      pendingSavePanel.includes('declinePendingEffectSave')
  );
  check(
    'CB109) grupo vazio encerra a Concentração (idempotente, sem loop)',
    groupLifecycle.includes('clearConcentrationForGroup') &&
      groupLifecycle.includes('remaining > 0') &&
      !groupLifecycle.includes('while (')
  );
  check(
    'CB110) expiração roda na ativação do turno e só afeta efeitos ativos',
    combatServiceSource.includes('processDurationExpirations') &&
      durationService.includes("status: 'active'") &&
      durationService.includes('duration-expired')
  );
  check(
    'CB111) fora de combate o acompanhamento é MANUAL (sem relógio falso)',
    durationDomain.includes("tracking: 'manual'") &&
      durationDomain.includes('acompanhamento manual') &&
      !durationDomain.includes('world clock')
  );
  check(
    'CB112) a UI distingue salvaguarda inicial × fim de turno',
    pendingSavePanel.includes("phase === 'ongoing'") &&
      pendingSavePanel.includes('fim do turno') &&
      pendingSavePanel.includes('Não tentar neste turno')
  );

  // ---------------------------------------------------------------------
  // 6.6I — RESOLUTION CARDS (registro lateral) e limpeza do centro
  // ---------------------------------------------------------------------
  const deathSavePanelSource = source('src/combat/components/DeathSavePanel.tsx');
  const resolutionService = source('../src/modules/combat/resolution-requests.ts');
  const resolutionCard = source('src/combat/components/ResolutionCard.tsx');
  const resolutionApiSource = source('src/combat/resolutionApi.ts');
  const trackerSource = source('src/combat/CombatTracker.tsx');

  check(
    'CB113) o Teste contra a Morte saiu do centro: sem botão, contador continua lá',
    !deathSavePanelSource.includes('<button') &&
      !deathSavePanelSource.includes('death-turn-roll') &&
      deathSavePanelSource.includes('DeathCounter') &&
      deathSavePanelSource.includes('A rolagem fica no Registro')
  );
  check(
    'CB114) o Teste contra a Morte vira card DERIVADO do turno real (sem persistência paralela)',
    resolutionService.includes("kind: 'death-saving-throw'") &&
      resolutionService.includes('combat.turnSequence') &&
      resolutionService.includes('death.saveTurnKey') &&
      resolutionService.includes('turnKey(') &&
      !resolutionService.includes('resolutionCard.create')
  );
  check(
    'CB115) o card de salvaguarda de magia deriva de PendingEffectSave (sem segunda engine)',
    resolutionService.includes('pendingEffectSave.findMany') &&
      resolutionService.includes("kind: 'spell-saving-throw'") &&
      resolutionService.includes('pendingId')
  );
  check(
    'CB116) o cliente não envia atributo, CD, bônus nem resultado',
    !resolutionApiSource.includes('dc:') &&
      !resolutionApiSource.includes('ability:') &&
      !resolutionCard.includes('pending.dc') &&
      resolutionApiSource.includes('rollPendingEffectSave') &&
      resolutionApiSource.includes('selectedEffectModifiers')
  );
  check(
    'CB117) só a salvaguarda `ongoing` + opcional oferece recusa (initial não)',
    resolutionService.includes("row.phase === 'ongoing' && row.optional") &&
      resolutionCard.includes('canDecline') &&
      resolutionCard.includes('Não tentar neste turno')
  );
  check(
    'CB118) Teste contra a Morte NUNCA tem recusa',
    resolutionService.includes('Teste contra a Morte NUNCA tem') &&
      resolutionService.includes("kind: 'death-saving-throw'") &&
      resolutionCard.includes('onRollDeath') &&
      !resolutionCard.includes('roll-death-decline')
  );
  check(
    'CB119) a privacidade é filtrada no SERVIDOR (jogador só o próprio personagem)',
    resolutionService.includes('target.ownerUserId === actor.userId') &&
      resolutionService.includes("actor.role === 'MASTER'") &&
      resolutionService.includes("visibility: 'public'")
  );
  check(
    'CB120) o log lateral recebe os cards e o tracker não os monta sozinho',
    trackerSource.includes('fetchResolutionRequests') &&
      trackerSource.includes('requests={resolutionRequests}') &&
      source('src/combat/components/CombatLog.tsx').includes('<ResolutionCard')
  );
  check(
    'CB121) próximo turno continua bloqueado por Teste de morte e fim de turno pendentes',
    combatServiceSource.includes('DEATH_SAVE_PENDING') &&
      combatServiceSource.includes('TURN_END_TRIGGER_PENDING')
  );
}

  // 6.6I.1 — o núcleo de dano/cura é ÚNICO e o serviço não guarda a regra.
  const combatServiceSource = source('../src/modules/combat/combat.service.ts');
  const damageCore = source('../src/modules/combat/damage-resolution.ts');
  const registrySource = source('../src/modules/spells/execution/spell-execution-registry.ts');
  const smokeRunner = source('../src/scripts/smoke-realtime.ts');
  check(
    'CB122) combat.service usa o núcleo compartilhado e não mantém as helpers privadas de dano',
    source('../src/modules/combat/combat.service.ts').includes("from './damage-resolution.js'") &&
      combatServiceSource.includes('resolveDamage(') &&
      combatServiceSource.includes('resolveHealing(') &&
      combatServiceSource.includes('applyHpMutation(') &&
      !combatServiceSource.includes('async function changeHp(') &&
      !combatServiceSource.includes('function damageDefensesOf(') &&
      !combatServiceSource.includes('function applyDamageDefense(')
  );
  check(
    'CB123) o núcleo não publica socket, não abre transação e não escreve log (composição do chamador)',
    damageCore.includes('export function damageDefensesOf') &&
      damageCore.includes('export function applyDamageDefense') &&
      damageCore.includes('export async function resolveDamage') &&
      damageCore.includes('export async function resolveHealing') &&
      damageCore.includes('export async function applyHpMutation') &&
      !damageCore.includes('getBroadcaster') &&
      !damageCore.includes('ServerEvents') &&
      !damageCore.includes('appendCombatJournal') &&
      !damageCore.includes('$transaction')
  );
  check(
    'CB124) Sacred Flame/Healing Word entram no registry SEM Effect Definition próprio',
    registrySource.includes("SACRED_FLAME_SPELL_ID") &&
      registrySource.includes("kind: 'save-damage'") &&
      registrySource.includes('HEALING_WORD_SPELL_ID') &&
      registrySource.includes("kind: 'immediate-healing'") &&
      !source('../src/modules/spells/execution/spell-execution-registry.ts').includes(
        'effectDefinitionId: SACRED_FLAME',
      )
  );
  check(
    'CB125) os smokes dos cards e do núcleo integram o runner principal',
    smokeRunner.includes('smokeCombatResolutionCards(BASE_URL, check)') &&
      smokeRunner.includes('smokeDamageHealingCore(BASE_URL, check)')
  );
  check(
    'CB126) o smoke dos cards usa o endpoint real e não cria tabela de cards',
    source('../src/scripts/smoke-combat-resolution-cards.ts').includes('/resolution-requests') &&
      source('../src/scripts/smoke-combat-resolution-cards.ts').includes('pendingEffectSave') &&
      !source('../src/scripts/smoke-combat-resolution-cards.ts').includes('resolutionCard.create')
  );

  // 6.6I.2 — Chama Sagrada: save-damage declarativo, sem card/client dedicado.
  const sacredFlame = source('../src/modules/spells/execution/sacred-flame.ts');
  const saveDamage = source('../src/modules/spells/execution/save-damage-resolution.ts');
  const finalizer = source('../src/modules/spells/execution/save-damage-finalizer.ts');
  const syntheticMulti = source(
    '../src/modules/spells/execution/multi-save-test-definition.ts'
  );
  const castSchemaSource = source('../src/modules/spells/execution/spell-cast.schema.ts');
  const castOptions = source('../src/modules/spells/execution/spell-cast-options.service.ts');
  check(
    'CB127) scaling de truque é genérico por nível TOTAL (não usa nível de classe nem ND)',
    source('../src/modules/shared/spells/cantrip-scaling.ts').includes('character-level') &&
      sacredFlame.includes('SACRED_FLAME_SCALING') &&
      !sacredFlame.includes('classLevel') &&
      !sacredFlame.includes('challengeRating') &&
      source('../src/modules/spells/execution/cantrip-scaling.service.ts').includes('characterLevelOf(')
  );
  check(
    'CB128) defesas e HP da Chama Sagrada passam pelo núcleo compartilhado (sem mutação direta)',
    source('../src/modules/spells/execution/save-damage-finalizer.ts').includes(
      "from '../../combat/damage-resolution.js'"
    ) &&
      source('../src/modules/spells/execution/save-damage-finalizer.ts').includes('resolveDamage(') &&
      !saveDamage.includes('hpCurrent =') &&
      !saveDamage.includes('UPDATE "characters"') &&
      !saveDamage.includes('UPDATE "combatants"')
  );
  check(
    'CB129) dano/concentração usam eventId DETERMINÍSTICO por ALVO e o roll compartilhado vive no cast',
    source('../src/modules/spells/execution/save-damage-finalizer.ts').includes(
      'spell-cast:${castId}:target:'
    ) &&
      source('../src/modules/spells/execution/save-damage-finalizer.ts').includes(
        'noteDamageConcentration('
      ) &&
      saveDamage.includes('resolutionSnapshot') &&
      saveDamage.includes('finalizeSaveDamageCast(')
  );
  check(
    'CB130) cliente não ganha campos de dano/atributo/CD da Chama Sagrada',
    !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('damage') &&
      !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('saveDc') &&
      !source('../src/modules/spells/execution/spell-cast.schema.ts').includes('ability') &&
      !castOptions.includes('sacredFlameDamage')
  );
  check(
    'CB131) o card continua GENÉRICO: nenhum componente/título dedicado à Chama Sagrada',
    !source('src/combat/components/CombatLog.tsx').includes('Chama Sagrada') &&
      !source('src/combat/components/ResolutionCard.tsx').includes('sacred') &&
      source('../src/modules/combat/resolution-requests.ts').includes("kind: 'spell-saving-throw'")
  );
  check(
    'CB161) barreira multi-alvo: lock do cast, `resolving` e espera por TODA pendência inicial',
    finalizer.includes('pg_advisory_xact_lock') &&
      finalizer.includes("status !== 'resolving'") &&
      finalizer.includes("status === 'pending'") &&
      finalizer.includes("phase: 'initial'")
  );
  check(
    'CB162) roll COMPARTILHADO e evento de dano por ALVO têm identidades distintas',
    finalizer.includes('damage-roll:${index}') &&
      finalizer.includes('target:${target.kind}:${target.id}:damage') &&
      !finalizer.includes('spell-save:')
  );
  check(
    'CB163) a definição sintética multi-alvo é de TESTE e declara `damageRollScope: shared`',
    syntheticMulti.includes("'test.synthetic-multi-save-damage'") &&
      syntheticMulti.includes("damageRollScope: 'shared'") &&
      !source('../src/modules/shared/spells/index.ts').includes('synthetic-multi-save-damage')
  );
  check(
    'CB164) o cliente NÃO envia roll compartilhado, dano por alvo nem CD/atributo do save',
    !castSchemaSource.includes('damage') &&
      !castSchemaSource.includes('damageRoll') &&
      !castSchemaSource.includes('saveDc') &&
      !castSchemaSource.includes('ability')
  );
  check(
    'CB165) a prova multi-alvo NÃO antecipa área/geometria (sem radius/cone/cube/line/origin)',
    !syntheticMulti.includes('radius') &&
      !syntheticMulti.includes('cone') &&
      !syntheticMulti.includes('cube') &&
      !syntheticMulti.includes('line') &&
      !syntheticMulti.includes('origin') &&
      !registrySource.includes('chain-lightning')
  );
  check(
    'CB166) o bloqueio de turno por resolução inicial é distinto do trigger de fim de turno',
    combatServiceSource.includes('SPELL_RESOLUTION_PENDING') &&
      combatServiceSource.includes('TURN_END_TRIGGER_PENDING') &&
      combatServiceSource.indexOf("'SPELL_RESOLUTION_PENDING'") <
        combatServiceSource.indexOf("'TURN_END_TRIGGER_PENDING'") &&
      source('src/combat/CombatTracker.tsx').includes('SPELL_RESOLUTION_PENDING')
  );
  // 6.6J.3 — Area Targeting Foundation (server-derived).
  const areaTargetingSource = source('../src/modules/spells/execution/area-targeting.ts');
  const areaServiceSource = source('../src/modules/spells/execution/area-targeting.service.ts');
  const areaSpatialSource = source('../src/modules/spells/execution/area-spatial.ts');
  const areaEvaluationSource = source('../src/modules/spells/execution/area-evaluation.ts');
  const areaSyntheticSource = source(
    '../src/modules/spells/execution/area-synthetic-definition.ts',
  );
  // Aliases locais: este bloco pode rodar em um escopo onde os nomes das seções
  // anteriores não estão visíveis.
  const areaCastService = source('../src/modules/spells/execution/spell-cast.service.ts');
  const areaCastSchema = source('../src/modules/spells/execution/spell-cast.schema.ts');
  const areaSaveResolution = source('../src/modules/spells/execution/save-damage-resolution.ts');
  const areaRegistry = source('../src/modules/spells/execution/spell-execution-registry.ts');
  const areaIntentService = source('../src/modules/spells/execution/spell-intent.service.ts');
  const areaRoutes = source('../src/modules/spells/execution/spell-cast.routes.ts');
  const areaRunner = source('../src/scripts/smoke-realtime.ts');
  check(
    'CB168) área deriva os atingidos no SERVIDOR: o cliente só envia origem/direção, nunca alvos ou geometria',
    areaTargetingSource.includes('areaPlacementSchema') &&
      areaTargetingSource.includes('includeOrigin: z.boolean().optional()') &&
      !areaTargetingSource.includes('affectedTargetIds') &&
      areaCastSchema.includes('.strict()') &&
      !areaCastSchema.includes('affectedTargetIds') &&
      areaCastService.includes('AREA_TARGETS_CLIENT_SUPPLIED') &&
      areaCastService.includes('AREA_PLACEMENT_NOT_ALLOWED') &&
      areaServiceSource.includes('areaCandidatesFor') &&
      !areaServiceSource.includes('targets: input') &&
      !areaServiceSource.includes('spellCast.create')
  );
  check(
    'CB169) o resolvedor NÃO conhece nome de magia, NÃO rola dados e NÃO mexe em HP',
    !areaServiceSource.includes('fireball') &&
      !areaServiceSource.includes('rollDie') &&
      !areaServiceSource.includes('applyDamageConsequences') &&
      !areaServiceSource.includes('pendingEffectSave.create') &&
      areaServiceSource.includes('AREA_CONTEXT_UNSUPPORTED')
  );
  check(
    'CB170) cinco formas PHB 2014 (sem `emanation`) e inclusão da origem centralizada',
    areaTargetingSource.includes("['sphere', 'cone', 'cube', 'cylinder', 'line']") &&
      !areaTargetingSource.includes('emanation') &&
      areaTargetingSource.includes('originInclusionPolicyOf') &&
      areaTargetingSource.includes("return 'caster-choice'") &&
      areaTargetingSource.includes('shapeRequiresDirection') &&
      areaSpatialSource.includes('unknown') &&
      !areaSpatialSource.includes('Math.sqrt')
  );
  check(
    'CB171) o Mestre decide SÓ `unknown`: pass/fail autoritativos nunca são sobrescritos',
    areaEvaluationSource.includes('AREA_DECISION_NOT_UNKNOWN') &&
      areaEvaluationSource.includes('AREA_RESOLUTION_INCOMPLETE') &&
      areaEvaluationSource.includes("if (evaluation.affected === 'pass')") &&
      areaEvaluationSource.includes("if (evaluation.affected === 'fail') continue;") &&
      areaIntentService.includes('parseAreaTargetingSnapshot') &&
      areaRoutes.includes('unknownTargetDecisions')
  );
  check(
    'CB172) área reutiliza o pipeline 6.6J.2 (1 cast → N pendências → 1 roll) sem engine de dano própria',
    areaServiceSource.includes('loadEntity') &&
      areaCastService.includes('resolveAreaTargets(') &&
      areaCastService.includes('beginPendingSaves(db, cast, context)') &&
      areaSaveResolution.includes('finalizeSaveDamageCast(') &&
      !areaTargetingSource.includes('spellSaveDc')
  );
  check(
    'CB173) área sem ninguém dentro é CAST VÁLIDO: fecha `no-effect` na hora, sem pendência e sem reembolso',
    areaCastService.includes('closeCastWithoutTargets') &&
      areaCastService.includes("resolutionReason: 'no-affected-targets'") &&
      areaCastService.includes('finalizeSaveDamageCast(cast.id, db)')
  );
  check(
    'CB174) definição sintética de área fora do catálogo e NENHUMA spell PHB de área registrada',
    areaSyntheticSource.includes("'test.synthetic-area-save-damage'") &&
      !source('../src/modules/shared/spells/index.ts').includes('synthetic-area-save-damage') &&
      !areaRegistry.includes('fireball') &&
      !areaRegistry.includes('burning-hands') &&
      !areaRegistry.includes('thunderwave') &&
      !areaRegistry.includes('lightning-bolt')
  );
  check(
    'CB175) sem Area Picker visual prematuro e o smoke de área integra o runner principal',
    !source('src/combat/CombatTracker.tsx').includes('areaPlacement') &&
      !source('src/components/SheetView.tsx').includes('areaPlacement') &&
      areaRunner.includes('smokeAreaTargetingFoundation(BASE_URL, check)')
  );

  // 6.6J.4 — Multiple Attacks / Beams Foundation.
  const multiAttackSource = source(
    '../src/modules/spells/execution/attack-damage-resolution.ts',
  );
  const multiCastService = source('../src/modules/spells/execution/spell-cast.service.ts');
  const multiSchema = source('../src/modules/spells/execution/spell-cast.schema.ts');
  const multiSnapshot = source('../src/modules/spells/execution/spell-resolution-snapshot.ts');
  const multiDefinition = source(
    '../src/modules/spells/execution/spell-execution-definition.ts',
  );
  const multiDto = source('../src/modules/spells/execution/spell-cast.dto.ts');
  const multiRegistry = source('../src/modules/spells/execution/spell-execution-registry.ts');
  const multiRunner = source('../src/scripts/smoke-realtime.ts');
  check(
    'CB176) múltiplos ataques usam o MESMO resolver compartilhado (d20 vs CA) e o mesmo núcleo de dano',
    multiAttackSource.includes("from '../../combat/attack-resolution.js'") &&
      multiAttackSource.includes('selectAttackRoll(') &&
      multiAttackSource.includes('resolveAttackOutcome(') &&
      multiAttackSource.includes('targetArmorClassOf(') &&
      multiAttackSource.includes('resolveDamage(') &&
      !multiAttackSource.includes('Math.random') &&
      !multiAttackSource.includes('rollD20(')
  );
  check(
    'CB177) a QUANTIDADE de jogadas vem da definição (server) e o cliente não envia d20/AC/acerto/dano',
    multiDefinition.includes('attackCountOf(') &&
      multiDefinition.includes('AttackCountDefinition') &&
      multiAttackSource.includes('attackCountOf(') &&
      multiAttackSource.includes('SPELL_ATTACK_COUNT_INVALID') &&
      !multiSchema.includes('attackCount') &&
      !multiSchema.includes('naturalRoll') &&
      !multiSchema.includes('targetAc') &&
      !multiSchema.includes('critical')
  );
  check(
    'CB178) repetição de alvo só com `allowRepeatedTarget`; a recusa GLOBAL de duplicata continua para as outras magias',
    multiCastService.includes('allowRepeatedTarget === true') &&
      multiCastService.includes('repeatedTargetsAllowed') &&
      multiCastService.includes('SPELL_TARGET_DUPLICATE') &&
      multiCastService.includes('SPELL_ATTACK_COUNT_INVALID') &&
      multiSnapshot.includes('selectedModifiers')
  );
  check(
    'CB179) ocorrências e eventos de dano têm identidades DETERMINÍSTICAS por índice, na ordem do snapshot',      multiAttackSource.includes('attack:${index}') &&
      multiAttackSource.includes('occurrences.push({') &&
      multiSnapshot.includes('attacks: z.array(spellAttackOccurrenceSnapshotSchema)') &&
      multiSnapshot.includes('index: z.number().int().nonnegative()')
  );
  check(
    'CB180) snapshot antigo de UMA jogada continua legível (normalização v1 → v2) sem migration de dados',
    multiSnapshot.includes('legacyAttackDamageSnapshotSchema') &&
      multiSnapshot.includes('normalizeAttackDamageSnapshot') &&
      multiSnapshot.includes("'attacks' in value") &&
      multiDto.includes("occurrence.target.kind === 'character'") &&
      !source('../prisma/schema.prisma').includes('SpellAttackOccurrence')
  );
  check(
    'CB181) ataque múltiplo não usa Resolution Card nem pede decisão do alvo (resolução imediata)',
    !multiAttackSource.includes('resolution-requests') &&
      !multiAttackSource.includes('CombatResolutionRequest') &&
      !multiCastService.includes('CombatResolutionRequest')
  );
  check(
    'CB182) definição sintética fora do catálogo/registry e NENHUMA spell PHB de múltiplos raios registrada',
    !multiRegistry.includes('test.synthetic-multi-attack') &&
      !source('../src/modules/shared/spells/index.ts').includes('synthetic-multi-attack') &&
      !multiRegistry.includes('eldritch-blast') &&
      !multiRegistry.includes('scorching-ray') &&
      !multiRegistry.includes('fire-bolt') &&
      !multiRegistry.includes('ray-of-frost') &&
      !multiRegistry.includes('inflict-wounds') &&
      !multiRegistry.includes('ice-knife')
  );
  check(
    'CB183) o smoke de múltiplos ataques integra o runner principal',
    multiRunner.includes('smokeMultipleSpellAttacks(BASE_URL, check)')
  );

  const coverRulesSource = source('../src/modules/combat/cover.ts');
  const coverServiceSource = source('../src/modules/combat/cover.service.ts');
  const coverCombatSource = source('../src/modules/combat/combat.service.ts');
  const coverAttackSource = source('../src/modules/spells/execution/attack-damage-resolution.ts');
  const coverCastSource = source('../src/modules/spells/execution/spell-cast.service.ts');
  const coverSnapshotSource = source('../src/modules/spells/execution/spell-resolution-snapshot.ts');
  const coverDiceSource = source('../src/modules/dice/dice.service.ts');
  const coverRunnerSource = source('../src/scripts/smoke-realtime.ts');
  check(
    'CB184) Cover é um módulo PURO e relacional — sem banco, Condition, Effect ou bônus permanente de CA',
    coverRulesSource.includes('CoverEvaluationInput') &&
      coverRulesSource.includes('interaction: CoverInteraction') &&
      !coverRulesSource.includes('prisma') &&
      !coverRulesSource.includes('mechanicalState') &&
      !coverRulesSource.includes('character.ac +=')
  );
  check(
    'CB185) sem geometria o provider padrão é ASSISTIDO (`not-assessed`) — nunca `known:none`',
    coverServiceSource.includes("status: 'not-assessed'") &&
      coverServiceSource.includes('assistedCoverProvider') &&
      coverRulesSource.includes("'not-assessed'") &&
      coverRulesSource.includes("'unknown'")
  );
  check(
    'CB186) PHB 2014: +2/+5 em CA e APENAS em salvaguarda de Destreza',
    coverRulesSource.includes("if (ability !== 'dexterity') return 0") &&
      coverRulesSource.includes("if (level === 'half') return 2") &&
      coverRulesSource.includes("if (level === 'three-quarters') return 5")
  );
  check(
    'CB187) Total Cover é falha de TARGETING recusada antes do d20 (arma e magia), nunca +999 CA',
    coverCombatSource.includes('TARGET_TOTAL_COVER') &&
      coverAttackSource.includes('SPELL_TARGET_TOTAL_COVER') &&
      !coverRulesSource.includes('acBonus: 999') &&
      !coverRulesSource.includes('saveBonus: 999')
  );
  check(
    'CB188) CA situacional por interação: bônus somado na resolução, nunca gravado na ficha',
    coverCombatSource.includes('cover.acBonus') &&
      coverAttackSource.includes('baseTargetAc + cover.acBonus') &&
      !coverCombatSource.includes('armorClass: cover')
  );
  check(
    'CB189) snapshot de ataque registra cover por ocorrência (campo opcional, casts antigos válidos)',
    coverSnapshotSource.includes('cover: coverSnapshotSchema.optional()') &&
      coverSnapshotSource.includes('coverSnapshotSchema')
  );
  check(
    'CB190) Chama Sagrada conecta `ignoreSaveCover` ao pipeline genérico de salvaguarda',
    coverCastSource.includes('ignoreSaveCover') &&
      coverDiceSource.includes('coverBonus') &&
      !coverCastSource.includes("spellId === 'sacred-flame'")
  );
  check(
    'CB191) o smoke de cover integra o runner principal',
    coverRunnerSource.includes('smokeCoverFoundation(BASE_URL, check)')
  );

  const coverAttackSchema = source('../src/modules/combat/combat.schema.ts');
  const coverAreaSource = source('../src/modules/spells/execution/area-targeting.service.ts');
  const coverSmokeSource = source('../src/scripts/smoke-cover-foundation.ts');
  check(
    'CB192) ataque de arma aceita SÓ `coverConfirmation` (nível por alvo), nunca bônus/AC',
    coverAttackSchema.includes('coverConfirmation') &&
      coverAttackSchema.includes("'three-quarters'") &&
      !coverAttackSchema.includes('coverBonus') &&
      !coverAttackSchema.includes('effectiveAc')
  );
  check(
    'CB193) PLAYER recusado e decisão do Mestre limitada ao que o provider NÃO sabe',
    coverCombatSource.includes('COVER_CONFIRMATION_FORBIDDEN') &&
      coverCombatSource.includes('COVER_TARGET_MISMATCH') &&
      coverCombatSource.includes('assertCoverDecisionAllowed') &&
      coverServiceSource.includes('COVER_DECISION_NOT_ALLOWED')
  );
  check(
    'CB194) Total Cover em arma é recusado antes de economia/rolagem e o retry preserva a decisão',
    coverCombatSource.indexOf('TARGET_TOTAL_COVER') <
      coverCombatSource.indexOf("spendEconomy(economy, 'bonus-action')") &&
      coverCombatSource.includes('cover,') &&
      !coverCombatSource.includes('armorClass: cover')
  );
  check(
    'CB195) área avalia cobertura na ORIGEM RESOLVIDA (nunca no caster fixo)',
    coverAreaSource.includes('resolvedOrigin.resolved,') &&
      coverAreaSource.includes("interaction: 'dexterity-save'") &&
      !coverAreaSource.includes("interaction: 'area-propagation'")
  );
  check(
    'CB196) o smoke prova adjudicação de arma, área com origem resolvida e freeze no COMMIT',
    coverSmokeSource.includes('COVER_CONFIRMATION_FORBIDDEN') &&
      coverSmokeSource.includes('TARGET_TOTAL_COVER') &&
      coverSmokeSource.includes('resolveAreaTargets') &&
      coverSmokeSource.includes('FREEZE')
  );

  check(
    'CB167) nenhuma UI multi-alvo dedicada: os Resolution Cards genéricos bastam',
    !source('../src/modules/combat/resolution-requests.ts').includes('MultiTarget') &&
      !smokeRunner.includes('MultiTargetSaveModal') &&
      smokeRunner.includes('smokeMultiTargetSaveDamage(BASE_URL, check)')
  );

  check(
    'CB132) NPC escala por campo explícito; nenhum spell attack REAL foi registrado',
    source('../src/modules/shared/creature-spellcasting.ts').includes('cantripScalingLevel') &&
      !registrySource.includes("kind: 'spell-attack'") &&
      !registrySource.includes("kind: 'attack-damage'")
  );
  check(
    'CB133) o smoke da Chama Sagrada integra o runner principal',
    smokeRunner.includes('smokeSacredFlame(BASE_URL, check)')
  );

  // 6.6I.3 — Palavra Curativa: cura imediata declarativa, server-side.
  const healingWord = source('../src/modules/spells/execution/healing-word.ts');
  const immediateHealing = source('../src/modules/spells/execution/immediate-healing-resolution.ts');
  const healingSnapshot = source('../src/modules/spells/execution/spell-resolution-snapshot.ts');
  const castSchema = source('../src/modules/spells/execution/spell-cast.schema.ts');
  check(
    'CB134) Palavra Curativa é `immediate-healing` declarativa: 1d4, scaling por espaço, sem Effect Definition',
    registrySource.includes('HEALING_WORD_SPELL_ID') &&
      registrySource.includes("kind: 'immediate-healing'") &&
      healingWord.includes('HEALING_WORD_SLOT_SCALING') &&
      healingWord.includes('baseSpellLevel') &&
      healingWord.includes('dicePerLevelAboveBase') &&
      !healingWord.includes('characterLevel') &&
      !healingWord.includes('challengeRating') &&
      !healingWord.includes('effectDefinitionId')
  );
  check(
    'CB135) cura usa `resolveHealing` (nunca `resolveDamage`) e não escreve HP direto',
    immediateHealing.includes('resolveHealing(') &&
      !immediateHealing.includes('resolveDamage(') &&
      !immediateHealing.includes('hpCurrent =') &&
      !immediateHealing.includes('UPDATE "characters"') &&
      !immediateHealing.includes('UPDATE "combatants"')
  );
  check(
    'CB136) modificador vem do snapshot do cast, com eventId determinístico e snapshot persistido',
    immediateHealing.includes('spellcastingAbilityModifier') &&
      immediateHealing.includes('spell-cast:${castId}:healing') &&
      immediateHealing.includes('resolutionSnapshot') &&
      healingSnapshot.includes("kind: z.literal('immediate-healing')") &&
      source('../src/modules/combat/damage-target.ts').includes('damageTargetOf') &&
      !immediateHealing.includes('req.body')
  );
  check(
    'CB137) cliente não envia cura/atributo e não há card dedicado de Healing Word',
    !castSchema.includes('healingAmount') &&
      !castSchema.includes('healingDice') &&
      !castSchema.includes('abilityModifier') &&
      !castSchema.includes('targetHp') &&
      !source('src/combat/components/CombatLog.tsx').includes('Palavra Curativa') &&
      !source('src/combat/components/ResolutionCard.tsx').includes('healing-word') &&
      source('../src/modules/combat/resolution-requests.ts').includes("kind: 'death-saving-throw'")
  );
  check(
    'CB138) morto é recusado antes do COMMIT e morto-vivo/constructo NÃO é filtro de targeting',
    healingWord.includes('SPELL_TARGET_DEAD') &&
      healingWord.includes('deathStateOf') &&
      registrySource.includes('noEffectOnCreatureTypes') &&
      !registrySource.includes("value: 'undead'") &&
      !registrySource.includes("value: 'construct'")
  );
  check(
    'CB139) Palavra Curativa não cria Effect/Pending/Concentração nem card interativo',
    registrySource.includes('requiresConcentration: false') &&
      immediateHealing.includes('create(') === false &&
      !immediateHealing.includes('effectInstance') &&
      !immediateHealing.includes('pendingEffectSave') &&
      source('../src/modules/spells/execution/spell-cast.service.ts').includes('immediate-healing')
  );
  check(
    'CB140) o smoke da Palavra Curativa integra o runner principal',
    smokeRunner.includes('smokeHealingWord(BASE_URL, check)')
  );

  // 6.6I.4 — Fundação compartilhada de ataque mágico (d20 vs CA).
  const attackResolver = source('../src/modules/combat/attack-resolution.ts');
  const attackDamage = source('../src/modules/spells/execution/attack-damage-resolution.ts');
  const executionDefinition = source(
    '../src/modules/spells/execution/spell-execution-definition.ts'
  );
  const spellSnapshot = source('../src/modules/spells/execution/spell-resolution-snapshot.ts');
  check(
    'CB141) arma e magia usam o MESMO resolver d20 vs CA (nenhum segundo motor)',
    attackResolver.includes('export function selectAttackRoll') &&
      attackResolver.includes('export function resolveAttackOutcome') &&
      combatServiceSource.includes("from './attack-resolution.js'") &&
      combatServiceSource.includes('selectAttackRoll(') &&
      combatServiceSource.includes('resolveAttackOutcome(') &&
      attackDamage.includes('selectAttackRoll(') &&
      attackDamage.includes('resolveAttackOutcome(') &&
      !combatServiceSource.includes('attackRoll !== 1')
  );
  check(
    'CB142) nat 1/nat 20/crítico moram numa regra ÚNICA e determinística (nada de "rolar até sair")',
    attackResolver.includes('naturalRoll === 1') &&
      attackResolver.includes('naturalRoll === 20') &&
      attackResolver.includes('critThreshold') &&
      !attackResolver.includes('Math.random') &&
      !attackDamage.includes('rollD20(')
  );
  check(
    'CB143) o crítico dobra TODOS os dados e nunca o bônus fixo (componentes múltiplos)',
    attackResolver.includes('export function rollAttackDamageComponents') &&
      attackResolver.includes('critical ? 2 : 1') &&
      attackDamage.includes('rollAttackDamageComponents(') &&
      attackResolver.includes('bonus: number') &&
      attackResolver.includes('rawAmount: Math.max(0, diceTotal + bonus)')
  );
  check(
    'CB144) bônus de ataque vem do SNAPSHOT do cast e a CA é o estado ATUAL do alvo',
    attackDamage.includes('spellAttackBonus') &&
      !attackDamage.includes('spellAttackBonusFrom(') &&
      attackDamage.includes('targetArmorClassOf(') &&
      attackResolver.includes('characterArmorClass(') &&
      attackResolver.includes('npcEffectiveArmorClass(') &&
      !attackDamage.includes('targetArmorClass =') &&
      spellSnapshot.includes("kind: z.literal('attack-damage')")
  );
  check(
    'CB145) dano do spell attack passa por `resolveDamage` (sem HP direto) e compõe morte/Concentração',
    attackDamage.includes('resolveDamage(') &&
      !attackDamage.includes('hpCurrent =') &&
      !attackDamage.includes('applyHpMutation(') &&
      !attackDamage.includes('resolveHealing(') &&
      attackDamage.includes('applyDamageConsequences(') &&
      attackDamage.includes('noteDamageConcentration(')
  );
  check(
    'CB146) cliente NÃO envia bônus/CA/d20/hit/crítico e magia não cria Effect/Pending/Concentração',
    !castSchema.includes('attackBonus') &&
      !castSchema.includes('naturalRoll') &&
      !castSchema.includes('targetArmorClass') &&
      !castSchema.includes('critical') &&
      !attackDamage.includes('effectInstance') &&
      !attackDamage.includes('pendingEffectSave') &&
      !attackDamage.includes('state.concentration =')
  );
  check(
    'CB147) a definição sintética é de TESTE e o registry de produção continua sem spell attack',
    source('../src/scripts/smoke-spell-attack-foundation.ts').includes('test.synthetic-spell-attack') &&
      !registrySource.includes('test.synthetic-spell-attack') &&
      executionDefinition.includes("kind: 'attack-damage'") &&
      !registrySource.includes("kind: 'attack-damage'")
  );
  check(
    'CB148) Fire Bolt, Eldritch Blast e Inflict Wounds NÃO foram implementados',
    !registrySource.includes('fire-bolt') &&
      !registrySource.includes('eldritch-blast') &&
      !registrySource.includes('inflict-wounds') &&
      !executionDefinition.includes('fire-bolt')
  );
  check(
    'CB149) miss não inventa evento de dano e o ataque tem identidade determinística',
    attackDamage.includes('attack-miss') &&
      attackDamage.includes('spell-cast:${castId}:attack:${index}') &&
      attackDamage.includes(':damage') &&
      attackDamage.includes("damageSnapshot: SpellAttackOccurrenceSnapshot['damage'] = null") &&
      spellSnapshot.includes('damage: attackDamageEventSnapshotSchema.nullable()')
  );
  check(
    'CB150) o smoke da fundação de spell attack integra o runner principal',
    smokeRunner.includes('smokeSpellAttackFoundation(BASE_URL, check)')
  );

  // 6.6J.1 — consequência genérica do save (`none`/`half`/`full`).
  const saveOutcome = source('../src/modules/spells/execution/save-damage-outcome.ts');
  const saveHalfSmoke = source('../src/scripts/smoke-save-half-damage.ts');
  const saveHalfDefinition = source('../src/modules/spells/execution/save-half-test-definition.ts');
  const spellCatalog = source('../src/modules/shared/spells/index.ts');
  check(
    'CB151) o desfecho do save é declarativo por componente: none | half | full',
    saveOutcome.includes("'none' | 'half' | 'full'") &&
      saveOutcome.includes('export function applySaveDamageShare') &&
      saveOutcome.includes('export function applySaveDamageOutcome') &&
      executionDefinition.includes('outcome: {') &&
      executionDefinition.includes('success: SaveDamageShare') &&
      executionDefinition.includes('failure: SaveDamageShare') &&
      executionDefinition.includes('components: readonly {')
  );
  check(
    'CB152) Chama Sagrada continua `success: none` (nunca meia-dano por engano)',
    registrySource.includes("outcome: { success: 'none', failure: 'full' }") &&
      !registrySource.includes("outcome: { success: 'none', failure: 'none' }")
  );
  check(
    'CB153) a metade é aplicada POR COMPONENTE e ANTES das defesas',
    finalizer.includes('applySaveDamageOutcome(') &&
      finalizer.indexOf('applySaveDamageOutcome(') < finalizer.indexOf('resolveDamage(') &&
      finalizer.includes('rawAmount: component.rawAmount') &&
      finalizer.includes('damageAfterSave')
  );
  check(
    'CB154) arredondamento da metade usa floor e o helper é puro (sem resolveDamage)',
    saveOutcome.includes('Math.floor(amount / 2)') &&
      !saveOutcome.includes('resolveDamage(') &&
      !saveOutcome.includes('prisma')
  );
  check(
    'CB155) o núcleo de dano NÃO conhece salvaguarda nem consequência de save',
    !damageCore.includes('saveOutcome') &&
      !damageCore.includes('applySaveDamageOutcome') &&
      !damageCore.includes('pendingEffectSave') &&
      damageCore.includes('export async function resolveDamage')
  );
  check(
    'CB156) cliente não envia desfecho/multiplicador de dano nem dados',
    !castSchema.includes('saveOutcome') &&
      !castSchema.includes('damageMultiplier') &&
      !castSchema.includes('halfDamage') &&
      !castSchema.includes('damageAfterSave')
  );
  check(
    'CB157) a definição sintética NÃO está no catálogo e o smoke é o único dono dela',
    saveHalfDefinition.includes("test.synthetic-save-half") &&
      saveHalfSmoke.includes('test.synthetic-save-half') &&
      !spellCatalog.includes('test.synthetic-save-half') &&
      !castOptions.includes('test.synthetic-save-half')
  );
  check(
    'CB158) Fireball, Burning Hands e Thunderwave continuam ausentes (área é etapa separada)',
    !registrySource.includes('fireball') &&
      !registrySource.includes('burning-hands') &&
      !registrySource.includes('thunderwave') &&
      !executionDefinition.includes('fireball')
  );
  check(
    'CB159) dano da prova passa por `resolveDamage` e Concentração usa o dano FINAL',
    finalizer.includes('resolveDamage(') &&
      !finalizer.includes('applyHpMutation(') &&
      finalizer.includes('noteDamageConcentration(') &&
      finalizer.includes('finalDamage') &&
      finalizer.indexOf('applySaveDamageOutcome(') <
        finalizer.indexOf('noteDamageConcentration(')
  );
  check(
    'CB160) o smoke de save-for-half integra o runner principal',
    smokeRunner.includes('smokeSaveHalfDamage(BASE_URL, check)')
  );

/* -------------------------------------------------------------------------- */
/* 6.6L.1 — Fundação espacial (invariantes de arquitetura)                     */
/* -------------------------------------------------------------------------- */
const spatialTypes = source('../src/modules/combat/spatial/spatial.types.ts');
const spatialSize = source('../src/modules/combat/spatial/spatial-size.ts');
const spatialOccupied = source('../src/modules/combat/spatial/occupied-space.ts');
const spatialProjection = source('../src/modules/combat/spatial/spatial-projection.ts');
const spatialService = source('../src/modules/combat/spatial/spatial-scene.service.ts');
const spatialSchema = source('../src/modules/combat/combat.schema.ts');
const combatRoutes = source('../src/modules/combat/combat.routes.ts');
const combatDtoSource = source('../src/modules/combat/combat.dto.ts');
const prismaSchema = source('../prisma/schema.prisma');
const creatureSchemaSource = source('../src/modules/creatures/creatures.schema.ts');
const creatureServiceSource = source('../src/modules/creatures/creatures.service.ts');
const smokeSpatial = source('../src/scripts/smoke-spatial-scene-foundation.ts');
const modelBlock = (name: string): string => {
  const start = prismaSchema.indexOf(`model ${name} {`);
  if (start < 0) return '';
  // O bloco termina na linha que fecha o modelo (`\n}`), não no primeiro `}`:
  // defaults JSONB contêm `}` no próprio texto.
  const end = prismaSchema.indexOf('\n}', start);
  return prismaSchema.slice(start, end < 0 ? undefined : end);
};

check(
  'CB161) posição espacial pertence ao COMBATANTE (instância), não à ficha',
  modelBlock('Combatant').includes('spatialPosition') &&
    !modelBlock('Character').includes('spatialPosition')
);
check(
  'CB162) o TEMPLATE de criatura não guarda posição de combate',
  !modelBlock('Creature').includes('spatialPosition') &&
    !modelBlock('Creature').includes('position')
);
check(
  'CB163) tamanho do Character vem da RAÇA estruturada (catálogo/custom), sem hardcode de nome',
  spatialProjection.includes('getRace(') &&
    spatialProjection.includes('customRace.findMany') &&
    !/race\.name|namePt\s*===\s*'Halfling'/.test(spatialProjection)
);
check(
  'CB164) tamanho de NPC/Creature é persistido e Master-authoritative',
  modelBlock('Creature').includes('size') &&
    creatureSchemaSource.includes('creatureSizeSchema') &&
    creatureServiceSource.includes("'size'")
);
check(
  'CB165) placement NÃO aceita tamanho/occupiedSpace e deriva o espaço no servidor',
  spatialSchema.includes('spatialPositionPatchSchema') &&
    !/spatialPositionPatchSchema[\s\S]{0,400}size:/.test(spatialSchema) &&
    spatialService.includes('occupiedSpaceOf(position, combatant.baseSize') &&
    spatialService.includes('SPATIAL_POSITION_OUT_OF_BOUNDS')
);
check(
  'CB166) Small e Medium continuam DISTINTOS; Tiny 2,5 e Large 10 pés',
  /tiny:\s*\{\s*widthFeet:\s*2\.5/.test(spatialSize) &&
    /small:\s*\{\s*widthFeet:\s*5/.test(spatialSize) &&
    /medium:\s*\{\s*widthFeet:\s*5/.test(spatialSize) &&
    /large:\s*\{\s*widthFeet:\s*10/.test(spatialSize) &&
    spatialSize.includes('SPATIAL_SIZES') &&
    spatialTypes.includes("'small'") &&
    spatialTypes.includes("'medium'")
);
check(
  'CB167.1) cadastro de Creature oferece TAMANHO (select PT-BR) e envia o rótulo canônico',
  source('src/components/master/CreatureEditor.tsx').includes('aria-label="Tamanho da criatura"') &&
    source('src/components/master/CreatureEditor.tsx').includes(
      'onPatch({\n                size: CREATURE_SIZE_LABEL_BY_SPATIAL[event.target.value as SpatialSize],'
    ) &&
    source('src/components/master/CreatureEditor.tsx').includes('SPATIAL_SIZE_ORDER.map') &&
    source('src/combat/grid/gridMath.ts').includes('CREATURE_SIZE_LABEL_BY_SPATIAL') &&
    source('src/combat/grid/gridMath.ts').includes("gargantuan: 'Gargantuan'") &&
    source('src/types.ts').includes("'Gargantuan'") &&
    // Nenhuma string traduzida é enviada ao servidor: o valor é o rótulo do enum.
    !/size:\s*event\.target\.value/.test(source('src/components/master/CreatureEditor.tsx'))
);
check(
  'CB167) occupiedSpace é DERIVADO (nenhuma coluna min/max no banco)',
  spatialOccupied.includes('export function occupiedSpaceOf') &&
    !prismaSchema.includes('occupiedSpace') &&
    !prismaSchema.includes('minXFeet')
);
check(
  'CB168) token reutiliza retrato/imagem existentes e pode ser null (fallback `?` futuro)',
  /tokenImageRef:\s*combatant\.character\?\.avatarUrl\s*\|\|\s*combatant\.creature\?\.imageUrl\s*\|\|\s*null/.test(
    combatDtoSource
  ) &&
    combatDtoSource.includes('tokenImageRef: string | null') &&
    !combatDtoSource.includes('tokenUpload')
);
check(
  'CB169) PLAYER não é autoridade espacial (config/placement MASTER-only)',
  (combatRoutes.match(/spatial-config'[\s\S]{0,120}requireRole\('MASTER'\)/g) ?? []).length === 1 &&
    (combatRoutes.match(/spatial-position'[\s\S]{0,200}requireRole\('MASTER'\)/g) ?? []).length === 1 &&
    spatialService.includes("role !== 'MASTER'")
);
check(
  'CB170) ainda NÃO há distância/alcance/movimento/Cover/AoE geométricos',
  !spatialTypes.includes('distanceFeet') &&
    !spatialOccupied.includes('distance') &&
    !spatialService.includes('cover') &&
    !spatialService.includes('area')
);
check(
  'CB171) o smoke espacial integra o runner principal',
  smokeRunner.includes('smokeSpatialScene(BASE_URL, check)') &&
    smokeSpatial.includes('SPATIAL_SCENE_RESIZE_CONFLICT') &&
    smokeSpatial.includes('SPATIAL_POSITION_OUT_OF_BOUNDS')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.1 — Grid visual (rendering puro a partir do DTO espacial)              */
/* -------------------------------------------------------------------------- */
const gridSource = (file: string): string => source(`src/combat/grid/${file}`);
const gridMathSource = gridSource('gridMath.ts');
const gridTokenSource = gridSource('GridToken.tsx');
const combatGridSource = gridSource('CombatGrid.tsx');
const gridApiSource = gridSource('gridApi.ts');
const gridCssSource = gridSource('grid.css');
/** Primitive ÚNICA de animação de movimento (6.6M.3.1.4). */
const movementVisualSource = gridSource('movementVisual.ts');
const gridSceneSource = gridSource('SpatialSceneControls.tsx');
const gridTraySource = gridSource('UnplacedCombatantsTray.tsx');
const combatTrackerSource = source('src/combat/CombatTracker.tsx');

const sceneOf = (mode: 'assisted' | 'grid-2d'): SpatialScene => ({
  mode,
  widthFeet: 100,
  heightFeet: 100,
  cellSizeFeet: 5,
});

const unitOf = (
  id: string,
  size: SpatialSize,
  options: {
    position?: { xFeet: number; yFeet: number } | null;
    image?: string | null;
    visibility?: 'public' | 'master-only';
  } = {},
): GridUnit => {
  const position = options.position === undefined ? { xFeet: 0, yFeet: 0 } : options.position;
  const footprint = SIZE_FOOTPRINT_FEET[size];
  const spatial: CombatantSpatial = {
    tokenImageRef: options.image ?? null,
    baseSize: size,
    effectiveSize: size,
    position,
    occupiedSpace: position
      ? {
          minXFeet: position.xFeet,
          minYFeet: position.yFeet,
          maxXFeet: position.xFeet + footprint.widthFeet,
          maxYFeet: position.yFeet + footprint.heightFeet,
          widthFeet: footprint.widthFeet,
          heightFeet: footprint.heightFeet,
        }
      : null,
  };
  return { id, name: id, spatial, spatialVisibility: options.visibility ?? 'public' };
};

const combatOf = (units: GridUnit[], mode: 'assisted' | 'grid-2d' = 'grid-2d') => ({
  id: 'grid-combat',
  version: 4,
  status: 'ACTIVE' as const,
  currentCombatantId: units[0]?.id ?? null,
  spatial: sceneOf(mode),
  combatants: units,
});

const tokenHtml = (unit: GridUnit): string =>
  renderToStaticMarkup(
    createElement(GridToken, {
      combatant: unit,
      cellSizeFeet: 5,
      pixelsPerCell: 44,
      interactive: false,
    }),
  );

check(
  'CB172) pés → pixels exatos e cena 100×100 em 20×20 células (somente rendering)',
  feetToPx(10, 5, 44) === 88 &&
    scenePixels(sceneOf('grid-2d'), 5, 44).width === 880 &&
    scenePixels(sceneOf('grid-2d'), 5, 44).height === 880
);
check(
  'CB173) footprint VISUAL por tamanho: Tiny 0,5 · Small/Medium 1 · Large 2 · Huge 3 · Gargantuan 4 células',
  tokenHtml(unitOf('tiny', 'tiny')).includes('width:22px') &&
    tokenHtml(unitOf('small', 'small')).includes('width:44px') &&
    tokenHtml(unitOf('medium', 'medium')).includes('width:44px') &&
    tokenHtml(unitOf('large', 'large')).includes('width:88px') &&
    tokenHtml(unitOf('huge', 'huge')).includes('width:132px') &&
    tokenHtml(unitOf('garg', 'gargantuan')).includes('width:176px')
);
check(
  'CB174) Tiny NÃO é arredondado para uma célula (data-size + 0,5 célula)',
  tokenHtml(unitOf('tiny', 'tiny')).includes('data-size="tiny"') &&
    !tokenHtml(unitOf('tiny', 'tiny')).includes('width:44px') &&
    tokenArtSize({ width: 22, height: 22 }) <= 22
);
check(
  'CB175) imagem usa tokenImageRef; sem imagem → fallback `?` centralizado e escalável',
  tokenHtml(unitOf('hero', 'medium', { image: '/uploads/characters/hero.png' })).includes(
    '<img'
  ) &&
    !tokenHtml(unitOf('hero', 'medium', { image: '/uploads/characters/hero.png' })).includes('?') &&
    tokenHtml(unitOf('vazio', 'large')).includes('?') &&
    tokenHtml(unitOf('vazio', 'large')).includes('grid-token-fallback') &&
    gridCssSource.includes('--grid-token-art') &&
    gridCssSource.includes('place-items: center') &&
    !gridTokenSource.includes('<svg') &&
    !gridTokenSource.includes('.png')
);
check(
  'CB176) position null não vira 0,0: token não rende e a unidade vai para a bandeja',
  tokenHtml(unitOf('fora', 'medium', { position: null })) === '' &&
    splitByPlacement([
      unitOf('dentro', 'medium'),
      unitOf('fora', 'large', { position: null }),
    ]).unplaced.map((item) => item.id).join(',') === 'fora'
);
check(
  'CB177) combatente privado (spatial null) NÃO é renderizado pelo grid',
  !combatGridSource.includes('imageUrl') &&
    !renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([unitOf('hero', 'medium', { image: '/a.png' })]),
        isMaster: false,
        onCombatChange: () => undefined,
        onError: () => undefined,
      })
    ).includes('NPC escondido') &&
    splitByPlacement([
      unitOf('hero', 'medium'),
      { id: 'oculto', name: 'NPC escondido', spatial: null },
    ]).placed.length === 1
);
check(
  'CB178) MASTER vê a bandeja e as instruções de posicionamento; PLAYER é somente leitura',
  renderToStaticMarkup(
    createElement(CombatGrid, {
      combat: combatOf([
        unitOf('hero', 'medium'),
        unitOf('fora', 'large', { position: null }),
      ]),
      isMaster: true,
      onCombatChange: () => undefined,
      onError: () => undefined,
    })
  ).includes('Posicionar coloca unidades') &&
    renderToStaticMarkup(
      createElement(UnplacedCombatantsTray, {
        combatants: [unitOf('fora', 'large', { position: null })],
        interactive: true,
      })
    ).includes('draggable="true"') &&
    !renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([
          unitOf('hero', 'medium'),
          unitOf('fora', 'large', { position: null }),
        ]),
        isMaster: false,
        onCombatChange: () => undefined,
        onError: () => undefined,
      })
    ).includes('Fora do mapa')
);
check(
  'CB179) assisted NÃO finge geometria: Master recebe “Ativar grid”, Player vê estado neutro',
  renderToStaticMarkup(
    createElement(CombatGrid, {
      combat: combatOf([], 'assisted'),
      isMaster: true,
      onCombatChange: () => undefined,
      onError: () => undefined,
    })
  ).includes('Ativar grid') &&
    !renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([], 'assisted'),
        isMaster: true,
        onCombatChange: () => undefined,
        onError: () => undefined,
      })
    ).includes('grid-plane') &&
    renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([], 'assisted'),
        isMaster: false,
        onCombatChange: () => undefined,
        onError: () => undefined,
      })
    ).includes('Cena assistida')
);
check(
  'CB180) grid consome o DTO espacial real e NÃO cria segunda fonte de posição',
  combatGridSource.includes('combat.spatial') &&
    combatGridSource.includes('splitByPlacement(combat.combatants)') &&
    gridTokenSource.includes('combatant.spatial.tokenImageRef') &&
    !/localGridPositions|tokenPositionStore|useCombatGridStore/.test(
      `${combatGridSource}${gridTokenSource}${gridMathSource}`
    )
);
check(
  'CB181) placement envia só position/expectedVersion/operationId (sem size/occupiedSpace)',
  // Corpo SEM comentários: as chaves proibidas não podem existir no payload.
  (() => {
    const body = gridApiSource.replace(/\/\*[\s\S]*?\*\//g, '');
    return (
      body.includes('position, expectedVersion') &&
      body.includes('createOperationId()') &&
      !body.includes('occupiedSpace') &&
      !body.includes('size')
    );
  })()
);
check(
  'CB182) grid continua SEM Movement/Cover/LoS/AoE (a distância vem do servidor)',
  !/movementCost|movementRemaining|lineOfSight|coverLevel|areaOfEffect|difficultTerrain/i.test(
    `${combatGridSource}${gridMathSource}${gridTokenSource}${gridTraySource}${gridSceneSource}`
  )
);
check(
  'CB183) snap de placement existe e preserva passo de 2,5 pés para Tiny',
  pixelToPlacementFeet(44, 5, 44, 'medium') === 5 &&
    pixelToPlacementFeet(22, 5, 44, 'tiny') === 2.5
);
check(
  'CB184) CSS do grid é ISOLADO (styles.css WIP não recebe o grid)',
  gridCssSource.includes('.grid-plane') &&
    !source('src/styles.css').includes('.grid-plane') &&
    combatTrackerSource.includes("import './grid/grid.css'") &&
    combatTrackerSource.includes('<CombatGrid')
);
check(
  'CB185) espelho de footprints do client é idêntico ao domínio do servidor',
  ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].every((size) => {
    const expected = (
      gridMathSource.match(new RegExp(`${size}: \\{ widthFeet: ([0-9.]+)`)) ?? []
    )[1];
    const server = (
      source('../src/modules/combat/spatial/spatial-size.ts').match(
        new RegExp(`${size}: \\{ widthFeet: ([0-9.]+)`)
      ) ?? []
    )[1];
    return expected !== undefined && expected === server;
  })
);

/* -------------------------------------------------------------------------- */
/* 6.6L.2 — DISTÂNCIA/ALCANCE: a matemática NÃO mora no cliente               */
/* -------------------------------------------------------------------------- */
const distanceDomain = source('../src/modules/combat/spatial/spatial-distance.ts');
const rangeDomain = source('../src/modules/combat/spatial/spatial-range.ts');
const weaponRangeDomain = source('../src/modules/shared/weapon-range.ts');
const distanceService = source(
  '../src/modules/combat/spatial/spatial-distance.service.ts'
);
const spatialCombatSource = source('../src/modules/combat/combat.service.ts');
const spellCastSource = source('../src/modules/spells/execution/spell-cast.service.ts');
const combatRoutesSource = source('../src/modules/combat/combat.routes.ts');

check(
  'CB186) distância/alcance vivem no DOMÍNIO do servidor (nada disso no grid do cliente)',
  distanceDomain.includes('evaluateSpatialDistance') &&
    rangeDomain.includes('evaluateRange') &&
    weaponRangeDomain.includes('weaponRangeOf') &&
    !/evaluateSpatialDistance|evaluateRange|weaponRangeOf/.test(
      `${combatGridSource}${gridMathSource}${gridTokenSource}${gridTraySource}${gridSceneSource}`
    )
);
check(
  'CB187) o cliente NÃO envia distância/alcance: nenhum `distanceFeet`/`rangeBand` no grid',
  !/distanceFeet|rangeBand|isInRange|effectiveReach/.test(
    `${combatGridSource}${gridMathSource}${gridApiSource}${gridTokenSource}`
  ) &&
    !gridApiSource.includes('distanceFeet')
);
check(
  'CB188) read endpoint de distância existe para a 6.6M.2 (UI não recalcula)',
  combatRoutesSource.includes('/spatial/distance') &&
    combatRoutesSource.includes('readCombatDistance') &&
    distanceService.includes('readCombatDistance')
);
check(
  'CB189) diagonal PHB usa max(|dx|,|dy|) e NUNCA Math.hypot/sqrt',
  distanceDomain.includes('anchorDistanceFeet') &&
    distanceDomain.includes('Math.max(Math.abs(a.xFeet - b.xFeet), Math.abs(a.yFeet - b.yFeet))') &&
    !/Math\.hypot|Math\.sqrt/.test(distanceDomain)
);
check(
  'CB190) Tiny preserva 2,5 pés (passo próprio) e Small+ alinha em 5',
  distanceDomain.includes('TINY_GRID_STEP_FEET = 2.5') &&
    distanceDomain.includes("size === 'tiny' ? TINY_GRID_STEP_FEET : GRID_CELL_SIZE_FEET") &&
    gridMathSource.includes("size === 'tiny' ? 2.5 : BASE_CELL_SIZE_FEET")
);
check(
  'CB191) distância usa ESPAÇO OCUPADO (âncoras por quadrado), não centro/top-left',
  distanceDomain.includes('squareAnchorsOf') &&
    distanceDomain.includes('occupiedSpacesOverlap') &&
    distanceService.includes('occupiedSpace') === false &&
    distanceService.includes('spatialBodyOf')
);
check(
  'CB192) ataque valida alcance ANTES de Ação/munição/d20 e long range vira desvantagem',
  spatialCombatSource.includes('TARGET_OUT_OF_REACH') &&
    spatialCombatSource.includes('TARGET_OUT_OF_RANGE') &&
    spatialCombatSource.includes('longRangeDisadvantage') &&
    spatialCombatSource.indexOf('rangeInfo = evaluateRange') <
      spatialCombatSource.indexOf('consumeAmmo(attacker.character.id')
);
check(
  'CB193) magia valida alcance pelo provider do grid (antes do COMMIT)',
  spellCastSource.includes('gridSpatialProvider') &&
    spellCastSource.includes('gridAreaSpatialProvider') &&
    spellCastSource.includes('combatSpatialIndexById') &&
    spellCastSource.indexOf('gridSpatialProvider(spatialIndex)') <
      spellCastSource.indexOf('commitSpellCast(db, context')
);
// Código SEM comentários: as palavras proibidas só podem existir na prosa.
const codeOnly = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const distanceCode = codeOnly(distanceDomain);
const rangeCode = codeOnly(rangeDomain);
const distanceServiceCode = codeOnly(distanceService);

check(
  'CB194) Cover, LoS e AoE continuam separados do alcance',
  distanceServiceCode.includes('evaluateSightGeometry') &&
    distanceServiceCode.includes("return 'unknown'") &&
    !/cover|lineOfSight|membership/i.test(distanceCode) &&
    !/coverLevel|evaluateMembership/i.test(distanceServiceCode)
);
check(
  'CB195) Movement/pathfinding NÃO entram nesta fase',
  !/movementRemaining|pathfinding|movementCost|difficultTerrain/i.test(
    `${distanceCode}${rangeCode}${distanceServiceCode}`
  )
);
check(
  'CB196) placement novo exige alinhamento canônico (erro dedicado no servidor)',
  source('../src/modules/combat/spatial/spatial-scene.service.ts').includes(
    'SPATIAL_POSITION_NOT_GRID_ALIGNED'
  ) && distanceDomain.includes('isGridAligned')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.2 — Distance + Range VISUAL FEEDBACK                                   */
/* -------------------------------------------------------------------------- */
const rulerUiSource = gridSource('GridRuler.tsx');
const rulerGeometrySource = gridSource('gridRuler.ts');
const cameraSource = gridSource('gridCamera.ts');
const hudSource = gridSource('MovementHud.tsx');
const distanceFormatSource = gridSource('distanceFormat.ts');
const attackPanelSource = source('src/combat/components/CombatActionPanel.tsx');
const realtimeEventsSource = source('../src/realtime/events.ts');
const prismaSchemaSource = source('../prisma/schema.prisma');

check(
  'CB197) régua é EXPLÍCITA (tecla F, sem modo) e o clique de medição nunca posiciona',
  combatGridSource.includes("type InteractionMode = 'none' | 'placement'") &&
    !combatGridSource.includes("mode === 'measure'") &&
    combatGridSource.includes("event.key === 'f' || event.key === 'F'") &&
    combatGridSource.includes('Posicionar') &&
    combatGridSource.includes("if (mode !== 'placement') return;") &&
    combatGridSource.includes("if (mode !== 'placement' || !isMaster || locked) return;")
);
check(
  'CB198) placement do Mestre preservado e PLAYER só mede (sem posicionar)',
  combatGridSource.includes("const placementInteractive = isMaster && !locked && mode === 'placement';") &&
    combatGridSource.includes('const measureInteractive = !locked;') &&
    // 6.6M.3: o modo MOVER tem o próprio gate; os dois antigos seguem intactos.
    combatGridSource.includes('const movementInteractive = !locked && Boolean(movableUnitId);') &&
    combatGridSource.includes('setSpatialPosition') &&
    // Ferramenta ativa só reescolhe o alvo; o gesto continua restrito ao
    // combatente com autoridade (nada de ownership ampliado pela UI).
    combatGridSource.includes('interactive={tokenInteractive(combatant)}') &&
    combatGridSource.includes('movableUnitId === combatant.id')
);
check(
  'CB199) React NÃO calcula distância mecânica nem faixa de alcance',
  !/Math\.(sqrt|hypot|cbrt)/.test(
    `${combatGridSource}${gridMathSource}${rulerUiSource}${rulerGeometrySource}${distanceFormatSource}`
  ) &&
    !/normalRangeFeet|longRangeFeet|reachFeet/.test(
      `${combatGridSource}${rulerUiSource}${rulerGeometrySource}${distanceFormatSource}`
    )
);
check(
  'CB200) medição manda só IDs (endpoint de distância + range-preview, zero número)',
  gridApiSource.includes('/spatial/distance') &&
    gridApiSource.includes('/spatial/range-preview') &&
    /new URLSearchParams\(\{ fromCombatantId, toCombatantId/.test(gridApiSource) &&
    !/distanceFeet|normalRangeFeet|longRangeFeet|reachFeet|rangeBand/.test(gridApiSource)
);
check(
  'CB201) formatação preserva 2,5 pés (nunca arredonda) e locale PT-BR',
  formatFeet(0) === '0 pés' &&
    formatFeet(2.5) === '2,5 pés' &&
    formatFeet(5) === '5 pés' &&
    formatFeet(7.5) === '7,5 pés' &&
    formatFeet(60) === '60 pés'
);
check(
  'CB202) unknown/not-assessed mostram motivo e NUNCA um número inventado',
  distanceLabel({
    status: 'unknown',
    distanceFeet: null,
    provenance: null,
    algorithm: null,
    reason: 'target-unplaced',
  }) === 'Fora do mapa' &&
    distanceLabel({
      status: 'not-assessed',
      distanceFeet: null,
      provenance: null,
      algorithm: null,
      reason: 'assisted-mode',
    }) === 'Distância não avaliada' &&
    distanceLabel({
      status: 'unknown',
      distanceFeet: null,
      provenance: null,
      algorithm: null,
      reason: 'not-visible',
    }) === 'Distância desconhecida' &&
    distanceLabel({
      status: 'known',
      distanceFeet: 2.5,
      provenance: 'grid-2d',
      algorithm: 'phb-grid-footprint-v1',
      reason: null,
    }) === '2,5 pés'
);
check(
  'CB203) faixa de alcance exibida a partir do estado do SERVIDOR (long → Desvantagem)',
  rangeSummary({
    status: 'long-range',
    distanceFeet: 200,
    band: 'long',
    reachFeet: null,
    normalRangeFeet: 150,
    longRangeFeet: 600,
    algorithm: 'phb-grid-footprint-v1',
    actionName: 'Arco longo',
    reason: null,
  }) === 'Longo alcance — Desvantagem · 200 pés' &&
    rangeSummary({
      status: 'out-of-range',
      distanceFeet: 65,
      band: 'out',
      reachFeet: null,
      normalRangeFeet: 60,
      longRangeFeet: null,
      algorithm: 'phb-grid-footprint-v1',
      actionName: 'Chama Sagrada',
      reason: null,
    }) === 'Fora do alcance · 65 pés' &&
    rangeSummary({
      status: 'in-range',
      distanceFeet: 25,
      band: 'normal',
      reachFeet: 5,
      normalRangeFeet: null,
      longRangeFeet: null,
      algorithm: 'phb-grid-footprint-v1',
      actionName: 'Espada longa',
      reason: null,
    }) === 'Dentro do alcance · 25 pés' &&
    rangeSummary({
      status: 'unknown',
      distanceFeet: null,
      band: null,
      reachFeet: null,
      normalRangeFeet: null,
      longRangeFeet: null,
      algorithm: null,
      actionName: null,
      reason: 'not-visible',
    }) === 'Alcance desconhecido'
);
check(
  'CB204) range-preview resolve a AÇÃO no servidor e reutiliza a política de privacidade',
  combatRoutesSource.includes('/spatial/range-preview') &&
    distanceService.includes('readCombatRangePreview') &&
    distanceService.includes('canReadDistance(actor, combat, from.id)') &&
    distanceService.includes('combatantAttacks(from)') &&
    distanceService.includes('ATTACK_NOT_FOUND') &&
    !/normalRangeFeet|longRangeFeet|reachFeet|distanceFeet/.test(combatRoutesSource)
);
check(
  'CB205) a linha da régua é DECORAÇÃO (SVG, aria-hidden, pointer-events none)',
  rulerUiSource.includes('grid-ruler-layer') &&
    rulerUiSource.includes('aria-hidden="true"') &&
    rulerUiSource.includes('rulerMidpoint') &&
    !/distanceFeet\s*[-+*]/ .test(rulerUiSource) &&
    /\.grid-ruler-layer[^}]*pointer-events: none/.test(gridCssSource)
);
check(
  'CB206) medição é leitura PURA: sem operationId/versão, sem persistência, sem socket',
  /export function getSpatialDistance\(\s*combatId: string,\s*fromCombatantId: string,\s*toCombatantId: string,?\s*\)/.test(
    gridApiSource
  ) &&
    !/measurement|measure-preview/i.test(realtimeEventsSource) &&
    !/measurement/i.test(prismaSchemaSource)
);
check(
  'CB207) cena assistida não finge distância (aviso explícito, régua só por F)',
  combatGridSource.includes('Distância não disponível sem grid ativo.') &&
    combatGridSource.includes('const rulerActive = quickRuler || ruler !== null;')
);
check(
  'CB208) realtime invalida a medição (nunca valor velho como atual)',
  /combat\.version/.test(combatGridSource) &&
    combatGridSource.includes('rulerSequence') &&
    combatGridSource.includes('setDistance(null)') &&
    combatGridSource.includes('clearRuler')
);
check(
  'CB209) estilos da régua ficam no grid.css (styles.css WIP intocado)',
  gridCssSource.includes('.grid-ruler-line') &&
    gridCssSource.includes('.grid-ruler-label') &&
    !source('src/styles.css').includes('.grid-ruler')
);

const rulerHtml = (distanceFeet: number | null, state: 'loading' | 'success' = 'success'): string =>
  renderToStaticMarkup(
    createElement(GridRuler, {
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      fromLabel: 'Origem',
      toLabel: 'Alvo',
      distance:
        distanceFeet === null
          ? null
          : {
              status: 'known',
              distanceFeet,
              provenance: 'grid-2d',
              algorithm: 'phb-grid-footprint-v1',
              reason: null,
            },
      state,
      locked: true,
    })
  );
const rulerMarkup = rulerHtml(25);
check(
  'CB210) régua desenha a linha e coloca a DISTÂNCIA NO MEIO, em metros, horizontal',
  rulerMarkup.includes('<line') &&
    rulerMarkup.includes('x1="0"') &&
    rulerMarkup.includes('x2="100"') &&
    rulerMarkup.includes('grid-ruler-label') &&
    rulerMarkup.includes('left:50px') &&
    rulerMarkup.includes('top:25px') &&
    rulerMarkup.includes('7,5 m') &&
    rulerHtml(null, 'loading').includes('Calculando…') &&
    /transform:\s*translate\(-50%,\s*-50%\)/.test(
      (gridCssSource.match(/\.grid-ruler-label\s*\{[^}]*\}/) ?? [''])[0]
    )
);
check(
  'CB211) painel de ataque reaproveita a seleção existente para o alcance (sem picker novo)',
  attackPanelSource.includes('getSpatialRangePreview') &&
    attackPanelSource.includes('rangeSummary(rangePreview)') &&
    attackPanelSource.includes('Alcance desconhecido') &&
    !/normalRangeFeet|longRangeFeet|reachFeet/.test(attackPanelSource)
);

/* -------------------------------------------------------------------------- */
/* 6.6L.3 — MOVEMENT + OCCUPANCY FOUNDATION                                    */
/* -------------------------------------------------------------------------- */
const movementDomainSource = source('../src/modules/combat/spatial/spatial-movement.ts');
const movementServiceSource = source('../src/modules/combat/spatial/spatial-movement.service.ts');
const movementGateSource = source('../src/modules/combat/spatial/movement-reaction-gate.ts');
const movementTerrainSource = source('../src/modules/combat/spatial/movement-terrain.ts');
const combatSchemaSource = source('../src/modules/combat/combat.schema.ts');
const movementCombatDtoSource = source('../src/modules/combat/combat.dto.ts');
const spatialSceneSource = source('../src/modules/combat/spatial/spatial-scene.service.ts');
const movementCode = codeOnly(movementDomainSource);
const movementServiceCode = codeOnly(movementServiceSource);
/** Bloco de um model do schema Prisma (para provar onde o side NÃO entra). */
const prismaModel = (name: string): string => {
  const start = prismaSchemaSource.indexOf(`model ${name} {`);
  const end = start >= 0 ? prismaSchemaSource.indexOf('\n}', start) : -1;
  return start >= 0 && end > start ? prismaSchemaSource.slice(start, end) : '';
};

check(
  'CB212) passo ao servidor: Small+ 5 pés, Tiny 2,5 e diagonal com o MESMO custo',
  movementDomainSource.includes('alignmentStepFeet(mover.size)') &&
    movementDomainSource.includes('anchorDistanceFeet(cursor, position)') &&
    !/Math\.hypot|Math\.sqrt/.test(movementDomainSource)
);
check(
  'CB213) custo do movimento é DERIVADO no servidor (cliente só manda o caminho)',
  combatSchemaSource.includes('movementPathSchema = z.array(spatialPositionSchema).max(200)') &&
    /movementCommitSchema = z\s*\.object\(\{[\s\S]{0,400}?\}\)\s*\.strict\(\)/.test(combatSchemaSource) &&
    !/movementCost|totalCostFeet|difficultTerrain|movementRemaining/.test(
      codeOnly(combatRoutesSource)
    ) &&
    movementServiceSource.includes('evaluateMovementForState(combat, combatant, input.path, true)')
);
check(
  'CB214) lado é estado do COMBATANTE (nunca ficha/template) e só o Mestre escreve',
  prismaModel('Combatant').includes('sideKey') &&
    !prismaModel('Character').includes('sideKey') &&
    !prismaModel('Creature').includes('sideKey') &&
    movementCombatDtoSource.includes('sideKey: combatant.sideKey ?? null') &&
    movementCombatDtoSource.includes('return { ...projected, sideKey: null };') &&
    combatRoutesSource.includes('setCombatantSideKey') &&
    spatialSceneSource.includes("'combatant-side'")
);
check(
  'CB215) espaço de criatura é difficult terrain e as fontes NÃO acumulam',
  movementDomainSource.includes("difficultTerrainSources.push('creature-space')") &&
    movementDomainSource.includes("if (terrainStatus === 'difficult') difficultTerrainSources.push('environmental')") &&
    movementDomainSource.includes('const difficultTerrain = difficultTerrainSources.length > 0') &&
    movementDomainSource.includes('distanceFeet * (1 + (crawling ? 1 : 0) + (difficultTerrain ? 1 : 0))')
);
check(
  'CB216) destino ocupado proibido e passagem hostil exige 2 categorias de tamanho',
  movementDomainSource.includes('MOVEMENT_DESTINATION_OCCUPIED') &&
    movementDomainSource.includes('HOSTILE_PASSAGE_SIZE_GAP = 2') &&
    movementDomainSource.includes(
      'Math.abs(sizeOrderOf(mover) - sizeOrderOf(occupant)) >= HOSTILE_PASSAGE_SIZE_GAP'
    ) &&
    movementDomainSource.includes("if (!moverSide || !occupantSide) return 'unknown'")
);
check(
  'CB217) commit REVALIDA o caminho (preview nunca é autoridade) e é idempotente',
  movementServiceCode.includes('evaluateMovementForState(combat, combatant, input.path, true)') &&
    movementServiceCode.includes("status: 'ACTIVE', version: input.expectedVersion") &&
    movementServiceSource.includes("status: 'ACTIVE', version: input.expectedVersion") &&
    movementServiceSource.includes('db.combatOperation.create') &&
    movementServiceSource.includes("'IDEMPOTENCY_KEY_REUSED'")
);
check(
  'CB218) movimento voluntário usa o gate REAL de Opportunity Attack (player-safe)',
  movementGateSource.includes("policy: 'phb-opportunity-attacks'") &&
    movementGateSource.includes('playerSafe: true') &&
    movementServiceSource.includes('opportunityAttackMovementGate.evaluate') &&
    !movementServiceSource.includes("actor.role === 'MASTER' ? administrativeMovementGate")
);
check(
  'CB219) sem walls/squeezing/voo/movimento forçado/pathfinding nesta fase',
  !/pathfind|dijkstra|squeez|flying|swim|climb|forced|walls?|obstacle/i.test(
    `${movementCode}${movementServiceCode}${codeOnly(movementTerrainSource)}`
  )
);
check(
  'CB220) placement administrativo continua SEPARADO (não consome movimento)',
  spatialSceneSource.includes('setCombatantSpatialPosition') &&
    spatialSceneSource.includes('SPATIAL_POSITION_NOT_GRID_ALIGNED') &&
    !spatialSceneSource.includes('moveDistance') &&
    movementServiceSource.includes(
      'orderCombatants(combat.combatants)[combat.currentIndex]?.id !== combatant.id'
    )
);

/* -------------------------------------------------------------------------- */
/* 6.6L.3.1 — MOVEMENT REACTION GATE / OPPORTUNITY ATTACK                     */
/* -------------------------------------------------------------------------- */
const opportunityDomainSource = source('../src/modules/combat/spatial/opportunity-attack.ts');
const opportunityServiceSource = source('../src/modules/combat/spatial/opportunity-attack.service.ts');
const opportunityOpenersSource = source('../src/modules/combat/spatial/opportunity-openers.ts');
const opportunityDomainCode = codeOnly(opportunityDomainSource);
const opportunityServiceCode = codeOnly(opportunityServiceSource);
const opportunityOpenersCode = codeOnly(opportunityOpenersSource);
const actionEconomySource = source('../src/modules/shared/action-economy.ts');
const reactionApiSource = source('../client/src/reactionOpportunitiesApi.ts');
check(
  'CB221) ReactionPanel é REUTILIZADO e NÃO existe segundo motor de Reação',
  combatTrackerSource.includes("import { ReactionPanel } from './components/ReactionPanel'") &&
    combatTrackerSource.includes('resolveOpportunityAttack(') &&
    reactionApiSource.includes('/reaction-opportunities/') &&
    !opportunityServiceCode.includes('reactionUsed') &&
    !combatTrackerSource.includes('reactionUsed')
);
check(
  'CB222) a janela é SERVER-AUTHORITATIVE: cliente manda só attackId/versão/operationId',
  opportunityServiceSource.includes("operationType: 'opportunity-attack'") &&
    opportunityServiceSource.includes('forcedReaction: true') &&
    combatRoutesSource.includes("'/:combatId/reaction-opportunities/:opportunityId/attack'") &&
    reactionApiSource.includes('attackId, expectedVersion, operationId') &&
    !reactionApiSource.includes('attackBonus') &&
    !reactionApiSource.includes('armorClass')
);
check(
  'CB223) privacidade no SERVIDOR: jogador só recebe a janela do próprio personagem',
  opportunityServiceSource.includes('row.reactorUserId === actor.userId') &&
    opportunityServiceSource.includes("row.visibilityStatus === 'known-visible'") &&
    movementServiceSource.includes('revealBlockers ? boundaryDiagnostics(boundaries) : []') &&
    !movementServiceSource.includes('boundaries: boundaryDiagnostics(boundaries)')
);
check(
  'CB224) reach é POR ATAQUE (nunca raio global) e só corpo a corpo com alcance estruturado',
  opportunityDomainCode.includes('before <= attack.reachFeet && ahead > attack.reachFeet') &&
    opportunityOpenersCode.includes('reachFeet') &&
    opportunityOpenersCode.includes('ranged') &&
    !opportunityDomainCode.includes('threatRadius')
);
check(
  'CB225) recusar NÃO gasta a Reação (só o ataque consome, via forcedReaction)',
  !opportunityServiceCode.includes('spendEconomy') &&
    opportunityServiceSource.includes("const reason = master ? 'master-declined' : 'declined'") &&
    combatServiceSource.includes('forcedReaction')
);
check(
  'CB226) o passo provocador NÃO é aplicado antes da Reação (checkpoint antes do boundary)',
  movementServiceSource.includes('const prefix = evaluation.steps.slice(0, boundaryIndex)') &&
    movementServiceSource.includes('remainingPath: input.path.slice(boundaryIndex)')
);
check(
  'CB227) Disengage vira estado do turnEconomy e suprime a janela do movimento daquele combatente',
  actionEconomySource.includes('disengaging') &&
    combatServiceSource.includes('economy.disengaging = true') &&
    opportunityDomainCode.includes('if (input.disengaging) return { eligible: false')
);
check(
  'CB228) visão UNKNOWN pede adjudicação do Mestre; fato "não vê" nunca é sobrescrito',
  opportunityDomainCode.includes("input.occludersExist ? 'unknown' : 'known-visible'") &&
    opportunityDomainCode.includes('return status === \'unknown\'') &&
    opportunityServiceSource.includes("'OPPORTUNITY_VISIBILITY_FINAL'")
);
check(
  'CB229) sem timeout: nenhuma janela fecha sozinha (sem expiresAt/cron)',
  !/setTimeout|setInterval|expiresAt|cron/i.test(opportunityServiceSource) &&
    !/setTimeout|setInterval|expiresAt|cron/i.test(opportunityDomainCode)
);
check(
  'CB230) blockers integrados: turno não avança e outro movimento não inicia com janela aberta',
  combatServiceSource.includes('MOVEMENT_REACTION_PENDING') &&
    movementServiceSource.includes('MOVEMENT_PENDING_REACTION') &&
    combatServiceSource.includes('reactionOpportunity.updateMany')
);
check(
  'CB231) sem Sentinel/Polearm Master/War Caster/magia como OA/LoS/cobertura nesta fase',
  !/sentinel|polearm|war ?caster|counterspell|shield|lineOfSight|cover/i.test(
    opportunityDomainCode + opportunityServiceCode + opportunityOpenersCode
  )
);

/* -------------------------------------------------------------------------- */
/* 6.6L.3.2 — PUBLIC SPATIAL VISIBILITY / NPC GRID PROJECTION                 */
/* -------------------------------------------------------------------------- */
const visibilityDtoSource = source('../src/modules/combat/combat.dto.ts');
const visibilityDomainSource = source('../src/modules/combat/spatial/spatial-visibility.ts');
const visibilitySceneSource = source('../src/modules/combat/spatial/spatial-scene.service.ts');
const visibilityDistanceSource = source('../src/modules/combat/spatial/spatial-distance.service.ts');
const visibilitySchemaSource = source('../src/modules/combat/combat.schema.ts');
const visibilityRoutesSource = source('../src/modules/combat/combat.routes.ts');
const visibilityGridSource = source('src/combat/grid/CombatGrid.tsx');
const visibilityTokenSource = source('src/combat/grid/GridToken.tsx');
const visibilityGridApiSource = source('src/combat/grid/gridApi.ts');
const visibilityGridCssSource = source('src/combat/grid/grid.css');
const visibilityGridMathSource = source('src/combat/grid/gridMath.ts');
const visibilityPrismaSchema = source('../prisma/schema.prisma');
const visibilityMigration = source(
  '../prisma/migrations/20261105220000_add_spatial_visibility/migration.sql',
);
check(
  'CB232) PROJEÇÃO espacial é política SEPARADA do estado mecânico e do tipo da entidade',
  visibilityDtoSource.includes('export function projectCombatantSpatialState') &&
    visibilityDtoSource.includes('export function hideCombatantMechanicalState') &&
    visibilityDtoSource.includes(
      "if (combatant.spatialVisibility !== 'master-only') return combatant;",
    ) &&
    visibilityDtoSource.includes('hasPrivateMechanicalState(combatant.kind)') &&
    !visibilityDtoSource.includes('isMasterOnlyCombatant')
);
check(
  'CB233) `spatialVisibility` vive SÓ na instância do combatente, com default PUBLIC (migration aditiva)',
  visibilityPrismaSchema.includes('spatialVisibility String @default("public")') &&
    (visibilityPrismaSchema.match(/spatialVisibility/g) ?? []).length === 1 &&
    visibilityMigration.includes('ADD COLUMN "spatialVisibility"') &&
    visibilityMigration.includes("DEFAULT 'public'")
);
check(
  'CB234) endpoint MASTER-only de ocultar/revelar com enum FECHADO, versão e operationId',
  visibilityRoutesSource.includes(
    "'/:combatId/combatants/:combatantId/spatial-visibility'",
  ) &&
    visibilityRoutesSource.includes('setCombatantSpatialVisibility(') &&
    visibilitySchemaSource.includes('z.enum(SPATIAL_VISIBILITIES)') &&
    visibilitySceneSource.includes("'combatant-spatial-visibility'") &&
    visibilitySceneSource.includes('requireMaster(actor)')
);
check(
  'CB235) distância/range-preview passam a usar spatialVisibility (NPC público mede; oculto é sanitizado)',
  visibilityDistanceSource.includes('isSpatiallyVisible(combatant.spatialVisibility)') &&
    !visibilityDistanceSource.includes("?.kind === 'CHARACTER'") &&
    visibilityDistanceSource.includes('HIDDEN_READING') &&
    visibilityDistanceSource.includes('HIDDEN_RANGE_READING')
);
check(
  'CB236) o CLIENTE não decide visibilidade por `kind`: desenha o DTO autorizado (sem token fantasma)',
  visibilityGridSource.includes('setSpatialVisibility') &&
    !visibilityGridSource.includes("kind === 'CREATURE'") &&
    !visibilityGridSource.includes("kind === 'NPC'") &&
    visibilityTokenSource.includes('if (!rect || !combatant.spatial) return null;') &&
    visibilityGridMathSource.includes('if (!combatant.spatial) continue;')
);
check(
  'CB237) ocultar/revelar é controle do MESTRE e não é Movimento (sem consumo de movimento)',
  visibilityGridSource.includes('Ocultar dos jogadores') &&
    visibilityGridSource.includes('Revelar aos jogadores') &&
    visibilityGridSource.includes("unit.spatialVisibility === 'master-only' ? 'public' : 'master-only'") &&
    visibilityGridApiSource.includes('spatial-visibility') &&
    !visibilitySceneSource.includes('moveDistance')
);
check(
  'CB238) ocultar/revelar entra no Registro como linha PRIVADA (não denuncia entidade oculta)',
  visibilitySceneSource.includes('{ private: true }') &&
    visibilitySceneSource.includes('ocultou') &&
    visibilitySceneSource.includes('revelou') &&
    visibilitySceneSource.includes("'spatial-visibility'")
);
check(
  'CB239) `?` significa apenas "sem imagem" — presença oculta nem chega a produzir token',
  visibilityTokenSource.includes('grid-token-fallback') &&
    visibilityTokenSource.includes('combatant.spatial.tokenImageRef') &&
    visibilityGridCssSource.includes('.grid-token-hidden') &&
    visibilityGridCssSource.includes('.grid-visibility')
);
check(
  'CB240) sem Fog of War/Invisible/Hide/LoS/darkvision ligados a spatialVisibility nesta fase',
  !/fog ?of ?war|visionCone|lineOfSight|darkvision|hideAction|stealth|occluder/i.test(
    codeOnly(visibilityDomainSource) + codeOnly(visibilitySceneSource)
  )
);
check(
  'CB241) estilos novos ficam em grid.css (o WIP de client/src/styles.css NÃO é tocado)',
  visibilityGridCssSource.includes('6.6L.3.2') &&
    !source('src/styles.css').includes('.grid-token-hidden') &&
    !source('src/styles.css').includes('.grid-visibility')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3 — DRAG & DROP MOVEMENT (draft local, regra SEMPRE no servidor)      */
/* -------------------------------------------------------------------------- */
const movementGridSource = source('src/combat/grid/CombatGrid.tsx');
const movementPathSource = source('src/combat/grid/movementPath.ts');
const movementApiSource = source('src/combat/grid/movementApi.ts');
const movementPanelSource = source('src/combat/grid/MovementHud.tsx');
const movementOverlaySource = source('src/combat/grid/GridMovementOverlay.tsx');
const movementTraceSource = source('src/combat/grid/GridMovementTrace.tsx');
const movementCssSource = source('src/combat/grid/grid.css');
const turnControlSource = source('src/combat/turnControl.ts');

/** Corpo SEM comentários: as palavras proibidas não podem existir no payload. */
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');
const movementApiBody = stripComments(movementApiSource);
const movementClientCode = stripComments(
  `${movementPathSource}${movementPanelSource}${movementOverlaySource}${cameraSource}${rulerGeometrySource}`,
);

const viewerOf = (role: 'PLAYER' | 'MASTER', id: string): SessionUser =>
  ({ id, username: id, role } as unknown as SessionUser);

const moverOf = (over: Record<string, unknown> = {}): CombatantDto =>
  ({
    id: 'hero',
    kind: 'CHARACTER',
    ownerUserId: 'u-player',
    name: 'Hero',
    spatialVisibility: 'public',
    spatial: {
      tokenImageRef: null,
      baseSize: 'medium',
      effectiveSize: 'medium',
      position: { xFeet: 5, yFeet: 5 },
      occupiedSpace: null,
    },
    deathBlocksActions: false,
    effectiveSpeed: 30,
    turnEconomy: { movementBudget: 9, movementUsed: 0 },
    ...over,
  }) as unknown as CombatantDto;

const movementAuthority = (
  over: {
    status?: 'PENDING_INITIATIVE' | 'ACTIVE';
    currentCombatantId?: string | null;
    combatants?: CombatantDto[];
    user?: SessionUser;
    gridActive?: boolean;
  } = {},
) =>
  movementAuthorityOf({
    status: 'ACTIVE',
    currentCombatantId: 'hero',
    combatants: [moverOf()],
    user: viewerOf('PLAYER', 'u-player'),
    gridActive: true,
    ...over,
  });

const movementReading = (over: Partial<MovementPathReading> = {}): MovementPathReading => ({
  status: 'ok',
  legal: true,
  affordable: true,
  movementMode: 'walking',
  totalDistanceFeet: 20,
  totalCostFeet: 25,
  movementRemainingFeet: 30,
  destination: { xFeet: 25, yFeet: 5 },
  steps: [],
  blocker: null,
  algorithm: 'phb-grid-2d',
  reason: null,
  ...over,
});

check(
  'CB242) MOVIMENTO NÃO É MODO: toolbar tem só Posicionar (sem Mover, sem Medir)',
  movementGridSource.includes("type InteractionMode = 'none' | 'placement'") &&
    !movementGridSource.includes("aria-pressed={mode === 'movement'}") &&
    !/\bMover\b/.test(stripComments(movementGridSource)) &&
    movementGridSource.includes('Posicionar') &&
    // Botão Medir removido: a régua virou a tecla F (nada de placeholder).
    !/>\s*Medir\s*</.test(stripComments(movementGridSource)) &&
    !/aria-pressed=\{mode === 'measure'\}/.test(stripComments(movementGridSource)) &&
    // Ferramentas são toggles: clicar na ativa volta para a superfície livre.
    movementGridSource.includes("changeMode(mode === 'placement' ? 'none' : 'placement')") &&
    !/Shift\+Click/.test(stripComments(movementGridSource))
);
check(
  'CB243) clique desambiguado (régua → placement → nada); o gesto do token é outro caminho',
  movementGridSource.indexOf('if (rulerActive) {') > 0 &&
    movementGridSource.indexOf('if (rulerActive) {') <
      movementGridSource.indexOf("if (mode !== 'placement') return;") &&
    movementGridSource.indexOf("if (mode !== 'placement') return;") <
      movementGridSource.indexOf('void place(') &&
    // Placement não usa nada do motor de movimento (caminhos separados).
    !gridApiSource.includes('movement') &&
    movementApiSource.includes('movement-preview') &&
    movementApiSource.includes('spatial/movement`')
);
check(
  'CB244) PLAYER recebe só Medir; MASTER Posicionar+Medir; NINGUÉM recebe Mover/Confirmar',
  (() => {
    const player = renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([unitOf('hero', 'medium')]),
        isMaster: false,
        movement: { combatantId: 'hero', reason: null },
        onCombatChange: () => undefined,
        onError: () => undefined,
      }),
    );
    const master = renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([unitOf('hero', 'medium')]),
        isMaster: true,
        movement: { combatantId: null, reason: 'Nenhum combatente no turno.' },
        onCombatChange: () => undefined,
        onError: () => undefined,
      }),
    );
    return (
      // PLAYER: só controles de câmera — sem Posicionar, Mover ou Medir.
      !/\bMover\b/.test(player) &&
      !/>\s*Medir\s*</.test(player) &&
      !/\bPosicionar\b/.test(player) &&
      /Enquadrar/.test(player) &&
      // MASTER: Posicionar + câmera; também sem Mover/Medir.
      /\bPosicionar\b/.test(master) &&
      !/\bMover\b/.test(master) &&
      !/>\s*Medir\s*</.test(master) &&
      !/Confirmar/.test(player) &&
      !/Confirmar/.test(master)
    );
  })()
);
check(
  'CB245) só o combatente DO TURNO controlado pelo usuário pode mover (Mestre: criatura do turno)',
  turnControlSource.includes('export function movementAuthorityOf') &&
    turnControlSource.includes('currentUserControlsCombatant(current, user)') &&
    movementAuthority().combatantId === 'hero' &&
    movementAuthority({ user: viewerOf('PLAYER', 'outro') }).combatantId === null &&
    movementAuthority({
      combatants: [moverOf({ kind: 'NPC', ownerUserId: null })],
      user: viewerOf('PLAYER', 'u-player'),
    }).combatantId === null &&
    movementAuthority({
      combatants: [moverOf({ kind: 'NPC', ownerUserId: null })],
      user: viewerOf('MASTER', 'u-master'),
    }).combatantId === 'hero' &&
    // Mestre NÃO move o personagem de um jogador no modo Mover.
    movementAuthority({ user: viewerOf('MASTER', 'u-master') }).combatantId === null &&
    // Só em combate ACTIVE e com grid ativo.
    movementAuthority({ status: 'PENDING_INITIATIVE' }).combatantId === null &&
    movementAuthority({ gridActive: false }).combatantId === null
);
check(
  'CB246) unplaced/morto/deslocamento zero/sem saldo não iniciam movimento (mensagem discreta)',
  movementAuthority({ combatants: [moverOf({ spatial: null })] }).combatantId === null &&
    movementAuthority({ combatants: [moverOf({ spatial: null })] }).reason ===
      'Seu token ainda não foi posicionado pelo Mestre.' &&
    movementAuthority({ combatants: [moverOf({ deathBlocksActions: true })] }).combatantId === null &&
    movementAuthority({ combatants: [moverOf({ effectiveSpeed: 0 })] }).combatantId === null &&
    movementAuthority({
      combatants: [moverOf({ turnEconomy: { movementBudget: 9, movementUsed: 9 } })],
    }).combatantId === null &&
    combatTrackerSource.includes('movementAuthorityOf({') &&
    combatTrackerSource.includes('movement={movementAuthority}') &&
    movementGridSource.includes('if (movableUnitId !== combatantId) return;')
);
check(
  'CB247) preview manda SÓ combatantId+path; commit só acrescenta versão/operação (nunca custo)',
  movementApiBody.includes('combatantId: input.combatantId') &&
    movementApiBody.includes('path: input.path') &&
    movementApiBody.includes('expectedVersion: combat.version') &&
    movementApiBody.includes('operationId: input.operationId') &&
    !/cost|remaining|speed|difficult|reach|occupiedSpace|\bsize\b/i.test(movementApiBody) &&
    movementGridSource.includes('createOperationId()') &&
    !movementApiSource.includes('createOperationId') &&
    // O path enviado é DERIVADO do destino (nada de rastro do mouse).
    movementPathSource.includes('export function contiguousAnchors(')
);
check(
  'CB248) preview é SERVER-AUTHORITATIVE: debounce por mudança de trajeto + sequência (stale ignorado)',
  movementGridSource.includes('previewMovement(combat.id, { combatantId: draftCombatantId, path: draftPath })') &&
    movementGridSource.includes('previewSequence.current !== sequence') &&
    movementGridSource.includes("setPreviewState('loading')") &&
    movementGridSource.includes('window.setTimeout') &&
    movementPathSource.includes('contiguousAnchors')
);
check(
  'CB249) commit adota o DTO do servidor; token real NÃO anda durante o draft (sem posição otimista)',
  movementGridSource.includes('commitMovement(combat, {') &&
    movementGridSource.includes('onCombatChange(result.combat)') &&
    movementGridSource.includes('operationRef.current ??= createOperationId()') &&
    !movementGridSource.includes('spatialPosition') &&
    movementGridSource.includes('GridMovementOverlay') &&
    !gridTokenSource.includes('ghost') &&
    // O drop SEMPRE revalida o caminho final (preview nunca é autoridade).
    movementGridSource.includes('const fresh = await previewMovement(combat.id, { combatantId, path });')
);
check(
  'CB250) trajeto DIRETO: origem→destino, contíguo, 5 pés (2,5 Tiny), diagonal PHB e 3×2 em 3 steps',
  (() => {
    const step = anchorStepFeet('medium');
    const start = { xFeet: 50, yFeet: 50 };
    const to = (xFeet: number, yFeet: number) => contiguousAnchors(start, { xFeet, yFeet }, step);
    const horizontal = to(65, 50);
    const vertical = to(50, 65);
    const diagonal = to(65, 65);
    const threeByTwo = to(65, 60);
    const fast = to(70, 50);
    const backHome = to(50, 50);
    const tiny = contiguousAnchors({
      xFeet: 0,
      yFeet: 0,
    }, { xFeet: 5, yFeet: 2.5 }, anchorStepFeet('tiny'));
    const contiguous = (
      path: { xFeet: number; yFeet: number }[],
      from: { xFeet: number; yFeet: number },
      size: number,
    ): boolean =>
      path.every((point, index) => {
        const previous = index === 0 ? from : path[index - 1];
        const dx = Math.abs(point.xFeet - previous.xFeet);
        const dy = Math.abs(point.yFeet - previous.yFeet);
        return (
          (dx === 0 || dx === size) && (dy === 0 || dy === size) && (dx !== 0 || dy !== 0)
        );
      });
    return (
      anchorStepFeet('tiny') === 2.5 &&
      step === 5 &&
      // A posição atual NUNCA entra no path (o servidor já a conhece).
      horizontal.length === 3 &&
      horizontal[0].xFeet === 55 &&
      horizontal[2].xFeet === 65 &&
      horizontal[2].yFeet === 50 &&
      vertical.length === 3 &&
      vertical[2].yFeet === 65 &&
      // Diagonal continua PHB-grid: um passo por eixo, sem custo extra.
      diagonal.length === 3 &&
      diagonal[0].xFeet === 55 &&
      diagonal[0].yFeet === 55 &&
      diagonal[2].xFeet === 65 &&
      diagonal[2].yFeet === 65 &&
      // 3 casas × 2 casas = 3 steps (nunca 5).
      threeByTwo.length === 3 &&
      threeByTwo[2].xFeet === 65 &&
      threeByTwo[2].yFeet === 60 &&
      // Salto do ponteiro não encurta nem duplica o path.
      fast.length === 4 &&
      fast[3].xFeet === 70 &&
      // Destino na origem = nenhum trajeto.
      backHome.length === 0 &&
      // Tiny continua em passos de 2,5 pés.
      tiny.length === 2 &&
      tiny[1].xFeet === 5 &&
      tiny[1].yFeet === 2.5 &&
      contiguous(horizontal, start, step) &&
      contiguous(vertical, start, step) &&
      contiguous(diagonal, start, step) &&
      contiguous(threeByTwo, start, step) &&
      contiguous(fast, start, step) &&
      contiguous(tiny, { xFeet: 0, yFeet: 0 }, anchorStepFeet('tiny'))
    );
  })()
);
check(
  'CB251) célula sob o cursor: floor CONTÉM o ponto (borda troca exata), footprint-aware e null fora da cena',
  (() => {
    const scene = { widthFeet: 100, heightFeet: 100 };
    const medium = containingCellFeet({ xFeet: 47, yFeet: 12 }, 'medium', scene);
    const tiny = containingCellFeet({ xFeet: 47.6, yFeet: 12.6 }, 'tiny', scene);
    const beforeBorder = containingCellFeet({ xFeet: 14.99, yFeet: 10 }, 'medium', scene);
    const afterBorder = containingCellFeet({ xFeet: 15, yFeet: 10 }, 'medium', scene);
    const lastCell = containingCellFeet({ xFeet: 95, yFeet: 95 }, 'medium', scene);
    const outside = containingCellFeet({ xFeet: 100, yFeet: 12 }, 'medium', scene);
    const beyond = containingCellFeet({ xFeet: 400, yFeet: 12 }, 'medium', scene);
    const negative = containingCellFeet({ xFeet: -1, yFeet: 12 }, 'medium', scene);
    const largeOnLastColumn = containingCellFeet({ xFeet: 95, yFeet: 10 }, 'large', scene);
    return (
      // Nunca a interseção mais próxima (47 → 45, não 45/50 por round).
      medium?.xFeet === 45 &&
      medium?.yFeet === 10 &&
      tiny?.xFeet === 47.5 &&
      tiny?.yFeet === 12.5 &&
      beforeBorder?.xFeet === 10 &&
      afterBorder?.xFeet === 15 &&
      lastCell?.xFeet === 95 &&
      lastCell?.yFeet === 95 &&
      // Fora da cena NÃO seleciona nada (nada de clamp para a última célula).
      outside === null &&
      beyond === null &&
      negative === null &&
      // Footprint Grande não cabe na última coluna: null, sem "empurrar".
      largeOnLastColumn === null
    );
  })()
);
check(
  'CB252) sem pathfinding/flood-fill/route optimization nesta fase',
  !/a\*|\bastar\b|\bdijkstra\b|\bshortest\b|\bpathfind|\brouteoptim|\breachable\b|\bflood ?fill\b|\bheatmap\b/i.test(
    movementClientCode
  )
);
check(
  'CB253) React NÃO aplica difficult terrain, crawling, tamanho hostil, Dash nem Opportunity Attack',
  !/difficultTerrain\s*\?|crawling\s*\?|speed\s*\*\s*2|movementBudget\s*\*|reachFeet|opportunityAttack/i.test(
    movementClientCode
  ) &&
    movementPanelSource.includes('movement.totalCostFeet') &&
    movementPanelSource.includes('movement.movementRemainingFeet') &&
    movementPanelSource.includes('movement.totalDistanceFeet') &&
    movementPanelSource.includes('formatMeters')
);
check(
  'CB254) painel separa válido × insuficiente × bloqueado com os números do SERVIDOR (sem identidade oculta)',
  (() => {
    const render = (over: Partial<MovementPathReading>, pathLength = 2) =>
      renderToStaticMarkup(
        createElement(MovementHud, {
          combatantName: 'Hero',
          eligible: true,
          reason: null,
          pathLength,
          movement: movementReading(over),
          reaction: null,
          state: 'ready',
          error: null,
          pendingNotice: null,
          busy: false,
          onCancel: () => undefined,
        })
      );
    const valid = render({});
    const insufficient = render({ affordable: false });
    const blocked = render({
      status: 'blocked',
      legal: false,
      affordable: false,
      blocker: { code: 'MOVEMENT_PATH_BLOCKED', stepIndex: 1, combatantId: null, combatantName: null },
    });
    const idle = renderToStaticMarkup(
      createElement(MovementHud, {
        combatantName: null,
        eligible: false,
        reason: 'Seu token ainda não foi posicionado pelo Mestre.',
        pathLength: 0,
        movement: null,
        reaction: null,
        state: 'idle',
        error: null,
        pendingNotice: null,
        busy: false,
        onCancel: () => undefined,
      })
    );
    return (
      valid.includes('Solte para mover.') &&
      valid.includes('Distância') &&
      valid.includes('Custo') &&
      valid.includes('Restante previsto') &&
      valid.includes('5 m') &&
      // SOLTAR é a confirmação: nenhum botão "Confirmar" no HUD.
      !valid.includes('Confirmar') &&
      !valid.includes('disabled=""') &&
      valid.includes('Cancelar') &&
      insufficient.includes('Movimento insuficiente para este trajeto.') &&
      blocked.includes('Caminho bloqueado.') &&
      !blocked.includes('Ogro') &&
      idle.includes('Seu token ainda não foi posicionado pelo Mestre.')
    );
  })()
);
check(
  'CB255) ghost e linha são APRESENTAÇÃO (aria-hidden) e nunca substituem o token autoritativo',
  (() => {
    const overlay = renderToStaticMarkup(
      createElement(GridMovementOverlay, {
        ghost: { position: { xFeet: 10, yFeet: 0 }, size: 'medium', imageRef: '/a.png' },
        cellSizeFeet: 5,
        pixelsPerCell: 44,
      })
    );
    const trace = renderToStaticMarkup(
      createElement(GridMovementTrace, {
        points: [
          { x: 10, y: 10 },
          { x: 54, y: 10 },
          { x: 54, y: 54 },
        ],
        distanceInFeet: 15,
        costInFeet: 20,
        state: 'ready',
      })
    );
    return (
      overlay.includes('grid-movement-ghost') &&
      overlay.includes('<img') &&
      overlay.includes('aria-hidden="true"') &&
      renderToStaticMarkup(
        createElement(GridMovementOverlay, {
          ghost: null,
          cellSizeFeet: 5,
          pixelsPerCell: 44,
        })
      ) === '' &&
      // A LINHA do movimento reutiliza o traço da régua (nada de 2º visual).
      trace.includes('grid-ruler-line') &&
      trace.includes('grid-ruler-label') &&
      trace.includes('4,5 m') &&
      trace.includes('Custo: 6 m') &&
      trace.includes('aria-hidden="true"') &&
      !tokenHtml(unitOf('hero', 'medium')).includes('ghost')
    );
  })()
);
check(
  'CB256) movimento não filtra por tipo nem visibilidade: NPC público continua no grid, master-only segue no DTO',
  !/spatialVisibility|\bkind\b/.test(
    stripComments(
      `${movementPathSource}${movementApiSource}${movementOverlaySource}${movementTraceSource}`
    )
  ) &&
    movementGridSource.includes('splitByPlacement(combat.combatants)') &&
    movementGridSource.includes('movableUnitId === combatant.id')
);
check(
  'CB257) ReactionPanel existente é REUTILIZADO — o grid não cria segundo motor de Reação',
  combatTrackerSource.includes('<ReactionPanel') &&
    !movementGridSource.includes('ReactionPanel') &&
    !/resolveOpportunityAttack|declineOpportunityReaction/.test(movementGridSource) &&
    movementGridSource.includes('pendingNotice')
);
check(
  'CB258) estilos novos continuam em grid.css (styles.css WIP NÃO é tocado)',
  movementCssSource.includes('6.6M.3') &&
    movementCssSource.includes('.grid-movement-hud') &&
    movementCssSource.includes('.grid-movement-ghost') &&
    !movementCssSource.includes('.grid-movement-panel') &&
    !source('src/styles.css').includes('.grid-movement-')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1 — GRID CAMERA, RÉGUA E UX DO COMBATE                              */
/* -------------------------------------------------------------------------- */
check(
  'CB259) câmera pura: screen↔scene é reversível e zoom mantém o ponto sob o cursor',
  (() => {
    const camera: GridCamera = { panX: 40, panY: -30, zoom: 1.5 };
    const point = { x: 220, y: 140 };
    const back = sceneToScreen(camera, screenToScene(camera, point));
    const anchor = { x: 320, y: 200 };
    const zoomed = zoomAt(camera, 1.6, anchor);
    const before = screenToScene(camera, anchor);
    const after = screenToScene(zoomed, anchor);
    return (
      Math.abs(back.x - point.x) < 1e-9 &&
      Math.abs(back.y - point.y) < 1e-9 &&
      Math.abs(before.x - after.x) < 1e-9 &&
      Math.abs(before.y - after.y) < 1e-9 &&
      zoomed.zoom > camera.zoom &&
      panBy(IDENTITY_CAMERA, 10, -5).panX === 10
    );
  })()
);
check(
  'CB260) Enquadrar mostra a cena inteira com margem, centralizada e sem ampliar >100%',
  (() => {
    const fitted = fitCamera({
      scene: { width: 1000, height: 800 },
      viewport: { width: 600, height: 400 },
      margin: 20,
    });
    const small = fitCamera({
      scene: { width: 100, height: 100 },
      viewport: { width: 600, height: 400 },
      margin: 20,
    });
    return (
      fitted.zoom > 0 &&
      fitted.zoom <= 1 &&
      Math.abs(fitted.panX - (600 - 1000 * fitted.zoom) / 2) < 1e-6 &&
      Math.abs(fitted.panY - (400 - 800 * fitted.zoom) / 2) < 1e-6 &&
      small.zoom === 1 &&
      centerCamera({ panX: 0, panY: 0, zoom: 1 }, { x: 100, y: 100 }, { width: 600, height: 400 })
        .panX === 200
    );
  })()
);
check(
  'CB261) pan bounds impedem PERDER a cena (mas permitem margem fora dela)',
  (() => {
    const clamped = clampCamera(
      { panX: 5000, panY: -5000, zoom: 1 },
      { width: 400, height: 400 },
      { width: 600, height: 400 },
      96,
    );
    return clamped.panX === 600 - 96 && clamped.panY === 96 - 400;
  })()
);
check(
  'CB262) MOVEMENT/PLACEMENT/RÉGUA usam a MESMA conversão com pan e zoom != 0',
  (() => {
    const camera: GridCamera = { panX: -120, panY: 60, zoom: 2 };
    const geometry = { pixelsPerCell: 44, cellSizeFeet: 5 };
    const scenePoint = feetToScenePixel({ xFeet: 30, yFeet: 15 }, geometry);
    const feet = screenToFeet(camera, sceneToScreen(camera, scenePoint), geometry);
    return Math.abs(feet.xFeet - 30) < 1e-9 && Math.abs(feet.yFeet - 15) < 1e-9;
  })()
);
check(
  'CB263) Ctrl+wheel dá ZOOM NO GRID com preventDefault (listener nativo, página intocada)',
  movementGridSource.includes("addEventListener('wheel', onWheel, { passive: false })") &&
    movementGridSource.includes('event.ctrlKey') &&
    movementGridSource.includes('event.preventDefault()') &&
    movementGridSource.includes('zoomAt(cameraRef.current, factor, point)') &&
    movementGridSource.includes('event.shiftKey') &&
    !movementGridSource.includes('onWheel={')
);
check(
  'CB264) viewport com overflow hidden (sem scrollbars) e câmera aplicada por transform',
  /\.grid-viewport\s*\{[^}]*overflow: hidden/.test(gridCssSource) &&
    /\.grid-viewport\s*\{[^}]*height: min\(70vh/.test(gridCssSource) &&
    gridCssSource.includes('.grid-camera') &&
    movementGridSource.includes(
      'translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})'
    ) &&
    // Câmera inicializada só com viewport REAL e reenquadrada até o usuário
    // escolher a câmera dele (sem F5, sem setTimeout arbitrário).
    movementGridSource.includes('if (viewport.width <= 0 || viewport.height <= 0) return;') &&
    // Câmera do usuário preservada (6.6M.3.1.4.1 trocou o early-return por
    // "manter a câmera preservada" — mesma intenção, agora com fit reentrante).
    movementGridSource.includes('cameraTouched.current && cameraInitialized.current && cameraIsUsable(preserved)') &&
    movementGridSource.includes('new ResizeObserver(') &&
    movementGridSource.includes('useLayoutEffect(') &&
    // Nenhum `setTimeout` de consolo na inicialização da câmera.
    !/setTimeout\([^)]*fitCamera/.test(stripComments(movementGridSource))
);
check(
  'CB265) HUD compacto FLUTUA no palco; painel grande removido e barra persistente segue fonte',
  hudSource.includes('grid-movement-hud') &&
    hudSource.includes('role="status"') &&
    hudSource.includes('formatMeters') &&
    /\.grid-movement-hud\s*\{[^}]*position: absolute/.test(gridCssSource) &&
    !gridCssSource.includes('.grid-movement-panel') &&
    combatTrackerSource.includes('<TurnResourceBar') &&
    movementGridSource.includes('<MovementHud')
);
check(
  'CB266) régua: F arma, clique fixa origem, 2º clique trava, direito/Esc limpam, uma por vez',
  movementGridSource.includes("event.key === 'f' || event.key === 'F'") &&
    movementGridSource.includes("kind: 'point'") &&
    movementGridSource.includes('pickRulerEndpoint') &&
    movementGridSource.includes('handleViewportContextMenu') &&
    movementGridSource.includes('clearRuler()') &&
    movementGridSource.includes("event.key === 'Escape'") &&
    movementGridSource.includes('if (!ruler || ruler.locked)') &&
    movementGridSource.includes('if (!rulerRef.current.from) setQuickRuler(false)')
);
check(
  'CB267) régua é leitura PURA server-authoritative: ponto↔ponto sem cálculo no cliente',
  combatRoutesSource.includes("'/:combatId/spatial/measure'") &&
    distanceService.includes('readCombatMeasure') &&
    distanceService.includes('pointMeasureDistanceFeet') &&
    distanceService.includes('pointToBodyDistanceFeet') &&
    distanceService.includes('canReadDistance(actor, combat, combatant.id)') &&
    gridApiSource.includes('measureSpatial') &&
    gridApiSource.includes('/spatial/measure') &&
    !/distanceFeet\s*[-+*/]/.test(stripComments(`${rulerGeometrySource}${rulerUiSource}`))
);
check(
  'CB268) Drag & Drop: retrato NÃO é arrastável nativamente e o gesto vive no window',
  gridTokenSource.includes('draggable={false}') &&
    gridTokenSource.includes('onDragStart={(event) => event.preventDefault()}') &&
    movementGridSource.includes("window.addEventListener('pointermove', onMove)") &&
    movementGridSource.includes("window.addEventListener('pointerup', onUp)") &&
    movementGridSource.includes('setPointerCapture') &&
    movementGridSource.includes('requestAnimationFrame(tick)') &&
    movementGridSource.includes('cancelAnimationFrame(frame)')
);
check(
  'CB269) tokens circulares com moldura metálica, halo de turno e seleção DISTINTA',
  /\.grid-token-art\s*\{[^}]*border-radius: 50%/.test(gridCssSource) &&
    gridCssSource.includes("data-kind='character'") &&
    gridCssSource.includes('.grid-token.is-current .grid-token-art') &&
    gridCssSource.includes('.grid-token.is-selected .grid-token-art') &&
    gridCssSource.includes('.grid-hover-cell') &&
    gridCssSource.includes('.grid-ruler-label')
);
check(
  'CB270) metros na UI espacial (5 ft = 1,5 m, 2,5 ft = 0,75 m) sem mexer no domínio em pés',
  formatMeters(2.5) === '0,75 m' &&
    formatMeters(5) === '1,5 m' &&
    formatMeters(10) === '3 m' &&
    formatMeters(15) === '4,5 m' &&
    formatMeters(20) === '6 m' &&
    formatMeters(25) === '7,5 m' &&
    formatMeters(30) === '9 m' &&
    formatFeet(2.5) === '2,5 pés' &&
    rulerLabelText(null, 'loading') === 'Calculando…' &&
    rulerMidpoint({ x: 0, y: 0 }, { x: 100, y: 50 }).x === 50
);
check(
  'CB271) câmera/régua não tocam o MUNDO: nada de walls/LoS/cover/AoE/minimap/pathfinding',
  !/\bwalls?\b|lineOfSight|coverLevel|areaOfEffect|fogOfWar|minimap|pathfind|dijkstra/i.test(
    stripComments(`${cameraSource}${rulerGeometrySource}${rulerUiSource}${hudSource}`)
  ) &&
    !/movementBudget|totalCostFeet\s*[-+*/]|difficultTerrain\s*\?/.test(
      stripComments(`${rulerGeometrySource}${rulerUiSource}${cameraSource}`)
    )
);
check(
  'CB272) câmera é CLIENT-ONLY: nenhum campo de pan/zoom em DTO, schema ou Prisma',
  !/panX|panY|\bzoom\b/.test(combatSchemaSource) &&
    !/panX|panY|\bzoom\b/.test(prismaSchemaSource) &&
    rulerEndpointKey({ kind: 'point', position: { xFeet: 5, yFeet: 5 } }) === 'point:5:5' &&
    rulerEndpointKey({ kind: 'combatant', combatantId: 'a' }) === 'combatant:a'
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.1 — MOVIMENTO DIRETO POR DRAG & DROP (sem modo, sem confirmar)     */
/* -------------------------------------------------------------------------- */
check(
  'CB273) fluxo DIRETO: nenhum botão Mover nem Confirmar no grid (jogador e Mestre) e HUD sem confirmar',
  (() => {
    const player = renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([unitOf('hero', 'medium')]),
        isMaster: false,
        movement: { combatantId: 'hero', reason: null },
        onCombatChange: () => undefined,
        onError: () => undefined,
      }),
    );
    const master = renderToStaticMarkup(
      createElement(CombatGrid, {
        combat: combatOf([unitOf('hero', 'medium')]),
        isMaster: true,
        movement: { combatantId: 'hero', reason: null },
        onCombatChange: () => undefined,
        onError: () => undefined,
      }),
    );
    const hud = renderToStaticMarkup(
      createElement(MovementHud, {
        combatantName: 'Hero',
        eligible: true,
        reason: null,
        pathLength: 1,
        movement: movementReading(),
        reaction: null,
        state: 'ready',
        error: null,
        pendingNotice: null,
        busy: false,
        onCancel: () => undefined,
      }),
    );
    return (
      !/\bMover\b/.test(player) &&
      !/Confirmar/.test(player) &&
      !/\bMover\b/.test(master) &&
      !/Confirmar/.test(master) &&
      hud.includes('Cancelar') &&
      !hud.includes('Confirmar') &&
      !movementGridSource.includes('onConfirm')
    );
  })()
);
check(
  'CB274) pointerdown ARMA o gesto e o draft só nasce após o limiar (clique curto não move)',
  movementGridSource.includes(
    'function armTokenGesture(combatantId: string, event: PointerEvent<HTMLButtonElement>): void {',
  ) &&
    movementGridSource.includes('const DRAG_THRESHOLD_PX = 4;') &&
    movementGridSource.includes('if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;') &&
    movementGridSource.includes('beginDraft(gesture, event.clientX, event.clientY);') &&
    movementGridSource.includes('if (current.path.length === 0) {') &&
    // Pointerdown/up sem cruzar o limiar não cria trajeto nenhum.
    contiguousAnchors({ xFeet: 0, yFeet: 0 }, { xFeet: 0, yFeet: 0 }, 5).length === 0
);
check(
  'CB275) POINTERUP = confirmação: o drop revalida o caminho e faz commit sem passo extra',
  movementGridSource.includes('void confirmMovement(current.combatantId, current.path);') &&
    movementGridSource.includes("window.addEventListener('pointerup', onUp)") &&
    movementGridSource.includes('if (!fresh.movement.legal || !fresh.movement.affordable) {') &&
    !movementGridSource.includes('onConfirm') &&
    !movementPanelSource.includes('onConfirm')
);
check(
  'CB276) precedências do gesto: pan (Space/meio), régua (F/Medir) e Posicionar vêm antes do movimento',
  movementGridSource.includes('if (overToken && !spaceDown.current && event.button !== 1) return;') &&
    movementGridSource.includes('if (spaceDown.current || rulerActive || locked) return;') &&
    movementGridSource.includes("if (mode !== 'none') return;") &&
    movementGridSource.includes(
      "movable={!locked && !rulerActive && mode === 'none' && movableUnitId === combatant.id}",
    ) &&
    movementGridSource.includes('if (movableUnitId !== combatantId) return;')
);
check(
  'CB277) direito/Esc/pointercancel/lostpointercapture cancelam SEM commit acidental',
  movementGridSource.includes('if (grabGesture || draft) {') &&
    movementGridSource.includes("cancelDraft('Movimento cancelado.');") &&
    movementGridSource.includes("window.addEventListener('pointercancel', onCancel)") &&
    movementGridSource.includes("window.addEventListener('lostpointercapture', onCancel)") &&
    movementGridSource.includes('if (released.current) return;') &&
    movementGridSource.includes("if (event.key === 'Escape')")
);
check(
  'CB278) ghost é APRESENTAÇÃO: overlay só desenha o fantasma e o token real fica na origem',
  movementGridSource.includes('<GridMovementOverlay') &&
    movementGridSource.includes('position: draft.pointer') &&
    movementOverlaySource.includes('if (!ghost) return null;') &&
    !movementOverlaySource.includes('polyline') &&
    movementTraceSource.includes('grid-ruler-line') &&
    movementTraceSource.includes("className=\"grid-ruler grid-movement-trace\"")
);
check(
  'CB279) path do componente nasce da ORIGEM AUTORITATIVA + DESTINO (nunca do rastro do ponteiro)',
  movementGridSource.includes(
    '? contiguousAnchors(current.startPosition, destination, anchorStepFeet(size))',
  ) &&
    movementPathSource.includes('export function contiguousAnchors(') &&
    // Nada de acumular âncoras por pointermove.
    !movementGridSource.includes('appendAnchor') &&
    !movementGridSource.includes('nextPath =') &&
    // A origem nunca é reintroduzida como primeiro passo; voltar à origem zera.
    contiguousAnchors({ xFeet: 0, yFeet: 0 }, { xFeet: 0, yFeet: 5 }, 5)[0].yFeet === 5 &&
    contiguousAnchors({ xFeet: 0, yFeet: 0 }, { xFeet: 0, yFeet: 0 }, 5).length === 0
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.2 — MEASURE TO MOVE (medir + Space, sem segundo engine)            */
/* -------------------------------------------------------------------------- */
const rulerMoveHtml = (move: Parameters<typeof GridRuler>[0]['move']) =>
  renderToStaticMarkup(
    createElement(GridRuler, {
      from: { x: 20, y: 40 },
      to: { x: 120, y: 40 },
      fromLabel: 'Hero',
      toLabel: 'Ponto',
      distance: {
        status: 'known',
        distanceFeet: 25,
        provenance: 'grid-2d',
        algorithm: 'phb-grid-2d',
        reason: null,
      },
      state: 'success',
      locked: true,
      move,
    }),
  );

check(
  'CB280) Measure-to-Move existe: régua FIXA num combatente autorizado vira intenção de Movement',
  movementGridSource.includes("ruler.locked && ruler.from.kind === 'combatant'") &&
    movementGridSource.includes('movableUnitId === measureSourceId') &&
    movementGridSource.includes('measureMoveEligible') &&
    movementGridSource.includes('async function executeMeasureMove(): Promise<void> {') &&
    movementGridSource.includes('sourcePosition: SpatialPosition;') &&
    // Elegibilidade reaproveita a autoridade do gesto direto (sem ownership novo).
    !/ownerUserId|currentUserControlsCombatant/.test(movementGridSource)
);
check(
  'CB281) origem obrigatoriamente COMBATENTE e destino PONTO canônico (ponto vazio, outro token, NPC)',    movementGridSource.includes("ruler.to?.kind === 'point' ? ruler.to.position : null") &&
    movementGridSource.includes("ruler.locked && ruler.from.kind === 'combatant'") &&
    movementGridSource.includes('path.length === 0') &&
    movementGridSource.includes("'O destino é a posição atual.'")
);
check(
  'CB282) affordance: ícone de movimento + keycap Space com aria-label; estados inválidos SÓ explicam',
  (() => {
    const ready = rulerMoveHtml({ state: 'ready', message: null, costFeet: null });
    const blocked = rulerMoveHtml({
      state: 'invalid',
      message: 'Caminho bloqueado.',
      costFeet: null,
    });
    const busy = rulerMoveHtml({ state: 'executing', message: null, costFeet: null });
    return (
      ready.includes('grid-measure-move-icon') &&
      ready.includes('grid-keycap') &&
      ready.includes('>Space<') &&
      ready.includes('Pressione Espaço para mover até o destino medido.') &&
      !ready.includes('grid-measure-move-message') &&
      blocked.includes('Caminho bloqueado.') &&
      !blocked.includes('grid-keycap') &&
      busy.includes('Executando…') &&
      !busy.includes('grid-keycap') &&
      // O desenho da régua continua aria-hidden; o badge não.
      !/<div class="grid-measure-move[^"]*"[^>]*aria-hidden/.test(ready)
    );
  })()
);
check(
  'CB283) não existe botão "Executar Movimento": a indicação vive na label (sem toolbar nova)',
  rulerMoveHtml({ state: 'ready', message: null, costFeet: null }).includes('<kbd') &&
    !/Executar Movimento/.test(movementGridSource) &&
    !movementGridSource.includes('onExecuteMovement') &&
    !/<button[^>]*grid-measure-move/.test(rulerMoveHtml({ state: 'ready', message: null, costFeet: null }))
);
check(
  'CB284) Space tap executa e Space+drag continua PAN (repeat e input focado não disparam)',
  movementGridSource.includes('spaceCandidate.current = Boolean(') &&
    movementGridSource.includes('if (candidate && !panned) void executeMeasureMove();') &&
    movementGridSource.includes('if (spaceDown.current) spacePanUsed.current = true;') &&
    movementGridSource.includes('if (!event.repeat) {') &&
    movementGridSource.includes('if (isEditableTarget(event.target)) return;') &&
    // Pan tem precedência sobre token (inclusive por cima do próprio token).
    movementGridSource.includes('if (overToken && !spaceDown.current && event.button !== 1) return;')
);
check(
  'CB285) path DIRETO interpolado pela MESMA função do gesto direto, com start implícito',
  movementGridSource.includes('const path = contiguousAnchors(') &&
    movementGridSource.includes('anchorStepFeet(unit.spatial.effectiveSize),') &&
    (() => {
      const path = contiguousAnchors(
        { xFeet: 50, yFeet: 50 },
        { xFeet: 50, yFeet: 65 },
        anchorStepFeet('medium'),
      );
      const tiny = contiguousAnchors(
        { xFeet: 0, yFeet: 0 },
        { xFeet: 2.5, yFeet: 5 },
        anchorStepFeet('tiny'),
      );
      return (
        JSON.stringify(path) ===
          JSON.stringify([
            { xFeet: 50, yFeet: 55 },
            { xFeet: 50, yFeet: 60 },
            { xFeet: 50, yFeet: 65 },
          ]) &&
        tiny.length === 2 &&
        tiny[1].yFeet === 5 &&
        tiny[0].yFeet === 2.5 &&
        path.every((step) => step.xFeet !== 50 || step.yFeet !== 50)
      );
    })()
);
check(
  'CB286) mesmo pipeline: preview → commit existentes (sem fetch próprio, com versão e operação)',
  movementGridSource.includes('previewMovement(combat.id, { combatantId: unit.id, path })') &&
    movementGridSource.includes('const result = await commitMovement(combat, {') &&
    movementGridSource.includes('operationId: operationRef.current,') &&
    !/fetch\(/.test(movementGridSource) &&
    !/totalDistanceFeet\s*[-+*/]|totalCostFeet\s*[-+*/]/.test(stripComments(movementGridSource)) &&
    movementGridSource.includes('if (!fresh.movement.legal || !fresh.movement.affordable) {')
);
check(
  'CB287) animação é APRESENTAÇÃO server-first, numa primitive ÚNICA (Direct Drag + Measure-to-Move)',
  movementGridSource.includes('await commitMovement(combat, {') &&
    // O operador NÃO anima pela resposta HTTP: quem anima é o evento.
    !movementGridSource.includes('startMovementAnimation(') &&
    movementVisualSource.includes('export function planMovementVisual(') &&
    movementVisualSource.includes('export function useMovementVisual(') &&
    movementVisualSource.includes('export function movementMotionAllowed(') &&
    movementVisualSource.includes("window.matchMedia('(prefers-reduced-motion: reduce)')") &&
    movementVisualSource.includes('MOVEMENT_MAX_MS') &&
    movementVisualSource.includes('const endIndex = anchors.findIndex(') &&
    movementVisualSource.includes('setVisualRect(null)') &&
    gridTokenSource.includes('const box = visualRect ?? rect;')
);
check(
  'CB288) régua mostra DISTÂNCIA e o custo só como secundário quando o servidor difere',
  rulerMoveHtml({ state: 'ready', message: null, costFeet: 30 }).includes('Custo: 9 m') &&
    !rulerMoveHtml({ state: 'ready', message: null, costFeet: 25 }).includes('Custo:') &&
    movementGridSource.includes('costFeet: measureMove.preview?.movement.totalCostFeet ?? null') &&
    !/difficultTerrain\s*\?/.test(stripComments(movementGridSource))
);
check(
  'CB289) invalidação: origem mudou/turno perdeu autoridade desativam o Space e o erro MANTÉM a régua',
  movementGridSource.includes('position.xFeet !== intent.sourcePosition.xFeet') &&
    movementGridSource.includes("message: 'A origem do movimento mudou: meça novamente.'") &&
    movementGridSource.includes('(movement ? movement.combatantId !== intent.combatantId : false)') &&
    movementGridSource.includes('movementVisual.syncVersion(combat.version);') &&
    // Falha NÃO limpa a régua: o jogador continua analisando a decisão.
    (() => {
      const finallyAt = movementGridSource.indexOf(
        '} finally {\n      committingRef.current = null;\n      executing.current = false;',
      );
      if (finallyAt < 0) return false;
      const catchAt = movementGridSource.lastIndexOf('} catch (error) {', finallyAt);
      const failure = movementGridSource.slice(catchAt, finallyAt);
      return catchAt >= 0 && failure.length > 0 && !failure.includes('clearRuler()');
    })()
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.3 — DESTINO ORIENTADO + CURSOR DE RÉGUA + CÉLULA EXATA            */
/* -------------------------------------------------------------------------- */

/** Ícone da régua é SVG do projeto (nunca emoji/crosshair de texto). */
const rulerIconHtml = renderToStaticMarkup(createElement(Icon, { name: 'ruler', size: 16 }));

check(
  'CB290) cursor da RÉGUA: ícone real do projeto acompanhando o ponteiro, sem crosshair',
  movementGridSource.includes('const rulerCursorActive = ruler ? !ruler.locked : quickRuler;') &&
    movementGridSource.includes('<Icon name="ruler" size={16} />') &&
    movementGridSource.includes('className="grid-ruler-cursor"') &&
    movementGridSource.includes('node.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;') &&
    gridCssSource.includes('.grid-viewport.is-ruler-cursor {\n  cursor: none;\n}') &&
    gridCssSource.includes('.grid-token.is-ruler-pick:not(:disabled) {\n  cursor: none;\n}') &&
    // Crosshair não pertence mais à régua (só ao Posicionar, que é placement).
    !/\.grid-viewport\.is-ruler\s*\{[^}]*crosshair/.test(gridCssSource) &&
    rulerIconHtml.startsWith('<svg') &&
    rulerIconHtml.includes('ruler') === false &&
    !/📏/.test(movementGridSource)
);
check(
  'CB291) UMA interpretação de célula: floor contém o ponteiro e régua/placement/destino leem por ela',
  gridMathSource.includes('export function containingCellFeet(') &&
    gridMathSource.includes('const xFeet = floorFeet(feet.xFeet, size);') &&
    // `Math.round(pointer / célula)` escolheria a interseção mais próxima.
    !/Math\.round\(\s*feet\.(x|y)Feet\s*\/\s*cellSizeFeet/.test(gridMathSource) &&
    movementGridSource.includes('function cellAnchorAt(') &&
    movementGridSource.includes('return containingCellFeet(') &&
    movementGridSource.includes('const position = cellAnchorAt(clientX, clientY, \'small\');') &&
    // Nenhum caminho alternativo de leitura do ponteiro sobrou.
    !movementGridSource.includes('pointerAnchor') &&
    movementGridSource.includes('cellAnchorAt(event.clientX, event.clientY, unit.spatial.effectiveSize)')
);
check(
  'CB292) hover fora da cena é NADA (sem clamp para a última célula) e sem validade mecânica local',
  movementGridSource.includes('const anchor = cellAnchorAt(event.clientX, event.clientY, \'small\');') &&
    movementGridSource.includes('setHoverAnchor(anchor);') &&
    movementGridSource.includes('{hoverAnchor && rulerActive ? (') &&
    gridCssSource.includes('grid-hover-cell') &&
    // Highlight é neutro: nada de verde/vermelho decidindo regra no cliente.
    !/\.grid-hover-cell\s*\{[^}]*green/.test(gridCssSource) &&
    !/\.grid-destination-cell\s*\{[^}]*green/.test(gridCssSource)
);
check(
  'CB293) DIRECT DRAG orientado a destino: destino + path derivado, sem acumular rastro do mouse',
  movementGridSource.includes('destination: SpatialPosition | null;') &&
    movementGridSource.includes('function updateDraftAt(clientX: number, clientY: number): void {') &&
    movementGridSource.includes('const sameDestination =') &&
    movementGridSource.includes('? contiguousAnchors(current.startPosition, destination, anchorStepFeet(size))') &&
    // Mesmo destino depois de zigue-zague ⇒ mesmo path (função só dos extremos).
    JSON.stringify(
      contiguousAnchors({ xFeet: 50, yFeet: 50 }, { xFeet: 65, yFeet: 60 }, 5),
    ) ===
      JSON.stringify(contiguousAnchors({ xFeet: 50, yFeet: 50 }, { xFeet: 65, yFeet: 60 }, 5)) &&
    !movementGridSource.includes('path.push') &&
    !movementPathSource.includes('export function appendAnchor(') &&
    !movementGridSource.includes('appendAnchor')
);
check(
  'CB294) preview só quando o DESTINO muda (mesma célula não gera passo nem requisição)',
  movementGridSource.includes('if (sameDestination) {') &&
    movementGridSource.includes('if (pointer.xFeet === current.pointer.xFeet && pointer.yFeet === current.pointer.yFeet) return;') &&
    movementGridSource.includes('const next = { ...current, pointer };') &&
    // O preview continua chaveado pelo PATH (identidade preservada na mesma célula).
    movementGridSource.includes('}, [combat.id, draftCombatantId, draftPath]);')
);
check(
  'CB295) linha do gesto é RETA e fala a linguagem da régua (tracejado, label no meio, metros)',
  movementGridSource.includes('points={[draftTraceFrom, draftTraceTo]}') &&
    movementGridSource.includes('const draftTraceTo = draft && draftDestination ? anchorScreen(draftDestination) : null;') &&
    !movementGridSource.includes('draft.path.map(anchorScreen)') &&
    movementTraceSource.includes('grid-ruler-line') &&
    movementTraceSource.includes('grid-ruler-label') &&
    movementTraceSource.includes('polylineMidpoint') &&
    movementTraceSource.includes('formatMeters')
);
check(
  'CB296) UM ghost suave + célula de destino snapada (nunca duas peças concorrentes)',
  movementGridSource.includes('position: draft.pointer') &&
    movementGridSource.includes('className="grid-destination-cell"') &&
    (movementGridSource.match(/<GridMovementOverlay/g) ?? []).length === 1 &&
    movementGridSource.includes('const pointer = centeredFootprintFeet(feet, size, scene);') &&
    gridCssSource.includes('.grid-destination-cell {')
);
check(
  'CB297) Direct Drag e Measure-to-Move produzem o MESMO path para a mesma origem/destino',
  (() => {
    const origin = { xFeet: 50, yFeet: 50 };
    const destination = { xFeet: 65, yFeet: 60 };
    const direct = contiguousAnchors(origin, destination, anchorStepFeet('medium'));
    const measured = contiguousAnchors(origin, destination, anchorStepFeet('medium'));
    return (
      JSON.stringify(direct) === JSON.stringify(measured) &&
      (movementGridSource.match(/contiguousAnchors\(/g) ?? []).length >= 2 &&
      movementGridSource.includes('const path = contiguousAnchors(') &&
      movementGridSource.includes('? contiguousAnchors(current.startPosition, destination')
    );
  })()
);
check(
  'CB298) servidor segue dono do custo/validade: cliente só manda combatantId+path',
  movementApiBody.includes('combatantId: input.combatantId') &&
    movementApiBody.includes('path: input.path') &&
    !/cost|remaining|difficult|occupied|reach/i.test(movementApiBody) &&
    movementGridSource.includes('if (!fresh.movement.legal || !fresh.movement.affordable) {') &&
    movementGridSource.includes('await previewMovement(combat.id, { combatantId, path });')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.4 — RUNTIME DO GRID + INTEGRIDADE DE PAPEL                        */
/* -------------------------------------------------------------------------- */

const authSource = source('src/auth.tsx');
const useRealtimeSource = source('src/useRealtime.ts');
const socketSource = source('src/socket.ts');
const useCombatStateSource = source('src/combat/useCombatState.ts');
const authMiddlewareSource = source('../src/modules/auth/auth.middleware.ts');
const smokeSource = source('../src/scripts/smoke-realtime.ts');
const spatialMovementSource = source('../src/modules/combat/spatial/spatial-movement.service.ts');
const opportunitySource = source('../src/modules/combat/spatial/opportunity-attack.service.ts');
const combatServiceFullSource = source('../src/modules/combat/combat.service.ts');

check(
  'CB299) "Medir" saiu da toolbar (sem placeholder) e F continua sendo a régua',
  !/>\s*Medir\s*</.test(
    stripComments(
      renderToStaticMarkup(
        createElement(CombatGrid, {
          combat: combatOf([unitOf('hero', 'medium')]),
          isMaster: false,
          movement: { combatantId: 'hero', reason: null },
          onCombatChange: () => undefined,
          onError: () => undefined,
        }),
      ),
    ),
  ) &&
    !/aria-pressed=\{mode === 'measure'\}/.test(stripComments(movementGridSource)) &&
    movementGridSource.includes("event.key === 'f' || event.key === 'F'") &&
    movementGridSource.includes('setQuickRuler')
);
check(
  'CB300) UMA primitive de animação: Direct Drag e Measure-to-Move desembocam no MESMO caminho',
  movementVisualSource.includes('export function useMovementVisual(') &&
    movementVisualSource.includes('const plan = planMovementVisual({') &&
    movementGridSource.includes('const movementVisual = useMovementVisual();') &&
    movementGridSource.includes('subscribeMovementVisual((payload) =>') &&
    // Nenhum dos dois fluxos anima localmente: os dois terminam em commit.
    (stripComments(movementGridSource).match(/startMovementAnimation|setVisualRect\(/g) ?? []).length === 0 &&
    movementGridSource.includes('playMovementVisual.current(payload, size, context.geometry);') &&
    useCombatStateSource.includes('publishMovementVisual(payload);')
);
check(
  'CB301) ESPECTADOR: evento realtime tipado move a peça em qualquer cliente',
  realtimeEventsSource.includes("COMBAT_MOVEMENT_VISUAL: 'combat:movement-visual'") &&
    realtimeEventsSource.includes('export interface CombatMovementVisualPayload {') &&
    socketSource.includes("'combat:movement-visual': (payload: CombatMovementVisualPayload) => void;") &&
    useRealtimeSource.includes("socket.on('combat:movement-visual', (payload) =>") &&
    useRealtimeSource.includes('onCombatMovementVisual?: (payload: CombatMovementVisualPayload) => void;')
);
check(
  'CB302) evento só DEPOIS do commit e só com o TRECHO autorizado (checkpoint em OA)',
  spatialMovementSource.indexOf('await prisma.$transaction(') <
    spatialMovementSource.indexOf('emitMovementVisualSegment(') &&
    spatialMovementSource.includes('result.pending !== null,') &&
    spatialMovementSource.includes('checkpoint,') &&
    // Retomada após a Reação emite um evento NOVO, nunca o caminho restante.
    opportunitySource.includes('publishContinuationVisual(') &&
    opportunitySource.includes('checkpoint: true,') &&
    !/remainingPath/.test(
      combatServiceFullSource.slice(
        combatServiceFullSource.indexOf('export function emitMovementVisual('),
        combatServiceFullSource.indexOf('export function emitMovementVisual(') + 900,
      ),
    )
);
check(
  'CB303) movimento master-only NÃO vaza para jogadores (filtro no servidor)',
  combatServiceFullSource.includes('if (spatialVisibility !== \'master-only\') {') &&
    combatServiceFullSource.includes('broadcaster.toPlayers(ServerEvents.COMBAT_MOVEMENT_VISUAL, payload);') &&
    spatialMovementSource.includes("combatant.spatialVisibility ?? 'public'") &&
    opportunitySource.includes("combatant.spatialVisibility ?? 'public'")
);
check(
  'CB304) dedupe do movimento visual por operationId (operador não anima duas vezes)',
  movementVisualSource.includes('const playedOperations = useRef<Set<string>>(new Set());') &&
    movementVisualSource.includes('const key = `${payload.operationId}:') &&
    movementVisualSource.includes('if (playedOperations.current.has(key)) return;')
);
check(
  'CB305) câmera inicial espera viewport válido e realtime não dá reset',
  movementGridSource.includes('if (viewport.width <= 0 || viewport.height <= 0) return;') &&
    movementGridSource.includes('const sceneKeyRef = useRef(\'\');') &&
    movementGridSource.includes('}, [active, combat.id, dimensions, viewport]);') &&
    // `combat:updated` não entra nas dependências do enquadramento.
    !/\[combat\.version[^\]]*\]/.test(
      movementGridSource.slice(
        movementGridSource.indexOf('useLayoutEffect(() => {'),
        movementGridSource.indexOf('useLayoutEffect(() => {') + 900,
      ),
    )
);
check(
  'CB306) token usa a imagem ORIGINAL e nada de "pixelated" como conserto',
  combatDtoSource.includes('tokenImageRef: combatant.character?.avatarUrl || combatant.creature?.imageUrl || null,') &&
    /\.grid-token-img\s*\{[^}]*image-rendering: auto/.test(gridCssSource) &&
    !/image-rendering:\s*(pixelated|crisp-edges)/.test(gridCssSource) &&
    // A camada da câmera NÃO é promovida permanentemente: escalar uma textura
    // já rasterizada era o que borrava o retrato no zoom.
    (() => {
      const block = gridCssSource.slice(
        gridCssSource.indexOf('.grid-camera {'),
        gridCssSource.indexOf('.grid-camera {') + 220,
      );
      return block.includes('transform-origin: 0 0;') && !block.includes('will-change');
    })() &&
    gridCssSource.includes('object-fit: cover;')
);
check(
  'CB307) papel vem do SERVIDOR: a UI relê a sessão e nunca o inventa',
  authMiddlewareSource.includes('prisma.user.findUnique({') &&
    authMiddlewareSource.includes('role: user.role,') &&
    authSource.includes('fetchCurrentUser()') &&
    authSource.includes("document.addEventListener('visibilitychange', onVisible);") &&
    !/localStorage.*role|sessionStorage.*role/.test(authSource)
);
check(
  'CB308) smoke NUNCA altera conta real (sem promoção/cleanup por username)',
  !smokeSource.includes('demoteForeignOnlinePlayers') &&
    !smokeSource.includes('foreignDemotedUsernames') &&
    smokeSource.includes('function requireNoForeignOnlinePlayers(') &&
    !/updateMany\(\{\s*where: \{ username: \{ in: foreign/.test(smokeSource) &&
    smokeSource.includes('preexistingUsers = await prisma.user.findMany({') &&
    smokeSource.includes('integridade) contas reais mantêm id, username e role depois do smoke') &&
    smokeSource.includes('guard) fixture PLAYER continua PLAYER e fixture MASTER continua MASTER')
);

check(
  'CB309) plano da animação: anchors autorizados, duração por passo e fim na caixa do destino',
  (() => {
    const geometry = { cellSizeFeet: 5, pixelsPerCell: 40 };
    const full = planMovementVisual({
      combatantId: 'hero',
      from: { xFeet: 0, yFeet: 0 },
      path: [
        { xFeet: 5, yFeet: 0 },
        { xFeet: 10, yFeet: 0 },
      ],
      to: { xFeet: 10, yFeet: 0 },
      size: 'medium',
      ...geometry,
    });
    // Checkpoint de Reação: só o trecho aplicado é animado.
    const checkpoint = planMovementVisual({
      combatantId: 'hero',
      from: { xFeet: 0, yFeet: 0 },
      path: [{ xFeet: 5, yFeet: 0 }],
      to: { xFeet: 5, yFeet: 0 },
      size: 'medium',
      ...geometry,
    });
    const still = planMovementVisual({
      combatantId: 'hero',
      from: { xFeet: 0, yFeet: 0 },
      path: [],
      to: { xFeet: 0, yFeet: 0 },
      size: 'medium',
      ...geometry,
    });
    return Boolean(
      full &&
        checkpoint &&
        full.points.length === 3 &&
        checkpoint.points.length === 2 &&
        full.width === 40 &&
        full.durationMs === 2 * MOVEMENT_STEP_MS &&
        movementPointAt(full, 1).left === full.points[2].left &&
        still === null,
    );
  })()
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.4.1 — LIFECYCLE DE ATIVAÇÃO DO GRID (inactive → initializing → ready) */
/* -------------------------------------------------------------------------- */
const sizeOf = (width: number, height: number): { width: number; height: number } => ({
  width,
  height,
});
/** Bloco da CÂMERA/ativação: é onde `setTimeout` cego seria proibido. */
const activationBlock = movementGridSource.slice(
  movementGridSource.indexOf('ENQUADRAMENTO INICIAL'),
  movementGridSource.indexOf('function applyCamera'),
);

check(
  'CB310) fase do grid é explícita e puramente derivada: inactive → initializing → ready',
  gridPhaseOf({ active: false, viewport: sizeOf(1200, 700), scene: sizeOf(880, 880), cameraReady: true }) ===
    'inactive' &&
    // Ativado com viewport 0×0 (antes de o ResizeObserver medir): NUNCA ready.
    gridPhaseOf({ active: true, viewport: sizeOf(0, 0), scene: sizeOf(880, 880), cameraReady: false }) ===
      'initializing' &&
    // Viewport válido, mas sem enquadramento aplicado: ainda não é interativo.
    gridPhaseOf({ active: true, viewport: sizeOf(1200, 700), scene: sizeOf(880, 880), cameraReady: false }) ===
      'initializing' &&
    // Cena sem dimensão mecânica também não libera interação.
    gridPhaseOf({ active: true, viewport: sizeOf(1200, 700), scene: sizeOf(0, 0), cameraReady: true }) ===
      'initializing' &&
    gridPhaseOf({ active: true, viewport: sizeOf(1200, 700), scene: sizeOf(880, 880), cameraReady: true }) ===
      'ready' &&
    // A fase é DERIVADA do estado observável, nunca marcada à mão no JSX.
    movementGridSource.includes('const gridPhase: GridPhase = gridPhaseOf({') &&
    movementGridSource.includes('data-grid-phase={gridPhase}')
);
check(
  'CB311) ativar o grid REINSTALA o bootstrap (observer/wheel/atalhos dependem de `active`)',
  movementGridSource.includes("const active = scene.mode === 'grid-2d';") &&
    // O observer agora é de LAYOUT e reexecuta na ativação (era `[]` — a causa).
    (movementGridSource.match(/if \(!active\) return undefined;/g) ?? []).length >= 3 &&
    movementGridSource.includes('  }, [active]);\n') &&
    movementGridSource.includes('const observer = new ResizeObserver((entries) => {') &&
    // Desativar zera a medição: a próxima ativação mede o viewport NOVO.
    movementGridSource.includes('setViewport((current) =>') &&
    movementGridSource.includes(
      'current.width === 0 && current.height === 0 ? current : { width: 0, height: 0 },',
    ) &&
    movementGridSource.includes('function attachRulerCursor(') &&
    // A viewport é remontada pela cena ativa: o ref continua sendo a fonte.
    movementGridSource.includes('ref={viewportRef}')
);
check(
  'CB312) câmera só nasce PRONTA com viewport e cena válidos (nada de fit em 0×0)',
  movementGridSource.includes('if (viewport.width <= 0 || viewport.height <= 0) return;') &&
    movementGridSource.includes('if (dimensions.width <= 0 || dimensions.height <= 0) return;') &&
    movementGridSource.includes('cameraInitialized.current = true;') &&
    // A prontidão só é marcada DEPOIS do fit e da marca de inicialização.
    movementGridSource.indexOf('cameraInitialized.current = true;') >
      movementGridSource.indexOf('fitCamera({ scene: dimensions, viewport, margin: CAMERA_FIT_MARGIN_PX })') &&
    movementGridSource.indexOf('setCameraReady(true);') >
      movementGridSource.indexOf('cameraInitialized.current = true;') &&
    // Fit inicial e botão "Enquadrar" chamam a MESMA função pura.
    movementGridSource.includes('function fitScene(): void {') &&
    movementGridSource.includes(
      'applyCamera(fitCamera({ scene: dimensions, viewport, margin: CAMERA_FIT_MARGIN_PX }));',
    ) &&
    // Dimensões da cena vêm do estado MECÂNICO, não de medir o DOM da cena.
    movementGridSource.includes('scenePixels(scene, cellSizeFeet, DEFAULT_PIXELS_PER_CELL)')
);
check(
  'CB313) atalhos, wheel e régua só valem com grid ATIVO (listeners não vazam para INACTIVE)',
  movementGridSource.includes("node.addEventListener('wheel', onWheel, { passive: false });") &&
    movementGridSource.includes(
      '}, [active, dimensions.width, dimensions.height, viewport.width, viewport.height]);',
    ) &&
    movementGridSource.includes('}, [active, ruler, quickRuler, draft, combat.spatial.mode, rulerActive]);') &&
    movementGridSource.includes("if ((event.key === 'f' || event.key === 'F') && !event.repeat) {") &&
    movementGridSource.includes("window.addEventListener('keydown', onKeyDown);") &&
    movementGridSource.includes("window.addEventListener('keyup', onKeyUp);") &&
    // F depois de ativar não depende de clique/foco/reload: o atalho é JANELA.
    movementGridSource.includes('setQuickRuler(true);')
);
check(
  'CB314) cada listener tem setup + cleanup próprios (ON→OFF→ON não duplica)',
  movementGridSource.includes('return () => observer.disconnect();') &&
    movementGridSource.includes("return () => node.removeEventListener('wheel', onWheel);") &&
    movementGridSource.includes("window.removeEventListener('keydown', onKeyDown);") &&
    movementGridSource.includes("window.removeEventListener('keyup', onKeyUp);") &&
    movementGridSource.includes("window.removeEventListener('pointermove', onMove);") &&
    (movementGridSource.match(/window\.addEventListener\('keydown'/g) ?? []).length === 1 &&
    (movementGridSource.match(/window\.addEventListener\('keyup'/g) ?? []).length === 1 &&
    (movementGridSource.match(/window\.addEventListener\('pointermove'/g) ?? []).length === 1 &&
    (movementGridSource.match(/node\.addEventListener\('wheel'/g) ?? []).length === 1 &&
    (movementGridSource.match(/new ResizeObserver\(/g) ?? []).length === 1
);
check(
  'CB315) ativação sem setTimeout cego e sem remount arbitrário por key',
  !/setTimeout\(/.test(activationBlock) &&
    !/requestAnimationFrame/.test(activationBlock) &&
    !/key=\{[^}]*Date\.now/.test(movementGridSource) &&
    // Nada de "remontar a cada update": o componente fica montado e o
    // bootstrap é reentrante por `active`.
    !/key=\{combat\.version/.test(movementGridSource) &&
    movementGridSource.includes('function beginDraft(')
);
check(
  'CB316) reativar PRESERVA a câmera do usuário; estado corrompido reenquadra',
  movementGridSource.includes('const keepCamera =') &&
    movementGridSource.includes('cameraTouched.current && cameraInitialized.current && cameraIsUsable(preserved)') &&
    movementGridSource.includes('clampCamera(preserved, dimensions, viewport)') &&
    movementGridSource.includes('cameraInitialized.current = false;') &&
    cameraIsUsable({ panX: 40, panY: 20, zoom: 1.5 }) &&
    !cameraIsUsable({ panX: Number.NaN, panY: 0, zoom: 1 }) &&
    !cameraIsUsable({ panX: 0, panY: 0, zoom: 0 }) &&
    // `combat:updated` continua fora: só cena/dimensões reabrem o enquadramento.
    !/\[combat\.version[^\]]*\]/.test(activationBlock)
);
check(
  'CB317) durante INITIALIZING a cena fica oculta e sem interação (revela no fit)',
  /\.grid-viewport\.is-initializing\s*\{[^}]*pointer-events: none;/.test(gridCssSource) &&
    /\.grid-viewport\.is-initializing \.grid-camera\s*\{[^}]*opacity: 0;/.test(gridCssSource) &&
    movementGridSource.includes("gridPhase !== 'ready' ? 'is-initializing' : ''") &&
    movementGridSource.includes("disabled={gridPhase !== 'ready'}") &&
    // Activate SEM remount: o listener do gesto resolve pelo ref do viewport.
    movementGridSource.includes('viewportPoint(clientX: number, clientY: number): Point2D | null') &&
    movementGridSource.includes('const node = viewportRef.current;')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.4.2 — AUTO-PAN: DIREÇÃO DE REVELAÇÃO                              */
/* -------------------------------------------------------------------------- */

// Mesma zona e velocidade de produção: esta task corrige DIREÇÃO, não tuning.
const AUTO_PAN_EDGE = 52;
const AUTO_PAN_SPEED = 14;
const AUTO_PAN_BOUNDS = { left: 0, top: 0, right: 1200, bottom: 700 };

/** Ponteiro de borda → intenção → delta de câmera → ponto de cena sob ele. */
function autoPanFrom(
  pointer: { x: number; y: number },
  camera: GridCamera,
): { camera: GridCamera; before: { x: number; y: number }; after: { x: number; y: number } } {
  const delta = autoPanCameraDelta(
    revealIntentAt(pointer, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE),
    AUTO_PAN_SPEED,
  );
  return {
    camera: panBy(camera, delta.dx, delta.dy),
    before: screenToScene(camera, pointer),
    after: screenToScene(panBy(camera, delta.dx, delta.dy), pointer),
  };
}

check(
  'CB318) auto-pan declara INTENÇÃO DE REVELAÇÃO (0..1 por lado), nunca delta cru de câmera',
  (() => {
    const right = revealIntentAt({ x: 1190, y: 350 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE);
    const left = revealIntentAt({ x: 6, y: 350 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE);
    const up = revealIntentAt({ x: 600, y: 3 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE);
    const down = revealIntentAt({ x: 600, y: 694 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE);
    const center = revealIntentAt({ x: 600, y: 350 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE);
    return (
      right.right > 0 &&
      right.left === 0 &&
      right.up === 0 &&
      right.down === 0 &&
      left.left > 0 &&
      left.right === 0 &&
      up.up > 0 &&
      up.down === 0 &&
      down.down > 0 &&
      down.up === 0 &&
      // Centro: intenção nenhuma (auto-pan só existe na borda).
      center.left === 0 &&
      center.right === 0 &&
      center.up === 0 &&
      center.down === 0 &&
      // Profundidade normalizada: no limite chega a 1, nunca passa.
      revealIntentAt({ x: 0, y: 0 }, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE).left === 1 &&
      // Zona desligada não inventa intenção.
      revealIntentAt({ x: 1190, y: 350 }, AUTO_PAN_BOUNDS, 0).right === 0
    );
  })(),
);
check(
  'CB319) borda DIREITA revela MAIS cena à direita (pan manual já diferente de zero)',
  (() => {
    const camera: GridCamera = { panX: 340, panY: -210, zoom: 1 };
    const { camera: moved, before, after } = autoPanFrom({ x: 1190, y: 350 }, camera);
    // A cena sob o ponteiro AVANÇA para a direita; a câmera recua em panX.
    return moved.panX < camera.panX && after.x > before.x && Math.abs(after.y - before.y) < 1e-9;
  })(),
);
check(
  'CB320) borda ESQUERDA revela MAIS cena à esquerda (o lado oposto, nunca o mesmo)',
  (() => {
    const camera: GridCamera = { panX: 340, panY: -210, zoom: 1 };
    const { camera: moved, before, after } = autoPanFrom({ x: 8, y: 350 }, camera);
    return moved.panX > camera.panX && after.x < before.x && Math.abs(after.y - before.y) < 1e-9;
  })(),
);
check(
  'CB321) borda SUPERIOR revela ACIMA e INFERIOR revela ABAIXO',
  (() => {
    const camera: GridCamera = { panX: 12, panY: -44, zoom: 1 };
    const top = autoPanFrom({ x: 600, y: 5 }, camera);
    const bottom = autoPanFrom({ x: 600, y: 695 }, camera);
    return (
      top.camera.panY > camera.panY &&
      top.after.y < top.before.y &&
      bottom.camera.panY < camera.panY &&
      bottom.after.y > bottom.before.y &&
      Math.abs(top.after.x - top.before.x) < 1e-9 &&
      Math.abs(bottom.after.x - bottom.before.x) < 1e-9
    );
  })(),
);
check(
  'CB322) CANTOS combinam os dois eixos (diagonal revela no sentido do ponteiro)',
  (() => {
    const camera: GridCamera = { panX: -60, panY: 90, zoom: 1.5 };
    const tl = autoPanFrom({ x: 4, y: 4 }, camera);
    const tr = autoPanFrom({ x: 1196, y: 4 }, camera);
    const bl = autoPanFrom({ x: 4, y: 696 }, camera);
    const br = autoPanFrom({ x: 1196, y: 696 }, camera);
    return (
      tl.after.x < tl.before.x &&
      tl.after.y < tl.before.y &&
      tr.after.x > tr.before.x &&
      tr.after.y < tr.before.y &&
      bl.after.x < bl.before.x &&
      bl.after.y > bl.before.y &&
      br.after.x > br.before.x &&
      br.after.y > br.before.y
    );
  })(),
);
check(
  'CB323) a DIREÇÃO não depende do zoom (0,75× / 1× / 1,5× / 2× revelam o mesmo lado)',
  [0.75, 1, 1.5, 2].every((zoom) => {
    const camera: GridCamera = { panX: -120, panY: 60, zoom };
    const right = autoPanFrom({ x: 1190, y: 350 }, camera);
    const left = autoPanFrom({ x: 10, y: 350 }, camera);
    return right.after.x > right.before.x && left.after.x < left.before.x;
  }),
);
check(
  'CB324) no limite da cena o auto-pan para: clamp devolve a MESMA câmera (sem oscilar)',
  (() => {
    const scene = { width: 880, height: 880 };
    const viewport = { width: 1200, height: 700 };
    // Câmera já no extremo direito da cena (só `keep` px visíveis).
    const pinned = clampCamera({ panX: -1e6, panY: 0, zoom: 1 }, scene, viewport);
    const { camera: moved } = autoPanFrom({ x: 1190, y: 350 }, pinned);
    const clamped = clampCamera(moved, scene, viewport);
    return pinned.panX === 96 - 880 && clamped.panX === pinned.panX && clamped.panY === pinned.panY;
  })(),
);
check(
  'CB325) PONTEIRO PARADO: reprojeção muda a célula de destino e o path segue origem→destino',
  (() => {
    const geometry = { pixelsPerCell: 44, cellSizeFeet: 5 };
    const sceneFeet = { widthFeet: 200, heightFeet: 200 };
    const pointer = { x: 1190, y: 350 };
    // Cena maior que o viewport, usuário já panned (pan ≠ 0).
    let camera: GridCamera = { panX: -280, panY: -530, zoom: 1 };
    const cells = new Set<string>();
    for (let frame = 0; frame < 40; frame += 1) {
      const delta = autoPanCameraDelta(
        revealIntentAt(pointer, AUTO_PAN_BOUNDS, AUTO_PAN_EDGE),
        AUTO_PAN_SPEED,
      );
      camera = panBy(camera, delta.dx, delta.dy);
      const cell = containingCellFeet(screenToFeet(camera, pointer, geometry), 'medium', sceneFeet);
      if (cell) cells.add(`${cell.xFeet}:${cell.yFeet}`);
    }
    // O MESMO destino gera o MESMO trajeto: nenhum histórico de câmera no path.
    const destination = { xFeet: 30, yFeet: 20 };
    const fromDrag = contiguousAnchors({ xFeet: 0, yFeet: 0 }, destination, 5);
    const fromRuler = contiguousAnchors({ xFeet: 0, yFeet: 0 }, destination, 5);
    return (
      camera.panX < -280 &&
      cells.size >= 3 &&
      fromDrag.length === fromRuler.length &&
      fromDrag.every(
        (step, index) =>
          step.xFeet === fromRuler[index].xFeet && step.yFeet === fromRuler[index].yFeet,
      ) &&
      fromDrag[fromDrag.length - 1].xFeet === destination.xFeet
    );
  })(),
);
check(
  'CB326) câmera NÃO entra no custo de Movement (nenhum pan/zoom chega à API)',
  !movementApiSource.includes('panX') &&
    !movementApiSource.includes('panY') &&
    !movementApiSource.includes('zoom') &&
    !movementPathSource.includes('panX') &&
    !movementPathSource.includes('zoom'),
);
check(
  'CB327) tick usa reveal→delta→clamp, reprojeta o ponteiro parado e NÃO inverte o pan manual',
  movementGridSource.includes('revealIntentAt(') &&
    movementGridSource.includes('AUTO_PAN_EDGE_PX,') &&
    movementGridSource.includes('autoPanCameraDelta(intent, AUTO_PAN_MAX_SPEED)') &&
    movementGridSource.includes('bounded(panBy(cameraRef.current, delta.dx, delta.dy))') &&
    movementGridSource.includes('updateDraftAt(pointer.x, pointer.y);') &&
    // Só com gesto ativo: sem draft nenhum loop de auto-pan existe.
    movementGridSource.includes('if (!draft) return undefined;') &&
    // Pan manual (Space/botão do meio/fundo) preservado, sinal aprovado.
    movementGridSource.includes('const next = bounded(panBy(gesture.camera, dx, dy));') &&
    // Path continua DERIVADO do destino, não do rastro do ponteiro.
    movementGridSource.includes('contiguousAnchors(current.startPosition, destination, anchorStepFeet(size))') &&
    // Um único loop, com cancelamento no cleanup (pointerup/cancel/Esc).
    (movementGridSource.match(/requestAnimationFrame\(tick\)/g) ?? []).length === 2 &&
    movementGridSource.includes('cancelAnimationFrame(frame)') &&
    !movementGridSource.includes('edgePanSpeed')
);

/* -------------------------------------------------------------------------- */
/* 6.6M.3.1.4.3 — GHOST = CURSOR · COMMIT PRÓPRIO · LOG EM METROS              */
/* -------------------------------------------------------------------------- */

/** Leitura de um arquivo do BACKEND (a raiz do repo está dois níveis acima). */
const serverSource = (relative: string): string =>
  readFileSync(resolve(here, '..', '..', relative), 'utf8');
const movementLogServiceSource = serverSource('src/modules/combat/spatial/spatial-movement.service.ts');
const movementLogDomainSource = serverSource('src/modules/combat/spatial/spatial-movement.ts');
const protectedStateSource = serverSource('src/scripts/support/protected-state.ts');
const smokeRealtimeSource = serverSource('src/scripts/smoke-realtime.ts');

/**
 * Centro VISUAL do ghost em px de TELA: a caixa é desenhada em px de CENA
 * dentro do container que recebe o transform da câmera (uma única vez).
 */
function ghostCenterScreen(
  camera: GridCamera,
  pointer: { x: number; y: number },
  size: SpatialSize,
  scene: { widthFeet: number; heightFeet: number },
): { x: number; y: number } {
  const geometry = { pixelsPerCell: 44, cellSizeFeet: 5 };
  const feet = screenToFeet(camera, pointer, geometry);
  const anchor = centeredFootprintFeet(feet, size, scene);
  const box = {
    left: feetToPx(anchor.xFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
    top: feetToPx(anchor.yFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
    width: feetToPx(SIZE_FOOTPRINT_FEET[size].widthFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
    height: feetToPx(SIZE_FOOTPRINT_FEET[size].heightFeet, geometry.cellSizeFeet, geometry.pixelsPerCell),
  };
  return sceneToScreen(camera, {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  });
}

check(
  'CB328) GHOST = CURSOR: o centro do footprint cai no ponteiro (pan, zoom, canto e Large)',
  (() => {
    const scene = { widthFeet: 200, heightFeet: 200 };
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
    // Pans negativos = cena rolada para a direita/baixo (o caso real do gesto).
    const cameras: GridCamera[] = [
      { panX: 0, panY: 0, zoom: 1 },
      { panX: -340, panY: -210, zoom: 1 },
      { panX: -88, panY: -512, zoom: 0.75 },
      { panX: -120, panY: -60, zoom: 1.5 },
      { panX: -800, panY: -400, zoom: 2 },
    ];
    const pointers = [
      { x: 500, y: 300 },
      { x: 137, y: 612 },
      { x: 980, y: 74 },
    ];
    return cameras.every((camera) =>
      pointers.every((pointer) =>
        (['tiny', 'medium', 'large', 'huge'] as SpatialSize[]).every((size) => {
          const center = ghostCenterScreen(camera, pointer, size, scene);
          return near(center.x, pointer.x) && near(center.y, pointer.y);
        }),
      ),
    );
  })(),
);
check(
  'CB329) ghost em px de CENA (sem duplicar o transform) e sem `grab` do clique',
  (() => {
    const parts: Record<string, boolean> = {
      'pointer centrado': movementGridSource.includes(
        'const pointer = centeredFootprintFeet(feet, size, scene);',
      ),
      'destino da célula': movementGridSource.includes(
        'const destination = containingCellFeet(pointer, size, scene);',
      ),
      'sem grab em uso': !movementGridSource.includes('current.grab'),
      'sem grab no draft': !movementGridSource.includes('grab: gesture.grab'),
      'ghost usa o pointer': movementGridSource.includes('position: draft.pointer,'),
      'overlay em px de cena': movementOverlaySource.includes(
        'feetToPx(position.xFeet, cellSizeFeet, pixelsPerCell)',
      ),
      'overlay sem transform': !/translate\([^)]*pointer/i.test(movementOverlaySource),
    };
    const bad = Object.entries(parts).filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0) console.log(`    ↳ CB329 falhou em: ${bad.join(', ')}`);
    return bad.length === 0;
  })(),
);
check(
  'CB330) commit PRÓPRIO não cancela (toast falso) e invalidação EXTERNA continua',
  movementGridSource.includes('if (committingRef.current === draft.combatantId) return;') &&
    movementGridSource.includes('committingRef.current = combatantId;') &&
    movementGridSource.includes('committingRef.current = intent.combatantId;') &&
    movementGridSource.includes('committingRef.current = null;') &&
    // A invalidação não foi removida: mudança externa antes do drop ainda vale.
    movementGridSource.includes("combat.status !== 'ACTIVE' ||") &&
    movementGridSource.includes('combat.currentCombatantId !== draft.combatantId') &&
    movementGridSource.includes('position.xFeet !== draft.startPosition.xFeet') &&
    movementGridSource.includes('O movimento foi cancelado: o estado do combate mudou.') &&
    // Falha REAL (409/ilegal) mantém feedback: o catch não é silencioso.
    movementGridSource.includes('setDraftNotice(messageOf(error));')
);
check(
  'CB331) Registro de combate em METROS, engine e campos internos continuam em PÉS',
  (() => {
    const parts: Record<string, boolean> = {
      'distância em m': movementLogServiceSource.includes(
        'formatMetersPtBr(evaluation.totalDistanceFeet)',
      ),
      'custo em m': /formatMetersPtBr\(\s*evaluation\.totalCostFeet\s*,?\s*\)/.test(
        movementLogServiceSource,
      ),
      'restante em m': movementLogServiceSource.includes('formatMetersPtBr(remainingAfter)'),
      'trecho em m': movementLogServiceSource.includes('formatMetersPtBr(totals.distanceFeet)'),
      'sem log em pés': !/Moveu \$\{[^}]*\} pés/.test(movementLogServiceSource),
      'sem restante em pés': !/restam \$\{[^}]*\} pés/.test(movementLogServiceSource),
      'formatter exportado': movementLogDomainSource.includes(
        'export function formatMetersPtBr(feet: number): string',
      ),
      'conversão reutilizada': movementLogDomainSource.includes('feetToMeters(feet)'),
      'engine em pés':
        movementLogDomainSource.includes('totalDistanceFeet') &&
        movementLogDomainSource.includes('totalCostFeet'),
      // Só existem nomes de CAMPO em pés: nenhuma grandeza mecânica virou metro.
      'nenhum campo em metros': !/\b(totalDistance|totalCost|movementRemaining)Meters\b/.test(
        movementLogDomainSource,
      ),
      // 6.6M.3.1.4.3.1 — TODO template de Moveu passa pelo formatter (sem
      // segundo caminho de string) e o card mostra a mensagem do SERVIDOR.
      'um formatter para todo Moveu':
        (movementLogServiceSource.match(/Moveu /g) ?? []).length === 2 &&
        (movementLogServiceSource.match(/Moveu \$\{formatMetersPtBr\(/g) ?? []).length === 2,
      'erro de insuficiência em metros': movementLogServiceSource.includes(
        'Movimento insuficiente: o trajeto custa ${formatMetersPtBr(',
      ),
      'card renderiza a mensagem crua': (() => {
        const log = source('src/combat/components/CombatLog.tsx');
        return (
          log.includes('entry.message') &&
          !/\.replace\(\s*['"`]\(?p[ée]s/i.test(log) &&
          !/formatFeet\(/.test(log)
        );
      })(),
    };
    const bad = Object.entries(parts).filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0) console.log(`    ↳ CB331 falhou em: ${bad.join(', ')}`);
    return bad.length === 0;
  })(),
);
check(
  'CB332) ISOLAMENTO de fixtures: fotografia de fichas/NPCs reais + diff + restore exato',
  protectedStateSource.includes('export async function snapshotProtectedGameState') &&
    protectedStateSource.includes('export async function diffProtectedGameState') &&
    protectedStateSource.includes('export async function restoreProtectedGameState') &&
    // Comparação de LINHA INTEIRA (não uma lista de campos "conhecidos").
    protectedStateSource.includes('Object.keys(snapshot.data)') &&
    // Restore exato: devolve o valor anterior, nunca default de vida.
    protectedStateSource.includes('data[field] = snapshot.data[field];') &&
    !/hpCurrent:\s*\w+\.hpMax/.test(protectedStateSource) &&
    !/deathState:\s*\{\s*\}/.test(protectedStateSource) &&
    // Compare-and-set por `version`: escrita humana concorrente nunca é sobrescrita.
    protectedStateSource.includes('updateMany({ where: { id: row.id, ...guard }, data })') &&
    smokeRealtimeSource.includes('protectedState = await snapshotProtectedGameState();') &&
    smokeRealtimeSource.includes('integridade) personagens reais permanecem idênticos') &&
    smokeRealtimeSource.includes('integridade) NPCs reais permanecem idênticos') &&
    // A limpeza continua por ID criado pela execução.
    smokeRealtimeSource.includes('createdCreatureIds') &&
    smokeRealtimeSource.includes('createdCombatIds')
);
check(
  'CB333) `POST /combat` traz a mesa inteira, mas o teste REMOVE as fichas que não são fixtures',
  (() => {
    const deathSource = serverSource('src/scripts/smoke-death.ts');
    const parts: Record<string, boolean> = {
      'fixa as fixtures': deathSource.includes(
        'const fixtureCharacterIds = new Set(',
      ),
      'remove ficha real do combate': /combatant\.deleteMany\(\{\s*where: \{\s*combatId: hotfixCombatId,\s*kind: 'CHARACTER',\s*characterId: \{ notIn: \[\.\.\.fixtureCharacterIds\] \}/.test(
        deathSource,
      ),
      'fallback só em fixture': deathSource.includes(
        'if (item.characterId && !fixtureCharacterIds.has(item.characterId)) continue;',
      ),
      'guard de isolamento': deathSource.includes(
        '65.isolamento) o combate de teste NÃO contém ficha real de jogador',
      ),
      // O restore não substitui isolamento: nenhum "cura todos"/"ressuscita todos".
      'sem heal global': !/UPDATE characters SET/i.test(protectedStateSource),
      'sem heal/alive global no harness': !/updateMany\(\{\s*where: \{\s*\},\s*data: \{[^}]*(hpCurrent|deathState)/.test(
        deathSource,
      ),
    };
    const bad = Object.entries(parts).filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length > 0) console.log(`    ↳ CB333 falhou em: ${bad.join(', ')}`);
    return bad.length === 0;
  })(),
);

console.log(failures === 0 ? '\nOK — todos os itens passaram.' : `\nFALHOU — ${failures} item(ns).`);
if (failures > 0) process.exit(1);
