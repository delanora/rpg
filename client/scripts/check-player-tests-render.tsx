/** Testes na lateral do jogador: React real, notificação e leituras fora de ordem. */
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {JSDOM} from 'jsdom';
register('data:text/javascript,'+encodeURIComponent("export async function load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context)}"),import.meta.url);
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost',pretendToBeVisual:true});
const globals=globalThis as unknown as Record<string,unknown>;
for(const name of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','localStorage','sessionStorage','MutationObserver']) globals[name]=name==='window'?dom.window:name==='document'?dom.window.document:(dom.window as unknown as Record<string,unknown>)[name];
globals.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globals.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,act,useState}=await import('react');
const {createRoot}=await import('react-dom/client');
const {CombatTracker}=await import('../src/combat/CombatTracker');
const {AuthProvider}=await import('../src/auth');
const {mechanicalStateOf,deriveConditionEffects,CONDITION_LABELS}=await import('../../src/modules/shared/conditions');
const {deathStateOf}=await import('../../src/modules/shared/death');
const {onTurnStart}=await import('../../src/modules/shared/action-economy');
import type {CombatDto,CombatResolutionCardDto,SessionUser} from '../src/types';
const makeUnit=(id:string,characterId:string)=>({id,characterId,creatureId:null,ownerUserId:id+'-owner',name:id==='hero'?'Herói':'Outro',kind:'CHARACTER',hpCurrent:10,hpMax:10,armorClass:12,effectiveSpeed:9,deathState:deathStateOf({}),deathBlocksActions:false,mechanicalState:mechanicalStateOf({}),conditionEffects:{...deriveConditionEffects(mechanicalStateOf({})),labels:CONDITION_LABELS},mechanicalVersion:1,turnEconomy:onTurnStart(9),rolled:true,initiative:20,dexterityMod:0,statsHidden:false,missing:false,spatialVisibility:'public',spatial:null});
let serverCombat={id:'combat',version:1,status:'ACTIVE',round:1,currentIndex:0,currentCombatantId:'hero',economyLog:[],combatants:[makeUnit('hero','sheet'),makeUnit('other','other-sheet')],spatial:{mode:'assisted',widthFeet:100,heightFeet:100,cellSizeFeet:5},sceneBackgroundImageUrl:null} as unknown as CombatDto;

const card=(kind:'spell-saving-throw'|'death-saving-throw'):CombatResolutionCardDto=>({id:kind==='spell-saving-throw'?'spell':'death',kind,status:'pending',target:{kind:'character',id:'sheet',name:'Herói',ownerUserId:'hero-owner'},title:kind==='spell-saving-throw'?'Salvaguarda de magia':'Teste contra a Morte',shortDescription:null,ability:kind==='spell-saving-throw'?'wisdom':null,phase:kind==='spell-saving-throw'?'initial':null,optional:false,canResolve:true,actions:kind==='spell-saving-throw'?[{kind:'roll',actor:'master',visibility:'public'},{kind:'roll',actor:'master',visibility:'private'}]:[{kind:'roll',actor:'master',visibility:null}],presentation:{tone:kind==='spell-saving-throw'?'arcane':'peril',icon:kind==='spell-saving-throw'?'sparkle':'skull'},counters:kind==='spell-saving-throw'?null:{successes:0,failures:0,stabilized:false},reference:{entity:{kind:'character',id:'sheet'},pendingId:kind==='spell-saving-throw'?'pending-spell':null},createdAt:'fixture'} as CombatResolutionCardDto);
let requests:CombatResolutionCardDto[]=[];
let viewer:SessionUser={id:'hero-owner',username:'player',displayName:'Jogador',role:'PLAYER'};
const calls:{url:string;body:any}[]=[];let resolveElsewhere=false;const reportedErrors:string[]=[];
globals.fetch=async(url:string,options:RequestInit={})=>{
 const body=options.body?JSON.parse(String(options.body)):undefined;calls.push({url,body});
 let value:any;
 if(url==='/api/auth/me')value={user:viewer};
 else if(url==='/api/combat/active')value={combat:serverCombat};
 else if(url.endsWith('/reaction-opportunities'))value={combatId:'combat',combatVersion:serverCombat.version,opportunities:[],movement:null};
 else if(url.endsWith('/resolution-requests'))value={requests,combatId:'combat',at:'fixture'};
 else if(url.includes('/api/death/'))value={death:{entity:{kind:'character',id:'sheet'},kind:'character',version:1,death:serverCombat.combatants[0].deathState,deathSave:{available:true,reason:'',audience:'table'}}};
 else if(url.startsWith('/api/dice/options/'))value={options:[]};
 else if(url==='/api/dice/roll'){
   if(resolveElsewhere){resolveElsewhere=false;serverCombat.combatants[0].mechanicalState.pendingConcentrationSaves=[];serverCombat={...serverCombat,version:serverCombat.version+1};return new Response(JSON.stringify({message:'Este teste já foi resolvido.'}),{status:409});}

   if(body.kind==='save')assert.equal(body.pendingEffectSaveId,'pending-spell');else assert.equal(body.entity.id,'sheet');
   if(body.kind==='concentration')serverCombat.combatants[0].mechanicalState.pendingConcentrationSaves=[];
   else if(body.kind==='save')requests=[];
   else if(body.kind==='death-save'){requests=[];serverCombat.combatants[0].deathState={...serverCombat.combatants[0].deathState!,successes:1,saveTurnKey:'combat:3:0'};}
   serverCombat={...serverCombat,version:serverCombat.version+1};value={roll:{kind:body.kind,total:10,audience:'table'}};
 }else return new Response(JSON.stringify({message:'Leitura auxiliar indisponível na fixture'}),{status:404});
 return new Response(JSON.stringify(value),{status:url==='/api/dice/roll'?201:200});
};
localStorage.setItem('grimorio.token','fixture');
function Harness(){const [combat,update]=useState(serverCombat);return h(AuthProvider,null,h(CombatTracker,{combat,user:viewer,log:[],turnAlert:null,onCombatChange:update,onCombatEnd:()=>{},onError:message=>{reportedErrors.push(message)}}));}
const root=createRoot(document.getElementById('root')!);let checks=0;
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);checks++;console.log('✔ '+label)};
const click=async(selector:string)=>{const button=document.querySelector<HTMLButtonElement>(selector);assert.ok(button,selector);await act(async()=>button.click())};
const {notifyResolutionRequestsChanged}=await import('../src/combat/resolutionApi');
try {
 await act(async()=>root.render(h(Harness)));
 check('bloco Testes começa vazio',!document.querySelector('.combat-tests-panel .resolution-card'));
 const normalFetch=globals.fetch as typeof fetch;
 let releaseOld:((response:Response)=>void)|undefined;
 let hold=true;
 globals.fetch=async(input:string,options?:RequestInit)=>{
   if(input.endsWith('/resolution-requests')&&hold){hold=false;return new Promise<Response>(resolve=>{releaseOld=resolve;});}
   return normalFetch(input,options);
 };
 await act(async()=>notifyResolutionRequestsChanged());
 requests=[{...card('spell-saving-throw'),kind:'ability-saving-throw',title:'Sopro elétrico',ability:'dexterity',actions:[{kind:'roll',actor:'owner',visibility:null}]}];
 await act(async()=>notifyResolutionRequestsChanged());
 check('salvaguarda de habilidade chega ao bloco Testes pela notificação',document.querySelectorAll('.combat-tests-panel [data-resolution-card="spell"]').length===1);
 check('nenhum formulário de salvaguarda flutua sobre a dock',!document.querySelector('.combat-dock-urgent .pending-effect-saves')&&!document.querySelector('.combat-dock-urgent button'));
 await act(async()=>releaseOld!(new Response(JSON.stringify({requests:[],combatId:'combat',at:'antiga'}),{status:200})));
 check('resposta antiga vazia não apaga solicitação recente',document.querySelectorAll('.combat-tests-panel [data-resolution-card="spell"]').length===1);
 await click('.combat-tests-panel .resolution-card-roll');
 check('rolagem reutiliza endpoint existente e remove o card resolvido',calls.some(c=>c.url==='/api/dice/roll'&&c.body.pendingEffectSaveId==='pending-spell')&&!document.querySelector('.combat-tests-panel .resolution-card'));
 check('não consulta formulário legado de salvaguardas da dock',!calls.some(c=>c.url.startsWith('/api/effects/pending/')));
 console.log(`✔ ${checks} verificações das salvaguardas no bloco Testes.`);
} finally {await act(async()=>root.unmount());dom.window.close();}
