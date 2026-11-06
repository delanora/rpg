import { api } from './api';
import type { Scene, ScenePatch } from './types';
import { newId } from './utils';

/**
 * FASE 6.6M.4.1 — API FRONTEND DE CENA (MASTER-only no servidor).
 *
 * Toda a infraestrutura já existia na 6.6L.4.1.1: aqui só há INTENÇÃO. A UI não
 * calcula versão, não decide lock e não valida geometria — `expectedVersion`,
 * `operationId`, `SCENE_IN_USE` e `Scene → Locality` são do servidor.
 *
 * Dimensões vão em PÉS (`widthFeet`/`heightFeet`), mesmo que a tela mostre
 * metros: a conversão acontece em `sceneUnits` antes de chamar esta camada.
 */

/** PATCH de cena: `expectedVersion` obrigatório; `operationId` é da intenção. */
export interface UpdateSceneInput extends ScenePatch {
  expectedVersion: number;
  /**
   * Chave de idempotência da INTENÇÃO. Retry de uma escrita cujo resultado
   * ficou incerto reenvia o MESMO id (o servidor devolve o snapshot); uma nova
   * intenção gera outro.
   */
  operationId: string;
}

export async function fetchScenes(localityId: string): Promise<Scene[]> {
  const { scenes } = await api<{ scenes: Scene[] }>(`/api/localities/${localityId}/scenes`);
  return scenes;
}

export async function fetchScene(sceneId: string): Promise<Scene> {
  const { scene } = await api<{ scene: Scene }>(`/api/scenes/${sceneId}`);
  return scene;
}

export interface CreateSceneInput {
  name: string;
}

/**
 * Cria a cena com o padrão assistido do servidor (sem imagem, sem paredes).
 * A criação não pede versão: não existe estado anterior para conflitar.
 */
export async function createScene(localityId: string, input: CreateSceneInput): Promise<Scene> {
  const { scene } = await api<{ scene: Scene }>(`/api/localities/${localityId}/scenes`, {
    method: 'POST',
    body: input,
  });
  return scene;
}

export async function updateScene(sceneId: string, input: UpdateSceneInput): Promise<Scene> {
  const { scene } = await api<{ scene: Scene }>(`/api/scenes/${sceneId}`, {
    method: 'PATCH',
    body: input,
  });
  return scene;
}

/**
 * Remove a cena; as paredes caem por cascade no servidor. O `operationId` é
 * exigido pelo contrato, mas a exclusão é uma intenção única: o retry de uma
 * exclusão já aplicada responde 404 determinístico, nunca reaplica.
 */
export async function deleteScene(sceneId: string, expectedVersion: number): Promise<void> {
  await api<{ scene: Scene }>(`/api/scenes/${sceneId}`, {
    method: 'DELETE',
    body: { expectedVersion, operationId: newId() },
  });
}

/* -------------------------------------------------------------------------- */
/* Barramento de eventos de cena                                               */
/* -------------------------------------------------------------------------- */

/**
 * O socket vive em UM lugar (`useRealtime`, no painel do Mestre). A cena é
 * consumida DENTRO da localidade, três níveis abaixo — passar callback por
 * `RegionsTab → RegionEditor → LocalityEditor` só para avisar "outra aba
 * renomeou" repetiria o problema que o barramento de intenção de conjuração já
 * resolve. Mesmo padrão: o `useRealtime` publica, quem edita assina.
 *
 * Isto NÃO é um segundo realtime: é um barramento em memória alimentado pelo
 * MESMO socket, sem polling e sem outra conexão.
 */
export type SceneEvent =
  | { type: 'created'; scene: Scene }
  | { type: 'updated'; scene: Scene }
  | { type: 'deleted'; sceneId: string; localityId: string };

type SceneListener = (event: SceneEvent) => void;

const listeners = new Set<SceneListener>();

export function subscribeSceneEvents(listener: SceneListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ponte chamada pelo `useRealtime` quando o evento chega (só para Mestres). */
export function publishSceneEvent(event: SceneEvent): void {
  for (const listener of listeners) listener(event);
}
