import { ABILITY_ABBREVIATIONS, formatChallengeRating, formatModifier } from '../../dnd';
import { useSheetAccess } from '../../readonly';
import type { ActiveResource, ActiveToggle, ArmorClassDetail, ClassState } from '../../types';
import { clampInt } from '../../utils';
import { HpBar } from '../HpBar';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/**
 * Explica de onde saiu a CA: a armadura equipada (e como a Destreza entrou),
 * a Defesa sem Armadura da classe, o escudo, os bônus mágicos e o override do
 * mestre. Sem isso a CA automática viraria um número sem justificativa.
 */
function describeArmorClass(detail: ArmorClassDetail): string {
  const parts: string[] = [];
  const dex = `DES ${formatModifier(detail.dexterityBonus)}`;

  if (detail.armor) {
    parts.push(
      detail.armor.type === 'Pesada'
        ? `${detail.armor.name} (pesada): ${detail.armor.base} · sem DES`
        : `${detail.armor.name} (${detail.armor.type.toLowerCase()}): ${detail.armor.base} + ${dex}`,
    );
  } else if (detail.unarmoredLabel) {
    parts.push(
      `${detail.unarmoredLabel}: ${detail.automatic - detail.shieldBonus - detail.magicBonus}`,
    );
  } else {
    parts.push(`sem armadura: 10 + ${dex}`);
  }

  if (detail.shieldBonus !== 0) parts.push(`escudo ${formatModifier(detail.shieldBonus)}`);
  if (detail.magicBonus !== 0) parts.push(`bônus mágico ${formatModifier(detail.magicBonus)}`);
  // Bônus de classe na CA (Estilo de Luta Defesa) — só entra com armadura.
  if (detail.classBonus !== 0) {
    const label = detail.classBonusLabels.join(' · ');
    parts.push(`${label || 'classe'} ${formatModifier(detail.classBonus)}`);
  }
  if (detail.override !== null) parts.push(`CA manual (automática ${detail.automatic})`);

  return parts.join(' · ');
}

export function VitalsSection({ character, update }: SheetSectionProps) {
  // PV atual/temporário, usos de recursos e espaços continuam editáveis pelo
  // jogador depois de finalizar a criação; PV máximo, CA, iniciativa e
  // deslocamento são construção (e a CA manual é privilégio do mestre).
  const { readOnly, lockedConstruction, masterView } = useSheetAccess();
  const { derived, classAdjustments, classState } = character;
  const armorClass: ArmorClassDetail = derived.armorClass;

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
        ...classState,
        active: classState.active.filter((id) => id !== toggle.id),
      });
      return;
    }

    const used = { ...classState.used };
    if (resource && !resource.unlimited) {
      used[resource.id] = Math.min(resource.max, (used[resource.id] ?? 0) + 1);
    }
    applyClassState({ ...classState, active: [...classState.active, toggle.id], used });
  }

  /** Descanso curto: repõe apenas os recursos de recarga curta (ex.: Ki). */
  function shortRest(): void {
    const used = { ...classState.used };
    for (const resource of classAdjustments.resources) {
      if (resource.recharge === 'short') delete used[resource.id];
    }
    applyClassState({ ...classState, used });
  }

  /**
   * Descanso longo: restaura o HP ao máximo, recarrega todos os espaços de
   * magia e zera o estado de classe (toggles encerrados e usos devolvidos).
   */
  function longRest(): void {
    const slots = Object.fromEntries(
      Object.entries(character.spells.slots).map(([level, slot]) => [
        level,
        { ...slot, used: 0 },
      ]),
    );
    update({
      hpCurrent: character.hpMax,
      spells: { ...character.spells, slots },
      // O descanso longo NÃO apaga as escolhas de característica (Estilo de
      // Luta, Inimigo Favorito): só encerra toggles e devolve usos.
      classState: { ...classState, active: [], used: {} },
    });
  }

  const hasShortResource = classAdjustments.resources.some(
    (resource) => resource.recharge === 'short',
  );
  const kiResource = classAdjustments.resources.find((resource) => resource.id === 'ki');
  const hasClassPanel =
    classAdjustments.toggles.length > 0 ||
    classAdjustments.resources.length > 0 ||
    classAdjustments.unarmoredDefense ||
    classAdjustments.speedBonus > 0 ||
    classAdjustments.critExtraDice > 0 ||
    classAdjustments.martialArtsDie > 0 ||
    classAdjustments.hpBonus > 0 ||
    (classAdjustments.critThreshold !== null && classAdjustments.critThreshold < 20) ||
    derived.halfProficiencyBonus > 0 ||
    classAdjustments.wildShapeCr !== null;

  return (
    <Section title="Vida e Defesa" icon="heart">
      {/*
       * A barra de vida faz o papel dos antigos cards de PV: os campos de
       * atual e máximo vivem aqui, junto da barra.
       */}
      <div className="vitals-hp">
        <div className="hp-editor">
          <Icon name="heart" size={16} className="hp-heart" />
          <InlineField
            className={`hp-editor-value${hpClass}`}
            value={character.hpCurrent}
            mode="number"
            min={-999}
            max={9999}
            ariaLabel="Pontos de vida atuais"
            onCommit={(value) =>
              update({ hpCurrent: clampInt(value, -999, 9999, character.hpCurrent) })
            }
          />
          <span className="hp-editor-sep">/</span>
          <InlineField
            className="hp-editor-value"
            value={character.hpMax}
            mode="number"
            min={0}
            max={9999}
            readOnly={lockedConstruction}
            ariaLabel="Pontos de vida máximos"
            onCommit={(value) => update({ hpMax: clampInt(value, 0, 9999, character.hpMax) })}
          />
          {character.hpTemp > 0 ? <span className="hp-badge">+{character.hpTemp}</span> : null}
        </div>

        <HpBar
          current={character.hpCurrent}
          max={character.hpMax}
          temp={character.hpTemp}
          showLabel={false}
        />
      </div>

      <div className="grid grid-4">
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

          {/* A CA é calculada; só o mestre pode fixar um valor manual. */}
          {masterView && !readOnly ? (
            <InlineField
              className="vital-value"
              value={character.armorClassOverride ?? armorClass.automatic}
              mode="number"
              min={0}
              max={99}
              ariaLabel="Classe de armadura"
              title="CA manual do mestre (igual à automática ou 0 volta ao cálculo)"
              onCommit={(value) => {
                const next = clampInt(
                  value,
                  0,
                  99,
                  character.armorClassOverride ?? armorClass.automatic,
                );
                update({
                  armorClassOverride: next === armorClass.automatic ? null : next,
                });
              }}
            />
          ) : (
            <strong className="vital-value">{armorClass.value}</strong>
          )}

          <span className="vital-hint">{describeArmorClass(armorClass)}</span>
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
              readOnly={lockedConstruction}
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
            readOnly={lockedConstruction}
            ariaLabel="Deslocamento"
            onCommit={(value) => update({ speed: clampInt(value, 0, 999, character.speed) })}
          />
          <span className="vital-hint">metros</span>
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
          <span className="vital-hint">peso atual / capacidade (kg)</span>
        </div>
      </div>

      {derived.spellcasting ? (
        <p className="section-note">
          Conjuração: CD {derived.spellcasting.saveDC} · ataque{' '}
          {formatModifier(derived.spellcasting.attackBonus)}
        </p>
      ) : null}

      {hasClassPanel ? (
        <section className="class-state">
          <h3 className="subsection-title">Recursos de Classe</h3>

          {classAdjustments.resources.length > 0 ? (
            <ul className="class-resources">
              {classAdjustments.resources.map((resource) => (
                <li key={resource.id} className="class-resource">
                  <span className="class-resource-name">{resource.name}</span>
                  <span className="class-resource-count">
                    {resource.unlimited ? '∞' : `${resource.remaining}/${resource.max}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {classAdjustments.toggles.length > 0 ? (
            <ul className="class-resources">
              {classAdjustments.toggles.map((toggle) => {
                const resource = classAdjustments.resources.find(
                  (item) => item.id === toggle.resourceId,
                );
                return (
                  <li key={toggle.id} className="class-resource">
                    <span className="class-resource-name">{toggle.name}</span>
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
          ) : null}

          <div className="class-rest">
            {hasShortResource ? (
              <button type="button" className="btn btn-small" disabled={readOnly} onClick={shortRest}>
                descanso curto
              </button>
            ) : null}
            <button type="button" className="btn btn-small" disabled={readOnly} onClick={longRest}>
              descanso longo
            </button>
          </div>

          <p className="section-note">
            {classAdjustments.unarmoredDefense
              ? `CA sem armadura: ${classAdjustments.unarmoredDefenseBase} + DES${
                  classAdjustments.unarmoredDefenseAbility
                    ? ` + ${ABILITY_ABBREVIATIONS[classAdjustments.unarmoredDefenseAbility]}`
                    : ''
                }. `
              : ''}
            {classAdjustments.martialArtsDie > 0
              ? `Artes Marciais: dado desarmado 1d${classAdjustments.martialArtsDie}, usa Destreza e permite um ataque desarmado extra como ação bônus. `
              : ''}
            {kiResource
              ? `CD de ki: ${8 + derived.proficiencyBonus + derived.modifiers.wisdom}. `
              : ''}
            {classAdjustments.wildShapeCr !== null
              ? `Forma Selvagem: até CR ${formatChallengeRating(classAdjustments.wildShapeCr)}${
                  classAdjustments.wildShapeFlying ? ' (inclui deslocamento de voo)' : ''
                }. `
              : ''}
            {classAdjustments.hpBonus > 0
              ? `Resiliência Dracônica: +${classAdjustments.hpBonus} PV (some ao HP máximo). `
              : ''}
            {classAdjustments.speedBonus > 0
              ? `Deslocamento +${classAdjustments.speedBonus} m. `
              : ''}
            {classAdjustments.critExtraDice > 0
              ? `Crítico Brutal: +${classAdjustments.critExtraDice} dado(s) no crítico. `
              : ''}
            {classAdjustments.critThreshold !== null && classAdjustments.critThreshold < 20
              ? `Crítico aprimorado: acerto crítico com ${classAdjustments.critThreshold}–20 no d20. `
              : ''}
            {derived.halfProficiencyBonus > 0
              ? `Metade da proficiência (+${derived.halfProficiencyBonus}) nos testes de habilidade em que você não é proficiente. `
              : ''}
            {classAdjustments.resistances.length > 0
              ? `Resistências: ${classAdjustments.resistances.join(', ')}.`
              : ''}
          </p>
        </section>
      ) : null}
    </Section>
  );
}
