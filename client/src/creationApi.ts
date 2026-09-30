import { api } from './api';
import type {
  Character,
  CreationResponse,
  CreationStepRequest,
  LevelUpRequest,
  RaceOption,
} from './types';

/**
 * Assistente de criação de personagem.
 *
 * O rascunho é a própria ficha com `creationFinalized = false`: cada passo
 * concluído é gravado no servidor, então fechar o navegador não perde nada — o
 * jogador retoma de onde parou ao voltar.
 */

/** Estado atual do assistente (ficha + rascunho + catálogos). */
export async function fetchCreationState(): Promise<CreationResponse> {
  return api<CreationResponse>('/api/characters/me/creation');
}

/**
 * Catálogo de raças (bônus de atributo), para a ficha explicar a composição de
 * cada atributo. É um catálogo fixo do livro: buscado uma vez por sessão e
 * reaproveitado (o assistente tem o dele na resposta da criação).
 */
let raceCatalog: Promise<RaceOption[]> | null = null;

export function fetchRaceCatalog(): Promise<RaceOption[]> {
  raceCatalog ??= fetchCreationState()
    .then((state) => state.creation.raceCatalog)
    .catch(() => []);

  return raceCatalog;
}

/** Salva o passo concluído (é o "Próximo" do assistente). */
export async function saveCreationStep(request: CreationStepRequest): Promise<CreationResponse> {
  return api<CreationResponse>('/api/characters/me/creation', {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Rola 4d6 descartando o menor, para um atributo.
 *
 * O dado é sorteado no servidor, com o mesmo mecanismo da janela de dados; o
 * resultado entra no rascunho (para distribuir depois) e no histórico do mestre.
 * `restart` recomeça os seis valores.
 */
export async function rollCreationAttribute(restart = false): Promise<CreationResponse> {
  return api<CreationResponse>('/api/characters/me/creation/roll', {
    method: 'POST',
    body: { restart },
  });
}

/** Passo 8: aplica um nível pelo assistente de Level Up, sem depender do mestre. */
export async function creationLevelUp(request: LevelUpRequest): Promise<CreationResponse> {
  return api<CreationResponse>('/api/characters/me/creation/level-up', {
    method: 'POST',
    body: request,
  });
}

/** Passo 9: fecha a criação. */
export async function finalizeCreation(): Promise<CreationResponse> {
  return api<CreationResponse>('/api/characters/me/creation/finalize', { method: 'POST' });
}

/** Devolve a ficha de um jogador ao assistente (exclusivo do mestre). */
export async function reopenCreation(characterId: string): Promise<Character> {
  const { character } = await api<{ character: Character }>(
    `/api/characters/${characterId}/creation/reopen`,
    { method: 'POST' },
  );
  return character;
}
