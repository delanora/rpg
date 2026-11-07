/**
 * 6.6M.8.1 — RENDER REAL (jsdom) DO CICLO DE MORTE E DA TROCA DE CENA.
 *
 * Por que este arquivo existe: as verificações de `check-combat-ui.ts` são
 * estáticas/SSR e NÃO conseguem provar a violação de Hooks — o React só erra
 * (`#300` / `#310`) quando o MESMO componente re-renderiza com uma quantidade
 * diferente de hooks. Aqui cada componente é MONTADO de verdade
 * (`react-dom/client`) e ATUALIZADO (grid ↔ cena assistida, morte ↔ vida,
 * Teste contra a Morte ↔ sucesso/falha/pendência) para que a ordem dos hooks
 * seja exercitada como no navegador.
 *
 * Segurança: nenhum acesso à API real. `fetch` é substituído por um stub que
 * falha de propósito e todas as fixtures são objetos locais — nada é enviado ao
 * servidor, nenhum personagem/NPC real é tocado (ANTES = DEPOIS no banco).
 *
 * Execução (o `package.json` da raiz é WIP de outra tarefa; não foi alterado):
 *   npx tsx --tsconfig client/tsconfig.json client/scripts/check-death-lifecycle-render.tsx
 */
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';

/* -------------------------------------------------------------------------- */
/* AMBIENTE DOM                                                               */
/* -------------------------------------------------------------------------- */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});
const win = dom.window as unknown as typeof globalThis & { [key: string]: unknown };
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = win;
globals.document = win.document;
for (const key of [
  'HTMLElement',
  'HTMLDivElement',
  'HTMLButtonElement',
  'Element',
  'Node',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'MutationObserver',
  'localStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  const value = win[key];
  if (value !== undefined) globals[key] = value;
}
globals.getComputedStyle = win.getComputedStyle.bind(win);
try {
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
} catch {
  /* Node sem `navigator` gravável: o jsdom já expõe o necessário. */
}
globals.IS_REACT_ACT_ENVIRONMENT = true;

/** Nada aqui pode chamar a API de verdade: as fixtures são locais. */
const fetchCalls: string[] = [];
const fetchStub = (input: unknown): Promise<never> => {
  fetchCalls.push(String(input));
  return Promise.reject(new Error('fixture: rede desligada no teste de render'));
};
globals.fetch = fetchStub;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { createElement: h, act } = React;
const { SheetAccessProvider } = await import('../src/readonly');
const { PlayerCombatDock } = await import('../src/combat/components/PlayerCombatDock');
const { DeathSavePanel } = await import('../src/combat/components/DeathSavePanel');
const { DeathCounter } = await import('../src/death/DeathCounter');
const { DeathPanel } = await import('../src/death/DeathPanel');
const { CombatGrid } = await import('../src/combat/grid/CombatGrid');
const { deathDockLabel } = await import('../src/combat/deathDock');
import type { DeathState } from '../src/types';

/* -------------------------------------------------------------------------- */
/* HARNESS                                                                    */
/* -------------------------------------------------------------------------- */

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
}

const hookErrors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  const text = args.map((item) => String(item)).join(' ');
  if (/hooks?|Hook|Rendered (more|fewer)|Minified React error/i.test(text)) {
    hookErrors.push(text.slice(0, 400));
  }
  originalError(...args);
};

interface Mounted {
  container: HTMLElement;
  rerender: (next: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
  error: string | null;
}

/** Monta (ou atualiza) como o navegador faria — dentro de `act`. */
async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const mounted: Mounted = {
    container,
    error: null,
    rerender: async (next) => {
      try {
        await act(async () => {
          root.render(next);
        });
      } catch (cause) {
        mounted.error = cause instanceof Error ? cause.message : String(cause);
      }
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
  try {
    await act(async () => {
      root.render(element);
    });
  } catch (cause) {
    mounted.error = cause instanceof Error ? cause.message : String(cause);
  }
  return mounted;
}

const text = (node: ParentNode | null): string => (node ? (node.textContent ?? '') : '');

/* -------------------------------------------------------------------------- */
/* FIXTURES (puras, em memória)                                               */
/* -------------------------------------------------------------------------- */

const deathState = (overrides: Partial<DeathState> = {}): DeathState => ({
  successes: 0,
  failures: 0,
  stabilized: false,
  dead: false,
  deathSaves: false,
  pending: null,
  relentless: null,
  saveTurnKey: null,
  log: [],
  ...overrides,
});

const pendingDeath = (): DeathState =>
  deathState({
    deathSaves: true,
    failures: 3,
    pending: { id: 'fixture-pendencia' } as DeathState['pending'],
  });

const characterFixture = (state: DeathState | null, hpCurrent = 0): never =>
  ({
    id: 'fixture-character',
    name: 'Ficha de Fixture',
    version: 7,
    hpCurrent,
    hpMax: 24,
    deathState: state,
  }) as never;

const mechanicalStateFixture = {
  conditions: [],
  log: [],
  concentration: null,
  pendingConcentrationSaves: [],
  exhaustionLevel: 0,
  seesInvisible: false,
} as never;

function dockProps(label: string | null, blocked = label !== null): Record<string, unknown> {
  return {
    name: 'Dock de Fixture',
    imageUrl: null,
    hpCurrent: 0,
    hpMax: 24,
    armorClass: 14,
    mechanicalState: mechanicalStateFixture,
    conditionEffects: { prone: true, canAct: false } as never,
    economy: {
      actionsGranted: 1,
      actionsUsed: 0,
      bonusActionUsed: false,
      reactionAvailable: true,
      movementBudget: 9,
      movementUsed: 0,
    } as never,
    deathBlocked: blocked,
    deathLabel: label,
    deathSavePending: label === 'Teste contra a Morte',
    actionMenu: h('span', { className: 'fixture-action-menu' }),
    hotbar: h(
      'span',
      { className: 'fixture-hotbar-slots' },
      Array.from({ length: 48 }, (_, index) => h('span', { key: index }, String(index + 1))),
    ),
    utilities: h('button', { type: 'button', className: 'fixture-end-turn' }, 'Encerrar turno'),
    movement: { remaining: 0, budget: 9 },
    movementControl: null,
  };
}

/** Cena do grid: a ÚNICA diferença entre os dois estados é o modo. */
function gridCombat(mode: 'assisted' | 'grid-2d'): never {
  return {
    id: 'fixture-combat',
    version: 1,
    status: 'ACTIVE',
    currentCombatantId: 'fixture-unit',
    sceneBackgroundImageUrl: null,
    spatial: {
      mode,
      widthFeet: mode === 'grid-2d' ? 60 : 0,
      heightFeet: mode === 'grid-2d' ? 60 : 0,
      cellSizeFeet: 5,
      walls: [],
    },
    combatants: [],
  } as never;
}

const gridProps = (mode: 'assisted' | 'grid-2d') => ({
  combat: gridCombat(mode),
  isMaster: false,
  onCombatChange: () => undefined,
  onError: () => undefined,
});

/* -------------------------------------------------------------------------- */
/* 1. GRID: grid-2d → cena assistida → grid-2d                                 */
/* -------------------------------------------------------------------------- */

{
  const view = await mount(h(CombatGrid, gridProps('assisted')));
  const assistedHasEmpty = Boolean(view.container.querySelector('.grid-empty'));
  const modes: string[] = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await view.rerender(h(CombatGrid, gridProps('grid-2d')));
    modes.push(view.container.querySelector('.grid-viewport') ? 'grid' : 'sem-grid');
    await view.rerender(h(CombatGrid, gridProps('assisted')));
    modes.push(view.container.querySelector('.grid-empty') ? 'assistida' : 'sem-cena');
  }
  check(
    'SC200) grid-2d ↔ cena assistida mantém a ordem dos hooks (sem React #300/#310)',
    view.error === null && assistedHasEmpty && modes.every((mode, index) => index % 2 === 0 ? mode === 'grid' : mode === 'assistida'),
    view.error ?? modes.join(' → '),
  );
  // RELOAD equivalente: desmontar e montar de novo já em grid.
  await view.unmount();
  const reloaded = await mount(h(CombatGrid, gridProps('grid-2d')));
  check(
    'SC201) reload/reconexão do grid: monta direto em grid-2d sem erro de hooks',
    reloaded.error === null && Boolean(reloaded.container.querySelector('.grid-viewport')),
    reloaded.error ?? '',
  );
  await reloaded.unmount();
}

/* -------------------------------------------------------------------------- */
/* 2. DOCK: ciclo de morte inteiro sem desmontar nem violar hooks             */
/* -------------------------------------------------------------------------- */

{
  const view = await mount(h(PlayerCombatDock, dockProps(null) as never));
  const labelFor = (state: DeathState | null): string | null => deathDockLabel(state);
  const states: (DeathState | null)[] = [
    null,
    deathState({ deathSaves: true }),
    deathState({ deathSaves: true, successes: 1 }),
    deathState({ deathSaves: true, failures: 2 }),
    pendingDeath(),
    deathState({ deathSaves: true, successes: 3, stabilized: true }),
    deathState({ dead: true }),
    deathState({
      deathSaves: true,
      relentless: { name: 'Resistência Implacável', resourceId: 'fixture' } as never,
    }),
    deathState({ deathSaves: true, failures: 1 }),
    null,
  ];
  const seen: string[] = [];
  let sameSurface = Boolean(view.container.querySelector('.dock-hotbar'));
  let legacyAbsent = !view.container.querySelector('.turn-resource-bar');
  for (const state of states) {
    const label = labelFor(state);
    await view.rerender(h(PlayerCombatDock, dockProps(label) as never));
    const overlay = view.container.querySelector('.dock-death-overlay');
    const slotCount = view.container.querySelectorAll('.fixture-hotbar-slots > span').length;
    sameSurface = sameSurface && Boolean(view.container.querySelector('.dock-hotbar')) && slotCount === 48;
    legacyAbsent = legacyAbsent && !view.container.querySelector('.turn-resource-bar');
    seen.push(`${label ?? 'operacional'}=${text(overlay) || '—'}`);
  }
  check(
    'SC202) dock do jogador sobrevive a todo o ciclo de morte sem barra legada',
    view.error === null && sameSurface && legacyAbsent,
    view.error ?? seen.join(' · '),
  );
  check(
    'SC203) rótulo da dock acompanha o estado autoritativo (sem segundo comando de rolagem)',
    seen[0] === 'operacional=—' &&
      seen[1].startsWith('Teste contra a Morte=') &&
      seen[4].startsWith('Aguardando decisão do Mestre=') &&
      seen[5].startsWith('Estabilizado=') &&
      seen[6].startsWith('Morto=') &&
      seen[7].startsWith('Resistência Implacável='),
    seen.join(' · '),
  );
  // RELOAD: monta novamente já em estado de morte.
  await view.unmount();
  const reloaded = await mount(
    h(PlayerCombatDock, dockProps(deathDockLabel(pendingDeath())) as never),
  );
  check(
    'SC204) reload/reconexão da dock em "decisão do Mestre" mantém Hotbar visível e inerte',
    reloaded.error === null &&
      Boolean(reloaded.container.querySelector('.dock-hotbar.is-death-blocked')) &&
      Boolean(reloaded.container.querySelector('.dock-death-overlay')) &&
      reloaded.container.querySelector('.dock-hotbar-track')?.hasAttribute('inert') === true,
    reloaded.error ?? '',
  );
  await reloaded.unmount();
}

/* -------------------------------------------------------------------------- */
/* 3. TESTE CONTRA A MORTE: 0 PV → sucesso/falha → 3ª falha → decisão         */
/* -------------------------------------------------------------------------- */

{
  const view = await mount(
    h(DeathSavePanel, { name: 'Ficha de Fixture', death: deathState({ deathSaves: true }) }),
  );
  const counters: string[] = [];
  // Sequência REAL do servidor: 0 PV → 1/2 sucessos → 1/2/3 falhas (a 3ª vira
  // decisão do Mestre) → estabilizado → morto → volta a 0 PV.
  const flow: DeathState[] = [
    deathState({ deathSaves: true }),
    deathState({ deathSaves: true, successes: 1 }),
    deathState({ deathSaves: true, successes: 2 }),
    deathState({ deathSaves: true, failures: 1 }),
    deathState({ deathSaves: true, failures: 2 }),
    deathState({ deathSaves: true, failures: 3 }),
    pendingDeath(),
    deathState({ deathSaves: true, successes: 3, stabilized: true }),
    deathState({ dead: true }),
    deathState({ deathSaves: true }),
  ];
  for (const state of flow) {
    await view.rerender(h(DeathSavePanel, { name: 'Ficha de Fixture', death: state }));
    const filled = view.container.querySelectorAll('.death-pip.filled').length;
    const pending = Boolean(view.container.querySelector('.death-turn-note.pending'));
    counters.push(`${state.successes}/${state.failures}${pending ? ' pendente' : ''} (${filled} pips)`);
  }
  check(
    'SC205) Teste contra a Morte: sucesso, falha, 3ª falha pendente, estabilizado e morto',
    view.error === null &&
      counters[0] === '0/0 (0 pips)' &&
      counters[1] === '1/0 (1 pips)' &&
      counters[2] === '2/0 (2 pips)' &&
      counters[3] === '0/1 (1 pips)' &&
      counters[4] === '0/2 (2 pips)' &&
      counters[5] === '0/3 (3 pips)' &&
      counters[6] === '0/3 pendente (3 pips)' &&
      counters[7] === '3/0 (3 pips)' &&
      counters[8] === '0/0 (0 pips)' &&
      Boolean(view.container),
    view.error ?? counters.join(' · '),
  );
  await view.unmount();

  const counter = await mount(h(DeathCounter, { successes: 0, failures: 0, showNumbers: true }));
  await counter.rerender(h(DeathCounter, { successes: 1, failures: 0, showNumbers: true }));
  await counter.rerender(h(DeathCounter, { successes: 1, failures: 1, showNumbers: true }));
  await counter.rerender(h(DeathCounter, { successes: 3, failures: 3, showNumbers: true }));
  check(
    'SC206) contador de sucessos/falhas atualiza por estado do servidor (sem rolagem local)',
    counter.error === null &&
      text(counter.container).includes('♥ 3/3') &&
      text(counter.container).includes('☠ 3/3') &&
      counter.container.querySelectorAll('.death-pip.filled').length === 6,
    counter.error ?? text(counter.container),
  );
  await counter.unmount();
}

/* -------------------------------------------------------------------------- */
/* 4. FICHA: painel de morte, Resistência Implacável e decisão do Mestre      */
/* -------------------------------------------------------------------------- */

{
  const view = await mount(
    h(DeathPanel, {
      character: characterFixture(deathState({ deathSaves: true })),
      onRollDeathSave: () => undefined,
    }),
  );
  const stages: string[] = [];
  const render = async (state: DeathState | null, hp = 0, master = false): Promise<void> => {
    const panel = h(DeathPanel, {
      character: characterFixture(state, hp),
      onRollDeathSave: () => undefined,
    });
    await view.rerender(
      master
        ? h(SheetAccessProvider, {
            value: { readOnly: false, creationLocked: false, masterView: true },
            children: panel,
          })
        : panel,
    );
    stages.push(text(view.container.querySelector('.death-panel')).slice(0, 90));
  };
  await render(deathState({ deathSaves: true, successes: 2, failures: 1 }));
  const savingText = text(view.container);
  await render(pendingDeath());
  const pendingText = text(view.container);
  await render(deathState({ deathSaves: true, successes: 3, stabilized: true }));
  const stabilizedText = text(view.container);
  await render(deathState({ dead: true }));
  const deadText = text(view.container);
  await render(
    deathState({
      deathSaves: true,
      relentless: { name: 'Resistência Implacável', resourceId: 'fixture' } as never,
    }),
  );
  const relentlessText = text(view.container);
  await render(deathState({ deathSaves: true }), 0, true);
  const masterText = text(view.container);
  await render(null, 12);
  const aliveEmpty = view.container.children.length === 0;
  check(
    'SC207) ficha acompanha o estado do servidor em todo o ciclo de morte',
    view.error === null &&
      savingText.includes('Rolar Teste contra a Morte') &&
      pendingText.includes('Aguardando resolução do Mestre') &&
      stabilizedText.includes('Estabilizado') &&
      deadText.includes('Morto') &&
      relentlessText.includes('Usar Resistência Implacável?') &&
      masterText.includes('Estabilizar') &&
      masterText.includes('Reviver (1 PV)') &&
      aliveEmpty,
    view.error ?? stages.join(' | '),
  );
  // RELOAD/reconexão: remonta com a decisão pendente — o Mestre não perde o card.
  await view.unmount();
  const reloaded = await mount(
    h(SheetAccessProvider, {
      value: { readOnly: false, creationLocked: false, masterView: true },
      children: h(DeathPanel, {
        character: characterFixture(pendingDeath()),
        onRollDeathSave: () => undefined,
      }),
    }),
  );
  check(
    'SC208) reload/reconexão da ficha mantém a decisão do Mestre visível',
    reloaded.error === null && text(reloaded.container).includes('Aguardando resolução do Mestre'),
    reloaded.error ?? '',
  );
  await reloaded.unmount();
}

/* -------------------------------------------------------------------------- */
/* 5. NENHUMA VIOLAÇÃO DE HOOKS EM NENHUMA ETAPA                              */
/* -------------------------------------------------------------------------- */

check(
  'SC209) nenhum React #300/#310 (violação de Hooks) em nenhuma transição renderizada',
  hookErrors.length === 0,
  hookErrors.join(' | '),
);

check(
  'SC210) nenhuma chamada de rede real: todo HTTP das fixtures é interceptado',
  globals.fetch === fetchStub &&
    fetchCalls.length > 0 &&
    fetchCalls.every((call) => call.startsWith('/api/')),
  fetchCalls.join(', '),
);

/* -------------------------------------------------------------------------- */
/* RELATÓRIO                                                                  */
/* -------------------------------------------------------------------------- */

console.error = originalError;
const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? '✔' : '✘'} ${item.name}${item.detail && !item.ok ? `\n    ${item.detail}` : ''}`);
}
if (failed.length > 0) {
  console.log(`FALHOU — ${failed.length} item(ns).`);
  process.exit(1);
}
console.log('OK — todos os itens passaram.');
process.exit(0);
