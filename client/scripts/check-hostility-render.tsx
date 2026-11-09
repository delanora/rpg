/** Wizard e menus em React/jsdom; nenhuma requisição sai da fixture. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}",
    ),
  import.meta.url,
);
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'SVGElement',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
])
  globals[name] =
    name === 'window'
      ? dom.window
      : name === 'document'
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
globals.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globals.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { HostilityDecisionPanel } =
  await import('../src/combat/components/HostilityDecisionPanel');
const bodies: any[] = [];
let current: any = {
  id: 'fixture-combat',
  version: 12,
  status: 'ACTIVE',
  hostilityPrompts: [
    {
      id: 'question',
      npcId: 'npc',
      attackerId: 'a',
      targetId: 'npc',
      attackName: 'Espada',
    },
  ],
  combatants: [
    { id: 'npc', name: 'NPC neutro', kind: 'NPC' },
    { id: 'a', name: 'Alice', kind: 'CHARACTER' },
    { id: 'b', name: 'Beto', kind: 'CHARACTER' },
    { id: 'other', name: 'Outro NPC', kind: 'NPC' },
  ],
};
globals.fetch = async (path: string, options: RequestInit) => {
  assert.equal(
    path,
    '/api/combat/hostility/decision',
    'Sem requisições externas',
  );
  bodies.push(JSON.parse(options.body as string));
  return new Response(JSON.stringify({ combat: current }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const root = createRoot(document.getElementById('root')!);
let checks = 0,
  pending: Promise<unknown> | undefined;
function check(label: string, condition: unknown) {
  assert.ok(condition, label);
  console.log('✔ ' + label);
  checks++;
}
const render = async () =>
  act(async () =>
    root.render(
      h(HostilityDecisionPanel, {
        combat: current,
        busy: false,
        onRun: (action) => {
          pending = action();
        },
      }),
    ),
  );
async function click(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === text);
  assert.ok(button, text);
  await act(async () => {
    button.click();
    await pending;
    pending = undefined;
  });
}
const checkedIds = () =>
  [...document.querySelectorAll<HTMLInputElement>('input:checked')].map(
    (input) => input.parentElement?.textContent,
  );
try {
  await render();
  check(
    'ataque apresenta pergunta privada com os dois nomes',
    document.body.textContent?.includes('Alice atacou NPC neutro com Espada'),
  );
  check(
    'seleção inicial contém apenas o oponente',
    JSON.stringify(checkedIds()) === JSON.stringify(['Alice']),
  );
  check(
    'NPC da decisão não pode selecionar a si próprio',
    document.querySelectorAll('input').length === 3,
  );
  await click('Depois');
  check(
    'adiar deixa lembrete sem escrever',
    bodies.length === 0 &&
      !document.querySelector('[role="dialog"]') &&
      document.body.textContent?.includes('Decisões de hostilidade (1)'),
  );
  await click('Decisões de hostilidade (1)');
  await click('Grupo de jogadores');
  check(
    'atalho de grupo seleciona somente personagens',
    JSON.stringify(checkedIds()) === JSON.stringify(['Alice', 'Beto']),
  );
  await click('Só os envolvidos');
  check(
    'atalho individual restaura o oponente original',
    JSON.stringify(checkedIds()) === JSON.stringify(['Alice']),
  );
  await act(async () =>
    document.querySelector<HTMLInputElement>('input')!.click(),
  );
  check(
    'seleção vazia impede confirmar hostilidade',
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.startsWith('Tornar hostil'),
    )?.disabled,
  );
  await act(async () =>
    document.querySelectorAll<HTMLInputElement>('input')[1].click(),
  );
  await click('Tornar hostil (1)');
  check(
    'envia somente os participantes escolhidos com versão e idempotência',
    bodies[0].hostile === true &&
      bodies[0].selectedIds.length === 1 &&
      bodies[0].selectedIds[0] === 'b' &&
      bodies[0].expectedVersion === 12 &&
      bodies[0].operationId,
  );
  await click('Manter relação');
  check(
    'manter relação não envia seleção residual',
    bodies[1].hostile === false && bodies[1].selectedIds.length === 0,
  );
  current = { ...current, hostilityPrompts: [] };
  await render();
  check(
    'fila vazia remove pergunta e lembrete',
    !document.querySelector('[role="dialog"]') &&
      !document.querySelector('.hostility-resume'),
  );
  current = {
    ...current,
    hostilityPrompts: [
      {
        id: 'reverse',
        npcId: 'npc',
        attackerId: 'npc',
        targetId: 'a',
        attackName: 'Garra',
      },
    ],
  };
  await render();
  check(
    'NPC atacante oferece o jogador como oponente',
    checkedIds()[0] === 'Alice' &&
      document.body.textContent?.includes('NPC neutro atacou Alice'),
  );
  console.log(`${checks} verificações de hostilidade aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
