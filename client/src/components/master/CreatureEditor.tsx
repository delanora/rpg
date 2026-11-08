import { MechanicalPanel } from '../MechanicalPanel';
import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  DAMAGE_TYPES,
  formatModifier,
  speedInSquares,
} from '../../dnd';
import type { Creature, CreaturePatch, Item, Locality, Region, SpatialSize } from '../../types';
import { formatMeters } from '../../combat/grid/distanceFormat';
import {
  CREATURE_SIZE_LABEL_BY_SPATIAL,
  SIZE_FOOTPRINT_FEET,
  SIZE_LABELS,
  SPATIAL_SIZE_ORDER,
} from '../../combat/grid/gridMath';
import { clampInt } from '../../utils';
import { AttacksTable } from '../AttacksTable';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
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
      selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type],
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
}: CreatureEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** Envia (ou troca) o ícone/retrato da criatura/NPC. */
  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadImage(payload.dataUrl, payload.name, 'creatures');
      onPatch({ imageUrl: image.url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha ao enviar a imagem.');
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
  const hpRatio = creature.effectiveMaxHp > 0 ? creature.hpCurrent / creature.effectiveMaxHp : 0;
  const hpClass = hpRatio <= 0 ? ' is-down' : hpRatio <= 0.25 ? ' is-critical' : '';

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
      <MechanicalPanel entity={{ kind: 'creature', id: creature.id }} refreshVersion={creature.version} />
      {embedded ? null : (
        <div className="detail-head">
          <h2>
            <Icon name="flame" size={22} /> {creature.name}
          </h2>
          <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
            remover {creature.kind === 'NPC' ? 'NPC' : 'criatura'}
          </button>
        </div>
      )}

      <Section title="Ícone" icon="star" subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB">
        <div className="item-sprite-row">
          <Portrait
            src={creature.imageUrl}
            alt={creature.name}
            size="lg"
            icon={creature.kind === 'NPC' ? 'crown' : 'flame'}
          />
          <div className="toolbar">
            <label className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}>
              {uploading ? 'enviando...' : creature.imageUrl ? 'trocar ícone' : '+ adicionar ícone'}
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
                remover ícone
              </button>
            ) : null}
          </div>
        </div>
        {uploadError ? <p className="form-error">{uploadError}</p> : null}
      </Section>

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
              onCommit={(value) => onPatch({ challengeRating: value.trim() })}
            />
          </label>
        </div>
      </Section>

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
            onChange={(event) => onPatch({ kind: event.target.value as Creature['kind'] })}
          >
            <option value="CREATURE">Criatura (combate)</option>
            <option value="NPC">NPC (narrativo)</option>
          </select>
        </label>

        <h3 className="subsection-title">Localidades</h3>
        {localities.length === 0 ? (
          <p className="empty-hint">
            Cadastre uma região e uma localidade nela (aba “Regiões”) para poder vincular.
          </p>
        ) : (
          regions.map((region) => {
            const own = localities.filter((locality) => locality.regionId === region.id);
            if (own.length === 0) return null;

            return (
              <div key={region.id} className="chip-group">
                <span className="chip-group-title">{region.name}</span>
                <div className="chips">
                  {own.map((locality) => {
                    const active = creature.localities.some((item) => item.id === locality.id);
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

      <Section title="Atributos" icon="shield">
        <div className="grid grid-abilities">
          {ABILITY_KEYS.map((ability) => (
            <div className="ability-card" key={ability}>
              <span className="ability-label">{ABILITY_LABELS[ability]}</span>
              <InlineField
                className="ability-score"
                value={creature[ability]}
                mode="number"
                min={1}
                max={30}
                ariaLabel={ABILITY_LABELS[ability]}
                onCommit={(value) =>
                  onPatch({ [ability]: clampInt(value, 1, 30, creature[ability]) })
                }
              />
              <span className="ability-modifier">
                {formatModifier(creature.derived.modifiers[ability])}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Conjuração"
        icon="sparkle"
        subtitle="Perfil EXPLÍCITO do statblock — a Spell Execution Engine usa estes valores, sem recalcular pelo nível de classe"
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
                      : { ability: event.target.value as (typeof ABILITY_KEYS)[number] }),
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
                      : { saveDc: clampInt(text, 1, 40, creature.spellcastingProfile.saveDc ?? 10) }),
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
          O statblock é a autoridade: a CD informada aqui vale mesmo que a fórmula de
          personagem sugerisse outro número. Sem CD, a criatura não é fonte de conjuração.
        </p>
        <div className="grid grid-3">
          <label className="field">
            <span>Espaços normais</span>
            <InlineField
              value={creature.spellcastingResources.spellSlots
                .map((slot) => `${slot.level}:${slot.max}`)
                .join(', ')}
              ariaLabel="Espaços de magia normais (nível:quantidade)"
              onCommit={(value) => {
                const spellSlots = value
                  .split(',')
                  .flatMap((part) => {
                    const [levelText, maxText] = part.split(':').map((item) => item.trim());
                    const level = clampInt(levelText ?? '', 1, 9, 0);
                    const max = clampInt(maxText ?? '', 0, 20, 0);
                    return level > 0 && max > 0 ? [{ level, max }] : [];
                  })
                  .filter(
                    (slot, index, list) =>
                      list.findIndex((item) => item.level === slot.level) === index,
                  );
                onPatch({
                  spellcastingResources: {
                    ...creature.spellcastingResources,
                    spellSlots,
                  },
                });
              }}
            />
          </label>
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
                            max: creature.spellcastingResources.pactSlot?.max ?? 1,
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
                const level = creature.spellcastingResources.pactSlot?.level ?? 1;
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
          Os espaços são gastos no COMMIT de cada conjuração e NÃO recuperam sozinhos. Sem
          espaços declarados, a criatura não conjura (nada de progressão inferida pelo ND).
        </p>
      </Section>

      <Section title="Vida e Defesa" icon="heart">
        <div className="grid grid-4">
          <div className="vital">
            <span className="vital-label">HP atual</span>
            <InlineField
              className={`vital-value${hpClass}`}
              value={creature.hpCurrent}
              mode="number"
              min={-999}
              max={9999}
              ariaLabel="Pontos de vida atuais"
              onCommit={(value) =>
                onPatch({ hpCurrent: clampInt(value, -999, 9999, creature.hpCurrent) })
              }
            />
          </div>

          <div className="vital">
            <span className="vital-label">HP máximo</span>
            <InlineField
              className="vital-value"
              value={creature.hpMax}
              mode="number"
              min={0}
              max={9999}
              ariaLabel="Pontos de vida máximos"
              onCommit={(value) => onPatch({ hpMax: clampInt(value, 0, 9999, creature.hpMax) })}
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
                onPatch({ armorClass: clampInt(value, 0, 99, creature.armorClass) })
              }
            />
          </div>          <div className="vital">
            <span className="vital-label">Deslocamento</span>
            <span className="vital-value-row">
              <InlineField
                className="vital-value"
                value={creature.speed}
                mode="number"
                min={0}
                max={999}
                ariaLabel="Deslocamento em metros"
                onCommit={(value) => onPatch({ speed: clampInt(value, 0, 999, creature.speed) })}
              />
              <span className="vital-unit">/m</span>
            </span>
            {/* Mesmo popup dos cards da ficha: aqui só os quadrados do tabuleiro. */}
            <span className="vital-tip" role="tooltip">
              <strong>Deslocamento</strong>
              <span>
                {creature.speed} metros equivalem a {speedInSquares(creature.speed)} no
                tabuleiro.
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
                size: CREATURE_SIZE_LABEL_BY_SPATIAL[event.target.value as SpatialSize],
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
            CA efetiva com o equipamento: <strong>{creature.effectiveArmorClass}</strong>.
            O campo acima é a CA BASE do statblock — armadura, escudo e bônus mágicos
            equipados entram na conta automaticamente.
          </p>
        ) : null}
      </Section>

      <Section title="Ataques" icon="sword">
        <AttacksTable
          attacks={creature.attacks}
          defaultBonus={attackBonus}
          onChange={(attacks) => onPatch({ attacks })}
        />
      </Section>

      {creature.kind === 'NPC' ? (
        <NpcInventorySection
          creature={creature}
          items={items}
          onCreatureChange={onCreatureChange ?? (() => {})}
          onError={onError ?? (() => {})}
        />
      ) : null}

      <Section title="Resistências, Imunidades e Vulnerabilidades" icon="flame">
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

      <Section title="Descrição" icon="quill">
        <InlineField
          value={creature.description}
          mode="textarea"
          placeholder="Aparência, comportamento, táticas, segredos..."
          ariaLabel="Descrição da criatura"
          onCommit={(value) => onPatch({ description: value })}
        />
      </Section>
    </div>
  );
}
