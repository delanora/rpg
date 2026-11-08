/** Mestre e dono resolvendo a mesma pendência: somente schema descartável. */
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {ServerEvents} from '../realtime/events.js';
import {randomUUID} from 'node:crypto';
import {prisma} from '../config/prisma.js';
import {signToken} from '../lib/jwt.js';
import {onTurnStart} from '../modules/shared/action-economy.js';
import {grantCastingComponents,seedSpellRepertoire} from './spell-slot-fixtures.js';
async function main(){
 assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema')??'',/^smoke_/);
 assert.ok(process.env.PLAYABLE_BASE_URL&&!process.env.PLAYABLE_BASE_URL.includes(':3000'));
 const users:string[]=[],ids:string[]=[];let combatId:string|undefined;let ownerSocket:ReturnType<typeof io>|undefined;
 const publicRolls=new Set<string>();
 const waitPublic=async(id:string)=>{for(let attempt=0;attempt<50&&!publicRolls.has(id);attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(publicRolls.has(id),'O dono deve receber a rolagem pública pelo socket')};
 try{
  const suffix=randomUUID();
  const user=async(role:'MASTER'|'PLAYER',label:string)=>{const row=await prisma.user.create({data:{username:label+suffix,displayName:label,passwordHash:'fixture',role}});users.push(row.id);return row};
  const master=await user('MASTER','Mestre fixture'),owner=await user('PLAYER','Dono fixture'),other=await user('PLAYER','Outro fixture');
  const token=(u:typeof master)=>signToken({sub:u.id,username:u.username,displayName:u.displayName,role:u.role});
  const request=async(path:string,body?:unknown,actor=master)=>{const response=await fetch(process.env.PLAYABLE_BASE_URL+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json() as any}};
  const hero=await prisma.character.create({data:{userId:owner.id,name:'Personagem assumido fixture',raceId:'human',hpMax:30,hpCurrent:0,speed:9,deathState:{successes:0,failures:0,deathSaves:true},classes:[{classKey:'fighter',level:1,subclass:''}]}});ids.push(hero.id);
  const caster=await prisma.character.create({data:{userId:other.id,name:'Conjurador fixture',raceId:'human',hpMax:30,hpCurrent:30,speed:9,classes:[{classKey:'cleric',level:20,subclass:''}]}});ids.push(caster.id);
  assert.equal((await request('/characters/me',undefined,owner)).data.character.id,hero.id,'Sentinela HTTP e banco devem coincidir');
  ownerSocket=io(process.env.PLAYABLE_BASE_URL!,{auth:{token:token(owner)},transports:['websocket'],forceNew:true,reconnection:false});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Socket da fixture indisponível')),3000);ownerSocket!.once('connect',()=>{clearTimeout(timeout);resolve()});ownerSocket!.once('connect_error',error=>{clearTimeout(timeout);reject(error)})});
  ownerSocket.on(ServerEvents.DICE_ROLL,payload=>{publicRolls.add(payload.roll.id)});

  const created=await prisma.combat.create({data:{status:'ACTIVE',round:1,turnSequence:1,currentIndex:0,combatants:{create:[
   {kind:'CHARACTER',characterId:hero.id,ownerUserId:owner.id,name:hero.name,initiative:20,dexterityMod:0,sideKey:'players',turnEconomy:onTurnStart(0)},
   {kind:'CHARACTER',characterId:caster.id,ownerUserId:other.id,name:caster.name,initiative:10,dexterityMod:0,sideKey:'players',turnEconomy:onTurnStart(9)},
  ]}},include:{combatants:true}});combatId=created.id;const unit=created.combatants.find(c=>c.characterId===hero.id)!;
  const entity={kind:'character',id:hero.id};
  const cards=async(actor=master)=>(await request(`/combat/${combatId}/resolution-requests`,undefined,actor)).data.requests;
  const deathInput=()=>({kind:'death-save',entity,dice:[{sides:20}],clientId:randomUUID()});
  const denied=await request('/dice/roll',deathInput(),other);assert.ok(denied.status>=400);
  const deathCards=await cards();assert.ok(deathCards.some((c:any)=>c.kind==='death-saving-throw'&&c.reference.entity.id===hero.id&&c.canResolve));
  const death=await request('/dice/roll',deathInput());assert.equal(death.status,201,JSON.stringify(death));assert.equal(death.data.roll.audience,'table');assert.equal(death.data.roll.isPrivate,false);
  assert.equal((await request('/dice/roll',deathInput(),owner)).status,409);
  assert.ok(!(await cards(owner)).some((c:any)=>c.kind==='death-saving-throw'));
  console.log('✔ Mestre resolve Teste contra a Morte público do personagem e a pendência some para o dono');
  await prisma.character.update({where:{id:hero.id},data:{hpCurrent:0,deathState:{successes:0,failures:0,deathSaves:true},mechanicalState:{conditions:[],exhaustionLevel:0,log:[]}}});
  await prisma.combat.update({where:{id:combatId},data:{round:2,turnSequence:2}});
  const deathRace=await Promise.all([request('/dice/roll',deathInput()),request('/dice/roll',deathInput(),owner)]);
  assert.deepEqual(deathRace.map(r=>r.status).sort(),[201,409]);
  assert.ok(!(await cards()).some((c:any)=>c.kind==='death-saving-throw'));
  console.log('✔ Mestre e jogador simultâneos aplicam somente um Teste contra a Morte');

  await prisma.character.update({where:{id:hero.id},data:{hpCurrent:30,deathState:{},mechanicalState:{conditions:[],exhaustionLevel:0,log:[]}}});
  await prisma.combatant.update({where:{id:unit.id},data:{turnEconomy:onTurnStart(9)}});
  const mechanical=async()=>(await request(`/mechanical/character/${hero.id}`)).data.mechanical;
  const queueConcentration=async()=>{
    const current=await mechanical();
    const start=await request('/mechanical/mutate',{entity,expectedVersion:current.version,expectedCombatVersion:current.combat?.version,operationId:randomUUID(),action:'concentrate',label:'Concentração fixture',visibility:'public'});
    assert.equal(start.status,200,JSON.stringify(start));
    const damage=await request('/combat/hp',{combatantId:unit.id,amount:2,mode:'damage'});assert.equal(damage.status,200);
    return (await mechanical()).state.pendingConcentrationSaves[0].id as string;
  };
  const concentrationInput=(pendingId:string)=>({kind:'concentration',entity,pendingConcentrationSaveId:pendingId,visibility:'public',dice:[{sides:20}],clientId:randomUUID()});
  let pendingId=await queueConcentration();
  assert.equal((await request('/dice/roll',concentrationInput(pendingId),other)).status,403);
  const concentration=await request('/dice/roll',concentrationInput(pendingId));assert.equal(concentration.status,201,JSON.stringify(concentration));await waitPublic(concentration.data.roll.id);assert.equal(concentration.data.roll.isPrivate,false);
  assert.equal((await mechanical()).state.pendingConcentrationSaves.length,0);
  assert.equal((await request('/dice/roll',concentrationInput(pendingId),owner)).status,409);
  pendingId=await queueConcentration();
  const concentrationRace=await Promise.all([request('/dice/roll',concentrationInput(pendingId)),request('/dice/roll',concentrationInput(pendingId),owner)]);
  assert.deepEqual(concentrationRace.map(r=>r.status).sort(),[201,409]);assert.equal((await mechanical()).state.pendingConcentrationSaves.length,0);
  console.log('✔ Concentração pública pode ser resolvida pelo Mestre, com concorrência e permissão preservadas');

  await grantCastingComponents({characters:[caster.id]});
  await seedSpellRepertoire({characterId:caster.id,classKey:'cleric',spellIds:['hold-person']});
  await prisma.combat.update({where:{id:combatId},data:{currentIndex:1,round:3,turnSequence:3}});
  const cast=await request('/effects/hold-person',{operationId:randomUUID(),caster:{kind:'character',id:caster.id},targets:[entity],castingResource:{kind:'spell-slot',level:2},spatialConfirmation:{withinRange:true,sight:true,clearPath:true,groupDistance:true}});
  assert.equal(cast.status,201,JSON.stringify(cast));
  const pending=await prisma.pendingEffectSave.findFirstOrThrow({where:{targetEntityId:hero.id,status:'pending'}});
  const saveInput=()=>({kind:'save',pendingEffectSaveId:pending.id,visibility:'public',dice:[{sides:20}],clientId:randomUUID()});
  const rollsBeforeSpell=publicRolls.size;
  const spellRace=await Promise.all([request('/dice/roll',saveInput()),request('/dice/roll',saveInput(),owner)]);
  assert.deepEqual(spellRace.map(r=>r.status).sort(),[201,409]);
  await waitPublic(spellRace.find(r=>r.status===201)!.data.roll.id);
  assert.equal(publicRolls.size,rollsBeforeSpell+1,'A disputa deve publicar somente uma rolagem');
  assert.equal((await prisma.pendingEffectSave.findUniqueOrThrow({where:{id:pending.id}})).status,'resolved');
  assert.ok(!(await cards(owner)).some((c:any)=>c.reference.pendingId===pending.id));
  console.log('✔ Salvaguarda de magia aceita Mestre/dono e resolve uma única vez, sem card restante');
 }finally{
  ownerSocket?.disconnect();
  await prisma.effectInstance.deleteMany({where:{OR:[{sourceEntityId:{in:ids}},{targetEntityId:{in:ids}}]}});
  await prisma.pendingEffectSave.deleteMany({where:{targetEntityId:{in:ids}}});
  await prisma.spellCast.deleteMany({where:{casterEntityId:{in:ids}}});
  if(combatId)await prisma.combat.delete({where:{id:combatId}});
  await prisma.character.deleteMany({where:{id:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
