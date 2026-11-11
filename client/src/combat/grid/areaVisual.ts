import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { createOperationId } from '../../utils';
import type { CombatAreaVisualPayload } from '../../../../src/modules/shared/area-visual';

type Placement={combatantId:string;abilityId:string;origin:{xFeet:number;yFeet:number};angle:number};
const listeners=new Set<(value:CombatAreaVisualPayload)=>void>();
export function publishAreaVisual(value:CombatAreaVisualPayload) { for(const receive of listeners) receive(value); }

/** Limita o envio a quatro atualizações/s e mantém a prévia viva enquanto estiver aberta. */
export function useShareAreaVisual(combatId:string|undefined,scope:string,placement:Placement|null) {
  const [error,setError]=useState<string|null>(null);
  const latest=useRef(placement); latest.current=placement;
  const active=!!placement;
  useEffect(()=>{
    if(!combatId || !active) return;
    setError(null);
    const previewId=createOperationId();
    // O fallback de operationId não é necessariamente UUID; o contrato aceita a mesma chave.
    let sequence=0, last='', stopped=false;
    const send=(value:Placement|null)=>{
      void api(`/api/combat/${encodeURIComponent(combatId)}/spatial/area-visual`,{method:'POST',body:{previewId,sequence:++sequence,placement:value}}).then(()=>{if(!stopped)setError(null);}).catch(()=>{if(!stopped)setError('Não foi possível compartilhar a prévia. Tentando reconectar…');});
    };
    let heartbeat=0;
    const tick=()=>{
      if(stopped)return;
      const value=latest.current, serialized=JSON.stringify(value);
      if(serialized!==last || ++heartbeat>=8) {last=serialized;heartbeat=0;send(value);}
    };
    tick();
    const timer=setInterval(tick,250);
    return ()=>{stopped=true;clearInterval(timer);send(null);};
  },[combatId,scope,active]);
  return error;
}

/** Prévia efêmera ordenada: cancelamentos atrasados nunca reabrem o mesmo desenho. */
export function useAreaVisuals(combatId:string) {
  const [values,setValues]=useState<CombatAreaVisualPayload[]>([]);
  useEffect(()=>{
    const received=new Map<string,CombatAreaVisualPayload>();
    const update=()=>setValues([...received.values()].filter(v=>v.area && v.expiresAt>Date.now()));
    const receive=(value:CombatAreaVisualPayload)=>{
      if(value.combatId!==combatId)return;
      const previous=received.get(value.previewId);
      if(previous && previous.sequence>=value.sequence)return;
      received.set(value.previewId,value);
      if(received.size>64)received.delete(received.keys().next().value!);
      update();
    };
    listeners.add(receive); setValues([]);
    const timer=setInterval(()=>{
      for(const [key,value] of received)if(value.expiresAt+30_000<Date.now())received.delete(key);
      update();
    },500);
    return ()=>{listeners.delete(receive);clearInterval(timer);};
  },[combatId]);
  return values;
}
