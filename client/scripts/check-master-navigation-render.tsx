/** Navegação do Mestre: combate independente, sem escritas ou perda de sincronização. */
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
  globals[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document :
    (dom.window as unknown as Record<string, unknown>)[name];
}
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.fetch = () => { throw Error('Navegação não pode fazer escritas HTTP.'); };
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useMasterNavigation } = await import('../src/combat/useMasterNavigation');
const { MasterHome } = await import('../src/components/master/MasterHome');
const tabs = ['home', 'sheets', 'creatures', 'npcs', 'regions', 'items', 'config', 'soundpad', 'combat', 'active-combat'] as const;
function Fixture({ combatId = null, version = 0 }: { combatId?: string | null; version?: number }) {
  const { tab, setTab } = useMasterNavigation(combatId);
  return h('div', null,
    h('nav', null, tabs.filter(key => key !== 'active-combat' || combatId).map(key => h('button', { key, 'data-tab': key, onClick: () => setTab(key) }, key))),
    h('main', { 'data-current': tab }, tab === 'active-combat' ? `Combate ${combatId} versão ${version}` : tab === 'combat' ? 'Biblioteca de encontros' : `Área ${tab}`));
}
let checks = 0;
function check(label: string, condition: unknown) { assert.ok(condition, label); checks++; console.log(`✔ ${label}`); }
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
async function render(combatId: string | null, version = 0) { await act(async () => root.render(h(Fixture, { combatId, version }))); }
async function choose(tab: string) { await act(async () => host.querySelector(`[data-tab="${tab}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
const current = () => host.querySelector('main')!.getAttribute('data-current');
await render(null);
check('sem combate inicia no salão', current() === 'home');
await choose('combat'); check('aba de combate existe mesmo sem combate ativo', current() === 'combat' && host.textContent!.includes('Biblioteca de encontros') && !host.querySelector('[data-tab="active-combat"]'));
await render('combate-a', 1); check('combate novo abre a aba temporária', current() === 'active-combat' && !!host.querySelector('[data-tab="active-combat"]'));
for (const tab of tabs.filter(tab => tab !== 'active-combat')) {
  await choose(tab);
  check(`${tab}: mostra apenas a área escolhida`, current() === tab && !host.querySelector('main')!.textContent!.includes('Combate '));
  await render('combate-a', 2);
  check(`${tab}: atualização do combate não rouba a aba`, current() === tab);
}
await choose('active-combat');
check('retorno ao combate usa o estado atualizado', host.querySelector('main')!.textContent === 'Combate combate-a versão 2');
await choose('items'); await render(null);
check('encerrar combate preserva outra aba aberta', current() === 'items');
await render('combate-b'); await render(null);
check('encerrar combate volta à biblioteca e remove a aba temporária', current() === 'combat' && !host.querySelector('[data-tab="active-combat"]'));
let opened = false;
await act(async () => root.render(h(MasterHome, {
  userName: 'Mestre Fixture', sheets: 0, creatures: 0, npcs: 0, regions: 0, localities: 0, items: 0,
  musicTrackCount: 0, levelUpRelease: 0, startingLevel: 1, extraCoins: false, combatActive: true,
  onOpenTab: () => {}, onStartCombat: () => { opened = true; }, onReleaseLevelUp: () => {},
})));
const back = Array.from(host.querySelectorAll('button')).find(button => button.textContent!.includes('Voltar ao combate'))!;
check('atalho do salão oferece retorno ao combate ativo', !!back);
await act(async () => back.dispatchEvent(new MouseEvent('click', { bubbles: true })));
check('atalho executa o retorno configurado', opened);
await act(async () => root.unmount()); dom.window.close();
console.log(`${checks} verificações de navegação aprovadas.`);
