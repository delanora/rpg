import { useState } from 'react';
import type { CombatDto, CombatantDto, CreatureAbility } from '../../types';
import { nextTurn, passLegendaryAction, setLegendarySurprise, useLegendaryAction } from '../combatApi';
import { Icon } from '../../components/Icon';
import './legendary-actions.css';

type Run=(action:()=>Promise<CombatDto>)=>void;
function LegendaryChoice({combat,unit,busy,onRun,onPrepareArea}:{combat:CombatDto;unit:CombatantDto;busy:boolean;onRun:Run;onPrepareArea?:(id:string,ability:CreatureAbility)=>void}) {
 const options=(unit.abilities??[]).filter(ability=>ability.cost==='legendary');
 const [abilityId,setAbilityId]=useState(options[0]?.id??'');
 const [targetId,setTargetId]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const ability=options.find(item=>item.id===abilityId);
 const pool=unit.legendary;
 const remaining=Math.max(0,(pool?.max??0)-(pool?.used??0));
 const available=(unit.hpCurrent??0)>0&&!unit.deathBlocksActions&&unit.conditionEffects.canAct&&(!pool?.surprised||pool.firstTurnEnded);
 const window=combat.legendaryWindow!;
 const decided=window.decidedIds.includes(unit.id);
 const attack=ability?.execution==='legendary-attack';
 const area=ability?.execution==='area-save-damage';
 return <article className="legendary-choice">
  <header><strong>{unit.name}</strong><span>{remaining}/{pool?.max??0} disponíveis</span></header>
  {decided?<p>Decisão concluída nesta janela.</p>:<>
   <label>Opção<select aria-label={`Ação Lendária de ${unit.name}`} value={abilityId} disabled={busy} onChange={event=>{setAbilityId(event.target.value);setConfirmed(false);}}>
    {options.map(option=><option key={option.id} value={option.id}>{option.name} · custo {option.legendaryCost}</option>)}
   </select></label>
   {ability?.description?<p>{ability.description}</p>:null}
   {attack?<label>Alvo<select aria-label={`Alvo da Ação Lendária de ${unit.name}`} value={targetId} disabled={busy} onChange={event=>setTargetId(event.target.value)}>
    <option value="">Escolha o alvo</option>{combat.combatants.filter(target=>target.id!==unit.id&&!target.missing).map(target=><option key={target.id} value={target.id}>{target.name}</option>)}
   </select></label>:area?<p>Posicione a área e escolha os alvos no grid antes de confirmar.</p>:<label className="legendary-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/> Confirmo as condições e resolvo o efeito de forma assistida.</label>}
   {!pool?.firstTurnEnded?<label className="legendary-confirm"><input type="checkbox" checked={pool?.surprised??false} disabled={busy} onChange={event=>onRun(()=>setLegendarySurprise(combat,unit.id,event.target.checked))}/> Surpresa inicial — não pode usar até encerrar o primeiro turno</label>:null}
   {!available?<p role="status">Esta criatura não pode agir nesta janela.</p>:null}
   <div className="legendary-buttons">
    <button className="btn btn-small btn-primary" disabled={busy||!available||!ability||(ability.legendaryCost??Infinity)>remaining||(attack?!targetId:area?!onPrepareArea:!confirmed)} onClick={()=>area&&ability?onPrepareArea?.(unit.id,ability):onRun(()=>useLegendaryAction(combat,{windowId:window.id,combatantId:unit.id,abilityId,...(attack?{targetCombatantId:targetId}:{confirmed:true})}))}>Usar {ability?.name??'opção'}</button>
    <button className="btn btn-small" disabled={busy} onClick={()=>onRun(()=>passLegendaryAction(combat,window.id,unit.id))}>Não usar nesta janela</button>
   </div>
  </>}
 </article>;
}
/** A fronteira pertence ao servidor; o próximo turno ainda não começou. */
export function LegendaryActionsPanel({combat,busy,onRun,onPrepareArea}:{combat:CombatDto;busy:boolean;onRun:Run;onPrepareArea?:(id:string,ability:CreatureAbility)=>void}) {
 const window=combat.legendaryWindow;
 if(!window)return null;
 const pending=window.candidateIds.filter(id=>!window.decidedIds.includes(id));
 return <section className="legendary-actions-panel" aria-label="Janela de Ações Lendárias">
  <h3><Icon name="crown" size={16}/> Ações Lendárias</h3>
  <p>Fim do turno. Escolha uma opção por criatura ou continue sem usar as restantes.</p>
  <div className="legendary-choices">{window.candidateIds.map(id=>{const unit=combat.combatants.find(item=>item.id===id);return unit?<LegendaryChoice key={`${window.id}:${id}`} combat={combat} unit={unit} busy={busy} onRun={onRun} onPrepareArea={onPrepareArea}/>:null;})}</div>
  <button className="btn btn-primary" disabled={busy} onClick={()=>onRun(()=>nextTurn(combat,{skipLegendary:true}))}>{pending.length?'Continuar sem usar restantes':'Iniciar próximo turno'} →</button>
 </section>;
}
