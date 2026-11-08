/** Mestre: painéis sob demanda preservam os formulários e a área do mapa. */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'localStorage', 'MutationObserver']) {
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document :
    (dom.window as unknown as Record<string, unknown>)[name];
}
globals.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globals.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw Error('Rede real proibida neste teste.'); };
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CombatWorkspace } = await import('../src/combat/components/CombatWorkspace');
let checks = 0, executions = 0;
function check(label: string, ok: unknown) { assert.ok(ok, label); checks++; console.log(`✔ ${label}`); }
const visible = (node: Element | null) => Boolean(node && !node.closest('[hidden]'));
function ActionFixture() {
  const [choice, setChoice] = useState('espada');
  return h('div', null, h('label', null, 'Ataque', h('select', { id: 'ataque', value: choice,
    onChange: (event: { target: { value: string } }) => setChoice(event.target.value) },
    h('option', { value: 'espada' }, 'Espada'), h('option', { value: 'arco' }, 'Arco'))),
    h('button', { id: 'executar', onClick: () => { executions++; } }, 'Executar ataque'));
}
function Fixture({ master = true, turnKey = '1', context = false }) {
  return h(CombatWorkspace, { isMaster: master, turnKey,
    header: h('h2', null, 'Combate'), initiative: h('div', null, 'Iniciativa'),
    scene: h('button', { id: 'mapa' }, 'Mapa'), log: h('div', { id: 'registro' }, 'Registro'),
    action: h(ActionFixture), context: context ? h('button', { id: 'reacao' }, 'Resolver Reação') : null,
    masterTools: master ? h('button', { id: 'cura' }, 'Aplicar cura') : undefined,
    tools: master ? h('input', { id: 'motivo', 'aria-label': 'Motivo do ajuste', defaultValue: '' }) : undefined,
    masterInventory: master ? h('button', { id: 'inventario' }, 'Inventário') : undefined,
    resourceBar: h('button', { id: 'turno' }, 'Encerrar turno'),
    dock: master ? undefined : h('div', { id: 'jogador-dock' }, 'Hotbar do jogador') });
}
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
await act(async () => root.render(h(Fixture, {})));
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(node => node.textContent?.includes(text))!;
async function click(node: Element) { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
check('mestre compartilha iniciativa, mapa e registro', !!host.querySelector('#mapa') && !!host.querySelector('#registro') && host.textContent!.includes('Iniciativa'));
check('mapa não reserva tray para o formulário de ataque', !host.querySelector('.combat-tactical-action'));
check('ajustes e ataques começam recolhidos', !visible(host.querySelector('#ataque')) && !visible(host.querySelector('#cura')));
check('recursos e inventário permanecem acessíveis sem abrir ajustes', visible(host.querySelector('#turno')) && visible(host.querySelector('#inventario')));
await click(button('Ações do turno'));
check('ações abrem na superfície flutuante com foco no fechamento', visible(host.querySelector('#ataque')) && document.activeElement?.getAttribute('aria-label') === 'Fechar painel do Mestre');
await act(async () => { const select = host.querySelector<HTMLSelectElement>('#ataque')!; select.value = 'arco'; select.dispatchEvent(new Event('change', { bubbles: true })); });
await click(host.querySelector('#executar')!);
check('ação continua usando o mesmo callback', executions === 1);
await click(button('Ajustes'));
check('abrir ajustes recolhe ações e expõe os controles existentes', !visible(host.querySelector('#ataque')) && visible(host.querySelector('#cura')));
const reason = host.querySelector<HTMLInputElement>('#motivo')!;
reason.value = 'Ajuste da fixture'; reason.focus();
await act(async () => reason.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
check('Escape fecha e devolve foco ao botão de origem', !visible(reason) && document.activeElement === button('Ajustes'));
await click(button('Ações do turno'));
check('fechar o painel preserva a arma selecionada', host.querySelector<HTMLSelectElement>('#ataque')!.value === 'arco');
await click(button('Ajustes'));
check('fechar o painel preserva o motivo digitado', reason.value === 'Ajuste da fixture');
await act(async () => host.querySelector('#mapa')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
check('interação fora do painel libera a vista do mapa', !visible(reason));
await click(button('Ajustes'));
await act(async () => root.render(h(Fixture, { turnKey: '2', context: true })));
check('mudança de turno recolhe o painel anterior', !visible(reason));
check('Reação continua visível sem abrir painel', visible(host.querySelector('#reacao')) && !!host.querySelector('.combat-tactical-context'));
await act(async () => root.render(h(Fixture, { master: false })));
check('jogador não recebe barra nem ferramentas do Mestre', !host.querySelector('.combat-master-dock') && !host.querySelector('#cura'));
check('jogador conserva sua dock e fluxo operacional', !!host.querySelector('#jogador-dock') && visible(host.querySelector('#ataque')));
const { CombatGrid } = await import('../src/combat/grid/CombatGrid');
const combat = { id: 'fixture-master', version: 1, status: 'ACTIVE', currentCombatantId: null,
  sceneBackgroundImageUrl: null, combatants: [], spatial: { mode: 'grid-2d', widthFeet: 60,
    heightFeet: 60, cellSizeFeet: 5, walls: [] } } as never;
await act(async () => root.render(h(CombatGrid, { combat, isMaster: true,
  onCombatChange: () => {}, onError: message => { throw Error(message); } })));
const settings = host.querySelector<HTMLDetailsElement>('.grid-master-settings')!;
check('cena e posicionamento começam em um único menu recolhido', !!settings && !settings.open && !!settings.querySelector('.grid-scene-controls') && !!settings.querySelector('.grid-toolbar'));
await act(async () => { settings.open = true; });
const sceneButton = settings.querySelector('button')!; sceneButton.focus();
await act(async () => sceneButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
check('Escape recolhe a administração da cena e retorna ao menu', !settings.open && document.activeElement === settings.querySelector('summary'));
await act(async () => root.unmount()); dom.window.close();
console.log(`${checks} verificações da composição do Mestre aprovadas.`);
