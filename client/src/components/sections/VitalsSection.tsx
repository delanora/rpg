import { formatModifier } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { ActiveResource, ActiveToggle, ClassState } from '../../types';
import { clampInt } from '../../utils';
import { HpBar } from '../HpBar';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function VitalsSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const { derived, classAdjustments, classState } = character;

  // O destaque é do valor, não do card: só o HP entra em estado crítico.
  const hpRatio = character.hpMax > 0 ? character.hpCurrent / character.hpMax : 0;
  const hpClass =
    hpRatio <= 0 ? ' is-down' : hpRatio <= 0.25 ? ' is-critical' : '';

  function applyClassState(next: ClassState): void {
    update({ classState: next });
  }

  /** Ativa/encerra um toggle; ao ativar, consome um uso do recurso ligado. */
  function toggleFeature(toggle: ActiveToggle, resource?: ActiveResource): void {
    if (toggle.active) {
      applyClassState({
        active: classState.active.filter((id) => id !== toggle.id),
        used: classState.used,
      });
      return;
    }

    const used = { ...classState.used };
    if (resource && !resource.unlimited) {
      used[resource.id] = Math.min(resource.max, (used[resource.id] ?? 0) + 1);
    }
    applyClassState({ active: [...classState.active, toggle.id], used });
  }

  return (
    <Section title="Vida e Defesa" icon="heart">
      <div className="vitals-hp">
        <HpBar current={character.hpCurrent} max={character.hpMax} temp={character.hpTemp} />
      </div>

      <div className="grid grid-4">
        <div className="vital">
          <span className="vital-label">
            <Icon name="heart" size={13} /> HP atual
          </span>
          <InlineField
            className={`vital-value${hpClass}`}
            value={character.hpCurrent}
            mode="number"
            min={-999}
            max={9999}
            ariaLabel="Pontos de vida atuais"
            onCommit={(value) =>
              update({ hpCurrent: clampInt(value, -999, 9999, character.hpCurrent) })
            }
          />
        </div>

        <div className="vital">
          <span className="vital-label">HP máximo</span>
          <InlineField
            className="vital-value"
            value={character.hpMax}
            mode="number"
            min={0}
            max={9999}
            ariaLabel="Pontos de vida máximos"
            onCommit={(value) => update({ hpMax: clampInt(value, 0, 9999, character.hpMax) })}
          />
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="flask" size={13} /> HP temporário
          </span>
          <InlineField
            className="vital-value"
            value={character.hpTemp}
            mode="number"
            min={0}
            max={9999}
            ariaLabel="Pontos de vida temporários"
            onCommit={(value) => update({ hpTemp: clampInt(value, 0, 9999, character.hpTemp) })}
          />
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="shield" size={13} /> Classe de Armadura
          </span>
          <InlineField
            className="vital-value"
            value={character.armorClass}
            mode="number"
            min={0}
            max={99}
            ariaLabel="Classe de armadura"
            onCommit={(value) => update({ armorClass: clampInt(value, 0, 99, character.armorClass) })}
          />
          <span className="vital-hint">sem armadura: {derived.armorClassHint}</span>
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="bolt" size={13} /> Iniciativa
          </span>
          <strong className="vital-value">{formatModifier(derived.initiative)}</strong>
          <span className="vital-hint">
            bônus extra:{' '}
            <InlineField
              className="vital-inline"
              value={character.initiativeBonus}
              mode="number"
              min={-30}
              max={30}
              ariaLabel="Bônus de iniciativa"
              onCommit={(value) =>
                update({ initiativeBonus: clampInt(value, -30, 30, character.initiativeBonus) })
              }
            />
          </span>
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="wind" size={13} /> Deslocamento
          </span>
          <InlineField
            className="vital-value"
            value={character.speed}
            mode="number"
            min={0}
            max={999}
            ariaLabel="Deslocamento"
            onCommit={(value) => update({ speed: clampInt(value, 0, 999, character.speed) })}
          />
          <span className="vital-hint">pés</span>
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="eye" size={13} /> Percepção passiva
          </span>
          <strong className="vital-value">{derived.passivePerception}</strong>
        </div>

        <div className="vital">
          <span className="vital-label">
            <Icon name="weight" size={13} /> Carga
          </span>
          <strong className="vital-value">
            {derived.totalWeight} / {derived.carryingCapacity}
          </strong>
          <span className="vital-hint">peso atual / capacidade (lb)</span>
        </div>
      </div>

      {derived.spellcasting ? (
        <p className="section-note">
          Conjuração: CD {derived.spellcasting.saveDC} · ataque{' '}
          {formatModifier(derived.spellcasting.attackBonus)}
        </p>
      ) : null}

      {classAdjustments.toggles.length > 0 ? (
        <section className="class-state">
          <h3 className="subsection-title">Recursos de Classe</h3>
          <ul className="class-resources">
            {classAdjustments.toggles.map((toggle) => {
              const resource = classAdjustments.resources.find(
                (item) => item.id === toggle.resourceId,
              );
              return (
                <li key={toggle.id} className="class-resource">
                  <span className="class-resource-name">{toggle.name}</span>
                  {resource ? (
                    <span className="class-resource-count">
                      {resource.unlimited ? '∞' : `${resource.remaining}/${resource.max}`}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={
                      toggle.active ? 'btn btn-small btn-danger' : 'btn btn-small btn-primary'
                    }
                    disabled={
                      readOnly ||
                      (!toggle.active &&
                        resource !== undefined &&
                        !resource.unlimited &&
                        resource.remaining <= 0)
                    }
                    onClick={() => toggleFeature(toggle, resource)}
                  >
                    {toggle.active ? 'Encerrar' : 'Ativar'}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="btn btn-small"
            disabled={readOnly}
            onClick={() => applyClassState({ active: [], used: {} })}
          >
            descanso longo
          </button>

          <p className="section-note">
            {classAdjustments.unarmoredDefense ? 'CA sem armadura: 10 + DES + CON. ' : ''}
            {classAdjustments.speedBonus > 0
              ? `Deslocamento +${classAdjustments.speedBonus} pés. `
              : ''}
            {classAdjustments.critExtraDice > 0
              ? `Crítico Brutal: +${classAdjustments.critExtraDice} dado(s) no crítico. `
              : ''}
            {classAdjustments.activeToggleIds.length > 0 &&
            classAdjustments.resistances.length > 0
              ? `Resistências ativas: ${classAdjustments.resistances.join(', ')}.`
              : ''}
          </p>
        </section>
      ) : null}
    </Section>
  );
}
