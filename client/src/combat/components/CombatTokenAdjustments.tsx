import { useState } from 'react';
import { MechanicalPanel } from '../../components/MechanicalPanel';
import type { CombatDto, CombatantDto } from '../../types';
import { applyManualHp } from '../combatApi';
import { MasterEconomyPanel } from './MasterEconomyPanel';

/** Todos os comandos recebem o token inspecionado, sem assumir ou trocar seu turno. */
export function CombatTokenAdjustments({ combat, combatant, busy, effectsRefresh, onRun }: {
  combat: CombatDto; combatant: CombatantDto; busy: boolean; effectsRefresh: number;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [tab, setTab] = useState<'conditions' | 'hp' | 'economy'>('conditions');
  const [amount, setAmount] = useState('5');
  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 1 && value <= 9999;
  return <>
    <div className="combat-token-menu-tabs" role="group" aria-label="Tipo de ajuste">
      {([['conditions', 'Condições e efeitos'], ['hp', 'Vida'], ['economy', 'Economia']] as const).map(([key, label]) =>
        <button key={key} type="button" className={tab === key ? 'active' : ''}
          aria-pressed={tab === key} disabled={key === 'economy' && combat.status !== 'ACTIVE'}
          title={key === 'economy' && combat.status !== 'ACTIVE' ? 'Disponível após a iniciativa.' : undefined} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className="combat-token-menu-body">
      {tab === 'conditions' ? <MechanicalPanel entity={{ kind: 'combatant', id: combatant.id }}
        refreshVersion={combat.version} effectsRefresh={effectsRefresh} variant="token"
        sourceChoices={combat.combatants.filter(item => !item.missing).map(item => ({
          entity: { kind: 'combatant' as const, id: item.id }, name: item.name }))} /> : null}
      {tab === 'hp' ? <section className="combat-token-hp">
        <p className="combat-token-vitals"><strong>{combatant.hpCurrent ?? '—'}</strong> / {combatant.hpMax ?? '—'} PV</p>
        <label>Quantidade<input aria-label="Quantidade de dano ou cura" type="number" min={1} max={9999}
          value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
        <div className="combat-token-hp-actions">
          <button className="btn btn-danger btn-small" type="button" disabled={busy || !valid}
            onClick={() => onRun(() => applyManualHp({ combatantId: combatant.id, amount: value, mode: 'damage' }))}>Aplicar dano</button>
          <button className="btn btn-small" type="button" disabled={busy || !valid}
            onClick={() => onRun(() => applyManualHp({ combatantId: combatant.id, amount: value, mode: 'heal' }))}>Curar</button>
        </div>
        <p className="section-note">O servidor aplica as regras de PV e registra o ajuste.</p>
      </section> : null}
      {tab === 'economy' ? <MasterEconomyPanel expanded combat={combat} combatant={combatant} busy={busy} onRun={onRun} /> : null}
    </div>
  </>;
}
