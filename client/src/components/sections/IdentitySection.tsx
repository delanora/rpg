import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fileToImagePayload, uploadAvatar } from '../../api';
import { fetchBackgroundCatalog, fetchRaceCatalog } from '../../creationApi';
import {
  ABILITY_ABBREVIATIONS,
  ALIGNMENTS,
  SPELLCASTING_TYPE_LABELS,
  SPELL_LEARNING_LABELS,
  formatModifier,
  hitDieLabel,
} from '../../dnd';
import { findBackgroundOption, findRaceOption } from '../../races';
import { useSheetAccess } from '../../readonly';
import { clampInt } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';
import type { BackgroundOption, ClassEntry, RaceOption } from '../../types';
import type { SheetSectionProps } from './common';
import { VitalsSection } from './VitalsSection';

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

/**
 * "i" ao lado do rótulo de um campo: explica em uma frase o que aquilo é.
 * O texto vive no tooltip, sem ocupar espaço permanente na ficha.
 */
function FieldInfo({ children }: { children: ReactNode }) {
  return (
    <span className="info-tip field-info" tabIndex={0}>
      <Icon name="info" size={12} />
      <span className="info-tip-text" role="tooltip">
        {children}
      </span>
    </span>
  );
}

export function IdentitySection({ character, update }: SheetSectionProps) {
  // O avatar é estado de jogo (segue editável com a criação finalizada); os
  // demais campos da identidade são construção.
  const { readOnly, lockedConstruction } = useSheetAccess();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Os botões do avatar só aparecem depois de clicar na foto.
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  // Catálogos do livro: dão a descrição de raça e antecedente mostrada no "i".
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [backgrounds, setBackgrounds] = useState<BackgroundOption[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchRaceCatalog(), fetchBackgroundCatalog()]).then(
      ([raceCatalog, backgroundCatalog]) => {
        if (!active) return;
        setRaces(raceCatalog);
        setBackgrounds(backgroundCatalog);
      },
    );
    return () => {
      active = false;
    };
  }, []);

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

  // Descrições do catálogo para os "i" de raça e antecedente.
  const raceInfo = findRaceOption(races, character.race)?.description;
  const backgroundInfo = findBackgroundOption(backgrounds, character.background)?.description;

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

  const spellcasting = character.derived.spellcasting;

  return (
    <Section
      title="Personagem"
      icon="scroll"
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

      {/*
       * A identidade propriamente dita (Nome, Raça e Antecedente) vem primeiro e
       * com mais peso: é o que reconhece o personagem. Os números derivados
       * ficam num segundo bloco, menor, para a hierarquia ficar clara.
       */}
      <div className="identity-primary">
        <label className="field identity-name">
          <span>
            Nome
            <FieldInfo>Como o personagem é chamado pela companhia e pelos NPCs.</FieldInfo>
          </span>
          <InlineField
            value={character.name}
            readOnly={lockedConstruction}
            ariaLabel="Nome do personagem"
            onCommit={(value) => {
              const name = value.trim();
              if (name) update({ name });
            }}
          />
        </label>

        <label className="field">
          <span>
            Raça
            <FieldInfo>{raceInfo || 'A raça escolhida na criação dá bônus e traços raciais.'}</FieldInfo>
          </span>
          <InlineField
            value={character.race}
            readOnly={lockedConstruction}
            ariaLabel="Raça"
            placeholder="ex.: Anão"
            onCommit={(value) => update({ race: value.trim() })}
          />
        </label>

        <label className="field">
          <span>
            Antecedente
            <FieldInfo>
              {backgroundInfo ||
                'A história que veio antes da aventura: define perícias e contatos.'}
            </FieldInfo>
          </span>
          <InlineField
            value={character.background}
            readOnly={lockedConstruction}
            ariaLabel="Antecedente"
            placeholder="ex.: Sábio"
            onCommit={(value) => update({ background: value.trim() })}
          />
        </label>
      </div>

      <div className="grid grid-3 identity-grid">
        <div className="field readonly">
          <span>
            Nível total
            <FieldInfo>Soma dos níveis de todas as classes do personagem.</FieldInfo>
          </span>
          <strong>{character.level}</strong>
        </div>

        <label className="field">
          <span>
            Alinhamento
            <FieldInfo>O código moral e ético do personagem (ex.: Leal e Bom).</FieldInfo>
          </span>
          <InlineField
            value={character.alignment}
            mode="select"
            options={ALIGNMENTS}
            readOnly={lockedConstruction}
            ariaLabel="Alinhamento"
            onCommit={(value) => update({ alignment: value })}
          />
        </label>

        <label className="field">
          <span>
            Experiência (XP)
            <FieldInfo>Pontos acumulados; o mestre decide quando rende um novo nível.</FieldInfo>
          </span>
          <InlineField
            value={character.experience}
            mode="number"
            min={0}
            readOnly={lockedConstruction}
            ariaLabel="Pontos de experiência"
            onCommit={(value) =>
              update({ experience: clampInt(value, 0, 99_999_999, character.experience) })
            }
          />
        </label>

        <div className="field readonly">
          <span>
            Dado de vida
            <FieldInfo>
              Dado de cada classe, usado para recuperar PV no descanso curto.
            </FieldInfo>
          </span>
          <strong>{hitDice || '—'}</strong>
        </div>

        <div className="field readonly">
          <span>
            Bônus de proficiência
            <FieldInfo>
              Somado a ataques, testes de resistência e perícias proficientes; cresce com o nível
              total.
            </FieldInfo>
          </span>
          <strong>+{character.derived.proficiencyBonus}</strong>
        </div>
      </div>

      {/*
       * Conjuração num bloco único: tipos de conjuração, como cada classe aprende
       * as magias e o resumo de CD/ataque que antes ficava solto no rodapé.
       */}
      <div className="casting-block">
        <span className="casting-title">
          Conjuração
          <FieldInfo>
            Como cada classe conjura magias, a CD para resistir a elas e o bônus de ataque mágico.
          </FieldInfo>
        </span>

        {spellcasting ? (
          <div className="casting-summary">
            <span className="casting-stat">
              <em>CD</em>
              <b>{spellcasting.saveDC}</b>
            </span>
            <span className="casting-stat">
              <em>ataque</em>
              <b>{formatModifier(spellcasting.attackBonus)}</b>
            </span>
          </div>
        ) : null}

        <p className="casting-detail">
          <em>Conjuração</em>
          <span title={casting || undefined}>{castingShort || '—'}</span>
        </p>
        <p className="casting-detail">
          <em>Magias</em>
          <span title={learning || undefined}>{learningShort || '—'}</span>
        </p>
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
              readOnly={lockedConstruction}
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
                    readOnly={lockedConstruction}
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

      {/* Vida e Defesa fecha o Personagem, logo abaixo das classes. */}
      <VitalsSection character={character} update={update} embedded />
    </Section>
  );
}
