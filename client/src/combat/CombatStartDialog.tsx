import { SIZE_LABELS } from './grid/gridMath';
import { EncounterThumbnail } from './EncounterThumbnail';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Portrait } from '../components/Portrait';
import { fetchScenes } from '../scenesApi';
import { createOperationId } from '../utils';
import type {
  Character,
  Creature,
  Locality,
  Region,
  Scene,
  SpatialSize,
} from '../types';
import type { CombatPreparation } from './combatApi';
import {
  fetchEncounters,
  saveEncounter,
  type PreparedEncounter,
} from './encountersApi';
import { PreparationBoard, type PreparationToken } from './PreparationBoard';
import './preparation.css';

export interface CombatStartDialogProps {
  localities: Locality[];
  regions: Region[];
  creatures: Creature[];
  characters: Character[];
  onCancel: () => void;
  onStart: (input: CombatPreparation) => Promise<void>;
  saveOnly?: boolean;
  initialEncounter?: PreparedEncounter;
  onSaved?: () => void;
}
const steps = [
  'Encontro',
  'Local',
  'Participantes',
  'Cena e posições',
  'Revisão',
];
export function CombatStartDialog({
  localities,
  regions,
  creatures,
  characters,
  onCancel,
  onStart,
  saveOnly = false,
  initialEncounter,
  onSaved,
}: CombatStartDialogProps) {
  const root = useRef<HTMLElement>(null);
  const draftId = useRef(initialEncounter?.id || createOperationId());
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  const [step, setStep] = useState(initialEncounter || saveOnly ? 1 : 0);
  const [preparation, setPreparation] = useState<CombatPreparation>(
    initialEncounter?.preparation ?? {
      characterIds: characters.map((c) => c.id),
      entries: [],
    },
  );
  const [encounter, setEncounter] = useState(initialEncounter);
  const [name, setName] = useState(initialEncounter?.name ?? 'Novo encontro');
  const [saved, setSaved] = useState<PreparedEncounter[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [region, setRegion] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('ALL');
  const [onlyLocal, setOnlyLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locality = localities.find((l) => l.id === preparation.localityId);
  const scene = scenes.find((s) => s.id === preparation.sceneId);
  useEffect(() => {
    let active = true;
    fetchEncounters()
      .then((rows) => {
        if (active) setSaved(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setScenes([]);
    if (!preparation.localityId) return;
    setSceneLoading(true);
    fetchScenes(preparation.localityId)
      .then((rows) => {
        if (active) setScenes(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setSceneLoading(false);
      });
    return () => {
      active = false;
    };
  }, [preparation.localityId]);
  function update(patch: Partial<CombatPreparation>) {
    setPreparation((p) => ({ ...p, ...patch }));
    setNotice('');
  }
  function chooseLocality(id?: string) {
    update({
      localityId: id,
      sceneId: undefined,
      characterPositions: [],
      entries: preparation.entries.map((e) => ({ ...e, positions: undefined })),
    });
  }
  function quantity(creature: Creature, value: number) {
    const q = Math.max(
      0,
      Math.min(creature.kind === 'NPC' ? 1 : 30, Math.trunc(value) || 0),
    );
    const old = preparation.entries.find((e) => e.creatureId === creature.id);
    update({
      entries: [
        ...preparation.entries.filter((e) => e.creatureId !== creature.id),
        ...(q
          ? [
              {
                creatureId: creature.id,
                quantity: q,
                disposition:
                  old?.disposition ??
                  (creature.kind === 'NPC'
                    ? ('neutral' as const)
                    : ('hostile' as const)),
                positions: old?.positions?.slice(0, q),
                spatialVisibilities: old?.spatialVisibilities?.slice(0,q),
              },
            ]
          : []),
      ],
    });
  }
  const selectedPlayers = characters.filter((c) =>
    preparation.characterIds?.includes(c.id),
  );
  const tokens: PreparationToken[] = [
    ...selectedPlayers.map((c) => ({
      key: `character:${c.id}`,
      name: c.name,
      image: c.avatarUrl ?? '',
      size: 'medium' as const,
      position:
        preparation.characterPositions?.find((p) => p.characterId === c.id)
          ?.position ?? null,
    })),
    ...preparation.entries.flatMap((e) => {
      const c = creatures.find((c) => c.id === e.creatureId);
      return c
        ? Array.from({ length: e.quantity }, (_, i) => ({
            key: `${c.id}:${i}`,
            name: e.quantity > 1 ? `${c.name} ${i + 1}` : c.name,
            image: c.imageUrl ?? '',
            size: c.size.toLowerCase() as SpatialSize,
            position: e.positions?.[i] ?? null,
            hidden: e.spatialVisibilities?.[i] === 'master-only',
          }))
        : [];
    }),
  ];
  function place(key: string, position: PreparationToken['position']) {
    if (key.startsWith('character:')) {
      const id = key.slice(10);
      update({
        characterPositions: [
          ...(preparation.characterPositions ?? []).filter(
            (p) => p.characterId !== id,
          ),
          ...(position ? [{ characterId: id, position }] : []),
        ],
      });
    } else {
      const split = key.lastIndexOf(':');
      const id = key.slice(0, split),
        index = Number(key.slice(split + 1));
      update({
        entries: preparation.entries.map((e) =>
          e.creatureId !== id
            ? e
            : {
                ...e,
                positions: Array.from({ length: e.quantity }, (_, i) =>
                  i === index ? position : (e.positions?.[i] ?? null),
                ),
              },
        ),
      });
    }
  }
  const total =
    (preparation.characterIds?.length ?? 0) +
    preparation.entries.reduce((n, e) => n + e.quantity, 0);
  const unavailable =
    Boolean(preparation.localityId && !locality) ||
    Boolean(preparation.sceneId && !sceneLoading && !scene) ||
    preparation.entries.some(
      (e) => !creatures.some((c) => c.id === e.creatureId),
    ) ||
    (preparation.characterIds ?? []).some(
      (id) => !characters.some((c) => c.id === id),
    );
  async function persist() {
    setBusy(true);
    setError('');
    try {
      const row = await saveEncounter({
        id: encounter?.id || draftId.current,
        version: encounter?.version ?? 0,
        name,
        preparation,
      });
      setEncounter(row);
      setNotice('Encontro salvo.');
      onSaved?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      await onStart(preparation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível iniciar.');
      setBusy(false);
    }
  }
  const scenePicker = (
    <>
      <h3>Escolha a cena</h3>
      {!locality ? (
        <p>
          Escolha uma localidade na etapa Local para usar uma cena cadastrada.
        </p>
      ) : null}
      {sceneLoading ? <p role="status">Carregando cenas…</p> : null}
      <div className="preparation-cards">
        <button
          className="preparation-card"
          aria-pressed={!preparation.sceneId}
          onClick={() =>
            update({
              sceneId: undefined,
              characterPositions: [],
              entries: preparation.entries.map((e) => ({
                ...e,
                positions: undefined,
              })),
            })
          }
        >
          <strong>Sem grid</strong>
          <small>Combate assistido.</small>
        </button>
        {scenes.map((s) => (
          <button
            key={s.id}
            className="preparation-card"
            aria-pressed={s.id === preparation.sceneId}
            onClick={() => {
              if (s.id !== preparation.sceneId)
                update({
                  sceneId: s.id,
                  characterPositions: [],
                  entries: preparation.entries.map((e) => ({
                    ...e,
                    positions: undefined,
                  })),
                });
            }}
          >
            {s.backgroundImageUrl ? (
              <img src={s.backgroundImageUrl} alt="" />
            ) : (
              <Icon name="table" />
            )}
            <strong>{s.name}</strong>
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div className="modal-backdrop">
      <section
        ref={root}
        className="modal preparation-wizard"
        data-positioning={
          (step === 3 && scene?.spatialConfig.mode === 'grid-2d') || undefined
        }
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            cancelRef.current();
          }
          if (event.key === 'Tab') {
            const list = root.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
            );
            if (!list?.length) return;
            const first = list[0],
              last = list[list.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preparation-title"
      >
        <header className="preparation-header">
          <div>
            <h2 id="preparation-title">
              <Icon name="sword" />{' '}
              {saveOnly ? 'Preparar encontro' : 'Iniciar combate'}
            </h2>
            <p className="section-subtitle">
              Monte a cena no seu ritmo. O combate só começa ao confirmar.
            </p>
          </div>
          <button
            className="btn btn-small"
            disabled={busy}
            aria-label="Fechar preparação"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <nav className="preparation-steps" aria-label="Etapas de preparação">
          {steps.map((label, i) => (
            <button
              key={label}
              disabled={busy || (saveOnly && i === 0)}
              aria-current={step === i ? 'step' : undefined}
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="preparation-content">
          {step === 0 ? (
            <>
              <h3>Como você quer começar?</h3>
              <div className="preparation-cards">
                <button
                  className="preparation-card"
                  onClick={() => {
                    setEncounter(undefined);
                    draftId.current = createOperationId();
                    setName('Novo encontro');
                    setPreparation({
                      characterIds: characters.map((c) => c.id),
                      entries: [],
                    });
                    setStep(1);
                  }}
                >
                  <Icon name="sparkle" />
                  <strong>Criar agora</strong>
                  <small>Escolha o local, os participantes e a cena.</small>
                </button>
                {saved.map((e) => (
                  <button
                    className="preparation-card"
                    key={e.id}
                    onClick={() => {
                      setEncounter(e);
                      setName(e.name);
                      setPreparation(e.preparation);
                      setStep(4);
                    }}
                  >
                    <EncounterThumbnail sceneId={e.preparation.sceneId} />
                    <strong>{e.name}</strong>
                    <small>
                      {localities.find((l) => l.id === e.preparation.localityId)
                        ?.name ?? 'Sem localidade'}{' '}
                      ·{' '}
                      {e.preparation.entries.reduce(
                        (n, c) => n + c.quantity,
                        0,
                      )}{' '}
                      criaturas/NPCs
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <h3>Onde acontece o encontro?</h3>
              <div className="preparation-cards compact">
                {regions.map((r) => (
                  <button
                    className="preparation-card"
                    key={r.id}
                    aria-pressed={region === r.id}
                    onClick={() => setRegion(region === r.id ? '' : r.id)}
                  >
                    <strong>{r.name}</strong>
                    <small>{r.localityCount} localidades</small>
                  </button>
                ))}
              </div>
              <label>
                Buscar localidade
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nome da localidade"
                />
              </label>
              <div className="preparation-cards">
                <button
                  className="preparation-card"
                  aria-pressed={!preparation.localityId}
                  onClick={() => chooseLocality()}
                >
                  <strong>Sem localidade</strong>
                  <small>Encontro improvisado, sem cena cadastrada.</small>
                </button>
                {localities
                  .filter(
                    (l) =>
                      (!region || l.regionId === region) &&
                      l.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((l) => (
                    <button
                      key={l.id}
                      className="preparation-card"
                      aria-pressed={preparation.localityId === l.id}
                      onClick={() => chooseLocality(l.id)}
                    >
                      <strong>{l.name}</strong>
                      <small>
                        {regions.find((r) => r.id === l.regionId)?.name}
                      </small>
                    </button>
                  ))}
              </div>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <h3>Personagens dos jogadores</h3>
              <div className="preparation-inline">
                <button
                  className="btn btn-small"
                  onClick={() =>
                    update({ characterIds: characters.map((c) => c.id) })
                  }
                >
                  Selecionar todos
                </button>
                <button
                  className="btn btn-small"
                  onClick={() =>
                    update({ characterIds: [], characterPositions: [] })
                  }
                >
                  Limpar seleção
                </button>
              </div>
              <div className="preparation-cards">
                {characters.map((c) => (
                  <button
                    className="preparation-card preparation-person"
                    key={c.id}
                    aria-pressed={
                      preparation.characterIds?.includes(c.id) ?? false
                    }
                    onClick={() => {
                      const has = preparation.characterIds?.includes(c.id);
                      update({
                        characterIds: has
                          ? preparation.characterIds!.filter(
                              (id) => id !== c.id,
                            )
                          : [...(preparation.characterIds ?? []), c.id],
                        characterPositions: (
                          preparation.characterPositions ?? []
                        ).filter((p) => p.characterId !== c.id),
                      });
                    }}
                  >
                    <Portrait src={c.avatarUrl ?? ''} zoomable={false} />
                    <strong>{c.name}</strong>
                    <small>
                      {preparation.characterIds?.includes(c.id)
                        ? 'Selecionado'
                        : 'Não participa'}
                    </small>
                  </button>
                ))}
              </div>
              <h3>Criaturas e NPCs</h3>
              {preparation.entries
                .filter(
                  (entry) => !creatures.some((c) => c.id === entry.creatureId),
                )
                .map((entry) => (
                  <p key={entry.creatureId}>
                    Cadastro indisponível ({entry.quantity} unidade(s)).{' '}
                    <button
                      className="btn btn-small"
                      onClick={() =>
                        update({
                          entries: preparation.entries.filter(
                            (e) => e.creatureId !== entry.creatureId,
                          ),
                        })
                      }
                    >
                      Retirar da seleção
                    </button>
                  </p>
                ))}
              <div className="preparation-inline">
                <input
                  aria-label="Buscar criatura ou NPC"
                  placeholder="Buscar criatura ou NPC"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Tipo de participante"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="ALL">Todos</option>
                  <option value="CREATURE">Criaturas</option>
                  <option value="NPC">NPCs</option>
                </select>
                {locality ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={onlyLocal}
                      onChange={(e) => setOnlyLocal(e.target.checked)}
                    />{' '}
                    Só desta localidade
                  </label>
                ) : null}
              </div>
              <div className="preparation-cards">
                {creatures
                  .filter(
                    (c) =>
                      (kind === 'ALL' || c.kind === kind) &&
                      c.name.toLowerCase().includes(query.toLowerCase()) &&
                      (!onlyLocal ||
                        !locality ||
                        c.localities.some((l) => l.id === locality.id)),
                  )
                  .map((c) => {
                    const entry = preparation.entries.find(
                      (e) => e.creatureId === c.id,
                    );
                    return (
                      <div
                        key={c.id}
                        className="preparation-card"
                        data-selected={Boolean(entry)}
                      >
                        <div className="preparation-inline">
                          <Portrait src={c.imageUrl ?? ''} zoomable={false} />
                          <strong>{c.name}</strong>
                        </div>
                        <small>
                          {c.kind === 'NPC'
                            ? 'NPC'
                            : `Criatura · ND ${c.challengeRating}`}{' '}
                          · {SIZE_LABELS[c.size.toLowerCase() as SpatialSize]}
                        </small>
                        <small>
                          {c.localities.map((l) => l.name).join(', ') ||
                            'Sem localidade'}
                        </small>
                        {c.kind === 'NPC' ? (
                          <button
                            type="button"
                            className={
                              entry
                                ? 'btn btn-small'
                                : 'btn btn-primary btn-small'
                            }
                            aria-pressed={Boolean(entry)}
                            onClick={() => quantity(c, entry ? 0 : 1)}
                          >
                            {entry
                              ? 'Remover do combate'
                              : 'Incluir no combate'}
                          </button>
                        ) : (
                          <label>
                            Quantidade
                            <input
                              aria-label={`Quantidade de ${c.name}`}
                              type="number"
                              min={0}
                              max={30}
                              value={entry?.quantity ?? 0}
                              onChange={(e) =>
                                quantity(c, Number(e.target.value))
                              }
                            />
                          </label>
                        )}
                        {entry ? (
                          <label>
                            Relação
                            <select
                              value={entry.disposition}
                              onChange={(e) =>
                                update({
                                  entries: preparation.entries.map((x) =>
                                    x.creatureId === c.id
                                      ? {
                                          ...x,
                                          disposition: e.target.value as
                                            | 'hostile'
                                            | 'neutral'
                                            | 'allied',
                                        }
                                      : x,
                                  ),
                                })
                              }
                            >
                              <option value="hostile">Hostil</option>
                              <option value="neutral">Neutro</option>
                              <option value="allied">Aliado</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            </>
          ) : null}
          {step === 3 ? (
            scene?.spatialConfig.mode === 'grid-2d' ? (
              <PreparationBoard
                key={scene.id}
                scene={scene}
                tokens={tokens}
                onPlace={place}
                scenePicker={scenePicker} onVisibility={key=>{const split=key.lastIndexOf(':');const id=key.slice(0,split),index=Number(key.slice(split+1));update({entries:preparation.entries.map(e=>e.creatureId!==id?e:{...e,spatialVisibilities:Array.from({length:e.quantity},(_,i)=>i===index?(e.spatialVisibilities?.[i]==='master-only'?'public':'master-only'):e.spatialVisibilities?.[i]??'public')})})}}
              />
            ) : (
              <>
                {scenePicker}
                {scene ? (
                  <p className="section-note">
                    Cena assistida: não exige posições no grid.
                  </p>
                ) : null}
              </>
            )
          ) : null}
          {step === 4 ? (
            <>
              <h3>Pronto para começar?</h3>
              <label>
                Nome do encontro
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <dl className="preparation-summary">
                <dt>Local</dt>
                <dd>{locality?.name ?? 'Sem localidade'}</dd>
                <dt>Cena</dt>
                <dd>
                  {scene?.name ??
                    (preparation.sceneId ? 'Cena indisponível' : 'Sem grid')}
                </dd>
                <dt>Jogadores</dt>
                <dd>
                  {selectedPlayers.map((c) => c.name).join(', ') || 'Nenhum'}
                </dd>
                <dt>Criaturas e NPCs</dt>
                <dd>
                  {preparation.entries
                    .map(
                      (e) =>
                        `${e.quantity} × ${creatures.find((c) => c.id === e.creatureId)?.name ?? 'Cadastro removido'}`,
                    )
                    .join(', ') || 'Nenhum'}
                </dd>
                <dt>Posições</dt>
                <dd>
                  {tokens.filter((t) => t.position).length} de {tokens.length}{' '}
                  definidas
                </dd>
              </dl>
              <p className="section-note">
                Após confirmar, os participantes rolam iniciativa. PV e recursos
                dos personagens permanecem como estão.
              </p>
              {unavailable ? (
                <p role="alert">
                  Há participantes removidos do cadastro. Atualize a seleção
                  antes de iniciar.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <footer className="preparation-footer">
          <span>{total} participantes</span>
          <button
            className="btn btn-small"
            disabled={busy || step <= (saveOnly ? 1 : 0)}
            onClick={() => {
              setQuery('');
              setStep(step - 1);
            }}
          >
            Voltar
          </button>
          <button
            className="btn btn-small"
            disabled={busy || !name.trim()}
            onClick={() => void persist()}
          >
            Salvar encontro
          </button>
          {step < 4 ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                setQuery('');
                setStep(step + 1);
              }}
            >
              Continuar
            </button>
          ) : saveOnly ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void persist().then((ok) => {
                  if (ok) onCancel();
                })
              }
            >
              Salvar e concluir
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy || !total || unavailable || sceneLoading}
              onClick={() => void start()}
            >
              {busy ? 'Iniciando…' : 'Iniciar combate'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
