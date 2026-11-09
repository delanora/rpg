import { CreatureAbilitiesEditor } from './CreatureAbilitiesEditor';
import { MechanicalPanel } from '../MechanicalPanel';
import { useState } from 'react';
import { CreatureField as InlineField } from './CreatureField';
import { InlineField as AttributeField } from '../InlineField';
import { CreatureTokenGallery } from './CreatureTokenGallery';
import { CreatureAttackCards } from './CreatureAttackCards';
import { SPELLS } from '../../../../src/modules/shared/spells';
import './creatures.css';
import { fileToImagePayload, uploadImage } from '../../api';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  DAMAGE_TYPES,
  formatModifier,
  speedInSquares,
} from '../../dnd';
import type {
  Creature,
  CreaturePatch,
  Item,
  Locality,
  Region,
  SpatialSize,
} from '../../types';
import { formatMeters } from '../../combat/grid/distanceFormat';
import {
  CREATURE_SIZE_LABEL_BY_SPATIAL,
  SIZE_FOOTPRINT_FEET,
  SIZE_LABELS,
  SPATIAL_SIZE_ORDER,
} from '../../combat/grid/gridMath';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import { NpcInventorySection } from './NpcInventorySection';

interface DamageChipsProps {
  label: string;
  selected: string[];
  onChange: (value: string[]) => void;
}

/** Seleção de tipos de dano em "chips" — edição direta, salva ao clicar. */
function DamageChips({ label, selected, onChange }: DamageChipsProps) {
  function toggle(type: string): void {
    onChange(
      selected.includes(type)
        ? selected.filter((item) => item !== type)
        : [...selected, type],
    );
  }

  return (
    <div className="chips-field">
      <span className="field-label">{label}</span>
      <div className="chips">
        {DAMAGE_TYPES.map((type) => {
          const active = selected.includes(type);
          return (
            <button
              key={type}
              type="button"
              className={active ? 'chip chip-on' : 'chip'}
              aria-pressed={active}
              onClick={() => toggle(type)}
            >
              {type}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CreatureEditorProps {
  creature: Creature;
  localities: Locality[];
  /** Regiões, usadas para agrupar as localidades no seletor. */
  regions: Region[];
  onPatch: (patch: CreaturePatch) => void;
  onDelete: () => void;
  /** Catálogo de itens (só usado pelo inventário do NPC). */
  items?: Item[];
  /** Atualiza o cadastro após uma escrita do inventário/moedas do NPC. */
  onCreatureChange?: (creature: Creature) => void;
  /** Mensagens de erro do painel (inventário do NPC). */
  onError?: (message: string) => void;
  /**
   * Montado dentro da janela flutuante do painel: o cabeçalho com o nome e o
   * botão de excluir mora no modal, então some daqui para não duplicar.
   */
  embedded?: boolean;
  creating?: boolean;
  saving?: boolean;
  onFinish?: () => void;
}

export function CreatureEditor({
  creature,
  localities,
  regions,
  onPatch,
  onDelete,
  items = [],
  onCreatureChange,
  onError,
  embedded = false,
  creating = false,
  saving = false,
  onFinish,
}: CreatureEditorProps) {
  const [step, setStep] = useState(0);
  const [attackEditing, setAttackEditing] = useState(false);
  const [abilityEditing, setAbilityEditing] = useState(false);
  const [spellQuery, setSpellQuery] = useState('');
  const steps = [
    'Identidade e imagens',
    'Estatísticas',
    'Ações e habilidades',
    'Magias',
    'Revisão',
  ];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const blocked = uploading || saving || attackEditing || abilityEditing;

  /** Envia (ou troca) o ícone/retrato da criatura/NPC. */
  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadImage(
        payload.dataUrl,
        payload.name,
        'creatures',
      );
      onPatch({ imageUrl: image.url });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Falha ao enviar a imagem.',
      );
    } finally {
      setUploading(false);
    }
  }

  // Bônus sugerido para um novo ataque: o melhor entre Força e Destreza.
  const attackBonus = Math.max(
    creature.derived.modifiers.strength,
    creature.derived.modifiers.dexterity,
  );

  // Footprint do tamanho CANÔNICO que o servidor devolve (`spatialSize`); a UI
  // só apresenta em metros, sem criar tabela/conversão paralela.
  const footprint = SIZE_FOOTPRINT_FEET[creature.spatialSize];

  // Mesmo destaque da ficha: a cor é do valor crítico, não do card.
  const hpRatio =
    creature.effectiveMaxHp > 0
      ? creature.hpCurrent / creature.effectiveMaxHp
      : 0;
  const hpClass =
    hpRatio <= 0 ? ' is-down' : hpRatio <= 0.25 ? ' is-critical' : '';

  /** Alterna o vínculo com uma localidade — sempre mantendo ao menos uma. */
  function toggleLocality(id: string): void {
    const current = creature.localities.map((locality) => locality.id);
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];

    if (next.length === 0) return;
    onPatch({ localityIds: next });
  }

  return (
    <div className="creature-editor">
      <nav className="creature-wizard-steps" aria-label="Etapas do cadastro">
        {steps.map((label, index) => (
          <button
            type="button"
            key={label}
            disabled={blocked}
            aria-current={step === index ? 'step' : undefined}
            onClick={() => setStep(index)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <p className="section-note">
        {creating
          ? 'Rascunho: o cadastro será criado apenas ao concluir.'
          : 'As alterações são salvas ao sair de cada campo.'}
      </p>
      <div className="creature-wizard-content" key={step}>
        {embedded ? null : (
          <div className="detail-head">
            <h2>
              <Icon name="flame" size={22} /> {creature.name}
            </h2>
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={onDelete}
            >
              remover {creature.kind === 'NPC' ? 'NPC' : 'criatura'}
            </button>
          </div>
        )}

        {step === 0 ? (
          <Section title="Identificação" icon="scroll">
            <div className="grid grid-3">
              <label className="field">
                <span>Nome</span>
                <InlineField
                  value={creature.name}
                  ariaLabel="Nome da criatura"
                  onCommit={(value) => {
                    const name = value.trim();
                    if (name) onPatch({ name });
                  }}
                />
              </label>

              <label className="field">
                <span>Tipo</span>
                <InlineField
                  value={creature.type}
                  placeholder="Humanoide, Besta, Dragão..."
                  ariaLabel="Tipo da criatura"
                  onCommit={(value) => onPatch({ type: value.trim() })}
                />
              </label>

              <label className="field">
                <span>Nível de Desafio</span>
                <InlineField
                  value={creature.challengeRating}
                  placeholder="ex.: 1/2"
                  ariaLabel="Nível de desafio"
                  onCommit={(value) =>
                    onPatch({ challengeRating: value.trim() })
                  }
                />
              </label>
            </div>
          </Section>
        ) : null}
        {step === 0 ? (
          <Section
            title="Classificação"
            icon="crown"
            subtitle="Criaturas são monstros de combate; NPCs são personagens narrativos"
          >
            <label className="field field-inline">
              <span>Tipo de entidade</span>
              <select
                value={creature.kind}
                aria-label="Tipo de entidade"
                onChange={(event) =>
                  onPatch({ kind: event.target.value as Creature['kind'] })
                }
              >
                <option value="CREATURE">Criatura (combate)</option>
                <option value="NPC">NPC (narrativo)</option>
              </select>
            </label>

            <h3 className="subsection-title">Localidades</h3>
            {localities.length === 0 ? (
              <p className="empty-hint">
                Cadastre uma região e uma localidade nela (aba “Regiões”) para
                poder vincular.
              </p>
            ) : (
              regions.map((region) => {
                const own = localities.filter(
                  (locality) => locality.regionId === region.id,
                );
                if (own.length === 0) return null;

                return (
                  <div key={region.id} className="chip-group">
                    <span className="chip-group-title">{region.name}</span>
                    <div className="chips">
                      {own.map((locality) => {
                        const active = creature.localities.some(
                          (item) => item.id === locality.id,
                        );
                        return (
                          <button
                            key={locality.id}
                            type="button"
                            className={active ? 'chip chip-on' : 'chip'}
                            aria-pressed={active}
                            onClick={() => toggleLocality(locality.id)}
                          >
                            {locality.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </Section>
        ) : null}
        {step === 0 ? (
          <Section
            title="Retrato e tokens"
            icon="star"
            subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB"
          >
            <div className="item-sprite-row">
              <Portrait
                src={creature.imageUrl}
                alt={creature.name}
                size="lg"
                icon={creature.kind === 'NPC' ? 'crown' : 'flame'}
              />
              <div className="toolbar">
                <label
                  className={
                    uploading
                      ? 'btn btn-small file-btn disabled'
                      : 'btn btn-small file-btn'
                  }
                >
                  {uploading
                    ? 'enviando...'
                    : creature.imageUrl
                      ? 'Trocar retrato'
                      : 'Adicionar retrato'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading}
                    onChange={(event) => {
                      void handleFile(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
                {creature.imageUrl ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => onPatch({ imageUrl: '' })}
                  >
                    Remover retrato
                  </button>
                ) : null}
              </div>
            </div>
            {uploadError ? <p className="form-error">{uploadError}</p> : null}
            <CreatureTokenGallery
              creature={creature}
              onPatch={onPatch}
              onBusy={setUploading}
            />
          </Section>
        ) : null}
        {step === 0 ? (
          <Section title="Descrição" icon="quill">
            <InlineField
              value={creature.description}
              mode="textarea"
              placeholder="Aparência, comportamento, táticas, segredos..."
              ariaLabel="Descrição da criatura"
              onCommit={(value) => onPatch({ description: value })}
            />
          </Section>
        ) : null}

        {step === 1 ? (
          <Section title="Atributos" icon="shield">
            <div className="grid grid-abilities">
              {ABILITY_KEYS.map((ability) => (
                <div className="ability-card" key={ability}>
                  <span className="ability-label">
                    {ABILITY_LABELS[ability]}
                  </span>
                  <AttributeField
                    className="ability-score"
                    value={creature[ability]}
                    mode="number"
                    min={1}
                    max={30}
                    ariaLabel={ABILITY_LABELS[ability]}
                    onCommit={(value) =>
                      onPatch({
                        [ability]: clampInt(value, 1, 30, creature[ability]),
                      })
                    }
                  />
                  <span className="ability-modifier">
                    {formatModifier(creature.derived.modifiers[ability])}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {step === 3 ? (
          <Section
            title="Conjuração"
            icon="sparkle"
            subtitle="Informe os valores do bloco de estatísticas. Esta etapa é opcional para quem não conjura magias."
          >
            <div className="grid grid-3">
              <label className="field">
                <span>Atributo de conjuração</span>
                <select
                  value={creature.spellcastingProfile.ability ?? ''}
                  aria-label="Atributo de conjuração"
                  onChange={(event) =>
                    onPatch({
                      spellcastingProfile: {
                        ...creature.spellcastingProfile,
                        ...(event.target.value === ''
                          ? { ability: undefined }
                          : {
                              ability: event.target
                                .value as (typeof ABILITY_KEYS)[number],
                            }),
                      },
                    })
                  }
                >
                  <option value="">Não declarado</option>
                  {ABILITY_KEYS.map((ability) => (
                    <option key={ability} value={ability}>
                      {ABILITY_LABELS[ability]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>CD de magia</span>
                <InlineField
                  value={creature.spellcastingProfile.saveDc ?? ''}
                  mode="number"
                  min={1}
                  max={40}
                  ariaLabel="CD de magia do statblock"
                  onCommit={(value) => {
                    const text = value.trim();
                    onPatch({
                      spellcastingProfile: {
                        ...creature.spellcastingProfile,
                        ...(text === ''
                          ? { saveDc: undefined }
                          : {
                              saveDc: clampInt(
                                text,
                                1,
                                40,
                                creature.spellcastingProfile.saveDc ?? 10,
                              ),
                            }),
                      },
                    });
                  }}
                />
              </label>

              <label className="field">
                <span>Ataque mágico</span>
                <InlineField
                  value={creature.spellcastingProfile.attackBonus ?? ''}
                  mode="number"
                  min={-20}
                  max={40}
                  ariaLabel="Bônus de ataque mágico do statblock"
                  onCommit={(value) => {
                    const text = value.trim();
                    onPatch({
                      spellcastingProfile: {
                        ...creature.spellcastingProfile,
                        ...(text === ''
                          ? { attackBonus: undefined }
                          : {
                              attackBonus: clampInt(
                                text,
                                -20,
                                40,
                                creature.spellcastingProfile.attackBonus ?? 0,
                              ),
                            }),
                      },
                    });
                  }}
                />
              </label>
            </div>
            <p className="section-note">
              O statblock é a autoridade: a CD informada aqui vale mesmo que a
              fórmula de personagem sugerisse outro número. Sem CD, a criatura
              não é fonte de conjuração.
            </p>
            <div className="grid grid-3">
              <fieldset className="creature-slot-editor">
                <legend>Espaços por nível</legend>
                <div className="creature-form-grid">
                  {Array.from({ length: 9 }, (_, i) => i + 1).map((level) => (
                    <label key={level}>
                      Nível {level}
                      <input
                        type="number"
                        min={0}
                        max={20}
                        aria-label={`Espaços de magia de nível ${level}`}
                        value={
                          creature.spellcastingResources.spellSlots.find(
                            (slot) => slot.level === level,
                          )?.max ?? 0
                        }
                        onChange={(e) => {
                          const max = Number(e.target.value);
                          if (!Number.isInteger(max) || max < 0 || max > 20)
                            return;
                          onPatch({
                            spellcastingResources: {
                              ...creature.spellcastingResources,
                              spellSlots: [
                                ...creature.spellcastingResources.spellSlots.filter(
                                  (slot) => slot.level !== level,
                                ),
                                ...(max ? [{ level, max }] : []),
                              ].sort((a, b) => a.level - b.level),
                            },
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>Nível do Pacto</span>
                <InlineField
                  value={creature.spellcastingResources.pactSlot?.level ?? ''}
                  mode="number"
                  min={1}
                  max={9}
                  ariaLabel="Nível do espaço de Pacto"
                  onCommit={(value) => {
                    const text = value.trim();
                    onPatch({
                      spellcastingResources: {
                        ...creature.spellcastingResources,
                        ...(text === ''
                          ? { pactSlot: null }
                          : {
                              pactSlot: {
                                level: clampInt(text, 1, 9, 1),
                                max:
                                  creature.spellcastingResources.pactSlot
                                    ?.max ?? 1,
                              },
                            }),
                      },
                    });
                  }}
                />
              </label>
              <label className="field">
                <span>Espaços de Pacto</span>
                <InlineField
                  value={creature.spellcastingResources.pactSlot?.max ?? ''}
                  mode="number"
                  min={0}
                  max={20}
                  ariaLabel="Quantidade de espaços de Pacto"
                  onCommit={(value) => {
                    const text = value.trim();
                    const level =
                      creature.spellcastingResources.pactSlot?.level ?? 1;
                    onPatch({
                      spellcastingResources: {
                        ...creature.spellcastingResources,
                        pactSlot:
                          text === ''
                            ? null
                            : { level, max: clampInt(text, 0, 20, 0) },
                      },
                    });
                  }}
                />
              </label>
            </div>
            <p className="section-note">
              Informe os espaços de magia que constam no bloco de estatísticas.
              Cada participante tem seu próprio controle de uso durante o
              combate.
            </p>
          </Section>
        ) : null}

        {step === 1 ? (
          <Section title="Vida e Defesa" icon="heart">
            <div className="grid grid-4">
              <div className="vital">
                <span className="vital-label">PV atuais</span>
                <InlineField
                  className={`vital-value${hpClass}`}
                  value={creature.hpCurrent}
                  mode="number"
                  min={-999}
                  max={9999}
                  ariaLabel="Pontos de vida atuais"
                  onCommit={(value) =>
                    onPatch({
                      hpCurrent: clampInt(
                        value,
                        -999,
                        9999,
                        creature.hpCurrent,
                      ),
                    })
                  }
                />
              </div>
              <div className="vital">
                <span className="vital-label">PV máximos</span>
                <InlineField
                  className="vital-value"
                  value={creature.hpMax}
                  mode="number"
                  min={0}
                  max={9999}
                  ariaLabel="Pontos de vida máximos"
                  onCommit={(value) =>
                    onPatch({ hpMax: clampInt(value, 0, 9999, creature.hpMax) })
                  }
                />
              </div>
              <div className="vital">
                <span className="vital-label">Classe de Armadura</span>
                <InlineField
                  className="vital-value"
                  value={creature.armorClass}
                  mode="number"
                  min={0}
                  max={99}
                  ariaLabel="Classe de armadura"
                  onCommit={(value) =>
                    onPatch({
                      armorClass: clampInt(value, 0, 99, creature.armorClass),
                    })
                  }
                />
              </div>{' '}
              <div className="vital">
                <span className="vital-label">Deslocamento</span>
                <span className="vital-value-row">
                  <InlineField
                    className="vital-value"
                    value={creature.speed}
                    mode="number"
                    min={0}
                    max={999}
                    ariaLabel="Deslocamento em metros"
                    onCommit={(value) =>
                      onPatch({
                        speed: clampInt(value, 0, 999, creature.speed),
                      })
                    }
                  />
                  <span className="vital-unit">/m</span>
                </span>
                {/* Mesmo popup dos cards da ficha: aqui só os quadrados do tabuleiro. */}
                <span className="vital-tip" role="tooltip">
                  <strong>Deslocamento</strong>
                  <span>
                    {creature.speed} metros equivalem a{' '}
                    {speedInSquares(creature.speed)} no tabuleiro.
                  </span>
                </span>
              </div>
            </div>
            {/* Tamanho mecânico (6.6M.3.1.4.4): authoring do espaço ocupado no grid. */}
            <label className="field field-inline">
              <span>Tamanho</span>
              <select
                value={creature.spatialSize}
                aria-label="Tamanho da criatura"
                onChange={(event) =>
                  onPatch({
                    size: CREATURE_SIZE_LABEL_BY_SPATIAL[
                      event.target.value as SpatialSize
                    ],
                  })
                }
              >
                {SPATIAL_SIZE_ORDER.map((size) => (
                  <option key={size} value={size}>
                    {SIZE_LABELS[size]}
                  </option>
                ))}
              </select>
              <span className="muted">
                Espaço no grid: {formatMeters(footprint.widthFeet)} ×{' '}
                {formatMeters(footprint.heightFeet)}
              </span>
            </label>

            {creature.kind === 'NPC' ? (
              <p className="section-note">
                CA efetiva com o equipamento:{' '}
                <strong>{creature.effectiveArmorClass}</strong>. O campo acima é
                a CA BASE do statblock — armadura, escudo e bônus mágicos
                equipados entram na conta automaticamente.
              </p>
            ) : null}
          </Section>
        ) : null}

        {step === 2 ? (
          <Section title="Ataques" icon="sword">
            <p className="section-note">
              Informe o alcance corpo a corpo de cada ataque para habilitar sua
              área de ameaça e os ataques de oportunidade.
            </p>
            <CreatureAttackCards
              attacks={creature.attacks}
              defaultBonus={attackBonus}
              onEditingChange={setAttackEditing}
              onChange={(attacks) => onPatch({ attacks })}
            />
          </Section>
        ) : null}

        {step === 2 ? <Section title="Habilidades especiais" icon="sparkle">
          <CreatureAbilitiesEditor abilities={creature.abilities ?? []} onChange={abilities => onPatch({ abilities })} onEditingChange={setAbilityEditing} />
        </Section> : null}

        {step === 4 && !creating && creature.kind === 'NPC' ? (
          <NpcInventorySection
            creature={creature}
            items={items}
            onCreatureChange={onCreatureChange ?? (() => {})}
            onError={onError ?? (() => {})}
          />
        ) : null}

        {step === 1 ? (
          <Section
            title="Resistências, Imunidades e Vulnerabilidades"
            icon="flame"
          >
            <DamageChips
              label="Resistências (½ dano)"
              selected={creature.resistances}
              onChange={(resistances) => onPatch({ resistances })}
            />
            <DamageChips
              label="Imunidades (0 dano)"
              selected={creature.immunities}
              onChange={(immunities) => onPatch({ immunities })}
            />
            <DamageChips
              label="Vulnerabilidades (×2 dano)"
              selected={creature.vulnerabilities}
              onChange={(vulnerabilities) => onPatch({ vulnerabilities })}
            />
          </Section>
        ) : null}

        {step === 3 ? (
          <section className="creature-spell-picks">
            <h3>Magias conhecidas</h3>
            <p className="section-note">
              Selecione o repertório desta criatura. A execução disponível
              depende das magias já suportadas pelo sistema.
            </p>
            <input
              aria-label="Buscar magia do repertório"
              placeholder="Buscar magia"
              value={spellQuery}
              onChange={(e) => setSpellQuery(e.target.value)}
            />
            <div>
              {SPELLS.filter((spell) =>
                spell.namePt.toLowerCase().includes(spellQuery.toLowerCase()),
              ).map((spell) => (
                <label key={spell.id} className="creature-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      creature.spellRepertoire?.spellIds.includes(spell.id) ??
                      false
                    }
                    onChange={() => {
                      const ids = creature.spellRepertoire?.spellIds ?? [];
                      onPatch({
                        spellRepertoire: {
                          spellIds: ids.includes(spell.id)
                            ? ids.filter((id) => id !== spell.id)
                            : [...ids, spell.id],
                        },
                      });
                    }}
                  />
                  {spell.namePt} ·{' '}
                  {spell.level === 0 ? 'Truque' : `Nível ${spell.level}`}
                </label>
              ))}
            </div>
          </section>
        ) : null}
        {step === 4 ? (
          <section className="creature-review">
            <h3>{creature.name || 'Nome não informado'}</h3>
            <p>
              {creature.type || 'Tipo não informado'} ·{' '}
              {SIZE_LABELS[creature.spatialSize]} · ND{' '}
              {creature.challengeRating || '—'}
            </p>
            <div className="creature-review-grid">
              <span>
                <strong>{creature.hpMax}</strong> PV máximos
              </span>
              <span>
                <strong>{creature.armorClass}</strong> CA
              </span>
              <span>
                <strong>{creature.speed} m</strong> Deslocamento
              </span>
              <span>
                <strong>{creature.attacks.length}</strong> Ataques
              </span>
              <span>
                <strong>
                  {creature.tokenImages?.length || (creature.imageUrl ? 1 : 0)}
                </strong>{' '}
                Imagens de token
              </span>
            </div>
            <p>
              Localidades: {creature.localities.map((l) => l.name).join(', ')}
            </p>
            <p>
              Ataques:{' '}
              {creature.attacks.map((a) => a.name).join(', ') || 'Nenhum'}
            </p>
            <p>Habilidades: {creature.abilities?.map(item => item.name).join(', ') || 'Nenhuma'}</p>
            {!creating ? (
              <details>
                <summary>Condições e estado atual</summary>
                <MechanicalPanel
                  entity={{ kind: 'creature', id: creature.id }}
                  refreshVersion={creature.version}
                />
              </details>
            ) : null}
            {creating && creature.kind === 'NPC' ? (
              <p className="section-note">
                O inventário e as moedas ficam disponíveis depois de criar o
                NPC.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      <footer className="creature-wizard-footer">
        <span>
          Etapa {step + 1} de {steps.length}
        </span>
        {attackEditing || abilityEditing ? (
          <small>Salve ou cancele a edição antes de continuar.</small>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={blocked || step === 0}
          onClick={() => setStep(step - 1)}
        >
          Voltar
        </button>
        {step < steps.length - 1 ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked}
            onClick={() => setStep(step + 1)}
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              blocked || !creature.name.trim() || !creature.localities.length
            }
            onClick={onFinish}
          >
            {saving ? 'Salvando…' : creating ? 'Criar cadastro' : 'Concluir'}
          </button>
        )}
      </footer>
    </div>
  );
}
