/** Cadastro e execução individual dos Ataques Múltiplos em React/jsdom. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register('data:text/javascript,' + encodeURIComponent("export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}"), import.meta.url);
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost'});
const globals = globalThis as unknown as Record<string,unknown>;
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
const {CombatActionPanel}=await import('../src/combat/components/CombatActionPanel');
const {onTurnStart}=await import('../../src/modules/shared/action-economy');
const {beginMultiattack,recordMultiattack}=await import('../../src/modules/shared/multiattack');
const {creatureAbilitySchema}=await import('../../src/modules/shared/creature-abilities');
try {
 await act(async()=>root.render(h(Harness)));
 await click('Adicionar habilidade');await change('Nome da habilidade','Ataques Múltiplos');await change('Execução da habilidade','multiattack');
 await change('Quantidade do ataque 1','1');await click('Adicionar ataque ou habilidade');await change('Quantidade do ataque 2','2');await click('Salvar habilidade');
 assert.deepEqual(saved[0].multiattack,[{attackId:'bite',count:1},{attackId:'claw',count:2}]);
 const economy=onTurnStart(9);beginMultiattack(economy,creatureAbilitySchema.parse(saved[0]),attacks,'sequence');
 const unit={id:'source',kind:'CREATURE',name:'Atacante',creatureId:'creature',hpCurrent:100,conditionEffects:{canAct:true},turnEconomy:economy,abilities:saved} as unknown as CombatantDto;
 const target={...unit,id:'target',name:'Alvo',turnEconomy:onTurnStart(9)};
 const combat={id:'combat',version:1,status:'ACTIVE',currentCombatantId:unit.id,combatants:[unit,target]} as unknown as CombatDto;
 const markup=renderToStaticMarkup(h(CreatureAbilitiesPanel,{combat,combatant:unit,busy:false,onRun:()=>{}}));
 assert.match(markup,/0\/3/);assert.match(markup,/Abandonar golpes restantes/);assert.match(markup,/Mordida/);
 globalThis.fetch=async()=>new Response(JSON.stringify({options:[]}),{status:200});
 let sent:Parameters<NonNullable<Parameters<typeof CombatActionPanel>[0]['onAttack']>>[0]|undefined;
 const render=async()=>act(async()=>root.render(h(CombatActionPanel,{combat,attacker:unit,attackerChoices:[unit],attacksFor:()=>attacks,attacks,targetCombatantId:target.id,busy:false,onAttack:input=>{sent=input;}})));
 await render();
 const roll=document.querySelector<HTMLButtonElement>('.attack-roll')!;assert.ok(roll&&!roll.disabled,'Ação já gasta permite golpe reservado');
 await act(async()=>roll.click());assert.equal(sent?.multiattackId,'sequence');assert.equal(sent?.attackId,'bite');assert.equal(sent?.attackActionId,undefined);
 recordMultiattack(economy,'sequence','bite');combat.version++;
 await render();
 assert.ok(!document.querySelector('.attack-options')?.textContent?.includes('Mordida'),'Golpe esgotado sai das opções');
 await act(async()=>document.querySelector<HTMLButtonElement>('.attack-roll')!.click());assert.equal(sent?.attackId,'claw');
 const special=creatureAbilitySchema.parse({id:'presence',name:'Habilidade especial de prova',cost:'action',execution:'assisted'});
 const original=saved[0];
 function MixedHarness(){const [list,setList]=useState<CreatureAbility[]>([original,special]);return h(CreatureAbilitiesEditor,{attacks,abilities:list,onChange:value=>{saved=value;setList(value);},onEditingChange:()=>{}});}
 await act(async()=>root.render(h(MixedHarness)));await click('Editar habilidade');await click('Adicionar ataque ou habilidade');await click('Salvar habilidade');
 assert.deepEqual(saved[0].multiattack!.at(-1),{kind:'ability',attackId:'presence',count:1});
 const mixedEconomy=onTurnStart(9);beginMultiattack(mixedEconomy,saved[0],attacks,'mixed-ui',saved);
 const mixedUnit={...unit,turnEconomy:mixedEconomy,abilities:saved};const mixedCombat={...combat,combatants:[mixedUnit,target]};
 let request:any;let task:Promise<CombatDto>|undefined;
 globalThis.fetch=async(_url,input)=>{request=JSON.parse(input?.body as string);return new Response(JSON.stringify({combat:mixedCombat}),{status:200});};
 await act(async()=>root.render(h(CreatureAbilitiesPanel,{combat:mixedCombat,combatant:mixedUnit,busy:false,onRun:action=>{task=action();}})));
 await act(async()=>{const card=[...document.querySelectorAll('article')].find(node=>node.querySelector('strong')?.textContent===special.name)!;const use=card.querySelector<HTMLButtonElement>('button')!;assert.equal(use.disabled,false);use.click();});await click('Confirmar');await task;assert.equal(request.multiattackId,'mixed-ui');assert.equal(request.abilityId,'presence');
 console.log('✔ Cadastro da composição, progresso, golpe reservado sem nova Ação e seleção automática do próximo tipo disponível.');
} finally {await act(async()=>root.unmount());dom.window.close();}
