import { useEffect, useRef, useState } from 'react';
import { fileToImagePayload, uploadAvatar } from '../../api';
import { fetchBackgroundCatalog, fetchRaceCatalog } from '../../creationApi';
import { ABILITY_LABELS, ALIGNMENTS, SKILLS, alignmentDescription } from '../../dnd';
import { fetchCompendium } from '../../gameApi';
import { findBackgroundOption, findRaceOption } from '../../races';
import { useSheetAccess } from '../../readonly';
import { FieldInfo } from '../FieldInfo';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { useLightbox } from '../Lightbox';
import { Section } from '../Section';
import type { BackgroundOption, ClassEntry, Compendium, RaceOption } from '../../types';
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
  //
  // O compêndio é a MESMA fonte da aba "Mesa" do mestre e está aberto ao
  // jogador: dele saem a descrição da classe e o que cada subclasse é.
  const [compendium, setCompendium] = useState<Compendium | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchRaceCatalog(), fetchBackgroundCatalog(), fetchCompendium()]).then(
      ([raceCatalog, backgroundCatalog, book]) => {
        if (!active) return;
        setRaces(raceCatalog);
        setBackgrounds(backgroundCatalog);
        setCompendium(book);
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

  // Descrições do catálogo para o "i" de raça e para o popup do antecedente.
  const raceInfo = findRaceOption(races, character.race)?.description;
  const backgroundOption = findBackgroundOption(backgrounds, character.background);
  const backgroundInfo = backgroundOption?.description;
  // Perícias concedidas pelo antecedente escolhido (chaves -> nomes do livro).
  const backgroundSkills = (backgroundOption?.skills ?? [])
    .map((key) => SKILLS.find((skill) => skill.key === key)?.label ?? key)
    .join(', ');

  /** Classe do compêndio (descrição, dado de vida, salvaguardas). */
  function bookClass(key: string) {
    return compendium?.classes.find((item) => item.key === key) ?? null;
  }

  /** O que a subclasse escolhida é, segundo o compêndio. */
  function bookSubclass(classKey: string, name: string): string {
    return bookClass(classKey)?.subclasses.find((item) => item.name === name)?.description ?? '';
  }

  /** "Destreza e Inteligência" — as salvaguardas da classe, do compêndio. */
  function savingThrowLabels(key: string): string {
    return (bookClass(key)?.savingThrows ?? [])
      .map((ability) => ABILITY_LABELS[ability])
      .join(' e ');
  }

  // "Mago Nv 1, Guerreiro Nv 2 e Ladino Nv 2" — detalhe do hover no nível total.
  const classSummary = classes.length
    ? joinList(classes.map((entry) => `${entry.className} Nv ${entry.level}`))
    : '';

  // Subclasses já escolhidas. Com mais de uma, o campo vira "Multiclasse" e o
  // popup explica cada uma delas.
  const chosenSubclasses = classes.filter((entry) => entry.subclass !== '');
  const multiclassSubclasses = classes.length > 1 && chosenSubclasses.length > 1;
  const subclassText = singleClass
    ? singleClass.subclassEligible
      ? singleClass.subclass || '—'
      : `nível ${singleClass.subclassLevel}+`
    : multiclassSubclasses
      ? 'Multiclasse'
      : joinList(chosenSubclasses.map((entry) => entry.subclass)) || '—';

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
           * O nível vive na MESMA linha da grade dos campos de papel, com o
           * centro do círculo na altura da linha que divide valor e rótulo.
           * A explicação abre no MESMO tooltip dos "i" dos campos (não no balão
           * nativo do navegador): quem tem Level Up liberado vê o resumo das
           * classes, o XP e o aviso do mestre.
           */}
          <div className="identity-level">
            <span className="level-ribbon">Nível</span>
            <span className="info-tip level-info" tabIndex={levelUp ? undefined : 0}>
              {levelUp ? (
                <button
                  type="button"
                  className={levelUp.available ? 'level-circle is-ready' : 'level-circle'}
                  aria-label={`Nível ${character.level}`}
                  aria-disabled={!levelUp.available}
                  onClick={() => {
                    if (levelUp.available) levelUp.onOpen();
                  }}
                >
                  {character.level}
                  {levelUp.available ? (
                    <span className="level-circle-pip" aria-hidden="true" />
                  ) : null}
                </button>
              ) : (
                <span className="level-circle">{character.level}</span>
              )}
              <span className="info-tip-text" role="tooltip">
                <strong>Nível {character.level}</strong>
                <span>{classSummary || 'Nenhuma classe definida'}</span>
                <span>XP {character.experience}</span>
                {levelUp?.hint ? <span>{levelUp.hint}</span> : null}
              </span>
            </span>
          </div>

          {/*
           * Estilo "linha de ficha de papel": valor centralizado em cima, uma
           * linha fina embaixo e o rótulo em caixa alta sob a linha.
           */}
          <div className="identity-line-fields">
            <div className="line-field">
              {/*
               * O "i" explica o conceito de CLASSE; o VALOR mostra o que a classe
               * escolhida é (descrição, dado de vida, salvaguardas e o que ela
               * pede em cada nível).
               */}
              <div
                className={
                  classes.length === 0
                    ? 'line-field-value'
                    : 'line-field-value info-tip identity-value-tip'
                }
              >
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
                  <span className="line-field-text">
                    {singleClass ? singleClass.className : 'Multiclasse'}
                  </span>
                )}
                {classes.length === 0 ? null : (
                  <span className="info-tip-text" role="tooltip">
                    {singleClass ? (
                      <>
                        <strong>{singleClass.className}</strong>
                        {bookClass(singleClass.classKey) ? (
                          <span>{bookClass(singleClass.classKey)?.description}</span>
                        ) : null}
                        <span>
                          Dado de vida 1d{singleClass.hitDie} · Salvaguardas{' '}
                          {savingThrowLabels(singleClass.classKey) || '—'}
                        </span>
                        {singleClass.asiLevels.length > 0 ? (
                          <span>
                            Aumento de atributo ou talento nos níveis{' '}
                            {singleClass.asiLevels.join(', ')}
                          </span>
                        ) : null}
                        <span>
                          {singleClass.subclassEligible
                            ? `Subclasse: ${singleClass.subclass || 'ainda não escolhida'}`
                            : `Subclasse a partir do nível ${singleClass.subclassLevel} da classe`}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>Multiclasse</strong>
                        <span>
                          O nível total é a soma das classes, mas cada uma sobe de nível pelo Level
                          Up e mantém as próprias características.
                        </span>
                        {classes.map((entry) => (
                          <span key={entry.classKey}>
                            {entry.className} · nível {entry.level}
                            {bookClass(entry.classKey) ? `: ${bookClass(entry.classKey)?.description}` : ''}
                          </span>
                        ))}
                      </>
                    )}
                  </span>
                )}
              </div>
              <span className="line-field-label">
                Classe
                <FieldInfo>
                  <strong>Classe</strong>
                  <span>
                    O arquétipo do personagem — guerreiro, mago, ladino... Define o dado de vida, as
                    salvaguardas, as proficiências e as características que ele ganha a cada nível.
                  </span>
                  <span>
                    Cada classe sobe de nível pelo Level Up; com mais de uma, o personagem é
                    multiclasse e o nível total é a soma delas.
                  </span>
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              {/*
               * Com uma classe, o popup lista as subclasses dela com a descrição
               * do livro; com mais de uma escolhida, o valor vira "Multiclasse" e
               * o popup explica cada subclasse escolhida.
               */}
              <div className="line-field-value info-tip identity-value-tip">
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
                  <span className="line-field-text">{subclassText}</span>
                )}
                <span className="info-tip-text" role="tooltip">
                  {singleClass ? (
                    singleClass.subclassEligible ? (
                      <>
                        <strong>Subclasses de {singleClass.className}</strong>
                        {singleClass.subclassNames.map((name) => (
                          <span key={name}>
                            {name}: {bookSubclass(singleClass.classKey, name) || '—'}
                          </span>
                        ))}
                      </>
                    ) : (
                      <>
                        <strong>Subclasse</strong>
                        <span>
                          {singleClass.className} escolhe a subclasse a partir do nível{' '}
                          {singleClass.subclassLevel}. Ela troca ou acrescenta características à
                          classe.
                        </span>
                      </>
                    )
                  ) : multiclassSubclasses ? (
                    <>
                      <strong>Multiclasse</strong>
                      <span>Uma subclasse para cada classe:</span>
                      {chosenSubclasses.map((entry) => (
                        <span key={entry.classKey}>
                          {entry.className} · {entry.subclass}:{' '}
                          {bookSubclass(entry.classKey, entry.subclass) || '—'}
                        </span>
                      ))}
                    </>
                  ) : chosenSubclasses.length === 1 ? (
                    <>
                      <strong>
                        {chosenSubclasses[0].className} · {chosenSubclasses[0].subclass}
                      </strong>
                      <span>
                        {bookSubclass(chosenSubclasses[0].classKey, chosenSubclasses[0].subclass) ||
                          '—'}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Subclasse</strong>
                      <span>Uma para cada classe do personagem:</span>
                      {classes.map((entry) => (
                        <span key={entry.classKey}>
                          {entry.className}:{' '}
                          {entry.subclassEligible
                            ? 'ainda não escolhida'
                            : `a partir do nível ${entry.subclassLevel}`}
                        </span>
                      ))}
                    </>
                  )}
                </span>
              </div>
              <span className="line-field-label">
                Subclasse
                <FieldInfo>
                  <strong>Subclasse</strong>
                  <span>
                    A especialização da classe — a partir de um nível (varia por classe), ela troca
                    ou acrescenta características de classe.
                  </span>
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              {/* O popup mostra a HISTÓRIA do antecedente escolhido e as perícias dele. */}
              <div className="line-field-value info-tip identity-value-tip">
                <InlineField
                  value={character.background}
                  readOnly={lockedConstruction}
                  ariaLabel="Antecedente"
                  placeholder="—"
                  onCommit={(value) => update({ background: value.trim() })}
                />
                <span className="info-tip-text" role="tooltip">
                  <strong>{character.background || 'Antecedente'}</strong>
                  {backgroundInfo ? <span>{backgroundInfo}</span> : null}
                  {backgroundSkills ? <span>Perícias concedidas: {backgroundSkills}</span> : null}
                  {!backgroundInfo && !backgroundSkills ? (
                    <span>
                      Ainda não escolhido — o antecedente define perícias, ferramentas e contatos.
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="line-field-label">
                Antecedente
                <FieldInfo>
                  <strong>Antecedente</strong>
                  <span>
                    A vida que o personagem levava antes da aventura: define perícias, ferramentas e
                    contatos com o mundo.
                  </span>
                </FieldInfo>
              </span>
            </div>

            <div className="line-field">
              {/* O popup explica o ALINHAMENTO escolhido, não o conceito. */}
              <div className="line-field-value info-tip identity-value-tip">
                <InlineField
                  value={character.alignment}
                  mode="select"
                  options={ALIGNMENTS}
                  readOnly={lockedConstruction}
                  ariaLabel="Alinhamento"
                  onCommit={(value) => update({ alignment: value })}
                />
                <span className="info-tip-text" role="tooltip">
                  <strong>{character.alignment || 'Alinhamento'}</strong>
                  <span>
                    {alignmentDescription(character.alignment) ||
                      'Ainda não escolhido: o código moral e ético do personagem (ex.: Leal e Bom).'}
                  </span>
                </span>
              </div>
              <span className="line-field-label">
                Alinhamento
                <FieldInfo>
                  <strong>Alinhamento</strong>
                  <span>
                    O código moral e ético do personagem: como ele decide entre o dever, a liberdade
                    e o próprio interesse.
                  </span>
                </FieldInfo>
              </span>
            </div>
          </div>

          {/* Inspiração fecha o conjunto, abaixo do nível, à esquerda. */}
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

      {/* Vida e Defesa fecha o Personagem, logo abaixo do cabeçalho. */}
      <VitalsSection character={character} update={update} embedded />
    </Section>
  );
}
