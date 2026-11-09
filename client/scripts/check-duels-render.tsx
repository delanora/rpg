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
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CombatDuelsPanel } =
  await import('../src/combat/components/CombatDuelsPanel');
const alice = { id: 'alice', role: 'PLAYER' },
  bob = { id: 'bob', role: 'PLAYER' },
  other = { id: 'other', role: 'PLAYER' },
  master = { id: 'master', role: 'MASTER' };
let viewer = alice;
let rows: any[] = [];
let state: any = {
  id: 'combat',
  version: 3,
  status: 'ACTIVE',
  duels: [],
  combatants: [
    { id: 'a', name: 'Alice', ownerUserId: 'alice', kind: 'CHARACTER' },
    { id: 'b', name: 'Beto', ownerUserId: 'bob', kind: 'CHARACTER' },
    { id: 'c', name: 'Clara', ownerUserId: 'other', kind: 'CHARACTER' },
    { id: 'npc', name: 'NPC', kind: 'NPC' },
  ],
};
let delayed = false;
let release: ((response: Response) => void) | undefined;
let applied = 0;
const commands: any[] = [],
  errors: string[] = [];
globals.fetch = async (path: string, options?: RequestInit) => {
  let result: unknown;
  if (path === '/api/combat/combat/duels') {
    const own = state.combatants.find(
      (u: any) => u.ownerUserId === viewer.id,
    )?.id;
    result = {
      duels: rows.filter(
        (row) =>
          viewer.role === 'MASTER' ||
          row.requesterId === own ||
          row.challengedId === own,
      ),
    };
  } else if (path === '/api/combat/active') result = { combat: state };
  else {
    assert.ok(
      ['/api/combat/duels/request', '/api/combat/duels/decision'].includes(
        path,
      ),
      path,
    );
    const body = JSON.parse(options?.body as string);
    commands.push(body);
    if (path.endsWith('/request'))
      rows.push({
        id: 'duel',
        requesterId: body.requesterId,
        challengedId: body.challengedId,
        status: 'pending',
      });
    else if (body.decision === 'accept')
      rows = rows.map((row) => ({ ...row, status: 'active' }));
    else rows = [];
    state = {
      ...state,
      version: state.version + 1,
      duels: rows.filter((row) => row.status === 'active'),
    };
    result = { combat: state };
  }
  if (delayed && path.endsWith('/request')) return new Promise<Response>(resolve => { release = resolve; });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const root = createRoot(document.getElementById('root')!);
const onError = (message: string) => errors.push(message);
function Harness({ session }: { session: any }) {
  const [combat, setCombat] = useState(state);
  return h(CombatDuelsPanel, {
    combat,
    user: session,
    onCombatChange: next => { applied++; setCombat(next); },
    onError,
  });
}
const render = async (user: any) => {
  viewer = user;
  await act(async () => {
    root.render(
      h(Harness, { session: user, key: user.id + ':' + state.status }),
    );
  });
};
async function click(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  assert.ok(button, label);
  await act(async () => button.click());
}
let checks = 0;
const check = (label: string, condition: unknown) => {
  assert.ok(condition, label);
  console.log('✔ ' + label);
  checks++;
};
try {
  await render(alice);
  await click('Duelos');
  const options = [...document.querySelectorAll('select option')].map(
    (o) => o.textContent,
  );
  check(
    'solicitação oferece outros jogadores, sem si próprio ou NPC',
    options.includes('Beto') &&
      options.includes('Clara') &&
      !options.includes('Alice') &&
      !options.includes('NPC'),
  );
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>('select')!;
    select.value = 'b';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await click('Solicitar duelo');
  check(
    'pedido leva identidades, versão e operationId',
    commands[0].requesterId === 'a' &&
      commands[0].challengedId === 'b' &&
      commands[0].expectedVersion === 3 &&
      commands[0].operationId,
  );
  check(
    'solicitante aguarda e não pode aceitar seu próprio convite',
    document.body.textContent?.includes('Aguardando o jogador desafiado') &&
      !document.body.textContent.includes('Aceitar duelo'),
  );
  check(
    'o convite pode ser cancelado por quem o enviou',
    document.body.textContent?.includes('Cancelar convite'),
  );
  await render(other);
  check(
    'terceiro jogador não recebe a pergunta',
    !document.querySelector('[role="dialog"]') &&
      !document.body.textContent?.includes('Aguardando'),
  );
  await render(bob);
  check(
    'destinatário recebe pergunta automaticamente',
    !!document.querySelector('[role="dialog"]') &&
      document.body.textContent?.includes('Você recebeu um convite'),
  );
  check(
    'aceite informa alcance do consentimento e dano normal',
    document.body.textContent?.includes('causam dano normalmente') &&
      document.body.textContent.includes('só entre os dois'),
  );
  await click('Aceitar duelo');
  check(
    'aceitar encaminha o id e libera encerrar',
    commands[1].duelId === 'duel' &&
      commands[1].decision === 'accept' &&
      document.body.textContent?.includes('Encerrar duelo'),
  );
  await render(master);
  await click('Duelos (1)');
  check(
    'Mestre acompanha e encerra, sem solicitar nem aceitar pelos jogadores',
    document.body.textContent?.includes('Encerrar duelo') &&
      !document.querySelector('form') &&
      !document.body.textContent.includes('Aceitar duelo'),
  );
  await click('Encerrar duelo');
  check(
    'encerramento envia operação própria',
    commands[2].decision === 'end' &&
      commands[2].operationId !== commands[1].operationId,
  );
  rows = [
    { id: 'new', requesterId: 'a', challengedId: 'b', status: 'pending' },
  ];
  state = { ...state, version: state.version + 1 };
  await render(alice);
  await render(master);
  await click('Duelos (1)');
  check(
    'Mestre só pode cancelar o convite pendente',
    document.body.textContent?.includes('Cancelar convite') &&
      !document.body.textContent?.includes('Aceitar duelo'),
  );
  state = { ...state, status: 'ENDED' };
  await render(bob);
  check(
    'fim do combate remove a ferramenta de duelo',
    !document.querySelector('.combat-duels-launcher') &&
      !document.querySelector('[role="dialog"]'),
  );
  rows = []; state = { ...state, status: 'ACTIVE', version: state.version + 1 };
  await render(alice); await click('Duelos');
  await act(async () => { const select = document.querySelector<HTMLSelectElement>('select')!; select.value = 'b'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  delayed = true;
  const beforeLate = applied;
  await click('Solicitar duelo');
  await act(async () => root.render(null));
  await act(async () => { release!(new Response(JSON.stringify({ combat: state }), { status: 200, headers: { 'Content-Type': 'application/json' } })); });
  check('resposta tardia não reabre combate já desmontado', applied === beforeLate);
  check('fluxo não produziu erros nem requisições externas', !errors.length);
  console.log(`${checks} verificações de duelos aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
