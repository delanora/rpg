import { api } from './api';
import type {
  BackgroundOption,
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
 * Catálogos fixos do livro (raças e antecedentes), reaproveitados pela ficha
 * para explicar a composição dos atributos e descrever a identidade do
 * personagem. Buscados uma vez por sessão (uma única resposta do assistente).
 */
let catalogs: Promise<{ races: RaceOption[]; backgrounds: BackgroundOption[] }> | null = null;

function fetchCatalogs(): Promise<{ races: RaceOption[]; backgrounds: BackgroundOption[] }> {
  catalogs ??= fetchCreationState()
    .then((state) => ({
      races: state.creation.raceCatalog,
      backgrounds: state.creation.backgroundCatalog,
    }))
    .catch(() => ({ races: [], backgrounds: [] }));

  return catalogs;
}

/** Catálogo de raças (bônus de atributo e descrição) do Livro do Jogador. */
export function fetchRaceCatalog(): Promise<RaceOption[]> {
  return fetchCatalogs().then((value) => value.races);
}

/** Catálogo de antecedentes (perícias e descrição) do Livro do Jogador. */
export function fetchBackgroundCatalog(): Promise<BackgroundOption[]> {
  return fetchCatalogs().then((value) => value.backgrounds);
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
