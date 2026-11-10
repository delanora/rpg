import { SceneMapScreen } from './SceneMapScreen';
import { SceneMapEditor } from './SceneMapEditor';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, fileToImagePayload, uploadImage } from '../../api';
import {
  feetToMeters,
  formatSceneFeet,
  formatSceneMeters,
  gridSquaresLabel,
  metersToFeet,
  SCENE_CELL_FEET,
} from '../../sceneUnits';
import type { Scene, ScenePatch, SpatialScene } from '../../types';
import { newId } from '../../utils';
import type { SceneWallMutation } from '../../sceneWallsApi';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import { SpatialGridOverlay } from '../spatial/SpatialGridOverlay';
import { useSceneGridTone } from '../spatial/useSceneGridTone';
import './scenes.css';

interface SceneEditorProps {
  scene: Scene;
  /** PATCH real (a camada `scenesApi` vive em `LocalityScenes`). */
  onUpdate: (patch: ScenePatch, expectedVersion: number, operationId: string) => Promise<Scene>;
  /** Exclusão com confirmação já dada nesta tela. */
  onDelete: (expectedVersion: number) => Promise<void>;
  /** Relê o snapshot autoritativo (usado em escrita velha). */
  onReload: () => Promise<Scene>;
  onWallMutation: (mutation: SceneWallMutation, expectedVersion: number, operationId: string) => Promise<Scene>;
}

/**
 * FASE 6.6M.4.1 — EDITOR DA CENA.
 *
 * Administra só as propriedades ESTRUTURAIS da cena: nome, base espacial
 * (modo + dimensões), imagem de fundo opcional e um preview de proporção.
 * A 6.6M.4.2 acrescenta desenho e edição das paredes pelas rotas da cena.
 *
 * Quem decide versão, lock e pertencimento é o SERVIDOR: o editor apenas manda
 * `expectedVersion` + `operationId`, adota a resposta como nova verdade e
 * traduz os 409 de domínio (`SCENE_IN_USE`, escrita velha) em estado de tela.
 */
export function SceneEditor({ scene, onUpdate, onDelete, onReload, onWallMutation }: SceneEditorProps) {
  const [mapOpen, setMapOpen] = useState(false);
  const [mapLocked, setMapLocked] = useState(false);
  const config = scene.spatialConfig;
  const [mode, setMode] = useState<SpatialScene['mode']>(config.mode);
  const [widthMeters, setWidthMeters] = useState(String(metersLabel(config.widthFeet)));
  const [heightMeters, setHeightMeters] = useState(String(metersLabel(config.heightFeet)));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Cena em uso por combate ativo: dados visíveis, edição estrutural travada.
  const [locked, setLocked] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  /**
   * URL JÁ ENVIADA e ainda NÃO persistida na cena.
   *
   * O upload físico não é transacional: se o PATCH cair na rede, a mesma
   * intenção é repetida com esta URL (mesmo `operationId`, sem segundo arquivo
   * órfão). Uma tentativa nova/troca de imagem sobrescreve o valor.
   */
  const [stagedImage, setStagedImage] = useState<string | null>(null);

  /**
   * Retry de uma escrita cujo resultado ficou INCERTO reenvia o mesmo
   * `operationId` (o servidor devolve o snapshot já aplicado); uma intenção
   * nova — outro payload ou outra versão base — gera outro id.
   */
  const pending = useRef<{ key: string; id: string } | null>(null);

  // Um evento de outra aba (ou o reload após conflito) troca o snapshot: os
  // campos voltam a refletir o servidor, nunca um merge local de duas versões.
  useEffect(() => {
    setMode(scene.spatialConfig.mode);
    setWidthMeters(String(metersLabel(scene.spatialConfig.widthFeet)));
    setHeightMeters(String(metersLabel(scene.spatialConfig.heightFeet)));
    setImageFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o SNAPSHOT novo reseta os campos
  }, [scene.id, scene.version]);

  const writing = useRef(false);

  const editable = !locked && !busy && !uploading;

  function messageOf(value: unknown): string {
    if (value instanceof Error && value.message) return value.message;
    return 'Não foi possível salvar a cena.';
  }

  async function handleFailure(value: unknown): Promise<void> {
    if (value instanceof ApiError && value.code === 'SCENE_IN_USE') {
      pending.current = null;
      setLocked(true);
      setError(value.message);
      return;
    }
    if (value instanceof ApiError && value.code === 'CONFLICT') {
      // Escrita velha: adota o snapshot autoritativo em vez de sobrescrever.
      pending.current = null;
      try {
        await onReload();
        setNotice(
          'A cena mudou em outra aba. Carregamos a versão mais recente — confira os valores antes de salvar de novo.',
        );
      } catch {
        setError('A cena mudou em outra aba e não foi possível recarregar. Feche e abra a cena.');
      }
      return;
    }
    // Erro incerto (rede/timeout): mantém a intenção para o retry reutilizar o id.
    setError(messageOf(value));
  }

  async function runUpdate(patch: ScenePatch, success: string): Promise<void> {
    if (locked || busy || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const key = JSON.stringify({ patch, expectedVersion: scene.version });
    const operationId =
      pending.current && pending.current.key === key ? pending.current.id : newId();
    pending.current = { key, id: operationId };
    try {
      await onUpdate(patch, scene.version, operationId);
      pending.current = null;
      setStagedImage(null);
      setNotice(success);
    } catch (value) {
      await handleFailure(value);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function mutateWall(mutation: SceneWallMutation, expectedVersion: number, operationId: string): Promise<Scene> {
    if (locked || writing.current) throw new ApiError('Aguarde a operação atual ou recarregue a cena.', 409, 'CONFLICT');
    writing.current = true; setBusy(true); setError(null); setNotice(null);
    try { return await onWallMutation(mutation, expectedVersion, operationId); }
    catch (value) { await handleFailure(value); throw value; }
    finally { writing.current = false; setBusy(false); }
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || !editable) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      // Pipeline EXISTENTE de imagem: redimensiona no navegador e grava em
      // `/uploads/...`. A cena guarda só a URL — nunca um dado embutido nem um
      // storage novo.
      const payload = await fileToImagePayload(file);
      const stored = await uploadImage(payload.dataUrl, payload.name, 'localities');
      setImageFailed(false);
      // O PATCH passa pelo MESMO caminho idempotente das outras mutações — não
      // existe atalho com `newId()` que fure a política de retry. A URL fica
      // guardada para ser reaproveitada se a escrita ficar incerta.
      setStagedImage(stored.url);
      await runUpdate({ backgroundImageUrl: stored.url }, 'Imagem de fundo atualizada.');
    } catch (value) {
      await handleFailure(value);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDelete(scene.version);
      pending.current = null;
    } catch (value) {
      await handleFailure(value);
      setConfirmingDelete(false);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function saveSpatial(): Promise<void> {
    const widthFeet = dimensionFeet(widthMeters, config.widthFeet);
    const heightFeet = dimensionFeet(heightMeters, config.heightFeet);
    await runUpdate(
      { spatialConfig: { mode, widthFeet, heightFeet } },
      'Base espacial salva.',
    );
  }

  return (
    <div className="scene-editor">
      <div className="scene-editor-head">
        <h3 className="scene-editor-title">
          <Icon name="book" size={16} /> {scene.name}
        </h3>
        <span className="scene-editor-meta">
          versão {scene.version} · {formatSceneMeters(config.widthFeet)} ×{' '}
          {formatSceneMeters(config.heightFeet)}
          {scene.obstacles.length > 0 ? ` · ${scene.obstacles.length} parede(s)` : ''}
        </span>
      </div>

      {locked ? (
        <div className="scene-lock">
          {error ?? 'Esta cena está sendo usada por um combate ativo e não pode ser editada agora.'}{' '}
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setLocked(false);
              setError(null);
            }}
          >
            tentar novamente
          </button>
        </div>
      ) : null}

      {notice ? <p className="scene-notice">{notice}</p> : null}
      {error && !locked ? <p className="form-error">{error}</p> : null}

      <Section title="Nome" icon="quill">
        <label className="field">
          <span>Como a mesa conhece esta cena</span>
          {editable ? (
            <InlineField
              value={scene.name}
              ariaLabel="Nome da cena"
              onCommit={(value) => {
                const name = value.trim();
                if (name && name !== scene.name) void runUpdate({ name }, 'Nome atualizado.');
              }}
            />
          ) : (
            <span>{scene.name}</span>
          )}
        </label>
      </Section>

      <Section
        title="Base espacial"
        icon="star"
        subtitle="Unidade da ficha: metros · o servidor guarda em pés"
      >
        <div className="scene-fields">
          <label className="scene-mode">
            Modo
            <select
              value={mode}
              disabled={!editable}
              onChange={(event) => setMode(event.target.value as SpatialScene['mode'])}
            >
              <option value="assisted">assistido</option>
              <option value="grid-2d">grade 2D</option>
            </select>
          </label>
          <label>
            Largura (m)
            <input
              type="number"
              min={1.5}
              step={1.5}
              inputMode="decimal"
              value={widthMeters}
              disabled={!editable}
              onChange={(event) => setWidthMeters(event.target.value)}
            />
            {/*
              Contagem DERIVADA (6.6M.4.1.2): sai do valor digitado, pelo snap
              canônico de `metersToFeet` — 30 m → 100 pés → 20 quadrados. Não é
              input nem autoridade: o servidor continua validando a base.
            */}
            <span className="scene-squares">
              {gridSquaresLabel(dimensionFeet(widthMeters, config.widthFeet))}
            </span>
          </label>
          <label>
            Altura (m)
            <input
              type="number"
              min={1.5}
              step={1.5}
              inputMode="decimal"
              value={heightMeters}
              disabled={!editable}
              onChange={(event) => setHeightMeters(event.target.value)}
            />
            <span className="scene-squares">
              {gridSquaresLabel(dimensionFeet(heightMeters, config.heightFeet))}
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!editable}
            onClick={() => void saveSpatial()}
          >
            {busy ? 'salvando...' : 'salvar base'}
          </button>
        </div>
        <p className="scene-hint">
          Persistido como {formatSceneFeet(config.widthFeet)} × {formatSceneFeet(config.heightFeet)}{' '}
          · grade de {formatSceneMeters(SCENE_CELL_FEET)} por quadrado. Reduzir a cena com parede
          fora dos limites é recusado pelo servidor.
        </p>
      </Section>

      <Section
        title="Imagem de fundo"
        icon="star"
        subtitle="Opcional — a cena funciona sem ela"
      >
        {scene.backgroundImageUrl && !imageFailed ? (
          <p className="scene-hint">Imagem atual aplicada no editor do mapa.</p>
        ) : scene.backgroundImageUrl ? (
          <p className="scene-hint">
            A imagem atual não carregou. Você pode trocar ou remover — a base espacial continua
            intacta.
          </p>
        ) : (
          <p className="scene-background-empty">Nenhuma imagem de fundo.</p>
        )}

        <div className="scene-background-actions">
          <label
            className={
              uploading || locked ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'
            }
          >
            {uploading ? 'enviando...' : scene.backgroundImageUrl ? 'trocar imagem' : '+ imagem de fundo'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!editable}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {scene.backgroundImageUrl ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={!editable}
              onClick={() => void runUpdate({ backgroundImageUrl: null }, 'Imagem de fundo removida.')}
            >
              remover imagem
            </button>
          ) : null}
        </div>
        <p className="scene-hint">
          Usa o mesmo envio de imagem das localidades. A imagem NÃO é fonte mecânica: grid,
          dimensões e paredes independem dela.
        </p>
        {stagedImage && editable ? (
          <p className="scene-hint">
            A imagem foi enviada, mas ainda não foi salva na cena.{' '}
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                void runUpdate(
                  { backgroundImageUrl: stagedImage },
                  'Imagem de fundo atualizada.',
                )
              }
            >
              salvar imagem enviada
            </button>
          </p>
        ) : null}
      </Section>

      <Section title="Editor da cena" icon="scroll" subtitle="Abra o mapa em uma tela dedicada, sem rolar as configurações">
        <div className="scene-map-launcher">
          <div><strong>Paredes e elevações</strong><p className="scene-hint">Mapa ampliado, câmera WASD, pincel de altura e ferramentas radiais.</p></div>
          <button type="button" className="btn btn-primary" disabled={busy || uploading} onClick={() => setMapOpen(true)}><Icon name="table" size={17} /> Editar mapa em tela inteira</button>
        </div>
      </Section>
      {mapOpen ? <SceneMapScreen scene={scene} locked={mapLocked || busy || uploading} onClose={() => setMapOpen(false)}>
        <SceneMapEditor fullScreen onSessionChange={setMapLocked} key={scene.id} scene={scene} disabled={!editable} onWallMutation={mutateWall}
          onReload={async () => { const fresh = await onReload(); setLocked(false); setError(null); return fresh; }}
          onSaveElevation={async (patch, version, operationId) => {
            if (locked || writing.current) throw new ApiError('Aguarde a operação atual.', 409, 'CONFLICT');
            writing.current = true; setBusy(true); setError(null);
            try { return await onUpdate(patch, version, operationId); }
            catch (cause) { await handleFailure(cause); throw cause; }
            finally { writing.current = false; setBusy(false); }
          }}
          renderCanvas={(overlay, zoom) => <ScenePreview scene={scene} imageFailed={imageFailed}
            onImageError={() => setImageFailed(true)} overlay={overlay} zoom={zoom} />} />
      </SceneMapScreen> : null}

      <Section title="Excluir cena" icon="trash" subtitle="Ação explícita">
        {confirmingDelete ? (
          <div className="scene-confirm">
            <p>
              Excluir <strong>{scene.name}</strong>? As paredes estruturais desta cena são removidas
              junto (cascade do servidor). Combatentes e fichas não são afetados.
            </p>
            <div className="scene-background-actions">
              <button
                type="button"
                className="btn btn-danger btn-small"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? 'excluindo...' : 'excluir cena e paredes'}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
              >
                cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger btn-small"
            disabled={locked || busy}
            onClick={() => setConfirmingDelete(true)}
          >
            <Icon name="trash" size={14} /> excluir cena
          </button>
        )}
      </Section>
    </div>
  );
}

/** Metros exibidos no input (número puro; o input formata em pt-BR). */
function metersLabel(feet: number): number {
  return feetToMeters(feet);
}

/** Dimensão digitada em metros → pés, com mínimo de 5 pés (1,5 m). */
function dimensionFeet(value: string, fallbackFeet: number): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackFeet;
  return Math.max(5, metersToFeet(parsed));
}

/**
 * PREVIEW estrutural da cena.
 *
 * O grid de combate (`CombatGrid`) NÃO é montado aqui: ele depende de câmera,
 * tokens, iniciativa e do runtime do encontro. O que é COMPARTILHADO é a
 * representação visual da grade — `SpatialGridOverlay`, o mesmo SVG do combate
 * — para preview e tabuleiro nunca discordarem da contagem de células.
 * Proporção vem de `spatialConfig`; a edição de paredes é um overlay separado.
 */
function ScenePreview({
  scene,
  imageFailed,
  onImageError,
  overlay,
  zoom = 1,
}: {
  scene: Scene;
  imageFailed: boolean;
  onImageError: () => void;
  overlay?: ReactNode;
  zoom?: number;
}) {
  const { widthFeet, heightFeet } = scene.spatialConfig;
  const safeWidth = widthFeet > 0 ? widthFeet : 1;
  const safeHeight = heightFeet > 0 ? heightFeet : 1;
  /** Contraste pela MESMA análise local do combate (apresentação, nunca regra). */
  const tone = useSceneGridTone(scene.backgroundImageUrl);

  return (
    <div className="scene-preview-frame">
      <div className="scene-wall-viewport">
      <div
        className="scene-preview scene-preview--editable"
        style={{ aspectRatio: `${safeWidth} / ${safeHeight}`, width: `${zoom * 100}%` }}
        role={overlay ? 'group' : 'img'}
        aria-label={`Prévia da cena ${scene.name}: ${formatSceneMeters(widthFeet)} por ${formatSceneMeters(heightFeet)}`}
      >
        {scene.backgroundImageUrl && !imageFailed ? (
          <img
            className="scene-preview-img"
            src={scene.backgroundImageUrl}
            alt=""
            onError={onImageError}
          />
        ) : null}
        {/* A MESMA grade do combate: uma célula = `SCENE_CELL_FEET` pés. */}
        <SpatialGridOverlay
          widthFeet={safeWidth}
          heightFeet={safeHeight}
          cellSizeFeet={SCENE_CELL_FEET}
          tone={tone}
        />
        {overlay}
      </div>
      </div>
      <p className="scene-preview-caption">
        {formatSceneMeters(widthFeet)} × {formatSceneMeters(heightFeet)} ·{' '}
        {Math.round(safeWidth / SCENE_CELL_FEET)} × {Math.round(safeHeight / SCENE_CELL_FEET)}{' '}
        quadrados de {formatSceneMeters(SCENE_CELL_FEET)}
      </p>
    </div>
  );
}
