import { useEffect, useRef, useState } from 'react';
import { fileToImagePayload, uploadAvatar } from '../../api';
import { fetchBackgroundCatalog, fetchRaceCatalog } from '../../creationApi';
import { ALIGNMENTS } from '../../dnd';
import { findBackgroundOption, findRaceOption } from '../../races';
import { useSheetAccess } from '../../readonly';
import { FieldInfo } from '../FieldInfo';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { useLightbox } from '../Lightbox';
import { Section } from '../Section';
import type { BackgroundOption, ClassEntry, RaceOption } from '../../types';
import type { SheetSectionProps } from './common';
import { VitalsSection } from './VitalsSection';

/**
 * Foto do personagem: imagem grande, sem moldura nem fundo — o destaque é a
 * própria foto. Sem imagem, um contorno tracejado discreto convida ao clique
 * para enviar uma.
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

/** Junta em "A, B e C" — a leitura natural do resumo de classes. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

interface IdentitySectionProps extends SheetSectionProps {
  /**
   * Level Up transferido para o círculo de nível do cabeçalho. Sem estas props
   * (a visão do mestre não as passa) o círculo é só leitura.
   */
  levelUp?: {
    /** O mestre liberou um Level Up que este jogador ainda não usou. */
    available: boolean;
    /** Aviso do mestre, mostrado no hover do nível. */
    hint: string;
    onOpen: () => void;
  };
}

export function IdentitySection({ character, update, levelUp }: IdentitySectionProps) {
  // O avatar é estado de jogo (segue editável com a criação finalizada); os
  // demais campos da identidade são construção.
  const { readOnly, lockedConstruction } = useSheetAccess();
  const { open: openLightbox } = useLightbox();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Os botões do avatar só aparecem depois de clicar na foto.
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  // Inspiração: por enquanto só o estado visual — a mecânica (concedida pelo
  // mestre) entra depois; o servidor ainda não guarda este campo.
  const [inspired, setInspired] = useState(false);

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
  // Com uma classe só, o subclasse ainda é escolhida no próprio campo; com
  // multiclasse as classes (e os níveis) vivem no hover do círculo de nível.
  const singleClass = classes.length === 1 ? classes[0] : null;

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

  // Resumo de Aumento de Atributo/Talento de cada classe (vai para o tooltip).
  const asiSummary = classes
    .filter((entry) => entry.asiLevels.length > 0)
    .map((entry) => `${entry.className}: níveis ${entry.asiLevels.join(', ')}`)
    .join(' · ');

  // "Mago Nv 1, Guerreiro Nv 2 e Ladino Nv 2" — o detalhe que aparece ao passar
  // o mouse no nível total, sem precisar clicar.
  const classSummary = classes.length
    ? joinList(classes.map((entry) => `${entry.className} Nv ${entry.level}`))
    : '';

  const levelTooltip = [
    classSummary || 'Nenhuma classe definida',
    `XP ${character.experience}`,
    levelUp?.hint || '',
  ]
    .filter(Boolean)
    .join(' · ');

  const unableToPickSubclass = singleClass !== null && !singleClass.subclassEligible;
  const subclassText = singleClass
    ? singleClass.subclassEligible
      ? singleClass.subclass || '—'
      : `nível ${singleClass.subclassLevel}+`
    : joinList(classes.map((entry) => entry.subclass).filter(Boolean)) || '—';

  return (
    <Section title="Personagem" icon="scroll" className="stacked-tip identity-section">
      {uploadError ? <p className="form-error">{uploadError}</p> : null}

      {/*
       * Cabeçalho novo: o retrato "salta" para fora do card (canto superior
       * esquerdo) e, à direita dele, a faixa de nome e raça sobre os quatro
       * campos de papel. Abaixo do retrato ficam o nível (com o Level Up) e a
       * inspiração.
       */}
      <div className="identity-hero">
        <div className="identity-side">
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
                      className={
                        uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'
                      }
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

          {/* Nível total: a faixa e o círculo ficam levemente sobre o retrato. */}
          <div className="identity-level">
            <span className="level-ribbon">Nível</span>
            {levelUp ? (
              <button
                type="button"
                className={levelUp.available ? 'level-circle is-ready' : 'level-circle'}
                title={levelTooltip}
                aria-label={`Nível ${character.level}`}
                aria-disabled={!levelUp.available}
                onClick={() => {
                  if (levelUp.available) levelUp.onOpen();
                }}
              >
                {character.level}
                {levelUp.available ? <span className="level-circle-pip" aria-hidden="true" /> : null}
              </button>
            ) : (
              <span className="level-circle" title={levelTooltip}>
                {character.level}
              </span>
            )}
          </div>

          <button
            type="button"
            className={inspired ? 'inspiration-toggle is-on' : 'inspiration-toggle'}
            aria-pressed={inspired}
            title="Inspiração — a mecânica será implementada em breve (o mestre poderá conceder)"
            onClick={() => setInspired((value) => !value)}
          >
            <Icon name="star" size={15} />
            <span>Inspiração</span>
          </button>
        </div>

        <div className="identity-main">
          {/*
           * Bandeirola que nasce DE TRÁS do retrato: a ponta esquerda fica
           * escondida sob a foto (o retrato tem z-index maior) e a direita
           * termina em V. Nome em destaque e raça logo abaixo, à esquerda.
           */}
          <div className="identity-ribbon">
            <div className="identity-ribbon-inner">
              <InlineField
                className="ribbon-name"
                value={character.name}
                readOnly={lockedConstruction}
                ariaLabel="Nome do personagem"
                onCommit={(value) => {
                  const name = value.trim();
                  if (name) update({ name });
                }}
              />
              <InlineField
                className="ribbon-race"
                value={character.race}
                readOnly={lockedConstruction}
                ariaLabel="Raça"
                placeholder="raça"
                title={raceInfo || 'Clique para editar'}
                onCommit={(value) => update({ race: value.trim() })}
              />
            </div>
          </div>

          {/*
           * Estilo "linha de ficha de papel": valor centralizado em cima, uma
           * linha fina embaixo e o rótulo em caixa alta sob a linha.
           */}
          <div className="identity-line-fields">
            <div className="line-field">
              <div className="line-field-value">
                {classes.length === 0 ? (
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
                ) : (
                  <span className="line-field-text" title={classSummary}>
                    {singleClass ? singleClass.className : 'Multiclasse'}
                  </span>
                )}
              </div>
              <span className="line-field-label">
                Classe
                <FieldInfo>
                  <strong>Aumento de atributo ou talento</strong>
                  <span>{asiSummary || 'Nenhum aumento de atributo ou talento nos níveis atuais.'}</span>
                  <strong>Multiclasse</strong>
                  <span>
                    O nível de cada classe sobe separadamente pelo Level Up e o nível total é a
                    soma. As magias combinadas usam a regra de multiclasse do PHB.
                  </span>
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              <div className="line-field-value">
                {singleClass?.subclassEligible ? (
                  <InlineField
                    value={singleClass.subclass}
                    mode="select"
                    options={singleClass.subclassNames}
                    readOnly={lockedConstruction}
                    ariaLabel={`Subclasse de ${singleClass.className}`}
                    onCommit={(value) => setSubclass(singleClass, value)}
                  />
                ) : (
                  <span
                    className="line-field-text"
                    title={
                      unableToPickSubclass
                        ? `Escolhida a partir do nível ${singleClass.subclassLevel} da classe`
                        : undefined
                    }
                  >
                    {subclassText}
                  </span>
                )}
              </div>
              <span className="line-field-label">
                Subclasse
                <FieldInfo>
                  A especialização da classe, escolhida a partir de um nível (varia por classe).
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              <div className="line-field-value">
                <InlineField
                  value={character.background}
                  readOnly={lockedConstruction}
                  ariaLabel="Antecedente"
                  placeholder="—"
                  onCommit={(value) => update({ background: value.trim() })}
                />
              </div>
              <span className="line-field-label">
                Antecedente
                <FieldInfo>
                  {backgroundInfo ||
                    'A história que veio antes da aventura: define perícias e contatos.'}
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              <div className="line-field-value">
                <InlineField
                  value={character.alignment}
                  mode="select"
                  options={ALIGNMENTS}
                  readOnly={lockedConstruction}
                  ariaLabel="Alinhamento"
                  onCommit={(value) => update({ alignment: value })}
                />
              </div>
              <span className="line-field-label">
                Alinhamento
                <FieldInfo>O código moral e ético do personagem (ex.: Leal e Bom).</FieldInfo>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Vida e Defesa fecha o Personagem, logo abaixo do cabeçalho. */}
      <VitalsSection character={character} update={update} embedded />
    </Section>
  );
}
