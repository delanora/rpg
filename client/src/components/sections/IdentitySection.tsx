import { useEffect, useRef, useState } from 'react';
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
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import type { ClassEntry } from '../../types';
import type { SheetSectionProps } from './common';

/** Abreviações dos tipos de conjuração mostradas na grade de Identidade. */
const SPELLCASTING_SHORT: Record<string, string> = {
  full: 'completo',
  half: 'meio',
  third: '1/3',
  pact: 'pacto',
};

/** Abreviações de como as magias são aprendidas. */
const SPELL_LEARNING_SHORT: Record<string, string> = {
  known: 'conhecidas',
  prepared: 'preparadas',
};

export function IdentitySection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Os botões do avatar só aparecem depois de clicar na foto.
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  // Um clique fora do bloco do avatar fecha as opções.
  useEffect(() => {
    if (!avatarOpen) return undefined;

    function onPointerDown(event: globalThis.MouseEvent): void {
      if (!avatarRef.current?.contains(event.target as Node)) setAvatarOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [avatarOpen]);

  /**
   * Avatar da ficha (gravado em `uploads/characters/`). O dono define o
   * próprio; o mestre também pode trocar quando está editando a ficha dele.
   */
  async function handleAvatar(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadAvatar(payload.dataUrl, payload.name);
      update({ avatarUrl: image.url });
      setAvatarOpen(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha ao enviar o avatar.');
    } finally {
      setUploading(false);
    }
  }

  const classes = character.classes;
  const classNames = character.classOptions.map((option) => option.name);

  function classKeyFromName(name: string): string {
    return character.classOptions.find((option) => option.name === name)?.key ?? '';
  }

  /** Troca a subclasse de UMA classe (o nível continua vindo do servidor). */
  function setSubclass(entry: ClassEntry, subclass: string): void {
    update({
      classes: classes.map((item) =>
        item.classKey === entry.classKey
          ? { classKey: item.classKey, subclass }
          : { classKey: item.classKey, subclass: item.subclass },
      ),
    });
  }

  const hitDice = classes.map((entry) => hitDieLabel(entry.hitDie)).join(' / ');
  const casting = classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.type !== 'none')
    .map((entry) => {
      const ability = entry.spellcasting?.ability;
      return (
        `${entry.className}: ${SPELLCASTING_TYPE_LABELS[entry.spellcasting!.type]}` +
        (ability ? ` · ${ABILITY_ABBREVIATIONS[ability]}` : '')
      );
    })
    .join(' · ');
  const learning = classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.learning !== 'none')
    .map((entry) => `${entry.className}: ${SPELL_LEARNING_LABELS[entry.spellcasting!.learning]}`)
    .join(' · ');

  /**
   * Versões curtas exibidas na grade (o texto completo fica no tooltip).
   * Sem isso, "Ladino: Terço-conjurador · INT" ocupava três linhas e empurrava
   * os campos vizinhos.
   */
  const castingShort = classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.type !== 'none')
    .map((entry) => {
      const ability = entry.spellcasting?.ability;
      return (
        `${entry.className} (${SPELLCASTING_SHORT[entry.spellcasting!.type]})` +
        (ability ? ` · ${ABILITY_ABBREVIATIONS[ability]}` : '')
      );
    })
    .join(' · ');
  const learningShort = classes
    .filter((entry) => entry.spellcasting && entry.spellcasting.learning !== 'none')
    .map(
      (entry) =>
        `${entry.className} (${SPELL_LEARNING_SHORT[entry.spellcasting!.learning] ?? entry.spellcasting!.learning})`,
    )
    .join(' · ');

  // Resumo de Aumento de Atributo/Talento de cada classe (vai para o tooltip).
  const asiSummary = classes
    .filter((entry) => entry.asiLevels.length > 0)
    .map((entry) => `${entry.className}: níveis ${entry.asiLevels.join(', ')}`)
    .join(' · ');

  return (
    <Section
      title="Identidade"
      icon="scroll"
      subtitle="Clique em qualquer campo para editar"
      className="stacked-tip"
      actions={
        /* Avatar da ficha no cabeçalho, alinhado à direita. */
        <div className="avatar-head" ref={avatarRef}>
          {readOnly ? (
            <Portrait src={character.avatarUrl} alt={character.name} size="lg" icon="users" />
          ) : (
            <>
              <button
                type="button"
                className="avatar-trigger"
                aria-label="Opções do avatar"
                aria-expanded={avatarOpen}
                title={avatarOpen ? 'Fechar opções do avatar' : 'Clique para trocar o avatar'}
                onClick={() => setAvatarOpen((value) => !value)}
              >
                <Portrait
                  src={character.avatarUrl}
                  alt={character.name}
                  size="lg"
                  icon="users"
                  zoomable={false}
                />
              </button>

              {/* Só aparecem depois de clicar na foto. */}
              {avatarOpen ? (
                <div className="avatar-menu">
                  <label
                    className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}
                  >
                    {uploading
                      ? 'enviando...'
                      : character.avatarUrl
                        ? 'trocar avatar'
                        : '+ adicionar avatar'}
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
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        update({ avatarUrl: '' });
                        setAvatarOpen(false);
                      }}
                    >
                      remover avatar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      }
    >
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

        <div className="field readonly">
          <span>Nível total</span>
          <strong>{character.level}</strong>
        </div>

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
          <strong>{hitDice || '—'}</strong>
        </div>

        <div className="field readonly">
          <span>Bônus de proficiência</span>
          <strong>+{character.derived.proficiencyBonus}</strong>
        </div>

        <div className="field readonly field-wide">
          <span>Conjuração</span>
          <strong title={casting || undefined}>{castingShort || '—'}</strong>
        </div>

        <div className="field readonly field-wide">
          <span>Magias</span>
          <strong title={learning || undefined}>{learningShort || '—'}</strong>
        </div>
      </div>

      <h3 className="subsection-title">
        Classes
        <span className="info-tip" tabIndex={0}>
          <Icon name="info" size={14} />
          <span className="info-tip-text" role="tooltip">
            <strong>Aumento de atributo ou talento</strong>
            <span>{asiSummary || 'Nenhum aumento de atributo ou talento nos níveis atuais.'}</span>
            <strong>Multiclasse</strong>
            <span>
              O nível de cada classe sobe separadamente pelo Level Up e o nível total é a soma.
              As magias combinadas usam a regra de multiclasse do PHB.
            </span>
          </span>
        </span>
      </h3>

      {classes.length === 0 ? (
        <div className="class-list">
          <p className="section-note">
            A ficha ainda não tem classe. Escolha a primeira abaixo — o nível sobe pelo botão
            Level Up, quando o mestre liberar.
          </p>
          <label className="field">
            <span>Primeira classe</span>
            <InlineField
              value=""
              mode="select"
              options={classNames}
              ariaLabel="Classe do personagem"
              onCommit={(value) => {
                const key = classKeyFromName(value);
                if (key) update({ classes: [{ classKey: key }] });
              }}
            />
          </label>
        </div>
      ) : (
        <ul className="class-list">
          {classes.map((entry) => (
            <li className="class-row" key={entry.classKey}>
              <span className="class-name">
                {entry.className} <em className="class-level">Nv {entry.level}</em>
              </span>

              {entry.subclassEligible ? (
                <label className="field class-subclass">
                  <span>Subclasse</span>
                  <InlineField
                    value={entry.subclass}
                    mode="select"
                    options={entry.subclassNames}
                    ariaLabel={`Subclasse de ${entry.className}`}
                    onCommit={(value) => setSubclass(entry, value)}
                  />
                </label>
              ) : (
                <div
                  className="field readonly class-subclass"
                  title={`Escolhida a partir do nível ${entry.subclassLevel} da classe`}
                >
                  <span>Subclasse</span>
                  <strong>nível {entry.subclassLevel}+</strong>
                </div>
              )}

            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
