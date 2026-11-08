import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { describeEffectModifiers, EFFECT_ROLL_LABELS } from '../../effectModifiers';
import {
  applyBlessEffect,
  applyHoldPersonEffect,
  createManualEffect,
  endEffect,
  expireEffectDuration,
  fetchCastingState,
  fetchSpellcastingSources,
  fetchSpellTargeting,
  type CastingEconomyDto,
  type CastingResourceChoice,
  type CastingResourceDto,
  type SpellTargetingDto,
} from '../../effectsApi';
import type {
  AbilityKey,
  EffectDto,
  EffectModifierDto,
  EffectRollType,
  EffectVisibility,
  MechanicalEntity,
  SpellcastingSourceDto,
} from '../../types';

/**
 * EFEITOS GENÉRICOS — ferramenta do Mestre em "Estado e ajustes".
 *
 * NÃO é Condition nem Concentração: a lista é a tabela própria de instâncias do
 * efeito, com identidade por instância (encerrar um nunca remove outro com o
 * mesmo nome), grupo de aplicação e visibilidade público/privado.
 *
 * Fase 6.5B: o Mestre também pode anexar MODIFICADORES tipados à instância
 * (bônus/dado em rolagem, vantagem/desvantagem, CA e deslocamento). São apenas
 * fixtures de engine — nenhuma magia do PHB é implementada aqui —, e o servidor
 * valida cada um antes de gravar.
 */

type ModifierKind = EffectModifierDto['kind'];

const KIND_LABELS: Record<ModifierKind, string> = {
  'roll-flat': 'Bônus fixo em rolagem',
  'roll-dice': 'Dado extra em rolagem',
  'roll-advantage': 'Vantagem em rolagem',
  'roll-disadvantage': 'Desvantagem em rolagem',
  'ac-flat': 'Bônus de CA',
  'speed-flat': 'Bônus de deslocamento (m)',
};

const ABILITY_OPTIONS: { value: '' | AbilityKey; label: string }[] = [
  { value: '', label: 'Todos os atributos' },
  { value: 'strength', label: 'Força' },
  { value: 'dexterity', label: 'Destreza' },
  { value: 'constitution', label: 'Constituição' },
  { value: 'intelligence', label: 'Inteligência' },
  { value: 'wisdom', label: 'Sabedoria' },
  { value: 'charisma', label: 'Carisma' },
];

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];

/** Espaços que comportam a magia e ainda têm uso livre (6.6C). */
function eligibleResources(
  resources: CastingResourceDto[],
  spellLevel: number,
): CastingResourceDto[] {
  return resources.filter(
    (resource) => resource.level >= spellLevel && resource.remaining > 0,
  );
}

function resourceKeyOf(resource: CastingResourceDto): string {
  return `${resource.kind}:${resource.level}`;
}

function resourceChoiceOf(
  resources: CastingResourceDto[],
  key: string,
): CastingResourceChoice | null {
  const found = resources.find((resource) => resourceKeyOf(resource) === key);
  return found ? { kind: found.kind, level: found.level } : null;
}

function defaultSlotKey(
  resources: CastingResourceDto[],
  spellLevel: number,
): string {
  const eligible = eligibleResources(resources, spellLevel);
  return eligible.length === 1 ? resourceKeyOf(eligible[0]) : '';
}

function isRollModifier(kind: ModifierKind): boolean {
  return kind.startsWith('roll-');
}

/**
 * EVIDÊNCIA ESPACIAL do Mestre (6.6E). Não é distância: o servidor só aceita a
 * confirmação dos requisitos que a própria magia declarou e que ele não mede.
 */
type SpatialEvidence = {
  withinRange: boolean;
  clearPath: boolean;
  sight: boolean;
  groupDistance: boolean;
};

const EMPTY_EVIDENCE: SpatialEvidence = {
  withinRange: false,
  clearPath: false,
  sight: false,
  groupDistance: false,
};

/** Requisitos que a UI deve pedir — derivados do targeting do SERVIDOR. */
function requiredConfirmations(
  targeting: SpellTargetingDto | null,
  targetCount: number,
): { key: keyof SpatialEvidence; label: string }[] {
  if (!targeting) return [];
  const list: { key: keyof SpatialEvidence; label: string }[] = [
    {
      key: 'withinRange',
      label:
        targeting.rangeFeet === null
          ? 'Todos os alvos estão ao alcance.'
          : `Todos os alvos estão dentro de ${targeting.rangeFeet} ft.`,
    },
  ];
  if (targeting.requiresSight) {
    list.push({ key: 'sight', label: 'O conjurador consegue ver todos os alvos.' });
  }
  if (targeting.requiresClearPath) {
    list.push({ key: 'clearPath', label: 'Há caminho livre até todos os alvos.' });
  }
  const group = targeting.groupConstraints[0];
  if (group && targetCount > 1) {
    list.push({
      key: 'groupDistance',
      label: `Todos os alvos estão a até ${group.feet} ft uns dos outros.`,
    });
  }
  return list;
}

export function MasterEffectsPanel({
  entity,
  targetName,
  effects,
  conditionLabels,
  choices = [],
  busy = false,
  onChanged,
}: {
  entity: MechanicalEntity;
  targetName: string;
  effects: EffectDto[];
  /** Rótulos PT-BR do catálogo de Conditions (vem do estado mecânico). */
  conditionLabels: Record<string, string>;
  /** Entidades que o Mestre pode escolher como alvo do Bless de prova. */
  choices?: { entity: MechanicalEntity; name: string }[];
  busy?: boolean;
  /** Recarrega a lista (o servidor já filtrou pelo papel). */
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<EffectVisibility>('public');
  // CONDITIONS aplicadas pelo efeito (6.5C): a Condition REAL nasce no estado
  // mecânico do alvo; aqui só se declara o que o efeito deve aplicar.
  const [conditions, setConditions] = useState<string[]>([]);
  const [pending, setPending] = useState<EffectModifierDto[]>([]);
  // Construtor compacto de UM modificador por vez.
  const [kind, setKind] = useState<ModifierKind>('roll-flat');
  const [roll, setRoll] = useState<EffectRollType>('attack');
  const [ability, setAbility] = useState<'' | AbilityKey>('');
  const [value, setValue] = useState('2');
  const [count, setCount] = useState('1');
  const [sides, setSides] = useState('4');
  const [negative, setNegative] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  // BLESS (6.5G): ferramenta temporária de PROVA da engine. O caster é a
  // entidade deste painel; até 3 alvos da lista da mesa.
  const [blessTargets, setBlessTargets] = useState<string[]>([]);
  // IMOBILIZAR PESSOA (6.5H): alvo ÚNICO. O servidor fixa atributo (Sabedoria),
  // CD e Condition (Paralyzed); nada disso é escolha daqui.
  const [holdPersonTargets, setHoldPersonTargets] = useState<string[]>([]);
  // TARGETING (6.6E): máximo/alcance/requisitos vêm do SERVIDOR para o espaço
  // escolhido; as confirmações são o que o Mestre afirma sobre o que o sistema
  // não consegue medir (nunca uma distância digitada).
  const [blessTargeting, setBlessTargeting] = useState<SpellTargetingDto | null>(null);
  const [holdTargeting, setHoldTargeting] = useState<SpellTargetingDto | null>(null);
  const [blessEvidence, setBlessEvidence] = useState<SpatialEvidence>(EMPTY_EVIDENCE);
  const [holdEvidence, setHoldEvidence] = useState<SpatialEvidence>(EMPTY_EVIDENCE);
  // FONTE DE CONJURAÇÃO (6.6B): lista do SERVIDOR com CD/ataque mágico já
  // derivados. Só há escolha no multiclasse; não existe campo de CD na UI.
  const [sources, setSources] = useState<SpellcastingSourceDto[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  // ESPAÇOS DE MAGIA (6.6C): `remaining`/`max` são LEITURA do servidor. O Mestre
  // só escolhe QUAL gastar; nada de campo manual de slot/remaining.
  const [resources, setResources] = useState<CastingResourceDto[]>([]);
  const [blessSlot, setBlessSlot] = useState('');
  const [holdSlot, setHoldSlot] = useState('');
  // DISPONIBILIDADE DE TURNO (6.6D): o servidor decide pelo turnSequence real.
  const [economy, setEconomy] = useState<CastingEconomyDto>({
    inCombat: false,
    isCasterTurn: true,
    actionAvailable: true,
    bonusActionAvailable: true,
  });

  useEffect(() => {
    let alive = true;
    setSources([]);
    setSourceKey('');
    fetchSpellcastingSources(entity)
      .then((list) => {
        if (!alive) return;
        setSources(list);
        setSourceKey(list.length === 1 ? `${list[0].kind}:${list[0].id}` : '');
      })
      .catch(() => {
        if (alive) setSources([]);
      });
    setResources([]);
    setBlessSlot('');
    setHoldSlot('');
    fetchCastingState(entity)
      .then((state) => {
        if (!alive) return;
        setResources(state.resources);
        setEconomy(state.economy);
        setBlessSlot(defaultSlotKey(state.resources, 1));
        setHoldSlot(defaultSlotKey(state.resources, 2));
      })
      .catch(() => {
        if (alive) setResources([]);
      });
    return () => {
      alive = false;
    };
  }, [entity.kind, entity.id]);

  // O máximo de alvos depende do ESPAÇO: buscar de novo quando ele muda.
  useEffect(() => {
    let alive = true;
    const level = blessSlot ? Number(blessSlot.split(':')[1]) : 0;
    if (!blessSlot || !Number.isInteger(level) || level < 1) {
      setBlessTargeting(null);
      return () => {
        alive = false;
      };
    }
    fetchSpellTargeting('bless', level)
      .then((targeting) => {
        if (alive) setBlessTargeting(targeting);
      })
      .catch(() => {
        if (alive) setBlessTargeting(null);
      });
    return () => {
      alive = false;
    };
  }, [blessSlot, entity.kind, entity.id]);

  useEffect(() => {
    let alive = true;
    const level = holdSlot ? Number(holdSlot.split(':')[1]) : 0;
    if (!holdSlot || !Number.isInteger(level) || level < 1) {
      setHoldTargeting(null);
      return () => {
        alive = false;
      };
    }
    fetchSpellTargeting('hold-person', level)
      .then((targeting) => {
        if (alive) setHoldTargeting(targeting);
      })
      .catch(() => {
        if (alive) setHoldTargeting(null);
      });
    return () => {
      alive = false;
    };
  }, [holdSlot, entity.kind, entity.id]);

  // Trocar caster/espaço invalida alvos e confirmações antigas.
  useEffect(() => {
    setBlessEvidence(EMPTY_EVIDENCE);
    setBlessTargets([]);
  }, [blessSlot, entity.kind, entity.id]);

  useEffect(() => {
    setHoldEvidence(EMPTY_EVIDENCE);
    setHoldPersonTargets([]);
  }, [holdSlot, entity.kind, entity.id]);

  const selectedSource =
    sources.find((item) => `${item.kind}:${item.id}` === sourceKey) ??
    (sources.length === 1 ? sources[0] : null);

  const locked = busy || working;
  const blessResources = eligibleResources(resources, 1);
  const holdResources = eligibleResources(resources, 2);
  const blessChoice = resourceChoiceOf(resources, blessSlot);
  const holdChoice = resourceChoiceOf(resources, holdSlot);
  const blessMax = blessTargeting?.maxTargets ?? 3;
  const holdMax = holdTargeting?.maxTargets ?? 1;
  const blessRequirements = requiredConfirmations(blessTargeting, blessTargets.length);
  const holdRequirements = requiredConfirmations(holdTargeting, holdPersonTargets.length);
  const blessReady =
    blessTargeting !== null && blessRequirements.every((item) => blessEvidence[item.key]);
  const holdReady =
    holdTargeting !== null && holdRequirements.every((item) => holdEvidence[item.key]);
  // Fora de combate não há economia a checar; em combate, só o ator do turno
  // com Ação disponível pode conjurar (o servidor revalida no COMMIT).
  const proofBlocked =
    economy.inCombat && (!economy.isCasterTurn || !economy.actionAvailable);
  const economyLabel = !economy.inCombat
    ? 'Fora de combate'
    : !economy.isCasterTurn
      ? 'Não é o turno do conjurador'
      : economy.actionAvailable
        ? 'Ação disponível'
        : 'Ação já utilizada';

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (locked) return;
    setWorking(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar os efeitos.');
    } finally {
      setWorking(false);
    }
  }

  /** Monta o modificador a partir dos campos; `null` = entrada inválida. */
  function currentModifier(): EffectModifierDto | null {
    const numberValue = Number(value);
    if (kind === 'roll-flat' || kind === 'ac-flat' || kind === 'speed-flat') {
      if (!Number.isInteger(numberValue) || numberValue === 0) return null;
    }
    const abilityFilter = ability === '' ? {} : { ability };
    if (kind === 'roll-flat') return { kind, roll, value: numberValue, ...abilityFilter };
    if (kind === 'roll-advantage' || kind === 'roll-disadvantage') {
      return { kind, roll, ...abilityFilter };
    }
    if (kind === 'roll-dice') {
      const diceCount = Number(count);
      const dieSides = Number(sides);
      if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > 20) return null;
      return {
        kind,
        roll,
        count: diceCount,
        sides: dieSides,
        sign: negative ? -1 : 1,
        ...abilityFilter,
      };
    }
    if (kind === 'ac-flat') return { kind, value: numberValue };
    return { kind: 'speed-flat', value: numberValue };
  }

  const preview = currentModifier();

  return (
    <div className="master-conditions">
      <div className="master-conditions-head">
        <span className="master-conditions-title">
          <Icon name="sparkle" size={13} /> Efeitos — {targetName}
        </span>
      </div>

      {effects.length === 0 ? (
        <p className="field-hint">Nenhum efeito ativo.</p>
      ) : (
        <ul className="master-conditions-list">
          {effects.map((effect) => (
            <li className="master-condition-row" key={effect.id} data-effect-id={effect.id}>
              <span className="master-condition-name">{effect.label}</span>
              <span className="master-condition-origin">
                Origem: {effect.sourceLabel ?? (effect.sourceType === 'manual' ? 'Mestre' : effect.sourceType)}
                {effect.groupId ? ' · grupo' : ''} · {effect.visibility === 'private' ? 'privado' : 'público'}
              </span>
              {effect.conditions.length > 0 ? (
                <span className="master-condition-origin" data-effect-conditions>
                  Condições: {effect.conditions.map((key) => conditionLabels[key] ?? key).join(', ')}
                </span>
              ) : null}
              {effect.modifiers.length > 0 ? (
                <span className="master-condition-origin" data-effect-modifiers>
                  {describeEffectModifiers(effect.modifiers)}
                </span>
              ) : null}
              {effect.duration ? (
                <span className="field-hint" data-effect-duration>
                  {effect.duration.tracking === 'combat' &&
                  effect.duration.remainingRounds !== null
                    ? `${effect.duration.label} — ${effect.duration.remainingRounds} rounds restantes`
                    : effect.duration.label}
                </span>
              ) : null}
              {effect.duration ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={locked}
                  title="Expira a duração deste efeito (acompanhamento manual do Mestre)"
                  onClick={() => void run(() => expireEffectDuration(effect.id))}
                >
                  Expirar duração
                </button>
              ) : null}
              <button
                type="button"
                className="master-condition-remove"
                disabled={locked}
                aria-label={`Encerrar ${effect.label}`}
                title={`Encerrar ${effect.label} (só esta instância)`}
                onClick={() => void run(() => endEffect(effect.id))}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="token-effect-editor">
        <summary>Novo efeito manual</summary>
      <div className="hp-controls">
        <input
          aria-label="Nome do efeito manual"
          placeholder="Nome do efeito"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <select
          aria-label="Visibilidade do efeito"
          value={visibility}
          onChange={(event) =>
            setVisibility(event.target.value === 'private' ? 'private' : 'public')
          }
        >
          <option value="public">Público</option>
          <option value="private">Privado (só o Mestre)</option>
        </select>
      </div>

      <div className="hp-controls">
        <select
          aria-label="Tipo de modificador"
          value={kind}
          onChange={(event) => setKind(event.target.value as ModifierKind)}
        >
          {(Object.keys(KIND_LABELS) as ModifierKind[]).map((key) => (
            <option key={key} value={key}>
              {KIND_LABELS[key]}
            </option>
          ))}
        </select>
        {isRollModifier(kind) ? (
          <>
            <select
              aria-label="Rolagem alvo"
              value={roll}
              onChange={(event) => setRoll(event.target.value as EffectRollType)}
            >
              {(Object.keys(EFFECT_ROLL_LABELS) as EffectRollType[]).map((key) => (
                <option key={key} value={key}>
                  {EFFECT_ROLL_LABELS[key]}
                </option>
              ))}
            </select>
            {kind !== 'roll-advantage' && kind !== 'roll-disadvantage' ? (
              <select
                aria-label="Atributo do modificador"
                value={ability}
                onChange={(event) => setAbility(event.target.value as '' | AbilityKey)}
              >
                {ABILITY_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
        {kind === 'roll-dice' ? (
          <>
            <input
              aria-label="Quantidade de dados"
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
            <select
              aria-label="Tipo de dado"
              value={sides}
              onChange={(event) => setSides(event.target.value)}
            >
              {DICE_SIDES.map((die) => (
                <option key={die} value={die}>
                  d{die}
                </option>
              ))}
            </select>
            <label className="field-hint">
              <input
                type="checkbox"
                checked={negative}
                onChange={(event) => setNegative(event.target.checked)}
              />{' '}
              negativo
            </label>
          </>
        ) : kind === 'roll-advantage' || kind === 'roll-disadvantage' ? null : (
          <input
            aria-label="Valor do modificador"
            type="number"
            min="-100"
            max="100"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <button
          type="button"
          className="btn btn-small"
          disabled={locked || preview === null}
          onClick={() => preview && setPending((list) => [...list, preview])}
        >
          <Icon name="plus" size={12} /> Adicionar modificador
        </button>
      </div>

      {pending.length > 0 ? (
        <ul className="master-conditions-list">
          {pending.map((modifier, index) => (
            <li className="master-condition-row" key={`${modifier.kind}-${index}`}>
              <span className="master-condition-name">{describeEffectModifiers([modifier])}</span>
              <button
                type="button"
                className="master-condition-remove"
                aria-label="Remover modificador pendente"
                onClick={() => setPending((list) => list.filter((_, item) => item !== index))}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="conditions-admin">
        <summary>
          Condições aplicadas{conditions.length > 0 ? ` (${conditions.length})` : ''}
        </summary>
        <div className="hp-controls">
          {Object.entries(conditionLabels).map(([key, name]) => (
            <label key={key} className="field-hint">
              <input
                type="checkbox"
                checked={conditions.includes(key)}
                onChange={(event) =>
                  setConditions((list) =>
                    event.target.checked ? [...list, key] : list.filter((item) => item !== key),
                  )
                }
              />{' '}
              {name}
            </label>
          ))}
        </div>
      </details>
      <div className="hp-controls">
        <button
          type="button"
          className="btn btn-small"
          disabled={locked || label.trim() === ''}
          onClick={() =>
            void run(async () => {
              await createManualEffect({
                label: label.trim(),
                target: entity,
                visibility,
                modifiers: pending,
                conditions,
              });
              setLabel('');
              setPending([]);
              setConditions([]);
            })
          }
        >
          <Icon name="plus" size={13} /> Adicionar efeito manual
        </button>
      </div>
      <p className="field-hint">Configure os modificadores e as condições deste efeito.</p>
      </details>
      <details className="token-effect-editor">
        <summary>Magias e recursos</summary>
      <div className="hp-controls" data-spellcasting-source>
        <span className="field-hint">Fonte de conjuração</span>
        {sources.length > 1 ? (
          <select
            aria-label="Fonte de conjuração"
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
          >
            <option value="">Escolha a fonte</option>
            {sources.map((source) => (
              <option key={`${source.kind}:${source.id}`} value={`${source.kind}:${source.id}`}>
                {source.label}
              </option>
            ))}
          </select>
        ) : null}
        {selectedSource ? (
          <span className="field-hint" data-spellcasting-derived>
            CD {selectedSource.spellSaveDc}
            {selectedSource.spellAttackBonus === null
              ? ''
              : ` · ataque mágico ${selectedSource.spellAttackBonus >= 0 ? '+' : ''}${selectedSource.spellAttackBonus}`}
          </span>
        ) : (
          <span className="field-hint">Sem fonte de conjuração utilizável.</span>
        )}
      </div>

      <details className="conditions-admin" data-bless-proof>
        <summary>
          Bênção ({blessTargets.length}/{blessMax})
        </summary>
        <p className="field-hint">
          Ferramenta TEMPORÁRIA do Mestre: cria o grupo de efeitos e a Concentração do
          caster, consome Ação e UM espaço real. O espaço escolhido define o MÁXIMO de
          alvos (3 no 1º, +1 por espaço acima); alcance e caminho livre são confirmados
          abaixo quando o servidor não consegue medir. Sem duração automática.
        </p>
        <div className="hp-controls" data-casting-resource="bless">
          <span className="field-hint">Conjuração: Ação — {economyLabel}</span>
          <span className="field-hint">Espaço</span>
          {blessResources.length > 1 ? (
            <select
              aria-label="Espaço de magia do Bless"
              value={blessSlot}
              onChange={(event) => setBlessSlot(event.target.value)}
            >
              <option value="">Escolha o espaço</option>
              {blessResources.map((resource) => (
                <option key={resourceKeyOf(resource)} value={resourceKeyOf(resource)}>
                  {resource.label} — {resource.remaining}/{resource.max}
                </option>
              ))}
            </select>
          ) : blessResources.length === 1 ? (
            <span className="field-hint">
              {blessResources[0].label} — {blessResources[0].remaining}/{blessResources[0].max}
            </span>
          ) : (
            <span className="field-hint" data-casting-resource-empty>
              Sem espaço disponível.
            </span>
          )}
        </div>
        <div className="hp-controls">
          {choices.map((choice) => {
            const key = `${choice.entity.kind}:${choice.entity.id}`;
            const checked = blessTargets.includes(key);
            return (
              <label key={key} className="field-hint">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && blessTargets.length >= blessMax}
                  onChange={(event) =>
                    setBlessTargets((list) =>
                      event.target.checked
                        ? [...list, key]
                        : list.filter((item) => item !== key),
                    )
                  }
                />{' '}
                {choice.name}
              </label>
            );
          })}
          {choices.length === 0 ? (
            <span className="field-hint">Nenhum personagem/criatura para escolher.</span>
          ) : null}
        </div>
        <div className="hp-controls" data-targeting-confirmation="bless">
          <span className="field-hint" data-targeting-max>
            Alvos: {blessTargets.length} / {blessMax}
          </span>
          {blessRequirements.map((requirement) => (
            <label key={requirement.key} className="field-hint">
              <input
                type="checkbox"
                checked={blessEvidence[requirement.key]}
                onChange={(event) =>
                  setBlessEvidence((current) => ({
                    ...current,
                    [requirement.key]: event.target.checked,
                  }))
                }
              />{' '}
              {requirement.label}
            </label>
          ))}
        </div>
        <div className="hp-controls">
          <button
            type="button"
            className="btn btn-small"
            disabled={
              locked ||
              proofBlocked ||
              blessTargets.length === 0 ||
              selectedSource === null ||
              !blessChoice ||
              !blessReady
            }
            onClick={() =>
              void run(async () => {
                const targets = blessTargets.flatMap((key) => {
                  const choice = choices.find(
                    (item) => `${item.entity.kind}:${item.entity.id}` === key,
                  );
                  return choice ? [choice.entity] : [];
                });
                if (targets.length === 0 || selectedSource === null || !blessChoice) return;
                await applyBlessEffect({
                  caster: entity,
                  targets,
                  spellcastingSource: { kind: selectedSource.kind, id: selectedSource.id },
                  castingResource: blessChoice,
                  spatialConfirmation: blessEvidence,
                });
                setBlessTargets([]);
                setBlessEvidence(EMPTY_EVIDENCE);
                const refreshed = await fetchCastingState(entity);
                setResources(refreshed.resources);
                setEconomy(refreshed.economy);
              })
            }
          >
            <Icon name="sparkle" size={13} /> Aplicar Bless
          </button>
        </div>
      </details>

      <details className="conditions-admin" data-hold-person-proof>
        <summary>Imobilizar Pessoa</summary>
        <p className="field-hint">
          Ferramenta TEMPORÁRIA do Mestre: cria UMA salvaguarda de Sabedoria por alvo. Se o
          espaço for superior ao 2º, cada nível acima permite um humanoide adicional. Nenhum
          efeito nasce antes de o ÚLTIMO save resolver; então só os alvos que falharam recebem
          Paralyzed e a Concentração do caster. O espaço gasto NÃO volta e o save não se repete
          no fim do turno.
        </p>
        <div className="hp-controls" data-casting-resource="hold-person">
          <span className="field-hint">Conjuração: Ação — {economyLabel}</span>
          <span className="field-hint">Espaço</span>
          {holdResources.length > 1 ? (
            <select
              aria-label="Espaço de magia do Imobilizar Pessoa"
              value={holdSlot}
              onChange={(event) => setHoldSlot(event.target.value)}
            >
              <option value="">Escolha o espaço</option>
              {holdResources.map((resource) => (
                <option key={resourceKeyOf(resource)} value={resourceKeyOf(resource)}>
                  {resource.label} — {resource.remaining}/{resource.max}
                </option>
              ))}
            </select>
          ) : holdResources.length === 1 ? (
            <span className="field-hint">
              {holdResources[0].label} — {holdResources[0].remaining}/{holdResources[0].max}
            </span>
          ) : (
            <span className="field-hint" data-casting-resource-empty>
              Sem espaço disponível.
            </span>
          )}
        </div>
        <div className="hp-controls">
          {choices.map((choice) => {
            const key = `${choice.entity.kind}:${choice.entity.id}`;
            const checked = holdPersonTargets.includes(key);
            return (
              <label key={key} className="field-hint">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && holdPersonTargets.length >= holdMax}
                  onChange={(event) => {
                    setHoldEvidence((current) => ({ ...current, groupDistance: false }));
                    setHoldPersonTargets((list) =>
                      event.target.checked
                        ? [...list, key]
                        : list.filter((item) => item !== key),
                    );
                  }}
                />{' '}
                {choice.name}
              </label>
            );
          })}
          {choices.length === 0 ? (
            <span className="field-hint">Nenhum personagem/criatura para escolher.</span>
          ) : null}
        </div>
        <div className="hp-controls" data-targeting-confirmation="hold-person">
          <span className="field-hint" data-targeting-max>
            Alvos: {holdPersonTargets.length} / {holdMax} (filtro: humanoide)
          </span>
          {holdRequirements.map((requirement) => (
            <label key={requirement.key} className="field-hint">
              <input
                type="checkbox"
                checked={holdEvidence[requirement.key]}
                onChange={(event) =>
                  setHoldEvidence((current) => ({
                    ...current,
                    [requirement.key]: event.target.checked,
                  }))
                }
              />{' '}
              {requirement.label}
            </label>
          ))}
        </div>
        <div className="hp-controls">
          <button
            type="button"
            className="btn btn-small"
            disabled={
              locked ||
              proofBlocked ||
              holdPersonTargets.length === 0 ||
              selectedSource === null ||
              !holdChoice ||
              !holdReady
            }
            onClick={() =>
              void run(async () => {
                const targets = holdPersonTargets.flatMap((key) => {
                  const choice = choices.find(
                    (item) => `${item.entity.kind}:${item.entity.id}` === key,
                  );
                  return choice ? [choice.entity] : [];
                });
                if (targets.length === 0 || selectedSource === null || !holdChoice) return;
                await applyHoldPersonEffect({
                  caster: entity,
                  targets,
                  spellcastingSource: { kind: selectedSource.kind, id: selectedSource.id },
                  castingResource: holdChoice,
                  spatialConfirmation: holdEvidence,
                });
                setHoldPersonTargets([]);
                setHoldEvidence(EMPTY_EVIDENCE);
                const refreshed = await fetchCastingState(entity);
                setResources(refreshed.resources);
                setEconomy(refreshed.economy);
              })
            }
          >
            <Icon name="sparkle" size={13} /> Aplicar Imobilizar Pessoa (teste)
          </button>
        </div>
        <p className="field-hint">
          A CD vem do perfil de conjuração do caster (ou do statblock do NPC) — não há campo manual.
          O espaço é real e só diminui: passar no save, cancelar ou perder a Concentração não o devolve.
        </p>
      </details>

      {error ? <p className="error">{error}</p> : null}
      </details>
    </div>
  );
}
