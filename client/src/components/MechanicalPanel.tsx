import { api } from '../api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { fetchMechanicalState, mutateMechanicalState } from '../mechanicalApi';
import type { ConditionEffects, MechanicalDto, MechanicalEntity, MechanicalState } from '../types';

/** Apresentação apenas: efeitos e nomes vêm do servidor. */
export function ConditionBadges({ state, effects }: { state: MechanicalState; effects: ConditionEffects }) {
  const grouped = [...new Set(state.conditions.map(instance => instance.condition))];
  return <div className="combat-shortcuts">
    {grouped.map(condition => {
      const sources = state.conditions.filter(instance => instance.condition === condition);
      return <span className="tag" key={condition} title={sources.map(instance => instance.sourceLabel ?? 'Origem não informada').join(' · ')}>
        {effects.labels[condition]}{sources.length > 1 ? ` ×${sources.length}` : ''}{condition === 'poisoned' && effects.poisonSuspended ? ' (suspenso)' : ''}
      </span>;
    })}
    <span className="tag">Exaustão {state.exhaustionLevel}/6</span>
  </div>;
}

/** Uma interface para personagem, cadastro e instância; sem segunda conexão WS. */
export function MechanicalPanel({ entity, refreshVersion, sourceChoices = [] }: {
  entity: MechanicalEntity; refreshVersion: number;
  sourceChoices?: { entity: MechanicalEntity; name: string }[];
}) {
  const { user } = useAuth();
  const isMaster = user?.role === 'MASTER';
  const targetKey = `${entity.kind}:${entity.id}`;
  const targetRef = useRef(targetKey);
  targetRef.current = targetKey;
  useEffect(() => { setCurrent(null); setSource(''); setSourceLabel(''); setError(''); }, [targetKey]);
  const [current, setCurrent] = useState<MechanicalDto | null>(null);
  const adopt = useCallback((next: MechanicalDto) => setCurrent(previous => {
    if (previous?.entity.id === next.entity.id && previous.entity.kind === next.entity.kind) {
      if (previous.version > next.version) return previous;
      if (previous.version === next.version && previous.combat && next.combat && previous.combat.id === next.combat.id && previous.combat.version > next.combat.version) return previous;
    }
    return next;
  }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [condition, setCondition] = useState('poisoned');
  const [outsideSources, setOutsideSources] = useState<{ entity: MechanicalEntity; name: string }[]>([]);
  useEffect(() => {
    if (!isMaster || sourceChoices.length) return;
    let live = true;
    Promise.all([api<{ characters: { id: string; name: string }[] }>('/api/characters'), api<{ creatures: { id: string; name: string; kind: string }[] }>('/api/creatures')]).then(([characters, creatures]) => {
      if (live) setOutsideSources([
        ...characters.characters.map(item => ({ entity: { kind: 'character' as const, id: item.id }, name: item.name })),
        ...creatures.creatures.map(item => ({ entity: { kind: 'creature' as const, id: item.id }, name: `${item.name} (${item.kind === 'NPC' ? 'NPC' : 'cadastro'})` })),
      ]);
    }).catch(() => {});
    return () => { live = false; };
  }, [isMaster, sourceChoices.length]);
  const choices = sourceChoices.length ? sourceChoices : outsideSources;
  const [source, setSource] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [level, setLevel] = useState('0');
  const refresh = useCallback(async () => {
    const requestedKey = `${entity.kind}:${entity.id}`;
    const next = await fetchMechanicalState({ kind: entity.kind, id: entity.id });
    if (targetRef.current !== requestedKey) return;
    adopt(next);
  }, [entity.kind, entity.id, adopt]);
  useEffect(() => { let live = true; fetchMechanicalState({ kind: entity.kind, id: entity.id }).then(next => { if (live) adopt(next); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [entity.kind, entity.id, refreshVersion, adopt]);
  async function execute(input: Parameters<typeof mutateMechanicalState>[1]) {
    if (!current) return;
    setBusy(true); setError('');
    const requestedKey = targetKey;
    try { const next = await mutateMechanicalState(current, input); if (targetRef.current === requestedKey) adopt(next); }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao atualizar estado mecânico.'); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  if (!current) return error ? <p className="error">{error}</p> : null;
  return <section className="combat-block">
    <h3>Condições e Exaustão — {current.name}</h3>
    <ConditionBadges state={current.state} effects={current.effects} />
    <p className="field-hint">Deslocamento efetivo {current.effectiveSpeed} m · PV máximo efetivo {current.effectiveMaxHp}.</p>
    {current.effects.exhaustionSummary.map(text => <p key={text} className="field-hint">{text}</p>)}
    {current.effects.assistedNotes.map(text => <p key={text} className="field-hint">{text}</p>)}
    {current.effects.prone ? <button className="btn btn-small" disabled={busy || current.effectiveSpeed <= 0} onClick={() => void execute({ action: 'stand' })}>Levantar (Movimento; fora de combate sem orçamento)</button> : null}
    {isMaster ? <details>
      <summary>Administrar condições e fontes</summary>
      <div className="hp-controls">
        <select aria-label="Condição" value={condition} onChange={event => setCondition(event.target.value)}>
          {Object.entries(current.effects.labels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Fonte conhecida" value={source} onChange={event => setSource(event.target.value)}>
          <option value="">Fonte não vinculada</option>
          {choices.map(choice => <option key={`${choice.entity.kind}:${choice.entity.id}`} value={`${choice.entity.kind}:${choice.entity.id}`}>{choice.name}</option>)}
        </select>
        {!source ? <input aria-label="Descrição da fonte" placeholder="Fonte / contexto" maxLength={200} value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} /> : null}
        <button className="btn btn-small" disabled={busy} onClick={() => void execute({ action: 'apply', condition, ...(source ? { sourceEntity: choices.find(choice => `${choice.entity.kind}:${choice.entity.id}` === source)!.entity } : sourceLabel.trim() ? { sourceLabel } : {}) })}>Aplicar e registrar</button>
      </div>
      {current.state.conditions.map(instance => <div className="hp-controls" key={instance.id}>
        <span>{current.effects.labels[instance.condition]} — {instance.sourceLabel ?? 'Origem não informada'}</span>
        <button className="btn btn-small" disabled={busy} onClick={() => void execute({ action: 'remove', instanceId: instance.id })}>Remover esta fonte</button>
      </div>)}
      <div className="hp-controls">
        <button className="btn btn-small" disabled={busy || current.state.exhaustionLevel === 0} onClick={() => void execute({ action: 'exhaustion', exhaustionDelta: -1 })}>−1 Exaustão</button>
        <button className="btn btn-small" disabled={busy || current.state.exhaustionLevel === 6} onClick={() => void execute({ action: 'exhaustion', exhaustionDelta: 1 })}>+1 Exaustão</button>
        <input aria-label="Nível de Exaustão" type="number" min="0" max="6" value={level} onChange={event => setLevel(event.target.value)} />
        <button className="btn btn-small" disabled={busy || !Number.isInteger(Number(level)) || Number(level) < 0 || Number(level) > 6} onClick={() => void execute({ action: 'exhaustion', exhaustionLevel: Number(level) })}>Definir e registrar</button>
      </div>
    </details> : null}
    {error ? <p className="error">{error}</p> : null}
    <details><summary>Histórico mecânico</summary>{[...current.state.log].reverse().map(entry => <p key={entry.id} className="field-hint">{entry.message}</p>)}</details>
  </section>;
}
