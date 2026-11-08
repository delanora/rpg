/** Wizard e menus em React/jsdom; nenhuma requisição sai da fixture. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const { CombatStartDialog } = await import('../src/combat/CombatStartDialog');
const { PreparedEncountersTab } = await import('../src/combat/PreparedEncountersTab');
const { CombatTokenAdjustments } = await import(
  '../src/combat/components/CombatTokenAdjustments'
);
const { CombatReinforcements } = await import(
  '../src/combat/components/CombatReinforcements'
);
const { AuthProvider } = await import('../src/auth');
import type {
  CombatDto,
  Character,
  Creature,
  Locality,
  Region,
  Scene,
} from '../src/types';
import type { CombatPreparation } from '../src/combat/combatApi';
const players = [
  { id: 'p1', name: 'Aria', avatarUrl: '' },
  { id: 'p2', name: 'Borin', avatarUrl: '' },
] as Character[];
const creatures = [
  {
    id: 'c1',
    name: 'Dragão',
    kind: 'CREATURE',
    size: 'Huge',
    imageUrl: '',
    challengeRating: '10',
    localities: [],
  },
  {
    id: 'n1',
    name: 'Guarda',
    kind: 'NPC',
    size: 'Medium',
    imageUrl: '',
    localities: [],
  },
] as unknown as Creature[];
const scene = {
  id: 's1',
  name: 'Salão',
  localityId: 'l1',
  spatialConfig: {
    mode: 'grid-2d',
    widthFeet: 60,
    heightFeet: 60,
    cellSizeFeet: 5,
  },
  backgroundImageUrl: null,
  obstacles: [],
  version: 0,
  createdAt: 'fixture',
  updatedAt: 'fixture',
} as Scene;
const preparation: CombatPreparation = {
  localityId: 'l1',
  sceneId: 's1',
  characterIds: ['p1'],
  entries: [{ creatureId: 'c1', quantity: 1 }],
};
let posted: CombatPreparation | undefined;
const requests: { path: string; body: any }[] = [];
let cancelled = 0;
globalThis.fetch = async (input, init) => {
  const path = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ path, body });
  let value: unknown;
  if (path === '/api/encounters' && !body)
    value = {
      encounters: [{ id: 'e1', name: 'Emboscada', version: 0, preparation }],
    };
  else if (path === '/api/localities/l1/scenes') value = { scenes: [scene] };
  else if (path === '/api/scenes/s1') value = { scene };
  else if (path.startsWith('/api/encounters/') && body)
    value = {
      encounter: {
        id: 'e1',
        name: body.name,
        version: 1,
        preparation: body.preparation,
      },
    };
  else if (path === '/api/creatures') value = { creatures };
  else if (path === '/api/combat/participants/add')
    value = { combat: { id: 'combat', version: 2 } };
  else if (path === '/api/auth/me')
    value = {
      user: {
        id: 'master',
        username: 'master',
        displayName: 'Mestre',
        role: 'MASTER',
      },
    };
  else
    return new Response(
      JSON.stringify({
        message: 'Leitura auxiliar não incluída nesta fixture',
      }),
      { status: 404 },
    );
  return new Response(JSON.stringify(value), { status: 200 });
};
const props = {
  characters: players,
  creatures,
  localities: [{ id: 'l1', regionId: 'r1', name: 'Fortaleza' }] as Locality[],
  regions: [{ id: 'r1', name: 'Norte', localityCount: 1 }] as Region[],
  onCancel: () => {
    cancelled++;
  },
  onStart: async (p: CombatPreparation) => {
    posted = p;
  },
};
localStorage.setItem('grimorio.token', 'fixture');
const root = createRoot(document.getElementById('root')!);
let checks = 0;
const check = (label: string, condition: unknown) => {
  assert.ok(condition, label);
  checks++;
  console.log('✔ ' + label);
};
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === text ||
      b.querySelector('strong')?.textContent === text,
  );
  assert.ok(button, text);
  await act(async () => button.click());
}
async function change(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  assert.ok(input, selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
try {
  await act(async () => root.render(h(CombatStartDialog, props)));
  check(
    'primeira etapa oferece encontros salvos',
    document.body.textContent?.includes('Emboscada'),
  );
  await click('Emboscada');
  check(
    'encontro pronto vai direto à revisão',
    document
      .querySelector('[aria-current="step"]')
      ?.textContent?.includes('Revisão'),
  );
  await click('Iniciar combate');
  check(
    'início conserva seleção e composição salvas',
    posted?.characterIds?.join() === 'p1' && posted.sceneId === 's1',
  );
  await act(async () =>
    root.render(h(CombatStartDialog, { ...props, key: 'novo' })),
  );
  const create = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Criar agora'),
  )!;
  await act(async () => create.click());
  await click('Fortaleza');
  await click('Continuar');
  check(
    'seleção de jogadores aparece em cards',
    document.body.textContent?.includes('Aria') &&
      document.body.textContent?.includes('Borin'),
  );
  const borin = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Borin'),
  )!;
  await act(async () => borin.click());
  await change('input[aria-label="Quantidade de Dragão"]', '1');
  await click('Continuar');
  const sceneButton = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Salão',
  )!;
  await act(async () => sceneButton.click());
  check(
    'escolha de cena abre mapa e bandeja',
    !!document.querySelector('.preparation-map') &&
      document
        .querySelector('.preparation-token-tray')
        ?.textContent?.includes('Dragão'),
  );
  await click('Continuar');
  await click('Voltar');
  check(
    'voltar preserva cena e seleção',
    !!document.querySelector('.preparation-map') &&
      !document
        .querySelector('.preparation-token-tray')
        ?.textContent?.includes('Borin'),
  );
  await click('Continuar');
  await click('Salvar encontro');
  const saved = requests
    .filter((r) => r.path.startsWith('/api/encounters/') && r.body)
    .at(-1)!;
  check(
    'salvar persiste jogadores escolhidos e quantidade',
    saved.body.preparation.characterIds.join() === 'p1' &&
      saved.body.preparation.entries[0].quantity === 1,
  );
  check(
    'salvar não inicia combate',
    requests.every((r) => r.path !== '/api/combat'),
  );
  await click('Iniciar combate');
  check(
    'criação improvisada usa a seleção explícita',
    posted?.characterIds?.join() === 'p1' &&
      posted.entries[0].creatureId === 'c1',
  );
  await act(async () =>
    root.render(
      h(CombatStartDialog, { ...props, key: 'salvar', saveOnly: true }),
    ),
  );
  await click('Continuar');
  await click('Continuar');
  await click('Continuar');
  await click('Salvar e concluir');
  check(
    'concluir preparação salva antes de fechar',
    cancelled === 1 &&
      requests.filter((r) => r.path.startsWith('/api/encounters/') && r.body)
        .length === 2,
  );
  let updated = false;
  const combat = {
    id: 'combat',
    version: 1,
    status: 'ACTIVE',
    combatants: [],
  } as unknown as CombatDto;
  await act(async () =>
    root.render(
      h(CombatReinforcements, {
        combat,
        position: { xFeet: 10, yFeet: 15 },
        onAdded: () => {
          updated = true;
        },
        onError: (message: string) => {
          throw Error(message);
        },
      }),
    ),
  );
  const dragon = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Dragão'),
  )!;
  await act(async () => dragon.click());
  await click('Adicionar ao combate');
  const added = requests.find(
    (r) => r.path === '/api/combat/participants/add',
  )!;
  check(
    'reforço envia casa clicada e versão ao servidor',
    updated &&
      added.body.expectedVersion === 1 &&
      added.body.entries[0].positions[0].xFeet === 10,
  );
  let openedStart = 0;
  await act(async () => root.render(h(PreparedEncountersTab, {...props, onOpenStart: () => { openedStart++; }})));
  check('aba permanente tem título Combate', document.querySelector('.prepared-encounters h2')?.textContent === 'Combate');
  check('criar e iniciar ficam juntos no cabeçalho', document.querySelector('.preparation-header-actions')?.textContent?.includes('Criar encontro') && document.querySelector('.preparation-header-actions')?.textContent?.includes('Iniciar combate'));
  await click('Iniciar combate');
  check('botão do cabeçalho abre o início existente', openedStart === 1);
  await click('Criar encontro');
  check('criar encontro abre a montagem sem iniciar batalha', document.querySelector('[role="dialog"] h2')?.textContent?.includes('Preparar encontro'));
  await click('×');
  await act(async () => root.render(h(PreparedEncountersTab, {...props, combatActive: true, onOpenStart: () => { openedStart++; }})));
  const startButton = document.querySelector<HTMLButtonElement>('.preparation-header-actions .btn-primary');
  check('combate ativo impede outro início e mantém criação de encontros', startButton?.disabled && !document.querySelector<HTMLButtonElement>('.preparation-header-actions .btn:not(.btn-primary)')?.disabled);
  let action: (() => Promise<CombatDto>) | undefined;
  await act(async () =>
    root.render(
      h(
        AuthProvider,
        null,
        h(CombatTokenAdjustments, {
          combat,
          combatant: { id: 'unit', kind: 'CREATURE', name: 'Dragão' } as never,
          busy: false,
          effectsRefresh: 0,
          onRun: (a: () => Promise<CombatDto>) => {
            action = a;
          },
        }),
      ),
    ),
  );
  await click('Remover do combate');
  check(
    'remoção pede confirmação local',
    document.body.textContent?.includes('O cadastro será preservado.'),
  );
  await click('Confirmar remoção');
  check('confirmação encaminha operação', !!action);
  const css = readFileSync(
    new URL('../src/combat/workspace.css', import.meta.url),
    'utf8',
  );
  check(
    'jogador tem altura limitada independente dos cards',
    css.includes(
      ".combat-panel:has(.combat-workspace:not([data-master='true']))",
    ) && css.includes('height: max(36rem, calc(100dvh - 7rem))'),
  );
  check(
    'iniciativa tem rolagem interna e barra fina',
    css.includes('overflow-y: auto') && css.includes('scrollbar-width: thin'),
  );
  console.log(`${checks} verificações de preparação aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
