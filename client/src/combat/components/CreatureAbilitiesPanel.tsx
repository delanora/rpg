import { useState } from 'react';
import type { CombatDto, CombatantDto } from '../../types';
import { useCreatureAbility, setLegendarySurprise } from '../combatApi';
import { creatureRechargeLabel, CREATURE_ABILITY_COST_LABELS as ABILITY_COST_LABELS } from '../../../../src/modules/shared/creature-abilities';
import './creature-abilities.css';

/** Superfície do Mestre: sem segunda economia e sem detectar gatilhos por texto. */
export function CreatureAbilitiesPanel({
  combat,
  combatant,
  busy,
  onRun,
  onPrepareArea,
}: {
  combat: CombatDto;
  combatant: CombatantDto;
  busy: boolean;
  onPrepareArea?: (combatantId:string,ability:NonNullable<CombatantDto['abilities']>[number],multiattackId?:string)=>void;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const abilities = (combatant.abilities ?? []).filter(ability=>ability.cost!=='legendary');
  const sequence=combatant.turnEconomy.multiattack;
  const sequencePending=Boolean(sequence && sequence.performed<sequence.total);
  if (!combatant.creatureId) return null;
  return (
    <div className="combat-creature-abilities">
      {combatant.legendary && combatant.legendary.max>0?<article>
        <strong>Ações Lendárias · {Math.max(0,combatant.legendary.max-combatant.legendary.used)}/{combatant.legendary.max}</strong>
        <p>Usadas na janela de fim do turno de outro participante. Recuperam no início do próprio turno.</p>
        {!combatant.legendary.firstTurnEnded?<label><input type="checkbox" checked={combatant.legendary.surprised} disabled={busy} onChange={event=>onRun(()=>setLegendarySurprise(combat,combatant.id,event.target.checked))}/> Surpresa inicial: bloquear opções lendárias até terminar o primeiro turno</label>:null}
      </article>:null}
      {sequence?<article aria-label="Progresso dos Ataques Múltiplos">
        <strong>{sequence.label} · {sequence.performed}/{sequence.total}</strong>
        <p>{sequencePending?'Resolva os ataques no painel de ataques e as habilidades nas opções abaixo.':'Todos os golpes foram resolvidos.'}</p>
        {sequence.attacks.filter(item=>item.remaining>0).map(item=><p key={`${item.kind??'attack'}:${item.attackId}`}>{item.name} · {item.remaining} restante(s)</p>)}
        {sequencePending?<button type="button" className="btn btn-small" disabled={busy} onClick={()=>onRun(()=>useCreatureAbility(combat,{combatantId:combatant.id,abilityId:sequence.abilityId,mode:'cancel-multiattack'}))}>Abandonar golpes restantes</button>:null}
      </article>:null}
      {!abilities.length ? (
        <p className="section-note">
          {combatant.legendary?.max ? 'Opções lendárias disponíveis na janela de fim de turno.' : 'Nenhuma ação cadastrada no bestiário.'}
        </p>
      ) : null}
      {abilities.map((ability) => {
        const used = combatant.abilityUses?.[ability.id] ?? 0;
        const economy = combatant.turnEconomy;
        const reserved=sequencePending&&sequence?.attacks.some(item=>item.kind==='ability'&&item.attackId===ability.id&&item.remaining>0);
        const compositionId=reserved?sequence!.id:undefined;
        const unavailable =
          (ability.execution==='multiattack' && sequencePending) ||
          combatant.deathBlocksActions ||
          (combatant.hpCurrent ?? 0) <= 0 ||
          !combatant.conditionEffects.canAct ||
          combat.status !== 'ACTIVE' ||
          (ability.cost !== 'reaction' &&
            combat.currentCombatantId !== combatant.id) ||
          (!reserved && ability.cost === 'action' &&
            economy.actionsUsed >= economy.actionsGranted) ||
          (!reserved && ability.cost === 'bonus-action' && economy.bonusActionUsed) ||
          (ability.cost === 'reaction' && !economy.reactionAvailable) ||
          (ability.maxUses !== null && used >= ability.maxUses);
        return (
          <article key={ability.id}>
            <header>
              <strong>{ability.name}</strong>
              <span>
                {reserved?'Incluída nos Ataques Múltiplos':ABILITY_COST_LABELS[ability.cost]} ·{' '}
                {ability.maxUses === null
                  ? 'Livre'
                  : `${Math.max(0, ability.maxUses - used)}/${ability.maxUses} usos`}
              </span>
            </header>
            {ability.recharge ? <p>{creatureRechargeLabel(ability.recharge.minimum)} · {used > 0 ? 'Aguardando recarga no início do turno' : 'Disponível'}</p> : null}
            <p>{ability.description}</p>
            {ability.trigger ? <p>Gatilho: {ability.trigger}</p> : null}
            <small>
              {ability.cost === 'passive'
                ? 'Consulta: não aplica modificadores automaticamente.'
                : ability.execution === 'assisted'
                  ? 'Assistida: o Mestre resolve os efeitos e testes.'
                  : ability.execution==='multiattack'?'Ataques Múltiplos: uma Ação, golpes resolvidos individualmente.': ability.execution==='area-save-damage'?'Área: selecione direção e confira os alvos no grid.': `Automática: ${ability.execution === 'dash' ? 'Disparada' : ability.execution === 'dodge' ? 'Esquivar' : 'Desengajar'}.`}
            </small>
            {ability.cost !== 'passive' ? (
              <div className="combat-ability-buttons">
                <button
                  className="btn btn-small"
                  type="button"
                  disabled={busy || unavailable}
                  onClick={() => ability.execution==='area-save-damage' ? onPrepareArea?.(combatant.id,ability,compositionId) : setSelected(ability.id)}
                >
                  {ability.execution==='area-save-damage'?'Preparar área':'Usar ação'}
                </button>
                {ability.maxUses !== null && used > 0 ? (
                  <button
                    className="btn btn-small"
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected('restore:' + ability.id)}
                  >
                    Restaurar usos
                  </button>
                ) : null}
              </div>
            ) : null}
            {selected === ability.id || selected === 'restore:' + ability.id ? (
              <div className="combat-ability-confirm">
                <p>
                  {selected.startsWith('restore:')
                    ? 'Restaurar todos os usos desta habilidade para esta cópia?'
                    : ability.execution === 'assisted'
                      ? `Confirme a elegibilidade${ability.cost === 'reaction' ? ' e a ocorrência do gatilho' : ''}. O sistema gastará o recurso; resolva o efeito e os testes de forma assistida.`
                      : ability.execution==='multiattack'?'Iniciar os Ataques Múltiplos? Consome uma Ação; resolva cada golpe no painel de ataques.':'Confirmar uso e consumo da economia indicada?'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={
                    busy || (!selected.startsWith('restore:') && unavailable)
                  }
                  onClick={() => {
                    const restore = selected.startsWith('restore:');
                    setSelected(null);
                    onRun(() =>
                      useCreatureAbility(combat, {
                        combatantId: combatant.id,
                        abilityId: ability.id,
                        ...(!restore&&compositionId?{multiattackId:compositionId}:{}),
                        confirmed: true,
                        mode: restore ? 'restore' : 'use',
                      }),
                    );
                  }}
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  Cancelar
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
