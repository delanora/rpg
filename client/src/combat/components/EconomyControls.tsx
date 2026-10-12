import { useState } from 'react';
import type { CombatantDto, CombatDto } from '../../types';
import { executeEconomyAction, overrideEconomy, type EconomyAction, type EconomyAdjustment } from '../combatApi';

const ACTIONS: { id: EconomyAction; name: string }[] = [
  { id: 'dash', name: 'Disparada' }, { id: 'disengage', name: 'Desengajar' },
  { id: 'dodge', name: 'Esquivar' }, { id: 'help', name: 'Ajudar' },
  { id: 'hide', name: 'Esconder' }, { id: 'search', name: 'Procurar' },
  { id: 'use-object', name: 'Usar um Objeto' }, { id: 'ready', name: 'Preparar' },
  { id: 'improvised', name: 'Outra ação' },
];

/** Controles assistidos: registram intenção e custo, sem resolver narrativa. */
export function EconomyControls({ combat, combatant, isMaster, busy, onRun }: {
  combat: CombatDto; combatant: CombatantDto | null; isMaster: boolean; busy: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [action, setAction] = useState<EconomyAction>('dash');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('');
  const [distance, setDistance] = useState('1.5');
  const [adjustment, setAdjustment] = useState<EconomyAdjustment>('grant-action');
  const [reason, setReason] = useState('');
  const [remaining, setRemaining] = useState('0');
  if (!combatant) return null;
  const ownTurn = combat.currentCombatantId === combatant.id;
  const economy = combatant.turnEconomy;
  const canAction = ownTurn && economy.actionsUsed < economy.actionsGranted;
  return (
    <section className="combat-block">
      <h3>Economia — {combatant.name}</h3>
      {economy.attackAction ? <p className="field-hint">Attack Action: {economy.attackAction.attacksMade} / {economy.attackAction.attacksAllowed} ataques.</p> : null}
      <div className="hp-controls">
        <select aria-label="Ação" value={action} onChange={event => setAction(event.target.value as EconomyAction)}>
          {ACTIONS.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        {action === 'ready' ? <input aria-label="Gatilho" placeholder="Gatilho decidido na mesa" value={trigger} maxLength={500} onChange={event => setTrigger(event.target.value)} /> : null}
        <input aria-label="Descrição ou intenção" placeholder={action === 'ready' ? 'Ação pretendida (sem magia)' : 'Contexto / descrição'} value={description} maxLength={500} onChange={event => setDescription(event.target.value)} />
        <button className="btn btn-small" disabled={busy || !canAction || (action === 'ready' && (!trigger.trim() || !description.trim())) || (action === 'improvised' && !description.trim())} onClick={() => onRun(() => executeEconomyAction(combat, {
          combatantId: combatant.id, action, description, ...(action === 'ready' ? { trigger, intent: description } : {}),
        }))}>Usar Ação</button>
      </div>
      <p className="field-hint">Efeitos de esquiva, ajuda, esconder e demais testes são resolvidos pelo Mestre. Preparar magia aguarda concentração e execução de magias.</p>
      <div className="hp-controls">
        <input type="number" min="0.01" step="0.5" aria-label="Distância em metros" value={distance} onChange={event => setDistance(event.target.value)} />
        <button className="btn btn-small" disabled={busy || !ownTurn || !Number.isFinite(Number(distance)) || Number(distance) <= 0} onClick={() => onRun(() => executeEconomyAction(combat, { combatantId: combatant.id, action: 'move', distance: Number(distance) }))}>Mover (m)</button>
      </div>
      {economy.ready ? <div>
        <p className="field-hint">Preparada: {economy.ready.trigger} → {economy.ready.intent}</p>
        <button className="btn btn-small" disabled={busy || !economy.reactionAvailable} onClick={() => onRun(() => executeEconomyAction(combat, { combatantId: combatant.id, action: 'execute-ready' }))}>Confirmar gatilho e usar Reação (assistido)</button>
        <p className="field-hint">Para rolar o ataque preparado, use a opção de Reação no painel Atacar.</p>
      </div> : null}
      {isMaster ? <details>
        <summary>Ajuste explícito do Mestre</summary>
        <div className="hp-controls">
          <select aria-label="Ajuste de economia" value={adjustment} onChange={event => setAdjustment(event.target.value as EconomyAdjustment)}>
            <option value="grant-action">Conceder +1 Ação</option><option value="restore-action">Recuperar Ações</option>
            <option value="restore-bonus">Recuperar Ação Bônus</option><option value="restore-reaction">Recuperar Reação</option>
            <option value="set-movement">Ajustar Movimento restante</option>
          </select>
          {adjustment === 'set-movement' ? <input type="number" min="0" step="0.5" aria-label="Movimento restante em metros" value={remaining} onChange={event => setRemaining(event.target.value)} /> : null}
          <input placeholder="Motivo do ajuste" aria-label="Motivo do ajuste" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
          <button className="btn btn-small" disabled={busy || !reason.trim()} onClick={() => onRun(() => overrideEconomy(combat, { combatantId: combatant.id, adjustment, reason, ...(adjustment === 'set-movement' ? { remaining: Number(remaining) } : {}) }))}>Aplicar e registrar</button>
        </div>
      </details> : null}
    </section>
  );
}
