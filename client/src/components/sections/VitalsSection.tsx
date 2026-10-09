import {
  ABILITY_ABBREVIATIONS,
  formatChallengeRating,
  formatModifier,
  hitDieLabel,
  speedInSquares,
} from '../../dnd';
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
 *
 * Cada parte sai em uma linha própria no popup do card (uma conta por linha).
 */
function describeArmorClass(detail: ArmorClassDetail): string[] {
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

  if (detail.shield?.name && detail.shieldBonus === 0) parts.push(`escudo ${detail.shield.name}`);
  if (detail.shieldBonus !== 0) {
    parts.push(`escudo ${detail.shield?.name ?? ''} ${formatModifier(detail.shieldBonus)}`.trim());
  }
  if (detail.magicBonus !== 0) parts.push(`bônus mágico ${formatModifier(detail.magicBonus)}`);
  // Bônus de classe na CA (Estilo de Luta Defesa) — só entra com armadura.
  if (detail.classBonus !== 0) {
    const label = detail.classBonusLabels.join(' · ');
    parts.push(`${label || 'classe'} ${formatModifier(detail.classBonus)}`);
  }
  if (detail.override !== null) parts.push(`CA manual (automática ${detail.automatic})`);

  // Sem proficiência a CA NÃO muda (PHB 2014): o equipamento continua contando.
  // O que fica ativo são as penalidades de não proficiência — avisadas abaixo e
  // consumidas pelo motor da Fase 8 (testes, salvaguardas, ataques e conjuração).
  if (detail.armorNonProficiency.armor && detail.armor) {
    parts.push(
      `⚠ Sem proficiência com ${detail.armor.type.toLowerCase()}: ${detail.armor.name}`,
    );
  }
  if (detail.armorNonProficiency.shield) {
    parts.push(`⚠ Sem proficiência com escudo${detail.shield ? `: ${detail.shield.name}` : ''}`);
  }

  return parts;
}

interface VitalsSectionProps extends SheetSectionProps {
  /**
   * Embutido na seção Personagem (depois das Classes): o bloco perde a moldura
   * de card e o cabeçalho vira um subtítulo, mas o conteúdo é o mesmo.
   */
  embedded?: boolean;
  /**
   * Descanso Curto: a seção só abre o painel e mostra o indicador — nenhuma
   * regra (recuperação de recursos, Dados de Vida) é decidida aqui.
   */
  shortRest?: {
    /** Há uma solicitação coletiva PENDING/APPROVED em andamento. */
    active: boolean;
    onOpen: () => void;
  };
}

export function VitalsSection({
  character,
  update,
  embedded = false,
  shortRest,
}: VitalsSectionProps) {
  // PV atual/temporário, usos de recursos e espaços continuam editáveis pelo
  // jogador depois de finalizar a criação; PV máximo, CA, iniciativa e
  // deslocamento são construção (e a CA manual é privilégio do mestre).
  const { readOnly, lockedConstruction, masterView } = useSheetAccess();
  const { derived, classAdjustments, classState } = character;
  const armorClass: ArmorClassDetail = derived.armorClass;

  // O destaque é do valor, não do card: só o HP entra em estado crítico. O
  // máximo é o EFETIVO (gravado + `hpBonus` de features/talentos).
  const hpMax = derived.hpMax;
  const hpRatio = hpMax > 0 ? character.hpCurrent / hpMax : 0;
  const hpClass =
    hpRatio <= 0 ? ' is-down' : hpRatio <= 0.25 ? ' is-critical' : '';

  // Dado de vida de cada classe, usado no descanso curto.
  const hitDice = character.classes.map((entry) => hitDieLabel(entry.hitDie)).join(' / ');

  // Percepção passiva = 10 + o total da perícia Percepção (proficiência inclusa).
  const perception = derived.skills.perception;

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

  /*
   * Descanso Longo: a autoridade mecânica é do SERVIDOR.
   *
   * O `longRest()` antigo aplicava os benefícios na ficha LOCAL (PV ao máximo,
   * espaços recarregados, `classState.used` apagado). Isso não pode coexistir com
   * a conclusão real do descanso coletivo — que é transacional e precisa do
   * consenso da mesa, do ready, da seleção de Dados de Vida e do consumo dos
   * recursos de acampamento. Enquanto o painel coletivo não chega (UI pendente),
   * o botão fica DESATIVADO: nenhuma ficha é alterada por aqui.
   */

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
    <Section
      title="Vida e Defesa"
      icon="heart"
      className={embedded ? 'vitals-embedded' : undefined}
    >
      <div className="vitals-grid">
        {/*
         * Linha 1: a vida ocupa a largura toda em faixa baixa — ícone e rótulo à
         * esquerda, número atual/máximo logo depois e a barra embaixo.
         */}
        <div className="vitals-hp">
          <div className="hp-editor">
            <Icon name="heart" size={18} className="hp-heart" />
            <span className="hp-editor-label">Vida</span>
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
              className="hp-editor-value hp-editor-value-max"
              value={hpMax}
              mode="number"
              min={0}
              max={9999}
              readOnly={lockedConstruction}
              ariaLabel="Pontos de vida máximos"
              // O editor mostra o máximo EFETIVO; o que se grava é a base (sem o
              // bônus derivado de features/talentos, que é recalculado).
              onCommit={(value) =>
                update({ hpMax: Math.max(0, clampInt(value, 0, 9999, hpMax) - derived.hpBonus) })
              }
            />
          </div>

          <HpBar
            current={character.hpCurrent}
            max={hpMax}
            temp={character.hpTemp}
            showLabel={false}
          />
        </div>

        {/*
         * Linha 2: os seis números de jogo numa linha só (a carga vive no
         * inventário e o PV temporário segue na mecânica, sem campo próprio).
         */}
        <div className="vitals-cards">
          <div className="vital">
            {/* O nome completo aparece no popup — sem balão nativo do navegador. */}
            <span className="vital-label">
              <Icon name="shield" size={13} />
              <span className="vital-label-text">Classe de Armadura</span>
              {armorClass.armorNonProficiency.armor || armorClass.armorNonProficiency.shield ? (
                <span
                  className="vital-warn"
                  title="Equipamento sem proficiência — penalidades de não proficiência ativas"
                >
                  ⚠
                </span>
              ) : null}
            </span>

            {/* A CA é calculada; só o mestre pode fixar um valor manual. */}
            <div className="vital-body">
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
            </div>

            {/* O popup abre no hover (e no foco): uma conta por linha. */}
            <span className="vital-tip" role="tooltip">
              <strong>Classe de Armadura</strong>
              {describeArmorClass(armorClass).map((part) => (
                <span key={part}>{part}</span>
              ))}
            </span>
          </div>

          <div className="vital">
            <span className="vital-label">
              <Icon name="bolt" size={13} />
              <span className="vital-label-text">Iniciativa</span>
            </span>
            <div className="vital-body">
              <strong className="vital-value">{formatModifier(derived.initiative)}</strong>
            </div>
            <span className="vital-tip" role="tooltip">
              <strong>Iniciativa</strong>
              <span>
                Destreza {formatModifier(derived.modifiers.dexterity)} · bônus extra{' '}
                {formatModifier(character.initiativeBonus)} · total{' '}
                {formatModifier(derived.initiative)}
              </span>
              <span>
                É um teste de Destreza: define a ordem dos turnos no combate — quem tem a maior
                iniciativa age primeiro.
              </span>
              {/* O bônus extra segue editável (mestre/criação); o popup fica aberto no foco. */}
              {lockedConstruction ? null : (
                <span className="vital-tip-field">
                  <InlineField
                    className="vital-inline"
                    value={character.initiativeBonus}
                    mode="number"
                    min={-30}
                    max={30}
                    ariaLabel="Bônus de iniciativa"
                    onCommit={(value) =>
                      update({
                        initiativeBonus: clampInt(value, -30, 30, character.initiativeBonus),
                      })
                    }
                  />
                  <span className="muted">bônus extra</span>
                </span>
              )}
            </span>
          </div>

          <div className="vital">
            <span className="vital-label">
              <Icon name="wind" size={13} />
              <span className="vital-label-text">Deslocamento</span>
            </span>
            <div className="vital-body">
              <span className="vital-value-row">
                <InlineField
                  className="vital-value"
                  value={character.speed}
                  mode="number"
                  min={0}
                  max={999}
                  readOnly={lockedConstruction}
                  ariaLabel="Deslocamento em metros"
                  onCommit={(value) => update({ speed: clampInt(value, 0, 999, character.speed) })}
                />
                <span className="vital-unit">/m</span>
              </span>
            </div>
            <span className="vital-tip" role="tooltip">
              <strong>Deslocamento</strong>
              {/* O tabuleiro conta em quadrados de 1,5 m (5 pés) — PHB. */}
              <span>
                {character.speed} metros equivalem a {speedInSquares(character.speed)} no
                tabuleiro.
              </span>
              <span>
                É o quanto o personagem anda gastando o movimento do turno — e pode dividir o
                deslocamento entre andar e agir.
              </span>
            </span>
          </div>

          <div className="vital">
            <span className="vital-label">
              <Icon name="eye" size={13} />
              <span className="vital-label-text">Percepção passiva</span>
            </span>
            <div className="vital-body">
              <strong className="vital-value">{derived.passivePerception}</strong>
            </div>
            <span className="vital-tip" role="tooltip">
              <strong>Percepção passiva</strong>
              <span>
                10 + Percepção {formatModifier(perception?.total ?? derived.modifiers.wisdom)} ={' '}
                {derived.passivePerception}
              </span>
              <span>
                É o que o mestre usa para notar — ou esconder — detalhes sem pedir uma rolagem.
              </span>
            </span>
          </div>

          <div className="vital">
            <span className="vital-label">
              <Icon name="die" size={13} />
              <span className="vital-label-text">Dado de Vida</span>
            </span>
            <div className="vital-body">
              <strong className="vital-value vital-value-die">{hitDice || '—'}</strong>
            </div>
            <span className="vital-tip" role="tooltip">
              <strong>Dado de Vida</strong>
              {character.classes.length > 0 ? (
                character.classes.map((entry) => (
                  <span key={entry.classKey}>
                    {entry.className}: 1{hitDieLabel(entry.hitDie)} por nível
                  </span>
                ))
              ) : (
                <span>Ainda sem classe definida.</span>
              )}
              <span>No descanso curto, gastar um dado recupera 1 dado de vida + CON em PV.</span>
            </span>
          </div>

          <div className="vital">
            <span className="vital-label">
              <Icon name="crown" size={13} />
              <span className="vital-label-text">Bônus de Proficiência</span>
            </span>
            <div className="vital-body">
              <strong className="vital-value">+{derived.proficiencyBonus}</strong>
            </div>
            <span className="vital-tip" role="tooltip">
              <strong>Bônus de Proficiência</strong>
              <span>
                Soma {formatModifier(derived.proficiencyBonus)} em testes de perícia, ataques e
                salvaguardas em que o personagem é proficiente.
              </span>
              <span>Sobe +1 no 5º, 9º, 13º e 17º nível.</span>
            </span>
          </div>
        </div>
      </div>

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
              ? `+${classAdjustments.hpBonus} PV de classe/talento (somados ao PV máximo). `
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

      {/* Descansos: abrem o painel/persistem; nenhuma regra roda no cliente. */}
      <div className="class-rest">
        {shortRest ? (
          <button
            type="button"
            className={`btn btn-small class-rest-btn${shortRest.active ? ' btn-primary' : ''}`}
            disabled={readOnly}
            onClick={shortRest.onOpen}
          >
            <Icon name="flame" size={15} />
            <span>Descanso Curto</span>
            {shortRest.active ? <span className="class-rest-badge">em andamento</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-small class-rest-btn"
          disabled
          title="O Descanso Longo é conduzido pela solicitação coletiva da mesa (pronto + conclusão do servidor)."
        >
          <Icon name="bed" size={15} />
          <span>Descanso Longo</span>
        </button>
      </div>
    </Section>
  );
}
