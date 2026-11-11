/** Decisão do Mestre: alvo obrigatório, confirmação assistida e orçamento. */
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}"),import.meta.url);
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {LegendaryActionsPanel}=await import('../src/combat/components/LegendaryActionsPanel');
import type {CombatDto} from '../src/types';
const combat={id:'fixture',version:1,legendaryWindow:{id:'window',turnSequence:1,outgoingId:'hero',candidateIds:['dragon'],decidedIds:[]},combatants:[{id:'dragon',name:'Dragão',hpCurrent:10,conditionEffects:{canAct:true},legendary:{max:3,used:0,firstTurnEnded:true},abilities:[{id:'tail',name:'Cauda',cost:'legendary',execution:'legendary-attack',legendaryCost:1,legendaryAttackId:'attack'},{id:'detect',name:'Detectar',cost:'legendary',execution:'assisted',legendaryCost:2}]},{id:'hero',name:'Herói'}]} as unknown as CombatDto;
const root=createRoot(document.getElementById('root')!);
try {
 await act(async()=>root.render(h(LegendaryActionsPanel,{combat,busy:false,onRun:()=>{}})));
 const button=()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('Usar '))!;
 assert.equal(button().disabled,true,'Ataque exige alvo');
 const target=document.querySelector<HTMLSelectElement>('[aria-label="Alvo da Ação Lendária de Dragão"]')!;
 await act(async()=>{target.value='hero';target.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(button().disabled,false);
 const option=document.querySelector<HTMLSelectElement>('[aria-label="Ação Lendária de Dragão"]')!;
 await act(async()=>{option.value='detect';option.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(button().disabled,true,'Efeito exige confirmação');
 await act(async()=>document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 assert.equal(button().disabled,false);
 combat.combatants[0].legendary!.used=2;
 await act(async()=>root.render(h(LegendaryActionsPanel,{combat,busy:false,onRun:()=>{}})));
 assert.equal(button().disabled,true,'Não oferece gasto acima do saldo');
 combat.legendaryWindow!.decidedIds=['dragon'];
 await act(async()=>root.render(h(LegendaryActionsPanel,{combat,busy:false,onRun:()=>{}})));
 assert.match(document.body.textContent!,/Decisão concluída/);assert.match(document.body.textContent!,/Iniciar próximo turno/);
 console.log('✔ Janela lendária: alvo, confirmação, saldo e decisão única em React/jsdom.');
}finally{await act(async()=>root.unmount());dom.window.close();}
