import { CreatureAreaFields, defaultCreatureArea } from './CreatureAreaFields';
import { useEffect, useRef, useState } from 'react';
import type { CreatureAbility } from '../../types';
import {
  creatureAbilitySchema,
  creatureRechargeLabel,
  CREATURE_ABILITY_COST_LABELS as ABILITY_COST_LABELS,
} from '../../../../src/modules/shared/creature-abilities';
import { createOperationId } from '../../utils';

export function CreatureAbilitiesEditor({
  abilities,
  onChange,
  onEditingChange,
  attacks = [],
}: {
  abilities: CreatureAbility[];
  attacks?: {id:string;name:string}[];
  onChange: (value: CreatureAbility[]) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<CreatureAbility | null>(null);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft)
      formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [draft?.id]);
  function edit(value: CreatureAbility | null) {
    setDraft(value);
    setError('');
    onEditingChange(value !== null);
  }
  function save() {
    const parsed = creatureAbilitySchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if(parsed.data.execution==='multiattack' && parsed.data.multiattack?.some(item=>!attacks.some(attack=>attack.id===item.attackId))) {
      setError('Selecione ataques existentes no cadastro da criatura.'); return;
    }
    onChange(
      abilities.some((item) => item.id === parsed.data.id)
        ? abilities.map((item) =>
            item.id === parsed.data.id ? parsed.data : item,
          )
        : [...abilities, parsed.data],
    );
    edit(null);
  }
  return (
    <div className="creature-attacks">
      <div className="creature-section-heading">
        <p>
          Cadastre opções especiais e características. Cada cópia controla seus
          próprios usos.
        </p>
        <button
          type="button"
          className="btn btn-small"
          disabled={!!draft}
          onClick={() =>
            edit({
              id: createOperationId(),
              name: '',
              description: '',
              cost: 'action',
              execution: 'assisted',
              trigger: '',
              maxUses: null,
            })
          }
        >
          Adicionar habilidade
        </button>
      </div>
      {!draft ? (
        <div
          className="creature-card-actions"
          aria-label="Modelos de habilidade"
        >
          <span>Começar com:</span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              edit({
                id: createOperationId(),
                name: 'Desengajar',
                cost: 'bonus-action',
                execution: 'disengage',
                description: 'Esta criatura pode Desengajar como ação bônus.',
                trigger: '',
                maxUses: null,
              })
            }
          >
            Desengajar como bônus
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              edit({
                id: createOperationId(),
                name: 'Esconder-se',
                cost: 'bonus-action',
                execution: 'assisted',
                description:
                  'Esta criatura pode tentar se esconder como ação bônus. O Mestre verifica as circunstâncias e resolve o teste.',
                trigger: '',
                maxUses: null,
              })
            }
          >
            Esconder-se como bônus
          </button>
        </div>
      ) : null}
      {!abilities.length && !draft ? (
        <p className="empty-hint">
          Exemplos: Desengajar como ação bônus, Esconder-se ou uma
          característica passiva.
        </p>
      ) : null}
      {abilities.map((item) => (
        <article className="creature-attack-card" key={item.id}>
          <div>
            <h4>{item.name}</h4>
            <p>
              {ABILITY_COST_LABELS[item.cost]} ·{' '}
              {item.execution === 'assisted'
                ? item.cost === 'passive'
                  ? 'Consulta'
                  : 'Assistida'
                : 'Automática'}{' '}
              ·{' '}
              {item.recharge ? creatureRechargeLabel(item.recharge.minimum) : item.maxUses === null
                ? 'Sem limite de usos'
                : `${item.maxUses} usos por combate`}
            </p>
            <p>{item.description}</p>
            {item.execution==='multiattack'?<p>{item.multiattack?.map(entry=>`${entry.count}× ${attacks.find(attack=>attack.id===entry.attackId)?.name??'Ataque removido'}`).join(' · ')}</p>:null}
          </div>
          <button
            className="btn btn-small"
            type="button"
            disabled={!!draft}
            onClick={() => edit({ ...item })}
          >
            Editar habilidade
          </button>
        </article>
      ))}
      {draft ? (
        <div className="creature-attack-form" ref={formRef}>
          <div className="creature-form-grid">
            <label>
              Nome da habilidade
              <input
                aria-label="Nome da habilidade"
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Custo
              <select
                aria-label="Custo da habilidade"
                value={draft.cost}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cost: e.target.value as CreatureAbility['cost'],
                    execution: 'assisted',
                    multiattack: undefined,
                    recharge: e.target.value === 'passive' ? undefined : draft.recharge,
                    maxUses:
                      e.target.value === 'passive' ? null : draft.maxUses,
                  })
                }
              >
                {Object.entries(ABILITY_COST_LABELS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Execução
              <select
                aria-label="Execução da habilidade"
                value={draft.execution}
                disabled={draft.cost === 'reaction'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    execution: e.target.value as CreatureAbility['execution'],
                    ...(e.target.value==='area-save-damage'?{area:draft.area??structuredClone(defaultCreatureArea)}:{}),
                    ...(e.target.value==='multiattack'?{multiattack:draft.multiattack??(attacks[0]?[{attackId:attacks[0].id,count:2}]:[])}:{multiattack:undefined}),
                  })
                }
              >
                <option value="assisted">
                  {draft.cost === 'passive'
                    ? 'Consulta — sem efeito automático'
                    : 'Assistida pelo Mestre'}
                </option>
                {draft.cost === 'passive' ? <option value="war-caster">Conjurador de Guerra (PHB 2014)</option> : null}
                {draft.cost !== 'passive' ? <>
                <option value="disengage">Desengajar</option>
                <option value="dash">Disparada</option>
                <option value="dodge">Esquivar</option>
                {draft.cost==='action'?<option value="multiattack">Ataques Múltiplos</option>:null}
                <option value="area-save-damage">Área com salvaguarda e dano</option>
                </> : null}
              </select>
            </label>
            {draft.cost !== 'passive' ? (
              <label>
                {draft.recharge ? 'Uso disponível antes da recarga' : 'Usos por combate (vazio = livre)'}
                <input
                  disabled={!!draft.recharge}
                  aria-label="Usos da habilidade"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxUses ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxUses:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            ) : null}
          {draft.cost !== 'passive' ? (
            <label>
              Recuperação da habilidade
              <select aria-label="Recarga da habilidade" value={draft.recharge?.minimum ?? ''}
                onChange={e => setDraft({ ...draft, recharge: e.target.value ? { minimum: Number(e.target.value) } : undefined,
                  ...(e.target.value ? { maxUses: 1 } : {}) })}>
                <option value="">Sem recarga automática</option>
                {[1, 2, 3, 4, 5, 6].map(minimum => <option key={minimum} value={minimum}>{creatureRechargeLabel(minimum)} em 1d6</option>)}
              </select>
              <small>Quando gasta, tenta recuperar no início do próprio turno. O Mestre pode restaurar manualmente após um descanso.</small>
            </label>
          ) : null}
          </div>
          {draft.execution==='multiattack'?<div className="creature-attacks">
            <h4>Composição dos Ataques Múltiplos</h4>
            <p>Escolha os ataques e quantidades. No combate, cada golpe pode mirar um alvo diferente, em qualquer ordem.</p>
            {!attacks.length?<p className="section-note">Cadastre os ataques da criatura antes de montar esta habilidade.</p>:null}
            {(draft.multiattack??[]).map((entry,index)=><div className="creature-form-grid" key={index}>
              <label>Ataque<select aria-label={`Ataque múltiplo ${index+1}`} value={entry.attackId}
                onChange={e=>setDraft({...draft,multiattack:draft.multiattack!.map((item,i)=>i===index?{...item,attackId:e.target.value}:item)})}>
                {!attacks.some(a=>a.id===entry.attackId)?<option value={entry.attackId}>Ataque removido — selecione outro</option>:null}
                {attacks.map(attack=><option value={attack.id} key={attack.id}>{attack.name}</option>)}
              </select></label>
              <label>Quantidade<input aria-label={`Quantidade do ataque ${index+1}`} type="number" min={1} max={20} value={entry.count}
                onChange={e=>setDraft({...draft,multiattack:draft.multiattack!.map((item,i)=>i===index?{...item,count:Number(e.target.value)}:item)})}/></label>
              <button type="button" className="btn btn-small" onClick={()=>setDraft({...draft,multiattack:draft.multiattack!.filter((_,i)=>i!==index)})}>Remover ataque da composição</button>
            </div>)}
            <button type="button" className="btn btn-small" disabled={!attacks.some(a=>!draft.multiattack?.some(item=>item.attackId===a.id))}
              onClick={()=>{const next=attacks.find(a=>!draft.multiattack?.some(item=>item.attackId===a.id));if(next)setDraft({...draft,multiattack:[...(draft.multiattack??[]),{attackId:next.id,count:1}]});}}>Adicionar tipo de ataque</button>
          </div>:null}
          {draft.execution==='area-save-damage'?<CreatureAreaFields value={draft.area??defaultCreatureArea} onChange={area=>setDraft({...draft,area})}/>:null}
          {draft.cost === 'reaction' ? (
            <label>
              Gatilho da reação
              <input
                aria-label="Gatilho da habilidade"
                maxLength={500}
                value={draft.trigger}
                onChange={(e) =>
                  setDraft({ ...draft, trigger: e.target.value })
                }
              />
            </label>
          ) : null}
          <label>
            Descrição e instruções
            <textarea
              aria-label="Descrição da habilidade"
              maxLength={3000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <p className="section-note">
            Assistida: controla custo e usos; o Mestre resolve o efeito.
            Esconder-se exige avaliação e testes, sem ocultar automaticamente o
            token. Passivas são consultivas. Recarga em 1d6 é automática no
            início do turno; descanso permanece assistido.
          </p>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <div className="creature-card-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Salvar habilidade
            </button>
            <button type="button" className="btn" onClick={() => edit(null)}>
              Cancelar habilidade
            </button>
            {abilities.some((item) => item.id === draft.id) ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onChange(abilities.filter((item) => item.id !== draft.id));
                  edit(null);
                }}
              >
                Remover habilidade
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
