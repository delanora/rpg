/** Cadastro da recarga usando React/jsdom; nenhuma chamada à campanha. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register('data:text/javascript,' + encodeURIComponent("export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}"), import.meta.url);
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost'});
const globals = globalThis as unknown as Record<string,unknown>;
globals.window = dom.window; globals.document = dom.window.document; globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement:h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const { CreatureAbilitiesEditor } = await import('../src/components/master/CreatureAbilitiesEditor');
const { CreatureAbilitiesPanel } = await import('../src/combat/components/CreatureAbilitiesPanel');
import type { CreatureAbility, CombatDto, CombatantDto } from '../src/types';
let saved:CreatureAbility[]=[];
function Harness() {
  const [abilities,setAbilities] = useState<CreatureAbility[]>([]);
  return h(CreatureAbilitiesEditor,{abilities,onChange:(value:CreatureAbility[])=>{saved=value;setAbilities(value);},onEditingChange:()=>{}});
}
const root = createRoot(document.getElementById('root')!);
async function click(text:string) {
 const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);
 assert.ok(button,text); await act(async()=>button.click());
}
async function select(value:string) {
 const field=document.querySelector<HTMLSelectElement>('[aria-label="Recarga da habilidade"]')!;
 await act(async()=>{field.value=value;field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
}
try {
 await act(async()=>root.render(h(Harness)));
 await click('Adicionar habilidade');
 const name=document.querySelector<HTMLInputElement>('[aria-label="Nome da habilidade"]')!;
 await act(async()=>{
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(name,'Sopro de prova');
  name.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 });
 await select('5');
 const uses=document.querySelector<HTMLInputElement>('[aria-label="Usos da habilidade"]')!;
 assert.equal(uses.value,'1'); assert.equal(uses.disabled,true);
 await click('Salvar habilidade');
 assert.deepEqual(saved[0].recharge,{minimum:5}); assert.equal(saved[0].maxUses,1);
 assert.ok(document.body.textContent?.includes('Recarga 5–6'));
 await click('Editar habilidade'); await select('');
 assert.equal(document.querySelector<HTMLInputElement>('[aria-label="Usos da habilidade"]')!.disabled,false);
 await click('Salvar habilidade'); assert.equal(saved[0].recharge,undefined);
 const unit={id:'copy',creatureId:'creature',hpCurrent:30,conditionEffects:{canAct:true},turnEconomy:{actionsUsed:0,actionsGranted:1,bonusActionUsed:false,reactionAvailable:true},abilities:[{...saved[0],recharge:{minimum:5}}],abilityUses:{[saved[0].id]:1}} as unknown as CombatantDto;
 const markup=renderToStaticMarkup(h(CreatureAbilitiesPanel,{combat:{status:'ACTIVE',currentCombatantId:unit.id} as CombatDto,combatant:unit,busy:false,onRun:()=>{}}));
 assert.match(markup,/Aguardando recarga/); assert.match(markup,/disabled=""/); assert.match(markup,/Restaurar usos/);
 console.log('✔ Cadastro salva/remove recarga, fixa um uso e apresenta espera/restauração no combate.');
} finally {await act(async()=>root.unmount());dom.window.close();}
