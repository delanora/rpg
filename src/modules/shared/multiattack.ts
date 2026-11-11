import type { CreatureAbility } from './creature-abilities.js';
import { spendEconomy, type TurnEconomy } from './action-economy.js';
import { HttpError } from '../../lib/http-error.js';

/** A definição é do cadastro; a transação grava o progresso por instância. */
export function beginMultiattack(state:TurnEconomy,ability:CreatureAbility,attacks:readonly {id:string;name:string}[],id:string):void {
  if(state.multiattack && state.multiattack.performed<state.multiattack.total)
    throw new HttpError('Conclua ou abandone os Ataques Múltiplos em andamento.',409,'MULTIATTACK_PENDING');
  const entries=ability.multiattack;
  if(ability.execution!=='multiattack'||!entries?.length||entries.some(item=>!attacks.some(attack=>attack.id===item.attackId)||item.attackId.startsWith('offhand:')))
    throw new HttpError('Revise os ataques cadastrados nesta habilidade.',409,'MULTIATTACK_DEFINITION_INVALID');
  spendEconomy(state,'action');
  state.multiattack={id,abilityId:ability.id,label:ability.name,attacks:entries.map(item=>({attackId:item.attackId,name:attacks.find(attack=>attack.id===item.attackId)!.name,remaining:item.count})),performed:0,total:entries.reduce((sum,item)=>sum+item.count,0)};
}

/** Um único golpe do pipeline normal; erro/retry não avança a sequência. */
export function recordMultiattack(state:TurnEconomy,id:string,attackId:string):void {
  const sequence=state.multiattack;
  const entry=sequence?.attacks.find(item=>item.attackId===attackId);
  if(!sequence || sequence.id!==id || !entry || entry.remaining<=0 || sequence.performed>=sequence.total)
    throw new HttpError('Este golpe não está disponível nos Ataques Múltiplos atuais.',409,'MULTIATTACK_ATTACK_UNAVAILABLE');
  entry.remaining--;sequence.performed++;
}
