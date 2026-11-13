import { CreatureAreaFields, defaultCreatureArea } from './CreatureAreaFields';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CreatureAbility } from '../../types';
import {
  canComposeAbility,
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
  legendaryActionsMax = 0,
  attackEditor,
  legendarySettings,
}: {
  abilities: CreatureAbility[];
  attackEditor?:ReactNode;
  legendarySettings?:ReactNode;
  attacks?: {id:string;name:string}[];
  legendaryActionsMax?: number;
  onChange: (value: CreatureAbility[]) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<CreatureAbility | null>(null);
  const [error, setError] = useState('');
  const compositionOptions=[...attacks.map(attack=>({...attack,kind:'attack' as const})),...abilities.filter(option=>option.id!==draft?.id&&canComposeAbility(option)).map(option=>({id:option.id,name:option.name,kind:'ability' as const}))];
  const entryKey=(entry:{attackId:string;kind?:'attack'|'ability'})=>entry.kind==='ability'?`ability:${entry.attackId}`:entry.attackId;
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft)
      formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [draft?.id,draft?.cost]);
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
    if(parsed.data.execution==='multiattack' && parsed.data.multiattack?.some(item=>!compositionOptions.some(option=>option.id===item.attackId&&option.kind===(item.kind??'attack')))) {
      setError('Selecione ataques ou habilidades elegíveis existentes no cadastro da criatura.'); return;
    }
    if(parsed.data.cost==='legendary' && (parsed.data.legendaryCost??Infinity)>legendaryActionsMax) {setError('Configure no cadastro um limite lendário suficiente para esta opção.');return;}
    if(parsed.data.execution==='legendary-attack'&&!attacks.some(attack=>attack.id===parsed.data.legendaryAttackId)) {setError('Selecione um ataque cadastrado.');return;}
    onChange(
      abilities.some((item) => item.id === parsed.data.id)
        ? abilities.map((item) =>
            item.id === parsed.data.id ? parsed.data : item,
          )
        : [...abilities, parsed.data],
    );
    edit(null);
  }
  const renderAction=(item:CreatureAbility)=>(
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
              {item.cost==='legendary'?`Custo ${item.legendaryCost} do saldo lendário`:item.recharge ? creatureRechargeLabel(item.recharge.minimum) : item.maxUses === null
                ? 'Sem limite de usos'
                : `${item.maxUses} usos por combate`}
            </p>
            <p>{item.description}</p>
            {item.execution==='multiattack'?<p>{item.multiattack?.map(entry=>`${entry.count}× ${compositionOptions.find(option=>option.id===entry.attackId&&option.kind===(entry.kind??'attack'))?.name??'Opção removida'}`).join(' · ')}</p>:null}
          </div>
          <button
            className="btn btn-small"
            type="button"
            disabled={!!draft}
            onClick={() => edit({ ...item })}
          >
            Editar ação
          </button>
        </article>
  );
  const actionForm=draft ? (
        <div className="creature-attack-form" ref={formRef}>
          <div className="creature-form-grid">
            <label>
              Nome da ação
              <input
                aria-label="Nome da ação"
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Custo
              <select
                aria-label="Custo da ação"
                value={draft.cost}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cost: e.target.value as CreatureAbility['cost'],
                    execution: e.target.value!=='passive' && draft.execution==='area-save-damage' ? draft.execution : 'assisted',
                    multiattack: undefined,
                    maxUses:
                      ['passive','legendary'].includes(e.target.value) ? null : draft.maxUses,
                    legendaryCost: e.target.value==='legendary' ? draft.legendaryCost??1 : undefined,
                    recharge: ['passive','legendary'].includes(e.target.value) ? undefined : draft.recharge,
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
                aria-label="Execução da ação"
                value={draft.execution}
                disabled={draft.cost === 'reaction'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    execution: e.target.value as CreatureAbility['execution'],
                    ...(e.target.value==='area-save-damage'?{area:draft.area??structuredClone(defaultCreatureArea)}:{}),
                    legendaryAttackId:e.target.value==='legendary-attack'?(draft.legendaryAttackId??attacks[0]?.id):undefined,
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
                {draft.cost==='legendary'?<option value="legendary-attack">Ataque cadastrado</option>:null}
                {draft.cost !== 'passive' && draft.cost !== 'legendary' ? <>
                <option value="disengage">Desengajar</option>
                <option value="dash">Disparada</option>
                <option value="dodge">Esquivar</option>
                {draft.cost==='action'?<option value="multiattack">Ataques Múltiplos</option>:null}

                </> : null}
                {['action','bonus-action','legendary'].includes(draft.cost)?<option value="area-save-damage">Área com salvaguarda e efeitos</option>:null}
              </select>
            </label>
            {draft.cost !== 'passive' && draft.cost !== 'legendary' ? (
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
          {draft.cost !== 'passive' && draft.cost !== 'legendary' ? (
            <label>
              Recuperação da ação
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
          {draft.cost==='legendary'?<div className="creature-form-grid">
            <label>Preencher com uma ação cadastrada<select aria-label="Ação base da opção lendária" value="" onChange={event=>{
              const key=event.target.value;
              if(key.startsWith('ability:')){
                const base=abilities.find(item=>item.id===key.slice(8));
                if(base)setDraft({...draft,name:draft.name||base.name,description:base.description,execution:base.execution==='area-save-damage'?'area-save-damage':'assisted',area:base.area,legendaryAttackId:undefined});
              }else if(key){const base=attacks.find(item=>item.id===key);if(base)setDraft({...draft,name:draft.name||base.name,execution:'legendary-attack',legendaryAttackId:base.id});}
            }}><option value="">Selecionar ação…</option>{compositionOptions.map(option=><option key={`${option.kind}:${option.id}`} value={entryKey({attackId:option.id,kind:option.kind})}>{option.name}</option>)}</select><small>Preenche esta opção lendária; o custo e os usos são próprios dela. Efeitos sem execução lendária automática ficam assistidos.</small></label>
            <label>Custo lendário<input aria-label="Custo da Ação Lendária" type="number" min={1} max={20} value={draft.legendaryCost??1} onChange={event=>setDraft({...draft,legendaryCost:Number(event.target.value)})}/></label>
            {draft.execution==='legendary-attack'?<label>Ataque<select aria-label="Ataque da Ação Lendária" value={draft.legendaryAttackId??''} onChange={event=>setDraft({...draft,legendaryAttackId:event.target.value})}>
              <option value="">Escolha um ataque</option>{attacks.map(attack=><option key={attack.id} value={attack.id}>{attack.name}</option>)}
            </select></label>:null}
            <p className="section-note">Disponível ao fim do turno de outra criatura, na janela do Mestre. Não consome Ação, Bônus ou Reação.</p>
          </div>:null}
          {draft.execution==='multiattack'?<div className="creature-attacks">
            <h4>Composição dos Ataques Múltiplos</h4>
            <p>Escolha as ações e quantidades. A sequência consome uma Ação; os usos e recargas das habilidades continuam valendo.</p>
            {!compositionOptions.length?<p className="section-note">Cadastre ações antes de montar esta composição.</p>:null}
            {(draft.multiattack??[]).map((entry,index)=><div className="creature-form-grid" key={index}>
              <label>Ação<select aria-label={`Ataque múltiplo ${index+1}`} value={entryKey(entry)}
                onChange={e=>setDraft({...draft,multiattack:draft.multiattack!.map((item,i)=>i===index?{...item,attackId:e.target.value.startsWith('ability:')?e.target.value.slice(8):e.target.value,kind:e.target.value.startsWith('ability:')?'ability':'attack'}:item)})}>
                {!compositionOptions.some(option=>entryKey({attackId:option.id,kind:option.kind})===entryKey(entry))?<option value={entryKey(entry)}>Opção removida — selecione outra</option>:null}
                {compositionOptions.map(option=><option value={entryKey({attackId:option.id,kind:option.kind})} key={`${option.kind}:${option.id}`}>{option.kind==='ability'?'':''}{option.name}</option>)}
              </select></label>
              <label>Quantidade<input aria-label={`Quantidade do ataque ${index+1}`} type="number" min={1} max={20} value={entry.count}
                onChange={e=>setDraft({...draft,multiattack:draft.multiattack!.map((item,i)=>i===index?{...item,count:Number(e.target.value)}:item)})}/></label>
              <button type="button" className="btn btn-small" onClick={()=>setDraft({...draft,multiattack:draft.multiattack!.filter((_,i)=>i!==index)})}>Remover opção da composição</button>
            </div>)}
            <button type="button" className="btn btn-small" disabled={!compositionOptions.some(option=>!draft.multiattack?.some(item=>item.attackId===option.id&&(item.kind??'attack')===option.kind))}
              onClick={()=>{const next=compositionOptions.find(option=>!draft.multiattack?.some(item=>item.attackId===option.id&&(item.kind??'attack')===option.kind));if(next)setDraft({...draft,multiattack:[...(draft.multiattack??[]),{attackId:next.id,...(next.kind==='ability'?{kind:'ability' as const}:{}),count:1}]});}}>Adicionar ação à composição</button>
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
              Salvar ação
            </button>
            <button type="button" className="btn" onClick={() => edit(null)}>
              Cancelar ação
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
                Remover ação
              </button>
            ) : null}
          </div>
        </div>
      ) : null;
  return (
    <div className="creature-attacks">
      <div className="creature-section-heading">
        <p>
          Cadastre as ações da criatura. Cada cópia controla seus
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
          Adicionar ação
        </button>
      </div>
      {!draft ? (
        <div
          className="creature-card-actions"
          aria-label="Modelos de ação"
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
      <div aria-label="Ações cadastradas">
        {attackEditor}
        {abilities.filter(item=>item.cost!=='legendary').map(renderAction)}
        {draft?.cost!=='legendary'?actionForm:null}
      </div>
      {abilities.some(item=>item.cost==='legendary')||draft?.cost==='legendary'?<section aria-label="Ações Lendárias cadastradas">
        <h3>Ações Lendárias</h3>
        {legendarySettings}
        {abilities.filter(item=>item.cost==='legendary').map(renderAction)}
        {draft?.cost==='legendary'?actionForm:null}
      </section>:null}

    </div>
  );
}
