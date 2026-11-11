import { useState } from 'react';
import type { CombatDto, CombatantDto } from '../../types';
import { useCreatureAbility } from '../combatApi';
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
  onPrepareArea?: (combatantId:string,ability:NonNullable<CombatantDto['abilities']>[number])=>void;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const abilities = combatant.abilities ?? [];
  if (!combatant.creatureId) return null;
  return (
    <div className="combat-creature-abilities">
      {!abilities.length ? (
        <p className="section-note">
          Nenhuma habilidade especial cadastrada no bestiário.
        </p>
      ) : null}
      {abilities.map((ability) => {
        const used = combatant.abilityUses?.[ability.id] ?? 0;
        const economy = combatant.turnEconomy;
        const unavailable =
          combatant.deathBlocksActions ||
          (combatant.hpCurrent ?? 0) <= 0 ||
          !combatant.conditionEffects.canAct ||
          combat.status !== 'ACTIVE' ||
          (ability.cost !== 'reaction' &&
            combat.currentCombatantId !== combatant.id) ||
          (ability.cost === 'action' &&
            economy.actionsUsed >= economy.actionsGranted) ||
          (ability.cost === 'bonus-action' && economy.bonusActionUsed) ||
          (ability.cost === 'reaction' && !economy.reactionAvailable) ||
          (ability.maxUses !== null && used >= ability.maxUses);
        return (
          <article key={ability.id}>
            <header>
              <strong>{ability.name}</strong>
              <span>
                {ABILITY_COST_LABELS[ability.cost]} ·{' '}
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
                  : ability.execution==='area-save-damage'?'Área: selecione direção e confira os alvos no grid.': `Automática: ${ability.execution === 'dash' ? 'Disparada' : ability.execution === 'dodge' ? 'Esquivar' : 'Desengajar'}.`}
            </small>
            {ability.cost !== 'passive' ? (
              <div className="combat-ability-buttons">
                <button
                  className="btn btn-small"
                  type="button"
                  disabled={busy || unavailable}
                  onClick={() => ability.execution==='area-save-damage' ? onPrepareArea?.(combatant.id,ability) : setSelected(ability.id)}
                >
                  {ability.execution==='area-save-damage'?'Preparar área':'Usar habilidade'}
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
                      : 'Confirmar uso e consumo da economia indicada?'}
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
