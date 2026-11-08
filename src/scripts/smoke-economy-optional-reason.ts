/** Smoke de justificativa opcional; exige banco isolado com schema smoke_<nome>. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
async function main() {
const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');
assert.ok(schema?.startsWith('smoke_'));
const suffix = randomUUID().slice(0,8), users:string[]=[], creatures:string[]=[];
let combatId:string|undefined;
try {
 const master=await prisma.user.create({data:{username:'audit_m_'+suffix,displayName:'Mestre Auditoria',passwordHash:'fixture',role:'MASTER'}});users.push(master.id);
 const player=await prisma.user.create({data:{username:'audit_p_'+suffix,displayName:'Sentinela Auditoria',passwordHash:'fixture',role:'PLAYER'}});users.push(player.id);
 const hero=await prisma.character.create({data:{userId:player.id,name:'Sentinela Auditoria',raceId:'human',hpMax:10,hpCurrent:10}});
 const token=(u:typeof master)=>signToken({sub:u.id,username:u.username,displayName:u.displayName,role:u.role});
 async function http(path:string,body?:unknown,auth=token(master)){
  const response=await fetch(process.env.PLAYABLE_BASE_URL+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json() as any;assert.equal(response.status,200,JSON.stringify(data));return data;
 }
 assert.equal((await http('/characters/me',undefined,token(player))).character.id,hero.id);

 const monster=await prisma.creature.create({data:{name:'Criatura do menu',kind:'CREATURE',hpMax:30,hpCurrent:30,speed:9}});creatures.push(monster.id);
 const npc=await prisma.creature.create({data:{name:'NPC do menu',kind:'NPC',hpMax:30,hpCurrent:30,speed:9}});creatures.push(npc.id);
 const created=await prisma.combat.create({data:{status:'ACTIVE',round:1,turnSequence:1,combatants:{create:[
   {kind:'CHARACTER',characterId:hero.id,ownerUserId:player.id,name:hero.name,initiative:20,dexterityMod:0,turnEconomy:onTurnStart(9)},
   {kind:'CREATURE',creatureId:monster.id,name:monster.name,hpMax:30,hpCurrent:30,armorClass:10,initiative:10,dexterityMod:0,turnEconomy:onTurnStart(9)},
   {kind:'NPC',creatureId:npc.id,name:npc.name,hpMax:30,hpCurrent:30,armorClass:10,initiative:5,dexterityMod:0,turnEconomy:onTurnStart(9)},
 ]}},include:{combatants:true}});combatId=created.id;

 for(const target of created.combatants) {
  for(const [label, reason] of [['omitida',undefined],['vazia',''],['espaços','   '],['preenchida','  Ajuste combinado  ']] as const) {
   const before=(await http('/combat/active')).combat;
   const previous=before.combatants.find((item:any)=>item.id===target.id).turnEconomy.actionsGranted;
   const input: Record<string, unknown> = {combatId,combatantId:target.id,expectedVersion:before.version,operationId:randomUUID(),adjustment:'grant-action',...(reason===undefined?{}:{reason})};
   const result=await http('/combat/economy/override',input);
   const logged=label==='preenchida';
   assert.equal(result.combat.combatants.find((item:any)=>item.id===target.id).turnEconomy.actionsGranted,previous+1);
   assert.equal(result.combat.economyLog.length,before.economyLog.length+(logged?1:0));
   if(logged)assert.ok(result.combat.economyLog.at(-1).message.includes('Ajuste combinado'));
   const replay=await http('/combat/economy/override',input);assert.equal(replay.replayed,true);
   const saved=(await http('/combat/active')).combat;
   assert.equal(saved.combatants.find((item:any)=>item.id===target.id).turnEconomy.actionsGranted,previous+1);
   assert.equal(saved.economyLog.length,result.combat.economyLog.length);
   const stale=await fetch(process.env.PLAYABLE_BASE_URL+'/api/combat/economy/override',{method:'POST',headers:{Authorization:'Bearer '+token(master),'Content-Type':'application/json'},body:JSON.stringify({...input,operationId:randomUUID(),reason:'Não deve aparecer'})});assert.equal(stale.status,409);
   assert.equal((await http('/combat/active')).combat.economyLog.length,result.combat.economyLog.length);
   console.log('✔ '+target.kind+' / justificativa '+label+': recurso aplicado, registro correto, retry e conflito sem duplicação');
  }
  for(const adjustment of ['restore-action','restore-bonus','restore-reaction','set-movement']) {
   const before=(await http('/combat/active')).combat;
   const result=await http('/combat/economy/override',{combatId,combatantId:target.id,expectedVersion:before.version,operationId:randomUUID(),adjustment,...(adjustment==='set-movement'?{remaining:7.5}:{})});
   assert.equal(result.combat.economyLog.length,before.economyLog.length);
   const economy=result.combat.combatants.find((item:any)=>item.id===target.id).turnEconomy;
   if(adjustment==='restore-action')assert.equal(economy.actionsUsed,0);
   if(adjustment==='restore-bonus')assert.equal(economy.bonusActionUsed,false);
   if(adjustment==='restore-reaction')assert.equal(economy.reactionAvailable,true);
   if(adjustment==='set-movement')assert.equal(economy.movementBudget-economy.movementUsed,7.5);
  }
  const before=(await http('/combat/active')).combat;
  const input: Record<string, unknown> = {combatId,combatantId:target.id,expectedVersion:before.version,operationId:randomUUID(),adjustment:'grant-action'};
  const rejections: Array<[string, Record<string, unknown>, number]> = [[token(player),input,403],[token(master),{...input,reason:'a'.repeat(501)},400]];
  for(const [auth,body,expected] of rejections){
   const denied=await fetch(process.env.PLAYABLE_BASE_URL+'/api/combat/economy/override',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(denied.status,expected);
  }
  const after=(await http('/combat/active')).combat;assert.equal(after.version,before.version);assert.equal(after.economyLog.length,before.economyLog.length);
  console.log('✔ '+target.kind+': demais recursos sem registro, permissão e tamanho máximo preservados');
 }
}finally{
 if(combatId)await prisma.combat.delete({where:{id:combatId}});
 await prisma.creature.deleteMany({where:{id:{in:creatures}}});
 await prisma.character.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
}}
main().catch(error=>{console.error(error);process.exitCode=1});
