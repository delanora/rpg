import { useEffect, useMemo, useState } from 'react';
import {
  createScene,
  deleteScene,
  fetchScene,
  fetchScenes,
  subscribeSceneEvents,
  updateScene,
  type SceneEvent,
} from '../../scenesApi';
import { mutateSceneWall } from '../../sceneWallsApi';
import { formatSceneMeters, SCENE_CELL_FEET } from '../../sceneUnits';
import type { Scene, ScenePatch } from '../../types';
import { Icon } from '../Icon';
import { Section } from '../Section';
import { SceneEditor } from './SceneEditor';
import './scenes.css';

interface LocalityScenesProps {
  localityId: string;
  localityName: string;
}

const byName = (a: Scene, b: Scene): number => a.name.localeCompare(b.name);

/** Aplica um evento de outra aba com guarda de VERSÃO (evento velho não vence). */
function applySceneEvent(scenes: Scene[], localityId: string, event: SceneEvent): Scene[] {
  if (event.type === 'deleted') {
    return scenes.filter((scene) => scene.id !== event.sceneId);
  }
  if (event.scene.localityId !== localityId) return scenes;
  const index = scenes.findIndex((scene) => scene.id === event.scene.id);
  if (index === -1) return [...scenes, event.scene].sort(byName);
  if (event.scene.version < scenes[index].version) return scenes;
  const next = [...scenes];
  next[index] = event.scene;
  return next.sort(byName);
}

/**
 * FASE 6.6M.4.1 — CENAS DENTRO DA LOCALIDADE.
 *
 * `Locality 1→N Scene`: a cena NÃO é entidade do painel principal. A lista,
 * a criação, a seleção e o editor vivem aqui, dentro do editor da localidade
 * (`Região → Localidade → Cenas → cena`).
 *
 * Esta camada é a única que fala com `scenesApi`; o `SceneEditor` recebe
 * callbacks. Assim nenhuma busca fica espalhada em componente de apresentação e
 * a resposta do PRÓPRIO PATCH vira estado imediatamente — não dependemos do
 * realtime para refletir a escrita que acabamos de fazer. O realtime (mesmo
 * socket, barramento em memória) serve para as outras abas do Mestre.
 */
export function LocalityScenes({ localityId, localityName }: LocalityScenesProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => scenes.find((scene) => scene.id === selectedId) ?? null,
    [scenes, selectedId],
  );

  // Cena excluída em outra aba: a seleção morre junto, sem editor órfão.
  useEffect(() => {
    if (selectedId && !loading && !scenes.some((scene) => scene.id === selectedId)) {
      setSelectedId(null);
    }
  }, [scenes, selectedId, loading]);

  // Trocar de localidade descarta a seleção anterior (nada de cena órfã).
  useEffect(() => {
    let active = true;
    setScenes([]);
    setSelectedId(null);
    setLoading(true);
    setError(null);

    fetchScenes(localityId)
      .then((list) => {
        if (active) setScenes([...list].sort(byName));
      })
      .catch((value: unknown) => {
        if (active) {
          setError(value instanceof Error ? value.message : 'Não foi possível carregar as cenas.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [localityId]);

  // Mesmo socket, barramento em memória: outra aba do Mestre cria/renomeia/
  // exclui e esta lista acompanha (com guarda de versão em `applySceneEvent`).
  useEffect(
    () => subscribeSceneEvents((event) => setScenes((prev) => applySceneEvent(prev, localityId, event))),
    [localityId],
  );

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const scene = await createScene(localityId, { name: nextSceneName(scenes) });
      setScenes((prev) => (prev.some((item) => item.id === scene.id) ? prev : [...prev, scene].sort(byName)));
      setSelectedId(scene.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Não foi possível criar a cena.');
    } finally {
      setCreating(false);
    }
  }

  function upsertScene(scene: Scene): void {
    setScenes((prev) => applySceneEvent(prev, localityId, { type: 'updated', scene }));
  }

  return (
    <Section
      title="Cenas"
      icon="book"
      subtitle={`Ambientes de ${localityName} — a cena é dona do grid e das paredes`}
    >
      {loading ? (
        <p className="empty-hint">Carregando as cenas...</p>
      ) : error && scenes.length === 0 ? (
        <p className="form-error">{error}</p>
      ) : selected ? (
        <>
          <div className="scene-toolbar">
            <button type="button" className="btn btn-small" onClick={() => setSelectedId(null)}>
              ← voltar para a lista
            </button>
            <span className="scene-hint">A cena pertence a esta localidade.</span>
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <SceneEditor
            key={selected.id}
            scene={selected}
            onWallMutation={async (mutation, expectedVersion, operationId) => {
              const updated = await mutateSceneWall(selected.id, mutation, expectedVersion, operationId);
              upsertScene(updated);
              return updated;
            }}
            onUpdate={async (patch: ScenePatch, expectedVersion, operationId) => {
              const updated = await updateScene(selected.id, {
                ...patch,
                expectedVersion,
                operationId,
              });
              upsertScene(updated);
              return updated;
            }}
            onDelete={async (expectedVersion) => {
              await deleteScene(selected.id, expectedVersion);
              setScenes((prev) => prev.filter((scene) => scene.id !== selected.id));
              setSelectedId(null);
            }}
            onReload={async () => {
              const fresh = await fetchScene(selected.id);
              upsertScene(fresh);
              return fresh;
            }}
          />
        </>
      ) : scenes.length === 0 ? (
        <div className="scene-toolbar">
          <p className="empty-hint">
            Nenhuma cena nesta localidade ainda. Crie a primeira para preparar o grid e as paredes
            do ambiente.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? 'criando...' : '+ criar primeira cena'}
          </button>
        </div>
      ) : (
        <>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="scene-toolbar">
            <span className="scene-hint">Cada cena tem grid, paredes e imagem próprios.</span>
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? 'criando...' : '+ nova cena'}
            </button>
          </div>
          <ul className="scene-cards">
            {scenes.map((scene) => (
              <li key={scene.id}>
                <button
                  type="button"
                  className="scene-card"
                  aria-label={`Abrir a cena ${scene.name}`}
                  onClick={() => setSelectedId(scene.id)}
                >
                  <span className="scene-thumb">
                    {scene.backgroundImageUrl ? (
                      <img src={scene.backgroundImageUrl} alt="" loading="lazy" />
                    ) : (
                      <Icon name="book" size={18} />
                    )}
                  </span>
                  <span className="scene-info">
                    <span className="card-name">{scene.name}</span>
                    <span className="card-line">
                      {formatSceneMeters(scene.spatialConfig.widthFeet)} ×{' '}
                      {formatSceneMeters(scene.spatialConfig.heightFeet)}
                    </span>
                    <span className="card-line">
                      {scene.spatialConfig.mode === 'grid-2d'
                        ? `grade de ${formatSceneMeters(SCENE_CELL_FEET)}`
                        : 'cena assistida'}
                      {scene.obstacles.length > 0
                        ? ` · ${scene.obstacles.length} parede(s)`
                        : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/** Nome de uma cena recém-criada, sem repetir os existentes. */
function nextSceneName(scenes: Scene[]): string {
  if (!scenes.some((scene) => scene.name === 'Nova cena')) return 'Nova cena';
  let index = 2;
  while (scenes.some((scene) => scene.name === `Nova cena ${index}`)) index += 1;
  return `Nova cena ${index}`;
}
