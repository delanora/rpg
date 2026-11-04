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
import { currentUserControlsCombatant } from '../src/combat/turnControl';
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
      rollAvailable: true,
      canRoll: true,
      rollLabel: 'Rolar Teste contra a Morte',
    }),
  );
  check('AD) painel de Teste contra a Morte substitui o fluxo de ataque', tracker.includes('<DeathSavePanel') && !savesPanel.includes('Escolha o ataque') && savesPanel.includes('Rolar Teste contra a Morte'));

  // AE. Pending mostra a mensagem apropriada (sem botões de decisão).
  const pending = renderToStaticMarkup(
    createElement(DeathSavePanel, {
      name: 'Umbrae',
      death: deathOf({ pending: { id: 'p', kind: 'failures', reason: '', createdAt: '', cause: null } }),
      rollAvailable: false,
      canRoll: false,
      rollLabel: 'Rolar Teste contra a Morte',
    }),
  );
  check('AE) pendente mostra "mãos do Mestre" e não oferece rolagem', pending.includes('mãos do Mestre') && !pending.includes('Rolar Teste contra a Morte'));

  // AF. Estabilizado mostra o estado; AG. Morto mostra o estado.
  const stabilized = renderToStaticMarkup(
    createElement(DeathSavePanel, { name: 'Razzil', death: deathOf({ stabilized: true, successes: 3 }), rollAvailable: false, canRoll: false, rollLabel: 'Rolar' }),
  );
  const dead = renderToStaticMarkup(
    createElement(DeathSavePanel, { name: 'Razzil', death: deathOf({ dead: true, failures: 3 }), rollAvailable: false, canRoll: false, rollLabel: 'Rolar' }),
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
    dto.includes('isMasterOnlyCombatant(combatant.kind)') &&
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
    service.includes('{ private: isMasterOnlyCombatant(targetCombatant.kind) }') &&
      service.includes("{ private: isMasterOnlyCombatant(outgoing.kind) }") &&
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
    service.includes("if (combatant.kind !== 'CHARACTER')") &&
      service.includes('combatant.creature?.hpMax') &&
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
      castOptionsService.includes('targetingSummary(execution.targeting, at)') &&
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
}

console.log(failures === 0 ? '\nOK — todos os itens passaram.' : `\nFALHOU — ${failures} item(ns).`);
if (failures > 0) process.exit(1);
