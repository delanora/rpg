import { ApiError, api } from '../api';
import { newId } from '../utils';
import type {
  CampSupplyOverrideType,
  LongRestCollectiveResultDto,
  LongRestRequestDto,
} from '../types';

/**
 * Chamadas do Descanso Longo coletivo — nenhum `fetch` espalhado pelos
 * componentes. Cada operação gera o próprio `operationId` (chave idempotente),
 * então um clique repetido nunca cria/força/consome de novo: o servidor devolve
 * o resultado original.
 *
 * O servidor é a ÚNICA autoridade: quem participa, quem está pronto, quantos
 * Dados de Vida cabem, quanto os suprimentos somam e se o descanso conclui são
 * decisões dele. Aqui só enviamos intenções.
 */

/** Aceitar/recusar na UI (o servidor rejeita `PENDING`). */
export type LongRestDecision = 'ACCEPTED' | 'DECLINED';

/** Seleção de Dados de Vida por face (`{ "10": 1, "6": 1 }`). */
export type HitDiceSelection = Record<string, number>;

/** Exceção do mestre sobre os recursos de acampamento (opcional no payload). */
export interface CampSupplyOverrideInput {
  type: CampSupplyOverrideType;
  /** Justificativa curta (≤ 300 caracteres) — opcional. */
  note?: string;
}

/**
 * Normaliza a resposta das operações. `create`/`respond`/`force-approve`/
 * `cancel`/`abort` não devolvem `completion` (o descanso não terminou ali), então
 * o campo vira `null` em vez de `undefined`.
 */
function asResult(raw: LongRestCollectiveResultDto): LongRestCollectiveResultDto {
  return { ...raw, completion: raw.completion ?? null };
}

/** Solicitação coletiva aberta da mesa (PENDING ou APPROVED), ou `null`. */
export function fetchOpenLongRestRequest(): Promise<LongRestRequestDto | null> {
  return api<{ request: LongRestRequestDto | null }>('/api/rest/long/request').then(
    (result) => result.request,
  );
}

/** Pede um Descanso Longo coletivo (jogador com ficha). */
export function requestLongRest(): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>('/api/rest/long/request', {
    method: 'POST',
    body: { operationId: newId() },
  }).then(asResult);
}

/** Aceita ou recusa a solicitação (trocável enquanto ela está PENDING). */
export function respondLongRest(
  requestId: string,
  response: LongRestDecision,
): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/respond`, {
    method: 'POST',
    body: { response, operationId: newId() },
  }).then(asResult);
}

/** Marca/desmarca "pronto para descansar" (pode concluir o descanso). */
export function setLongRestReady(
  requestId: string,
  ready: boolean,
): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/ready`, {
    method: 'POST',
    body: { ready, operationId: newId() },
  }).then(asResult);
}

/**
 * Grava a seleção de Dados de Vida a recuperar. O servidor substitui a seleção
 * inteira (o mapa enviado é a escolha completa), então a UI manda sempre o mapa
 * todo — nunca um delta.
 */
export function setLongRestHitDice(
  requestId: string,
  selection: HitDiceSelection,
): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/hit-dice`, {
    method: 'PUT',
    body: { selection, operationId: newId() },
  }).then(asResult);
}

/**
 * Contribui com UMA pilha do PRÓPRIO inventário (`quantity = 0` remove).
 * O valor em pontos é derivado pelo servidor — o cliente nunca o envia.
 */
export function setLongRestCampSupply(
  requestId: string,
  inventoryItemId: string,
  quantity: number,
): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/camp-supplies`, {
    method: 'PUT',
    body: { inventoryItemId, quantity, operationId: newId() },
  }).then(asResult);
}

/** Mestre: começa o descanso com quem já aceitou (o resto fica de fora). */
export function forceApproveLongRest(requestId: string): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/force-approve`, {
    method: 'POST',
    body: { operationId: newId() },
  }).then(asResult);
}

/**
 * Mestre: conclui o descanso agora.
 *
 * Sem `override`, ignora apenas o "pronto" que falta e continua respeitando os
 * recursos de acampamento (409 `CAMP_SUPPLIES_INSUFFICIENT` quando faltam). Com
 * `override`, o mestre declara a exceção (narrativa ou administrativa).
 */
export function forceCompleteLongRest(
  requestId: string,
  override?: CampSupplyOverrideInput,
): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/force-complete`, {
    method: 'POST',
    body: {
      operationId: newId(),
      ...(override ? { campSupplyOverride: { enabled: true, ...override } } : {}),
    },
  }).then(asResult);
}

/** Mestre: aborta um descanso APROVADO (libera reservas, nada é aplicado). */
export function abortLongRestRequest(requestId: string): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/abort`, {
    method: 'POST',
    body: { operationId: newId() },
  }).then(asResult);
}

/** Mestre: cancela a solicitação ainda PENDING. */
export function cancelLongRestRequest(requestId: string): Promise<LongRestCollectiveResultDto> {
  return api<LongRestCollectiveResultDto>(`/api/rest/long/${requestId}/cancel`, {
    method: 'POST',
    body: { operationId: newId() },
  }).then(asResult);
}

/**
 * Mensagens amigáveis para os códigos conhecidos. O servidor já manda um texto
 * em português; aqui ajustamos o que o jogador precisa entender sem jargão
 * técnico. Códigos desconhecidos caem na mensagem do servidor.
 */
const LONG_REST_ERROR_MESSAGES: Record<string, string> = {
  LONG_REST_REQUEST_ALREADY_PENDING:
    'Já existe uma solicitação de Descanso Longo aguardando resposta.',
  LONG_REST_SESSION_ALREADY_ACTIVE: 'Um dos personagens já tem um Descanso Longo ativo.',
  LONG_REST_REQUEST_NOT_APPROVED: 'O Descanso Longo ainda não começou.',
  LONG_REST_NOT_IN_PROGRESS: 'Este Descanso Longo já foi encerrado.',
  NO_PARTICIPANTS: 'Ninguém aceitou o Descanso Longo.',
  NOT_A_PARTICIPANT: 'Você não participa desta solicitação de descanso.',
  NOT_ACCEPTED: 'Apenas quem aceitou o descanso pode fazer isso.',
  CAMP_SUPPLIES_INSUFFICIENT: 'Ainda faltam recursos para concluir o descanso.',
  CAMP_SUPPLIES_DISABLED:
    'Os Recursos de Acampamento estão desativados — o descanso pode seguir normalmente.',
  CAMP_SUPPLY_ITEM_INVALID:
    'Esta pilha não serve como recurso de acampamento na sua ficha.',
  CAMP_SUPPLY_NOT_ENOUGH: 'Você não tem essa quantidade disponível nesta pilha.',
  CONTRIBUTION_NOT_YOURS: 'Esta contribuição pertence a outro personagem.',
  IDEMPOTENCY_KEY_REUSED: 'A ação já havia sido aplicada — atualizamos o estado.',
};

/** Traduz um erro da camada de API para uma mensagem exibível ao jogador. */
export function longRestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && LONG_REST_ERROR_MESSAGES[error.code]) {
      return LONG_REST_ERROR_MESSAGES[error.code];
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Não foi possível completar a ação.';
}
