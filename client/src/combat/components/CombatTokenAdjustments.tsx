import type { CreatureAbility } from '../../../../src/modules/shared/creature-abilities';
import { CombatHeightPanel } from './CombatHeightPanel';
import { CreatureAbilitiesPanel } from './CreatureAbilitiesPanel';
import { setSpatialVisibility } from '../grid/gridApi';
import { useState } from 'react';
import { MechanicalPanel } from '../../components/MechanicalPanel';
import type { CombatDto, CombatantDto } from '../../types';
import { applyManualHp, setCombatantSide, removeCombatParticipant } from '../combatApi';
import { MasterEconomyPanel } from './MasterEconomyPanel';

/** Todos os comandos recebem o token inspecionado, sem assumir ou trocar seu turno. */
export function CombatTokenAdjustments({ combat, combatant, busy, effectsRefresh, onRun, onPrepareArea }: {
  combat: CombatDto; combatant: CombatantDto; busy: boolean; effectsRefresh: number;
  onPrepareArea?: (combatantId: string, definition: CreatureAbility) => void;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [tab, setTab] = useState<'conditions' | 'hp' | 'economy' | 'relation' | 'abilities' | 'height'>('conditions');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [amount, setAmount] = useState('5');
  const specificHostileIds = (combatant.hostileToIds ?? []).filter(id => !(combatant.kind === 'CHARACTER' && combat.combatants.find(unit => unit.id === id)?.kind === 'CHARACTER'));
  const activeDuels = (combat.duels ?? []).filter(duel => duel.status === 'active' && [duel.requesterId, duel.challengedId].includes(combatant.id));
  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 1 && value <= 9999;
  return <>
    <div className="combat-token-menu-tabs" role="group" aria-label="Tipo de ajuste">
      {([['conditions', 'Condições e efeitos'], ['hp', 'Vida'], ['economy', 'Economia'], ['relation', 'Relação'], ['height', 'Altura'], ...(combatant.creatureId ? [['abilities', 'Habilidades'] as const] : [])] as const).map(([key, label]) =>
        <button key={key} type="button" className={tab === key ? 'active' : ''}
          aria-pressed={tab === key} disabled={key === 'economy' && combat.status !== 'ACTIVE'}
          title={key === 'economy' && combat.status !== 'ACTIVE' ? 'Disponível após a iniciativa.' : undefined} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className="combat-token-menu-body">
      {tab === 'height' ? <CombatHeightPanel key={`${combatant.id}:${combat.version}`} combat={combat} combatant={combatant} busy={busy} onRun={onRun} /> : null}
      {tab === 'abilities' ? <CreatureAbilitiesPanel combat={combat} combatant={combatant} busy={busy} onRun={onRun} onPrepareArea={onPrepareArea} /> : null}
      {tab === 'conditions' ? <MechanicalPanel entity={{ kind: 'combatant', id: combatant.id }}
        refreshVersion={combat.version} effectsRefresh={effectsRefresh} variant="token"
        sourceChoices={combat.combatants.filter(item => !item.missing).map(item => ({
          entity: { kind: 'combatant' as const, id: item.id }, name: item.name }))} /> : null}
      {tab === 'relation' ? <section className="combat-token-hp">
        <label>Relação com o grupo<select disabled={busy} value={combatant.sideKey ?? ''}
          onChange={event => onRun(() => setCombatantSide(combat, combatant.id, event.target.value || null))}>
          <option value="">Não definida</option><option value="players">Grupo dos jogadores</option>
          <option value="neutral">Neutro</option><option value="enemies">Hostil ao grupo</option>
          {combatant.sideKey && !['players','neutral','enemies'].includes(combatant.sideKey)
            ? <option value={combatant.sideKey}>{combatant.sideKey}</option> : null}
        </select></label>
        {specificHostileIds.length ? <div className="section-note"><p>Hostilidade específica com: {combat.combatants.filter(unit => specificHostileIds.includes(unit.id)).map(unit => unit.name).join(', ')}.</p><button type="button" className="btn btn-small" disabled={busy} onClick={() => onRun(() => setCombatantSide(combat, combatant.id, combatant.sideKey ?? null))}>Limpar hostilidades específicas</button></div> : null}
        {activeDuels.length ? <p className="section-note">Este personagem está em duelo. Use a janela Duelos para encerrá-lo; trocar o lado não substitui o consentimento.</p> : null}
        <p className="section-note">Trocar o lado também limpa as hostilidades específicas deste token. Ajusta somente este combatente. Neutros não provocam contra o grupo; reagem contra hostis e vice-versa.</p>
      </section> : null}
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
    {combatant.kind !== 'CHARACTER' ? <div className="combat-token-remove">
      <button type="button" className="btn btn-small" disabled={busy} onClick={()=>onRun(()=>setSpatialVisibility(combat,combatant.id,combatant.spatialVisibility==='master-only'?'public':'master-only'))}>{combatant.spatialVisibility==='master-only'?'Revelar aos jogadores':'Ocultar dos jogadores'}</button>
      {confirmRemove ? <><p>Remover {combatant.name} deste combate? O cadastro será preservado.</p><button className="btn btn-danger btn-small" disabled={busy} onClick={() => onRun(() => removeCombatParticipant(combat, combatant.id))}>Confirmar remoção</button> <button className="btn btn-small" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancelar</button></> : <button className="btn btn-small" disabled={busy} onClick={() => setConfirmRemove(true)}>Remover do combate</button>}
    </div> : null}
  </>;
}
