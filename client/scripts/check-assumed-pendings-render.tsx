/** Turno assumido: interação React real, sem rede nem dados da campanha. */
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
const {assumedCharacterFor}=await import('../src/combat/turnControl');
const {pendingsForCharacter}=await import('../src/combat/components/AssumedCharacterPendings');
import type {CombatDto,CombatResolutionCardDto,SessionUser} from '../src/types';
const master:SessionUser={id:'master',username:'mestre',displayName:'Mestre',role:'MASTER'};
const makeUnit=(id:string,characterId:string)=>({id,characterId,creatureId:null,ownerUserId:id+'-owner',name:id==='hero'?'Herói':'Outro',kind:'CHARACTER',hpCurrent:10,hpMax:10,armorClass:12,effectiveSpeed:9,deathState:deathStateOf({}),deathBlocksActions:false,mechanicalState:mechanicalStateOf({}),conditionEffects:{...deriveConditionEffects(mechanicalStateOf({})),labels:CONDITION_LABELS},mechanicalVersion:1,turnEconomy:onTurnStart(9),rolled:true,initiative:20,dexterityMod:0,statsHidden:false,missing:false,spatialVisibility:'public',spatial:null});
let serverCombat={id:'combat',version:1,status:'ACTIVE',round:1,currentIndex:0,currentCombatantId:'hero',economyLog:[],combatants:[makeUnit('hero','sheet'),makeUnit('other','other-sheet')],spatial:{mode:'assisted',widthFeet:100,heightFeet:100,cellSizeFeet:5},sceneBackgroundImageUrl:null} as unknown as CombatDto;
serverCombat.combatants[0].mechanicalState.pendingConcentrationSaves=[{id:'concentration-save',damage:2,dc:10,sourceName:'Fixture'}] as never;
const card=(kind:'spell-saving-throw'|'death-saving-throw'):CombatResolutionCardDto=>({id:kind==='spell-saving-throw'?'spell':'death',kind,status:'pending',target:{kind:'character',id:'sheet',name:'Herói',ownerUserId:'hero-owner'},title:kind==='spell-saving-throw'?'Salvaguarda de magia':'Teste contra a Morte',shortDescription:null,ability:kind==='spell-saving-throw'?'wisdom':null,phase:kind==='spell-saving-throw'?'initial':null,optional:false,canResolve:true,actions:kind==='spell-saving-throw'?[{kind:'roll',actor:'master',visibility:'public'},{kind:'roll',actor:'master',visibility:'private'}]:[{kind:'roll',actor:'master',visibility:null}],presentation:{tone:kind==='spell-saving-throw'?'arcane':'peril',icon:kind==='spell-saving-throw'?'sparkle':'skull'},counters:kind==='spell-saving-throw'?null:{successes:0,failures:0,stabilized:false},reference:{entity:{kind:'character',id:'sheet'},pendingId:kind==='spell-saving-throw'?'pending-spell':null},createdAt:'fixture'} as CombatResolutionCardDto);
let requests=[card('spell-saving-throw')];
const calls:{url:string;body:any}[]=[];let resolveElsewhere=false;const reportedErrors:string[]=[];
globals.fetch=async(url:string,options:RequestInit={})=>{
 const body=options.body?JSON.parse(String(options.body)):undefined;calls.push({url,body});
 let value:any;
 if(url==='/api/auth/me')value={user:master};
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
let setCombat:(combat:CombatDto)=>void=()=>{};
function Harness(){const [combat,update]=useState(serverCombat);setCombat=update;return h(AuthProvider,null,h(CombatTracker,{combat,user:master,log:[],turnAlert:null,onCombatChange:update,onCombatEnd:()=>{},onError:message=>{reportedErrors.push(message)}}));}
const root=createRoot(document.getElementById('root')!);let checks=0;
const check=(label:string,ok:unknown)=>{assert.ok(ok,label);checks++;console.log('✔ '+label)};
const click=async(selector:string)=>{const button=document.querySelector<HTMLButtonElement>(selector);assert.ok(button,selector);await act(async()=>button.click())};
try{
 check('assunção exige Mestre, personagem e chave do turno atual',!!assumedCharacterFor(serverCombat.combatants[0],master,'combat:1:0','combat:1:0')&&!assumedCharacterFor(serverCombat.combatants[0],{...master,role:'PLAYER'},'combat:1:0','combat:1:0')&&!assumedCharacterFor(serverCombat.combatants[0],master,'combat:1:0','combat:2:0'));
 check('pendências são filtradas por ficha/instância, sem misturar outro jogador',pendingsForCharacter(requests,serverCombat.combatants[0]).length===1&&pendingsForCharacter(requests,serverCombat.combatants[1]).length===0);
 await act(async()=>root.render(h(Harness)));
 check('antes de assumir, não existe painel do personagem no contexto',!document.querySelector('.assumed-character-pendings'));
 await click('.combat-assume-turn');
 check('assumir mostra concentração e salvaguarda no contexto',!!document.querySelector('.assumed-character-pendings .concentration-panel')&&!!document.querySelector('.assumed-character-pendings [data-resolution-card="spell"]'));
 serverCombat={...serverCombat,currentIndex:1,version:serverCombat.version+1};
 await act(async()=>setCombat(serverCombat));
 check('reindexação por reforços preserva o controle do mesmo personagem',document.querySelector('.combat-assume-turn')?.getAttribute('aria-pressed')==='true'&&!!document.querySelector('.assumed-character-pendings'));
 check('card assumido não fica duplicado no registro',document.querySelectorAll('[data-resolution-card="spell"]').length===1);
 check('rolagens do personagem assumido não oferecem audiência privada',![...document.querySelectorAll('.assumed-character-pendings button')].some(button=>button.textContent?.includes('privado')));
 await click('.combat-assume-turn');
 check('encerrar controle devolve os cards ao registro sem duplicar', !document.querySelector('.assumed-character-pendings')&&document.querySelectorAll('[data-resolution-card="spell"]').length===1);
 await click('.combat-assume-turn');

 await click('.assumed-character-pendings .concentration-panel button');
 check('Mestre resolve concentração da ficha correta publicamente',calls.some(call=>call.url==='/api/dice/roll'&&call.body.kind==='concentration'&&call.body.entity.kind==='character'&&call.body.visibility==='public'));
 check('concentração resolvida some sem recarregar',!document.querySelector('.assumed-character-pendings .concentration-panel'));
 await click('.assumed-character-pendings .resolution-card-roll');
 check('salvaguarda usa a pendência original e audiência pública',calls.some(call=>call.body?.pendingEffectSaveId==='pending-spell'&&call.body.visibility==='public'));
 check('sem pendências a área de avisos desaparece',!document.querySelector('.assumed-character-pendings'));
 serverCombat={...serverCombat,round:2,version:serverCombat.version+1};requests=[card('spell-saving-throw')];
 await act(async()=>setCombat(serverCombat));
 check('assunção não reaparece automaticamente na rodada seguinte',document.querySelector('.combat-assume-turn')?.getAttribute('aria-pressed')==='false'&&!document.querySelector('.assumed-character-pendings'));
 serverCombat={...serverCombat,round:3,version:serverCombat.version+1,combatants:serverCombat.combatants.map((unit,index)=>index?unit:{...unit,hpCurrent:0,deathBlocksActions:true,deathState:deathStateOf({deathSaves:true}),turnEconomy:onTurnStart(0)})};requests=[card('death-saving-throw')];
 await act(async()=>setCombat(serverCombat));
 check('botão de assumir permanece disponível a zero PV',!!document.querySelector('.combat-assume-turn'));
 await click('.combat-assume-turn');
 check('Mestre recebe o Teste contra a Morte ao assumir',document.querySelectorAll('[data-resolution-card="death"]').length===1&&!!document.querySelector('.assumed-character-pendings [data-resolution-card="death"]'));
 await click('.assumed-character-pendings .resolution-card-roll');
 check('teste contra a morte usa a rota existente para a ficha assumida',calls.some(call=>call.body?.kind==='death-save'&&call.body.entity.id==='sheet'));
 check('teste resolvido deixa de ser perguntado',!document.querySelector('[data-resolution-card="death"]'));
 check('fluxos normais não produzem erros',reportedErrors.length===0);
 serverCombat={...serverCombat,round:4,version:serverCombat.version+1,combatants:serverCombat.combatants.map((unit,index)=>index?unit:{...unit,hpCurrent:10,deathBlocksActions:false,deathState:deathStateOf({}),mechanicalState:{...mechanicalStateOf({}),pendingConcentrationSaves:[{id:'resolved-elsewhere',damage:2,dc:10}] as never}})};
 await act(async()=>setCombat(serverCombat));await click('.combat-assume-turn');
 resolveElsewhere=true;
 await click('.assumed-character-pendings .concentration-panel button');
 check('resposta de outro usuário remove o aviso após conflito, sem esperar socket',reportedErrors.at(-1)==='Este teste já foi resolvido.'&&!document.querySelector('.assumed-character-pendings'));

}finally{await act(async()=>root.unmount());dom.window.close()}
console.log(`${checks} verificações de turno assumido aprovadas.`);
