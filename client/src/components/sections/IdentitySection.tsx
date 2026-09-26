import { useState } from 'react';
import { fileToImagePayload, uploadAvatar } from '../../api';
import {
  ABILITY_ABBREVIATIONS,
  ALIGNMENTS,
  SPELLCASTING_TYPE_LABELS,
  SPELL_LEARNING_LABELS,
  hitDieLabel,
} from '../../dnd';
import { useReadOnly } from '../../readonly';
import { clampInt } from '../../utils';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function IdentitySection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** O jogador define o próprio avatar (gravado em `uploads/characters/`). */
  async function handleAvatar(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadAvatar(payload.dataUrl, payload.name);
      update({ avatarUrl: image.url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha ao enviar o avatar.');
    } finally {
      setUploading(false);
    }
  }

  const definition = character.classDefinition;
  const classNames = character.classCatalog.map((item) => item.name);
  const subclassEligible = definition !== null && character.level >= definition.subclassLevel;
  const subclassNames = definition?.subclasses.map((item) => item.name) ?? [];

  function classKeyFromName(name: string): string {
    return character.classCatalog.find((item) => item.name === name)?.key ?? '';
  }

  const spellcastingLabel = definition
    ? SPELLCASTING_TYPE_LABELS[definition.spellcasting.type] +
      (definition.spellcasting.ability
        ? ` · ${ABILITY_ABBREVIATIONS[definition.spellcasting.ability]}`
        : '')
    : '—';

  return (
    <Section title="Identidade" icon="scroll" subtitle="Clique em qualquer campo para editar">
      <div className="avatar-row">
        <Portrait src={character.avatarUrl} alt={character.name} size="lg" icon="users" />
        {readOnly ? null : (
          <div className="toolbar">
            <label className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}>
              {uploading ? 'enviando...' : character.avatarUrl ? 'trocar avatar' : '+ adicionar avatar'}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(event) => {
                  void handleAvatar(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            {character.avatarUrl ? (
              <button type="button" className="btn btn-small" onClick={() => update({ avatarUrl: '' })}>
                remover avatar
              </button>
            ) : null}
          </div>
        )}
      </div>
      {uploadError ? <p className="form-error">{uploadError}</p> : null}

      <div className="grid grid-3">
        <label className="field">
          <span>Nome</span>
          <InlineField
            value={character.name}
            ariaLabel="Nome do personagem"
            onCommit={(value) => {
              const name = value.trim();
              if (name) update({ name });
            }}
          />
        </label>

        <label className="field">
          <span>Raça</span>
          <InlineField
            value={character.race}
            ariaLabel="Raça"
            placeholder="ex.: Anão"
            onCommit={(value) => update({ race: value.trim() })}
          />
        </label>

        <label className="field">
          <span>Classe</span>
          <InlineField
            value={definition?.name ?? ''}
            mode="select"
            options={classNames}
            ariaLabel="Classe do personagem"
            onCommit={(value) => update({ classKey: classKeyFromName(value) })}
          />
        </label>

        {definition !== null && subclassEligible ? (
          <label className="field">
            <span>Subclasse</span>
            <InlineField
              value={character.subclass}
              mode="select"
              options={subclassNames}
              ariaLabel="Subclasse"
              onCommit={(value) => update({ subclass: value })}
            />
          </label>
        ) : (
          <div
            className="field readonly"
            title={definition ? `Escolhida a partir do nível ${definition.subclassLevel}` : undefined}
          >
            <span>Subclasse</span>
            <strong>{definition ? `nível ${definition.subclassLevel}+` : '—'}</strong>
          </div>
        )}

        <label className="field">
          <span>Nível</span>
          <InlineField
            value={character.level}
            mode="number"
            min={1}
            max={20}
            ariaLabel="Nível"
            onCommit={(value) => update({ level: clampInt(value, 1, 20, character.level) })}
          />
        </label>

        <label className="field">
          <span>Antecedente</span>
          <InlineField
            value={character.background}
            ariaLabel="Antecedente"
            placeholder="ex.: Sábio"
            onCommit={(value) => update({ background: value.trim() })}
          />
        </label>

        <label className="field">
          <span>Alinhamento</span>
          <InlineField
            value={character.alignment}
            mode="select"
            options={ALIGNMENTS}
            ariaLabel="Alinhamento"
            onCommit={(value) => update({ alignment: value })}
          />
        </label>

        <label className="field">
          <span>Experiência (XP)</span>
          <InlineField
            value={character.experience}
            mode="number"
            min={0}
            ariaLabel="Pontos de experiência"
            onCommit={(value) =>
              update({ experience: clampInt(value, 0, 99_999_999, character.experience) })
            }
          />
        </label>

        <div className="field readonly">
          <span>Dado de vida</span>
          <strong>{hitDieLabel(definition?.hitDie ?? null)}</strong>
        </div>

        <div className="field readonly">
          <span>Conjuração</span>
          <strong>{spellcastingLabel}</strong>
        </div>

        <div className="field readonly">
          <span>Magias</span>
          <strong>{definition ? SPELL_LEARNING_LABELS[definition.spellcasting.learning] : '—'}</strong>
        </div>

        <div className="field readonly">
          <span>Bônus de proficiência</span>
          <strong>+{character.derived.proficiencyBonus}</strong>
        </div>
      </div>
    </Section>
  );
}
