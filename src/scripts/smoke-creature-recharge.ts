/** HTTP e persistência de recarga: somente fixtures próprias em schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';

async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^smoke_recharge_/);
  const base = process.env.PLAYABLE_BASE_URL!;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  assert.equal(new URL(base).port, '3137');
  assert.equal(await prisma.user.count(), 0);
  assert.equal(await prisma.combat.count(), 0);
  const users: string[] = [];
  let characterId: string | undefined, creatureId: string | undefined, combatId: string | undefined;
  try {
    const master = await prisma.user.create({data:{username:'master_'+randomUUID(),passwordHash:'fixture',displayName:'Mestre fixture',role:'MASTER'}});
    users.push(master.id);
    const player = await prisma.user.create({data:{username:'player_'+randomUUID(),passwordHash:'fixture',displayName:'Jogador fixture',role:'PLAYER'}});
    users.push(player.id);
    const hero = await prisma.character.create({data:{userId:player.id,name:'Sentinela recarga',hpMax:30,hpCurrent:30}});
    characterId = hero.id;
    const token = (u: typeof master) => signToken({sub:u.id,username:u.username,displayName:u.displayName,role:u.role});
    const http = async (path:string, body?:unknown, actor=master) => {
      const response = await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json() as any};
    };
    assert.equal((await http('/characters/me',undefined,player)).data.character.id, hero.id, 'Sentinela deve comprovar HTTP e schema idênticos antes de ações');
    const creature = await prisma.creature.create({data:{name:'Fonte de recarga isolada',hpMax:30,hpCurrent:30,abilities:[
      {id:'sopro',name:'Sopro isolado',cost:'action',execution:'assisted',maxUses:1,recharge:{minimum:1}},
      {id:'espera',name:'Recarga variável',cost:'bonus-action',execution:'assisted',maxUses:1,recharge:{minimum:6}},
      {id:'limitada',name:'Limitada',cost:'action',execution:'assisted',maxUses:2},
    ]}});
    creatureId = creature.id;
    const combat = await prisma.combat.create({data:{status:'ACTIVE',turnSequence:1,currentIndex:0}});
    combatId = combat.id;
    const leader = await prisma.combatant.create({data:{combatId,kind:'CHARACTER',characterId:hero.id,ownerUserId:player.id,name:hero.name,dexterityMod:0,initiative:30,turnEconomy:onTurnStart(9)}});
    const createCopy = (name:string, initiative:number) => prisma.combatant.create({data:{combatId:combat.id,kind:'CREATURE',creatureId:creature.id,name,dexterityMod:0,initiative,hpMax:30,hpCurrent:30,abilityUses:{sopro:1,espera:1,limitada:2},turnEconomy:onTurnStart(9)}});
    const first = await createCopy('Cópia um',20);
    const second = await createCopy('Cópia dois',10);
    await prisma.combatant.update({where:{id:second.id},data:{kind:'NPC',spatialVisibility:'master-only'}});
    const dead = await createCopy('Cópia morta',25);
    await prisma.combatant.update({where:{id:dead.id},data:{hpCurrent:0,deathState:{dead:true}}});
    let dto = (await http('/combat/active')).data.combat;
    const request = {combatId,expectedVersion:dto.version,operationId:randomUUID()};
    const next = await http('/combat/next-turn',request);
    assert.equal(next.status,200,JSON.stringify(next));
    dto = next.data.combat;
    assert.equal(dto.currentCombatantId,first.id);
    const stored = await prisma.combatant.findUniqueOrThrow({where:{id:first.id}});
    const uses = stored.abilityUses as Record<string,number>;
    assert.equal(uses.sopro,0);
    assert.equal(uses.limitada,2);
    const logs = dto.economyLog.filter((e:any)=>e.action==='creature-recharge');
    assert.equal(logs.length,2);
    const rolled = Number(logs.find((e:any)=>e.message.startsWith('Recarga variável')).message.match(/1d6 = (\d)/)[1]);
    assert.equal(uses.espera,rolled===6?0:1,'Resultado e disponibilidade precisam coincidir para qualquer face');
    assert.deepEqual((await prisma.combatant.findUniqueOrThrow({where:{id:second.id}})).abilityUses,{sopro:1,espera:1,limitada:2});
    const retry = await http('/combat/next-turn',request);
    assert.equal(retry.status,200);
    assert.deepEqual(retry.data.combat,dto,'Retry não avança nem rola novamente');
    assert.equal((await http('/combat/next-turn',{...request,operationId:randomUUID()})).status,409);
    assert.deepEqual((await http('/combat/active')).data.combat,dto,'Leitura não recarrega');
    assert.equal((await http('/combat/active',undefined,player)).data.combat.economyLog.filter((e:any)=>e.action==='creature-recharge').length,0,'Saldos e recarga são privados do Mestre');
    const use = await http('/combat/creature-ability',{combatId,expectedVersion:dto.version,operationId:randomUUID(),combatantId:first.id,abilityId:'sopro',confirmed:true});
    assert.equal(use.status,200,JSON.stringify(use));
    dto=use.data.combat;
    assert.equal(dto.combatants.find((c:any)=>c.id===first.id).abilityUses.sopro,1);
    const exhausted = await http('/combat/creature-ability',{combatId,expectedVersion:dto.version,operationId:randomUUID(),combatantId:first.id,abilityId:'sopro',confirmed:true});
    assert.equal(exhausted.status,409);
    // Remover o combatente atual deve ativar a recarga do próximo, na mesma transação.
    const removed = await http('/combat/participants/remove',{combatId,expectedVersion:dto.version,operationId:randomUUID(),combatantId:first.id});
    assert.equal(removed.status,200,JSON.stringify(removed));
    dto=removed.data.combat;
    assert.equal(dto.currentCombatantId,second.id);
    assert.equal(dto.combatants.find((c:any)=>c.id===second.id).abilityUses.sopro,0);
    // Disponível não rola novamente no turno seguinte; habilidades sem recarga nunca restauram.
    for(let i=0;i<2;i++) {
      const step=await http('/combat/next-turn',{combatId,expectedVersion:dto.version,operationId:randomUUID()});
      assert.equal(step.status,200,JSON.stringify(step)); dto=step.data.combat;
    }
    assert.equal(dto.currentCombatantId,second.id);
    assert.equal(dto.economyLog.filter((e:any)=>e.action==='creature-recharge'&&e.actorName===second.name&&e.message.startsWith('Sopro')).length,1);
    assert.equal(dto.combatants.find((c:any)=>c.id===second.id).abilityUses.limitada,2);
    assert.equal(dto.economyLog.filter((e:any)=>e.action==='creature-recharge'&&e.actorName===dead.name).length,0,'Mortos sem turno não rolam recarga');
    // Corrida de dois comandos: só um turno e uma tentativa podem ser confirmados.
    const version=dto.version;
    const raced=await Promise.all([1,2].map(()=>http('/combat/next-turn',{combatId,expectedVersion:version,operationId:randomUUID()})));
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
    dto=raced.find(r=>r.status===200)!.data.combat;
    assert.equal(dto.currentCombatantId,leader.id);
    // Reforço antecipado também ativa um turno verdadeiro e sua própria recarga.
    const extra=await createCopy('Reforço antecipado',40);
    await prisma.combatant.update({where:{id:extra.id},data:{firstTurnPending:true}});
    await prisma.combat.update({where:{id:combatId},data:{currentIndex:1,version:{increment:1}}});
    dto=(await http('/combat/active')).data.combat;
    const advance=await http('/combat/next-turn',{combatId,expectedVersion:dto.version,operationId:randomUUID(),extraCombatantId:extra.id});
    assert.equal(advance.status,200,JSON.stringify(advance));
    assert.equal(advance.data.combat.currentCombatantId,extra.id);
    assert.equal(advance.data.combat.combatants.find((c:any)=>c.id===extra.id).abilityUses.sopro,0);
    // Finalizar a iniciativa só recarrega depois de ativar o primeiro turno.
    await prisma.combat.delete({where:{id:combatId}});
    const initial=await prisma.combat.create({data:{status:'PENDING_INITIATIVE'}}); combatId=initial.id;
    const starter=await prisma.combatant.create({data:{combatId,kind:'NPC',creatureId:creature.id,name:'Primeiro turno',dexterityMod:100,initiative:null,hpMax:30,hpCurrent:30,abilityUses:{sopro:1},turnEconomy:onTurnStart(9)}});
    assert.equal((await http('/combat/active')).data.combat.economyLog.length,0);
    const initiative=await http('/combat/initiative/'+starter.id,{});
    assert.equal(initiative.status,200,JSON.stringify(initiative));
    assert.equal(initiative.data.combat.status,'ACTIVE');
    assert.equal(initiative.data.combat.combatants[0].abilityUses.sopro,0);
    assert.equal(initiative.data.combat.economyLog.filter((e:any)=>e.action==='creature-recharge').length,1);

    console.log('✔ HTTP: consumo, recarga por cópia, journal, privacidade, retry, versão, remoção e disponibilidade.');
  } finally {
    if(combatId) await prisma.combat.deleteMany({where:{id:combatId}});
    if(creatureId) await prisma.creature.deleteMany({where:{id:creatureId}});
    if(characterId) await prisma.character.deleteMany({where:{id:characterId}});
    await prisma.user.deleteMany({where:{id:{in:users}}});
    await prisma.$disconnect();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
