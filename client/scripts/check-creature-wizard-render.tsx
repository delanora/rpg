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
const { useState } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { CreaturesTab } = await import('../src/components/master/CreaturesTab');
const { GridToken, repeatedCreatureIds } = await import('../src/combat/grid/GridToken');
import type { Creature, CreaturePatch, Locality, Region } from '../src/types';
const locality = {
  id: 'local',
  name: 'Ruínas',
  regionId: 'region',
  images: [],
  description: '',
  creatureCount: 0,
  version: 0,
  createdAt: '',
  updatedAt: '',
} as Locality;
const region = { id: 'region', name: 'Norte', localityCount: 1 } as Region;
let created: (CreaturePatch & { localityIds: string[] }) | null = null;
let creates = 0;
const requests: string[] = [];
globalThis.fetch = async (input) => {
  requests.push(String(input));
  throw Error('Rede real proibida nesta fixture');
};
function Harness() {
  const [rows, setRows] = useState<Creature[]>([]);
  return h(CreaturesTab, {
    kind: 'CREATURE',
    creatures: rows,
    localities: [locality],
    regions: [region],
    onCreate: async (input) => {
      creates++;
      created = input;
      const { creatureDraft } = await import(
        '../src/components/master/creatureDraft'
      );
      const result = {
        ...creatureDraft('CREATURE', locality),
        ...input,
        id: 'persisted',
      } as Creature;
      setRows([...rows, result]);
      return result;
    },
    onPatch: () => {},
    onDelete: () => {},
  });
}
const root = createRoot(document.getElementById('root')!);
let checks = 0;
const check = (label: string, condition: unknown) => {
  assert.ok(condition, label);
  checks++;
  console.log('✔ ' + label);
};
async function click(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === text);
  assert.ok(button, text);
  await act(async () => button.click());
}
async function change(selector: string, value: string, blur = false) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  assert.ok(input, selector);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    if (blur) input.blur();
  });
}
try {
  await act(async () => root.render(h(Harness)));
  check(
    'listagem apresenta bestiário e filtro por localidade',
    document.body.textContent?.includes('Bestiário') &&
      document.body.textContent.includes('Filtrar por localidade'),
  );
  await click('+ nova criatura');
  check(
    'abrir criação não cadastra uma criatura vazia',
    creates === 0 &&
      !!document.querySelector('[aria-label="Etapas do cadastro"]'),
  );
  await click('fechar');
  check(
    'cancelar o rascunho não grava dados',
    creates === 0 && !document.querySelector('.creature-editor'),
  );
  await click('+ nova criatura');
  await change('[aria-label="Nome da criatura"]', 'Guardião das ruínas', true);
  check(
    'nome digitado atualiza o rascunho',
    document.querySelector('.detail-modal-title')?.textContent ===
      'Guardião das ruínas',
  );
  await click('Continuar');
  await change('[aria-label="Pontos de vida máximos"]', '30', true);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Força"]')!.click());
  await change('[aria-label="Força"]', '18', true);
  await click('Continuar');
  await click('Adicionar ataque');
  check(
    'ataque abre formulário com alcance explícito',
    !!document.querySelector('.creature-attack-form') &&
      document
        .querySelector('.creature-attack-form')
        ?.textContent?.includes('Alcance corpo a corpo (m)'),
  );
  check(
    'ataque não salvo impede sair da etapa',
    document.querySelector<HTMLButtonElement>(
      '.creature-wizard-footer .btn-primary',
    )?.disabled,
  );
  await change('input[placeholder="Ex.: Mordida"]', 'Garra');
  await change('input[placeholder="1,5"]', '3');
  await click('Adicionar outro tipo de dano');
  check(
    'dano adicional é uma linha independente',
    document.querySelectorAll('.creature-damage-row').length === 2,
  );
  await click('Salvar ataque');
  check(
    'salvar ataque produz card e libera navegação',
    document
      .querySelector('.creature-attack-card')
      ?.textContent?.includes('Garra') &&
      !document.querySelector<HTMLButtonElement>(
        '.creature-wizard-footer .btn-primary',
      )?.disabled,
  );
  await click('Adicionar habilidade');
  check('edição da habilidade bloqueia a navegação', document.querySelector<HTMLButtonElement>('.creature-wizard-footer .btn-primary')?.disabled);
  await change('[aria-label="Nome da habilidade"]', 'Escape ágil');
  const choose = async (label: string, value: string) => act(async () => {
    const select = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await choose('Custo da habilidade', 'bonus-action');
  await choose('Execução da habilidade', 'disengage');
  await change('[aria-label="Usos da habilidade"]', '2');
  await click('Salvar habilidade');
  check('habilidade apresenta custo, execução e limite', document.body.textContent?.includes('Ação bônus · Automática · 2 usos por combate'));
  await click('Adicionar habilidade');
  await choose('Custo da habilidade', 'reaction');
  await change('[aria-label="Nome da habilidade"]', 'Guarda');
  await click('Salvar habilidade');
  check('reação sem gatilho mantém formulário e mostra erro', document.querySelector('[role="alert"]')?.textContent?.includes('gatilho'));
  await click('Cancelar habilidade');
  await click('Continuar');
  await click('Continuar');
  check(
    'revisão mantém nome, PV e ataque',
    document
      .querySelector('.creature-review')
      ?.textContent?.includes('Guardião das ruínas') &&
      document.querySelector('.creature-review')?.textContent?.includes('30') &&
      document
        .querySelector('.creature-review')
        ?.textContent?.includes('Garra'),
  );
  await click('Criar cadastro');
  const saved = created as unknown as CreaturePatch;
  check(
    'concluir faz uma única criação completa',
    creates === 1 &&
      saved.name === 'Guardião das ruínas' &&
      saved.hpMax === 30 &&
      saved.hpCurrent === 30 &&
      saved.strength === 18,
  );
  check(
    'alcance em metros é enviado em pés com dano estruturado',
    saved.attacks?.[0].reachFeet === 10 &&
      saved.attacks[0].extraDamages.length === 1,
  );
  check('habilidade acompanha o cadastro completo', saved.abilities?.[0].execution === 'disengage' && saved.abilities[0].cost === 'bonus-action' && saved.abilities[0].maxUses === 2);
  check('nenhuma escrita intermediária saiu para a API', requests.length === 0);
  const spatial = {
    tokenImageRef: '/fixture.png',
    position: { xFeet: 0, yFeet: 0 },
    baseSize: 'medium',
    effectiveSize: 'medium',
    occupiedSpace: {
      minXFeet: 0,
      minYFeet: 0,
      maxXFeet: 5,
      maxYFeet: 5,
      widthFeet: 5,
      heightFeet: 5,
    },
  } as const;
  const token = {
    id: 'copy2',
    name: 'Guardião 2',
    kind: 'CREATURE',
    relation: 'hostile' as const,
    spatialVisibility: 'master-only' as const,
    spatial,
    tokenNumber: 2,
    tokenDimmed: true,
  };
  const master = renderToStaticMarkup(
    h(GridToken, {
      combatant: token,
      isMaster: true,
      showNumber: true,
      pixelsPerCell: 40,
      cellSizeFeet: 5,
    }),
  );
  const player = renderToStaticMarkup(
    h(GridToken, {
      combatant: { ...token, spatialVisibility: 'public' },
      pixelsPerCell: 40,
      cellSizeFeet: 5,
    }),
  );
  check(
    'token inativo escurece e tem numeração discreta',
    master.includes('is-inactive') &&
      master.includes('grid-token-number') &&
      master.includes('Unidade 2'),
  );
  check(
    'olho fechado aparece apenas para Mestre',
    master.includes('grid-token-visibility') &&
      master.includes('Oculto dos jogadores') &&
      !player.includes('grid-token-visibility'),
  );
  const visible = renderToStaticMarkup(
    h(GridToken, {
      combatant: { ...token, spatialVisibility: 'public', tokenDimmed: false },
      isMaster: true,
      pixelsPerCell: 40,
      cellSizeFeet: 5,
    }),
  );
  check(
    'revelado mostra olho aberto sem escurecimento indevido',
    visible.includes('Revelado aos jogadores') &&
      !visible.includes('is-inactive'),
  );
  const { CreatureAbilitiesPanel } = await import('../src/combat/components/CreatureAbilitiesPanel');
  const reactionUnit = { id: 'reaction-copy', creatureId: 'catalog', hpCurrent: 20, deathBlocksActions: false,
    conditionEffects: { canAct: true }, turnEconomy: { reactionAvailable: true }, abilityUses: {},
    abilities: [{ id: 'guard', name: 'Guarda', description: 'Efeito assistido', cost: 'reaction', execution: 'assisted', trigger: 'Ataque percebido', maxUses: 2 }] };
  let commands = 0;
  const renderAbility = async (unit = reactionUnit) => act(async () => root.render(h(CreatureAbilitiesPanel, {
    combat: { status: 'ACTIVE', currentCombatantId: 'other-copy' } as any, combatant: unit as any, busy: false, onRun: () => { commands++; },
  })));
  await renderAbility();
  check('reação cadastrada fica acessível fora do turno', ![...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Usar habilidade')?.disabled);
  await click('Usar habilidade');
  check('reação assistida pede confirmação do gatilho', document.querySelector('.combat-ability-confirm')?.textContent?.includes('ocorrência do gatilho'));
  await click('Cancelar');
  check('cancelar a confirmação não envia comando', commands === 0);
  await click('Usar habilidade'); await click('Confirmar');
  check('confirmar encaminha uma operação ao controlador', commands === 1);
  await renderAbility({ ...reactionUnit, hpCurrent: 0 });
  check('token a zero PV não oferece uso da habilidade', [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Usar habilidade')?.disabled);
  const copies = repeatedCreatureIds([{ kind: 'CREATURE', creatureId: 'dragon' }, { kind: 'CREATURE', creatureId: 'goblin' }, { kind: 'CREATURE', creatureId: 'goblin' }, { kind: 'NPC', creatureId: 'dragon' }]);
  check('somente cópias do mesmo cadastro recebem numeração', copies.has('goblin') && !copies.has('dragon'));
  check('lista pública com uma só cópia não denuncia outras ocultas', !repeatedCreatureIds([{ kind: 'CREATURE', creatureId: 'goblin' }]).size);
  const single = renderToStaticMarkup(h(GridToken, { combatant: token, isMaster: true, pixelsPerCell: 40, cellSizeFeet: 5 }));
  check('token único não exibe o selo numérico', !single.includes('grid-token-number'));
  let visibilityCalls = 0, selectCalls = 0, dragCalls = 0, centerCalls = 0, backgroundCalls = 0;
  const renderToken = async (disabled = false, isMaster = true, revealed = false) => act(async () => root.render(h('div', { onClick: () => backgroundCalls++, onPointerDown: () => backgroundCalls++ }, h(GridToken, {
    combatant: { ...token, spatialVisibility: revealed ? 'public' : 'master-only' }, isMaster, showNumber: true, pixelsPerCell: 40, cellSizeFeet: 5, interactive: true, movable: true,
    visibilityDisabled: disabled, onToggleVisibility: id => { assert.equal(id, token.id); visibilityCalls++; }, onSelect: () => selectCalls++, onMoveStart: () => dragCalls++, onCenter: () => centerCalls++,
  }))));
  await renderToken();
  const eye = document.querySelector<HTMLButtonElement>('.grid-token-visibility')!;
  check('olho é um botão independente, sem botão aninhado', eye.tagName === 'BUTTON' && !eye.parentElement?.closest('button'));
  await act(async () => { eye.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); eye.click(); eye.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })); });
  check('clicar no olho só solicita visibilidade, sem mover, atacar, centralizar ou acionar o fundo', visibilityCalls === 1 && selectCalls === 0 && dragCalls === 0 && centerCalls === 0 && backgroundCalls === 0);
  check('olho aguarda estado confirmado para mudar', eye.getAttribute('aria-label')?.startsWith('Revelar'));
  await renderToken(true); await act(async () => document.querySelector<HTMLButtonElement>('.grid-token-visibility')!.click());
  check('pedido em andamento bloqueia novo clique', visibilityCalls === 1);
  await renderToken(false, true, true);
  check('estado revelado oferece ocultar', document.querySelector('.grid-token-visibility')?.getAttribute('aria-label')?.startsWith('Ocultar'));
  await renderToken(false, false, true);
  check('jogador não recebe o controle de visibilidade', !document.querySelector('.grid-token-visibility'));
  check('jogador vê o número de criaturas repetidas e reveladas', document.querySelector('.grid-token-number')?.textContent === '2');
  console.log(`${checks} verificações do bestiário aprovadas.`);
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
