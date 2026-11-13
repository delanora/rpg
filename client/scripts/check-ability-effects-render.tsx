/** Cadastro e execução individual dos Ataques Múltiplos em React/jsdom. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register('data:text/javascript,' + encodeURIComponent("export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}"), import.meta.url);
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost'});
const globals = globalThis as unknown as Record<string,unknown>;
globals.HTMLElement=dom.window.HTMLElement;globals.Node=dom.window.Node;
globals.localStorage=dom.window.localStorage; globals.window = dom.window; globals.document = dom.window.document; globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement:h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const { CreatureAbilitiesEditor } = await import('../src/components/master/CreatureAbilitiesEditor');
const { CreatureAbilitiesPanel } = await import('../src/combat/components/CreatureAbilitiesPanel');
import type { CreatureAbility, CombatDto, CombatantDto, Attack } from '../src/types';
let saved:CreatureAbility[]=[];
function Harness() {
  const [abilities,setAbilities] = useState<CreatureAbility[]>([]);
  return h(CreatureAbilitiesEditor,{attacks,abilities,onChange:(value:CreatureAbility[])=>{saved=value;setAbilities(value);},onEditingChange:()=>{}});
}
const attacks=[{id:'bite',name:'Mordida',attackBonus:5,damage:{count:1,sides:6,bonus:2,type:'Perfurante'},extraDamages:[],notes:'',ranged:false,finesse:false,legacy:false},{id:'claw',name:'Garra',attackBonus:5,damage:{count:1,sides:4,bonus:2,type:'Cortante'},extraDamages:[],notes:'',ranged:false,finesse:false,legacy:false}] as Attack[];
const root = createRoot(document.getElementById('root')!);
async function click(text:string) {
 const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);
 assert.ok(button,text); await act(async()=>button.click());
}
async function change(label:string,value:string) {
 const field=document.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;assert.ok(field,label);
 await act(async()=>{
  const proto=field instanceof dom.window.HTMLSelectElement?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(field,value);
  field.dispatchEvent(new dom.window.Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));
 });
}
try {
 await act(async()=>root.render(h(Harness)));
 await click('Adicionar habilidade');await change('Nome da habilidade','Efeito genérico');await change('Execução da habilidade','area-save-damage');
 await act(async()=>document.querySelector<HTMLInputElement>('[aria-label="Causar dano na falha"]')!.click());
 const label=[...document.querySelectorAll('label')].find(row=>row.textContent?.trim()==='Amedrontado')!;assert.ok(label);
 await act(async()=>label.querySelector<HTMLInputElement>('input')!.click());await click('Salvar habilidade');
 assert.equal(saved[0].area!.damage.length,0);assert.deepEqual(saved[0].area!.conditions,['frightened']);
 const {LegendaryActionsPanel}=await import('../src/combat/components/LegendaryActionsPanel');
 const ability={...saved[0],cost:'legendary',legendaryCost:2};
 const unit={id:'source',name:'Origem',hpCurrent:100,conditionEffects:{canAct:true},legendary:{max:3,used:0,firstTurnEnded:true},abilities:[ability]} as unknown as CombatantDto;
 const combat={id:'fixture',version:1,combatants:[unit],legendaryWindow:{id:'window',candidateIds:['source'],decidedIds:[]}} as unknown as CombatDto;
 let prepared=false;
 await act(async()=>root.render(h(LegendaryActionsPanel,{combat,busy:false,onRun:()=>{},onPrepareArea:()=>{prepared=true;}})));
 await click('Usar Efeito genérico');assert.equal(prepared,true,'Opção lendária prepara área em vez de exigir ataque individual');
 const {GridRadialMenu}=await import('../src/combat/grid/GridRadialMenu');let toggled=false;
 await act(async()=>root.render(h(GridRadialMenu,{point:{x:200,y:200},canAdd:false,areaDisabled:false,onClose:()=>{},onAdd:()=>{},onArea:()=>{},terrainVisible:false,onToggleTerrain:()=>{toggled=true;}})));
 const terrain=document.querySelector<HTMLButtonElement>('button[aria-label="Exibir terreno"]');assert.ok(terrain);await act(async()=>terrain.click());assert.equal(toggled,true);
 await act(async()=>root.render(h(GridRadialMenu,{point:{x:200,y:200},canAdd:false,areaDisabled:false,onClose:()=>{},onAdd:()=>{},onArea:()=>{}})));
 assert.ok(!document.querySelector('button[aria-label="Exibir terreno"]'),'Sem callback privado o jogador não recebe o controle');
 console.log('✔ Cadastro sem dano, condição, preparação lendária e controle de terreno privado em React/jsdom.');
} finally {await act(async()=>root.unmount());dom.window.close();}
