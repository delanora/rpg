import { useEffect, useRef, useState } from 'react';
import { fileToImagePayload, uploadAvatar } from '../../api';
import { fetchBackgroundCatalog, fetchRaceCatalog } from '../../creationApi';
import { ALIGNMENTS, hitDieLabel } from '../../dnd';
import { findBackgroundOption, findRaceOption } from '../../races';
import { useSheetAccess } from '../../readonly';
import { clampInt } from '../../utils';
import { FieldInfo } from '../FieldInfo';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { useLightbox } from '../Lightbox';
import { Section } from '../Section';
import type { BackgroundOption, ClassEntry, RaceOption } from '../../types';
import type { SheetSectionProps } from './common';
import { VitalsSection } from './VitalsSection';

/**
 * Foto do personagem no topo da Identidade: imagem grande, sem moldura nem
 * fundo — o destaque é a própria foto. Sem imagem, um contorno tracejado
 * discreto convida ao clique para enviar uma.
 */
function HeroPhoto({ src, name }: { src: string; name: string }) {
  if (!src) {
    return (
      <span className="hero-photo is-empty">
        <Icon name="users" size={54} />
      </span>
    );
  }
  return <img className="hero-photo" src={src} alt={name} />;
}

export function IdentitySection({ character, update }: SheetSectionProps) {
  // O avatar é estado de jogo (segue editável com a criação finalizada); os
  // demais campos da identidade são construção.
  const { readOnly, lockedConstruction } = useSheetAccess();
  const { open: openLightbox } = useLightbox();
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

  // Resumo de Aumento de Atributo/Talento de cada classe (vai para o tooltip).
  const asiSummary = classes
    .filter((entry) => entry.asiLevels.length > 0)
    .map((entry) => `${entry.className}: níveis ${entry.asiLevels.join(', ')}`)
    .join(' · ');

  return (
    <Section title="Personagem" icon="scroll" className="stacked-tip">
      {uploadError ? <p className="form-error">{uploadError}</p> : null}

      {/*
       * A identidade abre com a foto do personagem à esquerda — grande, sem
       * moldura nem fundo — e, ao lado, o que o reconhece: nome, raça,
       * antecedente e alinhamento, com o maior peso da seção. Os números
       * derivados ficam num segundo bloco, menor, para a hierarquia ficar clara.
       */}
      <div className="identity-hero">
        <div className="hero-avatar" ref={avatarRef}>
          {readOnly ? (
            character.avatarUrl ? (
              <button
                type="button"
                className="hero-avatar-trigger"
                title="Ampliar imagem"
                aria-label={`Ampliar imagem de ${character.name}`}
                onClick={() => openLightbox(character.avatarUrl, character.name)}
              >
                <HeroPhoto src={character.avatarUrl} name={character.name} />
              </button>
            ) : (
              <HeroPhoto src="" name={character.name} />
            )
          ) : (
            <>
              <button
                type="button"
                className="hero-avatar-trigger"
                aria-label="Opções do avatar"
                aria-expanded={avatarOpen}
                title={avatarOpen ? 'Fechar opções do avatar' : 'Clique para trocar o avatar'}
                onClick={() => setAvatarOpen((value) => !value)}
              >
                <HeroPhoto src={character.avatarUrl} name={character.name} />
              </button>

              {/* Só aparecem depois de clicar na foto. */}
              {avatarOpen ? (
                <div className="avatar-menu hero-avatar-menu">
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

        <div className="identity-hero-fields">
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

          {/* Raça, antecedente e alinhamento completam o "quem é" do personagem. */}
          <div className="identity-hero-meta">
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
          </div>
        </div>
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
