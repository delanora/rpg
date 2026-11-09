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
const { CreatureAbilitiesEditor } =
  await import('../src/components/master/CreatureAbilitiesEditor');
const { ReactionPanel } =
  await import('../src/combat/components/ReactionPanel');
const { resolveOpportunitySpell } =
  await import('../src/reactionOpportunitiesApi');
const root = createRoot(document.getElementById('root')!);
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  assert.ok(button, text);
  await act(async () => button.click());
};
const change = async (label: string, value: string) => {
  const input = document.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLInputElement;
  assert.ok(input, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'SELECT'
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(
      new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
};
let saved: any[] = [];
await act(async () =>
  root.render(
    h(CreatureAbilitiesEditor, {
      abilities: [],
      onChange: (value) => {
        saved = value;
      },
      onEditingChange: () => {},
    }),
  ),
);
await click('Adicionar habilidade');
await change('Nome da habilidade', 'Talento do conjurador');
await change('Custo da habilidade', 'passive');
await change('Execução da habilidade', 'war-caster');
await click('Salvar habilidade');
assert.equal(saved[0]?.execution, 'war-caster');
assert.equal(saved[0].cost, 'passive');
assert.equal(saved[0].maxUses, null);
console.log(
  '✔ Bestiário cadastra a identidade mecânica passiva, sem usos ou custo de ação',
);
let chosen = '';
const opportunity = {
  id: 'janela',
  reactorUserId: 'dono',
  reactorCombatantId: 'reator',
  sourceCombatantId: 'alvo',
  targetCombatantId: 'reator',
  trigger: 'O alvo está saindo do alcance.',
  availableReactions: [
    {
      id: 'ataque',
      label: 'Ataque de oportunidade',
      description: 'Corpo a corpo',
    },
    {
      id: 'magia',
      label: 'Chama Sagrada · truque — Clérigo',
      description:
        'Conjurador de Guerra · usa Reação e atinge somente quem provocou a oportunidade.',
    },
  ],
  expiresAt: null,
};
await act(async () =>
  root.render(
    h(ReactionPanel, {
      opportunity,
      onChoose: (id) => {
        chosen = id;
      },
      onDecline: () => {
        chosen = 'decline';
      },
    }),
  ),
);
assert.equal(document.querySelectorAll('.reaction-option').length, 2);
await act(async () =>
  (
    document.querySelectorAll('.reaction-option')[1] as HTMLButtonElement
  ).click(),
);
assert.equal(chosen, 'magia');
await act(async () =>
  (
    document.querySelectorAll('.reaction-option')[0] as HTMLButtonElement
  ).click(),
);
assert.equal(chosen, 'ataque');
await click('Não reagir');
assert.equal(chosen, 'decline');
console.log('✔ Janela preserva ataque comum, oferece magia e permite recusar');
await act(async () =>
  root.render(
    h(ReactionPanel, {
      opportunity,
      busy: true,
      onChoose: () => {
        throw Error('Clique concorrente');
      },
      onDecline: () => {
        throw Error('Recusa concorrente');
      },
    }),
  ),
);
assert.ok(
  [...document.querySelectorAll('.reaction-panel button')].every(
    (b) => (b as HTMLButtonElement).disabled,
  ),
);
console.log('✔ Requisição em voo bloqueia escolhas simultâneas');
let request: any;
globalThis.fetch = async (path, init) => {
  request = { path: String(path), body: JSON.parse(init!.body as string) };
  return new Response(JSON.stringify({ combat: { id: 'combate' } }), {
    status: 200,
  });
};
await resolveOpportunitySpell(
  'combate',
  'janela',
  {
    spellId: 'sacred-flame',
    spellcastingSource: { kind: 'class', id: 'cleric' },
  },
  7,
);
assert.equal(
  request.path,
  '/api/combat/combate/reaction-opportunities/janela/spell',
);
assert.equal(request.body.expectedVersion, 7);
assert.ok(request.body.operationId);
assert.ok(!('targets' in request.body) && !('caster' in request.body));
console.log(
  '✔ API envia só escolha e versão; alvo, conjurador e dados pertencem ao servidor',
);
await act(async () => root.unmount());
