/** Temporização da apresentação com hook real e HTTP inteiramente em memória. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
});
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
globals.localStorage = dom.window.localStorage;
globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useDiceRoller } = await import('../src/dice/useDiceRoller');
const { rollAnimationMs } = await import('../src/dice/rollAnimation');
import type { SessionUser, TableRollRequest } from '../src/types';
let nextTimer = 0;
const timers = new Map<number, { callback: () => void; delay: number }>();
window.setTimeout = ((callback: () => void, delay: number) => {
  const id = ++nextTimer;
  timers.set(id, { callback, delay });
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id: number) => {
  timers.delete(id);
}) as typeof window.clearTimeout;
let posted: TableRollRequest | null = null;
const result = {
  id: 'roll',
  actorUserId: 'owner',
  actorName: 'Herói',
  kind: 'death-save',
  label: 'Teste contra a Morte',
  dice: [{ sides: 20, value: 14 }],
  bonus: 0,
  total: 14,
  crit: false,
  isPrivate: false,
  at: new Date().toISOString(),
};
globals.fetch = async (path: string, input?: { body?: string }) => {
  const body = input?.body ? JSON.parse(input.body) : null;
  if (path.endsWith('/dice/roll')) posted = body;
  const payload = path.endsWith('/dice/roll')
    ? { roll: { ...result, kind: body.kind, clientId: body.clientId } }
    : path.includes('/options/')
      ? { options: [] }
      : { activeRoll: null };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
let roller!: ReturnType<typeof useDiceRoller>;
function Probe() {
  roller = useDiceRoller({
    id: 'owner',
    role: 'PLAYER',
    username: 'owner',
    displayName: 'Herói',
  } as SessionUser);
  return null;
}
const root = createRoot(document.getElementById('root')!);
try {
  await act(async () => root.render(h(Probe)));
  assert.equal(rollAnimationMs('death-save'), 2100);
  assert.equal(rollAnimationMs('save'), 1150);
  await act(async () =>
    roller.openSkillRoll({
      kind: 'death-save',
      label: 'Teste contra a Morte',
      bonus: 0,
      entity: { kind: 'character', id: 'hero' },
    }),
  );
  await act(async () => roller.submit());
  assert.equal(roller.phase, 'tumbling');
  assert.equal(roller.result?.total, 14);
  assert.ok(
    posted &&
      !Object.hasOwn(posted, 'value') &&
      !Object.hasOwn(posted, 'total'),
  );
  const local = [...timers.values()].find((timer) => timer.delay === 2100);
  assert.ok(local);
  await act(async () => local.callback());
  assert.equal(roller.phase, 'settled');
  assert.ok(
    [...timers.values()].some((timer) => timer.delay === 3000),
    'Fechamento automático só depois do pouso',
  );
  await act(async () =>
    roller.openSkillRoll({ kind: 'save', label: 'Salvaguarda', bonus: 0 }),
  );
  timers.clear();
  await act(async () => roller.submit());
  assert.ok(
    [...timers.values()].some((timer) => timer.delay === 1150),
    'Salvaguarda comum mantém sua duração',
  );
  timers.clear();
  await act(async () =>
    roller.handlers.onDiceActive?.({
      active: true,
      userId: 'other',
      actorName: 'Outro',
      avatarUrl: '',
      kind: 'death-save',
      label: 'Morte',
      at: new Date().toISOString(),
      board: {
        phase: 'tumbling',
        pool: [{ sides: 20, locked: true }],
        bonus: 0,
        advantage: false,
        disadvantage: false,
      },
      lastRoll: null,
    }),
  );
  await act(async () =>
    roller.handlers.onDiceRoll?.({
      roll: { ...result, actorUserId: 'other' },
    } as never),
  );
  assert.ok(
    [...timers.values()].some((timer) => timer.delay === 2100),
    'Quem assiste aguarda a animação de morte',
  );
  console.log(
    '✔ Morte e espectador aguardam 2,1 s; dados comuns mantêm 1,15 s; resultado vem do HTTP; fechamento segue após o pouso.',
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
