import { ApiError, api } from '../api';
import { newId } from '../utils';
import type { Character, ShortRestCompletionDto, ShortRestRequestDto } from '../types';

/**
 * Chamadas do Descanso Curto coletivo — nenhum `fetch` espalhado pelos
 * componentes. Cada operação gera o próprio `operationId` (chave idempotente),
 * então um clique repetido nunca rola/gasta/cria de novo: o servidor devolve o
 * resultado original.
 */

/** Resposta das operações que podem CONCLUIR o descanso coletivo. */
export interface ShortRestCollectiveResult extends ShortRestRequestDto {
  replayed: boolean;
  /** Preenchido quando ESTA chamada concluiu o descanso; `null` se segue aberto. */
  completion: ShortRestCompletionDto | null;
}

/** Resposta do gasto de um Dado de Vida (espelha `SpendHitDieResult`). */
export interface SpendHitDieResult {
  /** A ficha já atualizada (PV e Dados de Vida gastos). */
  character: Character;
  roll: { die: number; value: number; conMod: number; healing: number; actualHealed: number };
  hp: { before: number; after: number; max: number };
  hitDice: Character['derived']['hitDice'];
  version: number;
  replayed: boolean;
}

/** Aceitar/recusar na UI (o servidor rejeita `PENDING`). */
export type ShortRestDecision = 'ACCEPTED' | 'DECLINED';

/** Solicitação coletiva aberta da mesa (PENDING ou APPROVED), ou `null`. */
export function fetchOpenShortRestRequest(): Promise<ShortRestRequestDto | null> {
  return api<{ request: ShortRestRequestDto | null }>('/api/rest/short/request').then(
    (result) => result.request,
  );
}

/** Pede um Descanso Curto coletivo (jogador). */
export function requestShortRest(): Promise<ShortRestRequestDto> {
  return api<ShortRestRequestDto>('/api/rest/short/request', {
    method: 'POST',
    body: { operationId: newId() },
  });
}

/** Aceita ou recusa a solicitação (trocável enquanto ela está PENDING). */
export function respondShortRest(
  requestId: string,
  response: ShortRestDecision,
): Promise<ShortRestRequestDto> {
  return api<ShortRestRequestDto>(`/api/rest/short/${requestId}/respond`, {
    method: 'POST',
    body: { response, operationId: newId() },
  });
}

/** Marca/desmarca "pronto para finalizar"; pode concluir o descanso coletivo. */
export function setShortRestReady(
  requestId: string,
  ready: boolean,
): Promise<ShortRestCollectiveResult> {
  return api<ShortRestCollectiveResult>(`/api/rest/short/${requestId}/ready`, {
    method: 'POST',
    body: { ready, operationId: newId() },
  });
}

/** Gasta UM Dado de Vida na sessão do descanso em andamento. */
export function spendShortRestHitDie(input: {
  sessionId: string;
  die: number;
  expectedVersion: number;
}): Promise<SpendHitDieResult> {
  return api<SpendHitDieResult>('/api/characters/me/rest/short/hit-die', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/** Mestre: força o início com quem já aceitou (o resto fica de fora). */
export function forceApproveShortRest(requestId: string): Promise<ShortRestRequestDto> {
  return api<ShortRestRequestDto>(`/api/rest/short/${requestId}/force-approve`, {
    method: 'POST',
    body: { operationId: newId() },
  });
}

/** Mestre: conclui agora, mesmo sem os "pronto" que faltam. */
export function forceCompleteShortRest(requestId: string): Promise<ShortRestCollectiveResult> {
  return api<ShortRestCollectiveResult>(`/api/rest/short/${requestId}/force-complete`, {
    method: 'POST',
    body: { operationId: newId() },
  });
}

/** Mestre: cancela a solicitação ainda PENDING. */
export function cancelShortRestRequest(requestId: string): Promise<ShortRestRequestDto> {
  return api<ShortRestRequestDto>(`/api/rest/short/${requestId}/cancel`, {
    method: 'POST',
    body: { operationId: newId() },
  });
}

/**
 * Mensagens amigáveis para os códigos conhecidos. O servidor já manda um texto
 * em português; aqui só ajustamos os casos em que a mensagem técnica não ajuda
 * o jogador. Códigos desconhecidos caem na mensagem do servidor.
 */
const REST_ERROR_MESSAGES: Record<string, string> = {
  SHORT_REST_ALREADY_ACTIVE: 'Já existe um Descanso Curto em andamento.',
  SHORT_REST_REQUEST_ALREADY_PENDING:
    'Já existe uma solicitação de Descanso Curto aguardando resposta.',
  SHORT_REST_SESSION_ALREADY_ACTIVE: 'Um dos personagens já tem um Descanso Curto ativo.',
  SHORT_REST_COLLECTIVE_COMPLETION_REQUIRED:
    'Este descanso deve ser concluído junto com os demais participantes.',
  SHORT_REST_REQUEST_CLOSED: 'Este Descanso Curto já foi encerrado.',
  SHORT_REST_REQUEST_NOT_APPROVED: 'O Descanso Curto ainda não começou.',
  SHORT_REST_SESSION_READY:
    'Você marcou que terminou — desmarque "pronto" antes de gastar outro Dado de Vida.',
  IDEMPOTENCY_KEY_REUSED: 'A ação já havia sido aplicada — atualizamos o estado.',
  NOT_A_PARTICIPANT: 'Você não participa desta solicitação de descanso.',
  NOT_ACCEPTED: 'Apenas quem aceitou o descanso pode marcar-se pronto.',
  NO_PARTICIPANTS: 'Ninguém aceitou o Descanso Curto.',
};

/** Traduz um erro da camada de API para uma mensagem exibível ao jogador. */
export function restErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && REST_ERROR_MESSAGES[error.code]) return REST_ERROR_MESSAGES[error.code];
    return error.message;
  }
  return error instanceof Error ? error.message : 'Não foi possível completar a ação.';
}
