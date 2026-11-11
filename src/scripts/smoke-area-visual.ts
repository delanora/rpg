/** Compartilhamento HTTP/WS com fixtures próprias e sentinela de banco descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { ServerEvents, type CombatAreaVisualPayload } from '../realtime/events.js';
async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema')??'',/^smoke_area_visual_/);
  const base=process.env.PLAYABLE_BASE_URL!;
  assert.equal(new URL(base).hostname,'127.0.0.1'); assert.equal(new URL(base).port,'3138');
  assert.equal(await prisma.user.count(),0); assert.equal(await prisma.combat.count(),0);
  const users:string[]=[]; let characterId:string|undefined,creatureId:string|undefined,combatId:string|undefined;
  let socket:ReturnType<typeof io>|undefined;
  try {
    const master=await prisma.user.create({data:{username:'master_'+randomUUID(),displayName:'Mestre fixture',passwordHash:'fixture',role:'MASTER'}}); users.push(master.id);
    const player=await prisma.user.create({data:{username:'player_'+randomUUID(),displayName:'Jogador fixture',passwordHash:'fixture',role:'PLAYER'}}); users.push(player.id);
    const hero=await prisma.character.create({data:{userId:player.id,name:'Sentinela visual'}}); characterId=hero.id;
    const token=(u:typeof player)=>signToken({sub:u.id,username:u.username,displayName:u.displayName,role:u.role});
    const http=async(path:string,body?:unknown,actor=master)=>{
      const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json() as any};
    };
    assert.equal((await http('/characters/me',undefined,player)).data.character.id,hero.id,'Sentinela HTTP/schema antes de ações');
    const ability={id:'raio',name:'Sopro elétrico',cost:'action',execution:'area-save-damage',maxUses:1,description:'Privada',area:{shape:{kind:'line',lengthFeet:60,widthFeet:5},rangeFeet:0,saveAbility:'dexterity',dc:17,onSuccess:'half',damage:[{type:'Elétrico',dice:{count:12,sides:10}}]}};
    const creature=await prisma.creature.create({data:{name:'Fonte isolada',abilities:[ability]}}); creatureId=creature.id;
    const combat=await prisma.combat.create({data:{status:'ACTIVE',spatialConfig:{mode:'grid-2d',widthFeet:100,heightFeet:100,cellSizeFeet:5}}}); combatId=combat.id;
    const unit=await prisma.combatant.create({data:{combatId,creatureId,kind:'CREATURE',name:'Fonte isolada',dexterityMod:0,initiative:20}});
    socket=io(base,{auth:{token:token(player)},transports:['websocket'],forceNew:true,reconnection:false});
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket indisponível')),3000);socket!.once('connect',()=>{clearTimeout(timer);resolve();});socket!.once('connect_error',reject);});
    const events:CombatAreaVisualPayload[]=[];socket.on(ServerEvents.COMBAT_AREA_VISUAL,p=>events.push(p));
    const path=`/combat/${combatId}/spatial/area-visual`;
    const input={previewId:randomUUID(),sequence:1,placement:{combatantId:unit.id,abilityId:'raio',origin:{xFeet:5,yFeet:5},angle:0.5}};
    const before=JSON.stringify(await prisma.combat.findUnique({where:{id:combatId},include:{combatants:true}}));
    assert.equal((await http(path,input,player)).status,403);
    assert.equal((await http(path,{...input,damageType:'Fogo'})).status,400,'Não aceita tipo de dano do cliente');
    assert.equal((await http(path,{...input,placement:{...input.placement,origin:{xFeet:101,yFeet:0}}})).status,400);
    const wait=async(count:number)=>{for(let i=0;i<30&&events.length<count;i++)await new Promise(r=>setTimeout(r,20));assert.equal(events.length,count);};
    const shared=await http(path,input); assert.equal(shared.status,200,JSON.stringify(shared)); await wait(1);
    assert.equal(events[0].area?.damageType,'Elétrico'); assert.deepEqual(events[0].area?.shape,ability.area.shape);
    assert.equal(events[0].area?.angle,0.5); assert.ok(events[0].expiresAt>Date.now());
    assert.deepEqual(Object.keys(events[0].area!).sort(),['angle','combatantId','damageType','origin','shape']);
    assert.equal(JSON.stringify(await prisma.combat.findUnique({where:{id:combatId},include:{combatants:true}})),before,'Prévia não altera versão/economia nem qualquer estado de combate');
    assert.equal((await http(path,input)).data.shared,false,'Retry não duplica evento');
    assert.equal((await http(path,{...input,sequence:0})).data.shared,false,'Fora de ordem é descartado');
    assert.equal((await http(path,{...input,sequence:2,placement:null})).status,200); await wait(2); assert.equal(events[1].area,null);
    assert.equal((await http(path,{...input,sequence:3})).data.shared,false,'Cancelamento é terminal para a sessão');
    await prisma.combatant.update({where:{id:unit.id},data:{spatialVisibility:'master-only'}});
    assert.equal((await http(path,{...input,previewId:randomUUID()})).status,200); await wait(3); assert.equal(events[2].area,null,'Ocultos não revelam origem, tipo, forma nem identidade');
    await prisma.combat.update({where:{id:combatId},data:{status:'ENDED'}});
    assert.equal((await http(path,{...input,previewId:randomUUID()})).status,409);
    console.log('✔ HTTP/WS: jogador recebe forma/cor canônicas, sem segredos ou escritas; permissões, cancelamento, ordem e ocultação verificados.');
  } finally {
    socket?.disconnect();
    if(combatId)await prisma.combat.deleteMany({where:{id:combatId}});
    if(creatureId)await prisma.creature.deleteMany({where:{id:creatureId}});
    if(characterId)await prisma.character.deleteMany({where:{id:characterId}});
    await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
