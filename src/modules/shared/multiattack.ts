import { canComposeAbility, type CreatureAbility } from './creature-abilities.js';
import { spendEconomy, type TurnEconomy } from './action-economy.js';
import { HttpError } from '../../lib/http-error.js';

/** A definição é do cadastro; a transação grava o progresso por instância. */
export function beginMultiattack(state:TurnEconomy,ability:CreatureAbility,attacks:readonly {id:string;name:string}[],id:string,abilities:readonly CreatureAbility[]=[],uses:Readonly<Record<string,number>>={}):void {
  if(state.multiattack && state.multiattack.performed<state.multiattack.total)
    throw new HttpError('Conclua ou abandone os Ataques Múltiplos em andamento.',409,'MULTIATTACK_PENDING');
  const entries=ability.multiattack;
  if(ability.execution!=='multiattack'||!entries?.length||entries.some(item=>item.kind==='ability'?!abilities.some(option=>option.id===item.attackId&&option.id!==ability.id&&canComposeAbility(option)):!attacks.some(attack=>attack.id===item.attackId)||item.attackId.startsWith('offhand:')))
    throw new HttpError('Revise os ataques cadastrados nesta habilidade.',409,'MULTIATTACK_DEFINITION_INVALID');
  for(const entry of entries.filter(item=>item.kind==='ability')){const option=abilities.find(item=>item.id===entry.attackId)!;if(option.maxUses!==null&&(uses[option.id]??0)+entry.count>option.maxUses)throw new HttpError('Usos insuficientes para a habilidade da composição.',409,'MULTIATTACK_ABILITY_EXHAUSTED');}
  spendEconomy(state,'action');
  state.multiattack={id,abilityId:ability.id,label:ability.name,attacks:entries.map(item=>({attackId:item.attackId,...(item.kind==='ability'?{kind:'ability' as const}:{}),name:(item.kind==='ability'?abilities:attacks).find(option=>option.id===item.attackId)!.name,remaining:item.count})),performed:0,total:entries.reduce((sum,item)=>sum+item.count,0)};
}

/** Um único golpe do pipeline normal; erro/retry não avança a sequência. */
export function recordMultiattack(state:TurnEconomy,id:string,attackId:string,kind:'attack'|'ability'='attack'):void {
  const sequence=state.multiattack;
  const entry=sequence?.attacks.find(item=>item.attackId===attackId&&(item.kind??'attack')===kind);
  if(!sequence || sequence.id!==id || !entry || entry.remaining<=0 || sequence.performed>=sequence.total)
    throw new HttpError('Este golpe não está disponível nos Ataques Múltiplos atuais.',409,'MULTIATTACK_ATTACK_UNAVAILABLE');
  entry.remaining--;sequence.performed++;
}
