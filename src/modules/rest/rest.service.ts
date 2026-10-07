import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { getOnlineUsers } from '../../realtime/presence.js';
import {
  toShortRestRequestDto,
  type ShortRestCompletionDto,
  type ShortRestRequestDto,
} from './short-rest-request.dto.js';
import {
  completeCollectiveShortRest,
  publishCollectiveCompletion,
  type CollectiveCompletionOutcome,
} from './collective-completion.js';
import type {
  CreateShortRestRequestInput,
  RespondShortRestRequestInput,
  SetReadyInput,
  ShortRestRequestActionInput,
} from './rest.schema.js';

/**
 * Solicitação COLETIVA de Descanso Curto (consenso da mesa).
 *
 * Fluxo: um PLAYER solicita → a lista de convidados é CONGELADA (jogadores
 * PLAYER conectados com ficha) → solicitante nasce ACCEPTED, os demais PENDING →
 * cada um aceita/recusa enquanto a solicitação está PENDING → quando não há mais
 * PENDING ela é resolvida: APPROVED (cria uma `ShortRestSession` ACTIVE SÓ para
 * os ACCEPTED) ou CANCELLED (ninguém aceitou). O MESTRE não participa: só pode
 * FORÇAR a aprovação ou CANCELAR.
 *
 * Idempotência: a solicitação é global/multi-personagem, então NÃO reaproveita
 * `CharacterOperation` (que é por personagem) — usa `ShortRestOperation`, com a
 * mesma semântica (chave única + tipo + fingerprint + resultado original).
 */

/** Tipo LÓGICO das operações da solicitação (`ShortRestOperation.type`). */
const CREATE_TYPE = 'SHORT_REST_REQUEST_CREATE';
const RESPOND_TYPE = 'SHORT_REST_REQUEST_RESPOND';
const FORCE_TYPE = 'SHORT_REST_REQUEST_FORCE_APPROVE';
const CANCEL_TYPE = 'SHORT_REST_REQUEST_CANCEL';
const READY_TYPE = 'SHORT_REST_REQUEST_READY';
const FORCE_COMPLETE_TYPE = 'SHORT_REST_REQUEST_FORCE_COMPLETE';

/** Mesma chave idempotente usada para outra operação. */
const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
/** Já existe uma solicitação coletiva aguardando resposta (uma PENDING global). */
const SHORT_REST_REQUEST_ALREADY_PENDING = 'SHORT_REST_REQUEST_ALREADY_PENDING';
/** A solicitação já foi resolvida (APPROVED/CANCELLED) — não aceita mais mudanças. */
const SHORT_REST_REQUEST_CLOSED = 'SHORT_REST_REQUEST_CLOSED';
/** Quem chamou não é participante da solicitação. */
const NOT_A_PARTICIPANT = 'NOT_A_PARTICIPANT';
/** Um dos personagens aceitos já tem um Descanso Curto ativo. */
const SHORT_REST_SESSION_ALREADY_ACTIVE = 'SHORT_REST_SESSION_ALREADY_ACTIVE';
/** Motivo gravado quando todos recusaram (nenhum ACCEPTED). */
const NO_PARTICIPANTS = 'NO_PARTICIPANTS';
/** A solicitação ainda não foi aprovada (não dá para ficar pronto ainda). */
const SHORT_REST_REQUEST_NOT_APPROVED = 'SHORT_REST_REQUEST_NOT_APPROVED';
/** Só quem ACEITOU o descanso pode marcar-se pronto. */
const NOT_ACCEPTED = 'NOT_ACCEPTED';

/** Autor da requisição (vem sempre do token). */
export interface Actor {
  userId: string;
  username: string;
  displayName: string;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Violação de unicidade do Prisma (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

/** Nome do alvo/índice que violou a unicidade (para separar as causas do P2002). */
function uniqueViolationTarget(error: unknown): string {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.join(',');
  return typeof target === 'string' ? target : '';
}

/** Busca a operação idempotente por `operationId` (global). */
function findOperation(operationId: string) {
  return prisma.shortRestOperation.findUnique({ where: { operationId } });
}

/**
 * Devolve o snapshot PERSISTIDO de uma operação já existente quando a
 * identidade lógica (tipo + fingerprint) bate — ou lança 409
 * `IDEMPOTENCY_KEY_REUSED` quando a MESMA chave foi usada para outra operação.
 */
function replaySnapshot<T>(
  previous: { type: string; requestFingerprint: string; result: Prisma.JsonValue },
  type: string,
  fingerprint: string,
): T {
  if (previous.type !== type || previous.requestFingerprint !== fingerprint) {
    throw new HttpError(
      'Esta chave de operação já foi usada para outra operação. Gere um novo identificador.',
      409,
      IDEMPOTENCY_KEY_REUSED,
    );
  }
  return previous.result as unknown as T;
}

/**
 * Serializa o acesso a UMA solicitação: trava a linha (`FOR UPDATE`). Assim,
 * responder / forçar / cancelar concorrentes se enfileiram e só uma operação
 * enxerga a solicitação ainda PENDING — sem corrida entre as transições.
 */
async function lockRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "short_rest_requests" WHERE "id" = ${requestId} FOR UPDATE`;
}

/**
 * `include` padrão para montar o DTO: usuários, classes (para a Song of Rest) e
 * as SESSÕES da solicitação (de onde sai o `ready` de cada participante).
 */
const REQUEST_DTO_INCLUDE = {
  requestedBy: { select: { id: true, username: true, displayName: true } },
  participants: {
    include: {
      user: { select: { id: true, username: true, displayName: true } },
      character: { select: { classes: true } },
    },
  },
  sessions: { select: { characterId: true, readyAt: true } },
} as const;

/** Carrega a solicitação já no formato do DTO (com usuários, classes e sessões). */
async function loadRequestDto(client: Db, requestId: string): Promise<ShortRestRequestDto> {
  const request = await client.shortRestRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: REQUEST_DTO_INCLUDE,
  });
  return toShortRestRequestDto(request);
}

/**
 * Resolve a solicitação quando não resta nenhum PENDING.
 *
 * `forcedByUserId` (force-approve do mestre) fecha os PENDING como DECLINED com
 * `closedByMaster = true` — NUNCA como aceitação. Sem ACCEPTED, cancela com
 * `NO_PARTICIPANTS`; caso contrário, valida TODOS os ACEITOS contra sessões
 * ativas (falha atômica se algum já tiver), cria as sessões ACTIVE e marca
 * APPROVED. Tudo na MESMA transação de quem chamou.
 */
async function settleIfAnswered(
  tx: Prisma.TransactionClient,
  requestId: string,
  forcedByUserId: string | null,
): Promise<void> {
  if (forcedByUserId) {
    await tx.shortRestRequestParticipant.updateMany({
      where: { requestId, response: 'PENDING' },
      data: { response: 'DECLINED', respondedAt: new Date(), closedByMaster: true },
    });
  } else {
    const pending = await tx.shortRestRequestParticipant.count({
      where: { requestId, response: 'PENDING' },
    });
    if (pending > 0) return; // a coleta continua
  }

  const participants = await tx.shortRestRequestParticipant.findMany({
    where: { requestId },
    select: { characterId: true, response: true },
  });
  const accepted = participants.filter((participant) => participant.response === 'ACCEPTED');

  // Ninguém aceitou → não faz sentido aprovar um descanso sem participantes.
  if (accepted.length === 0) {
    await tx.shortRestRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: NO_PARTICIPANTS,
        forcedByUserId,
      },
    });
    return;
  }

  // Conflito: qualquer ACCEPTED com sessão ativa ABORTA tudo (nada parcial).
  const characterIds = accepted.map((participant) => participant.characterId);
  const activeCount = await tx.shortRestSession.count({
    where: { characterId: { in: characterIds }, status: 'ACTIVE' },
  });
  if (activeCount > 0) {
    throw new HttpError(
      'Um dos personagens já tem um Descanso Curto ativo; a solicitação não foi aprovada.',
      409,
      SHORT_REST_SESSION_ALREADY_ACTIVE,
    );
  }

  // Uma sessão ACTIVE SÓ para cada ACCEPTED. DECLINED fica completamente fora.
  // O vínculo `shortRestRequestId` é o que permite concluir TODAS juntas depois.
  for (const participant of accepted) {
    await tx.shortRestSession.create({
      data: { characterId: participant.characterId, shortRestRequestId: requestId },
    });
  }

  await tx.shortRestRequest.update({
    where: { id: requestId },
    data: { status: 'APPROVED', approvedAt: new Date(), forcedByUserId },
  });
}

/** Publica o evento da solicitação para a mesa inteira (payload enxuto, sem fichas). */
function publishRequest(request: ShortRestRequestDto): void {
  getBroadcaster().toTable(ServerEvents.SHORT_REST_REQUEST_UPDATED, { request });
}

/** Resultado padrão de qualquer operação da solicitação. */
export interface ShortRestRequestResult extends ShortRestRequestDto {
  replayed: boolean;
}

/**
 * Cria a solicitação coletiva.
 *
 * Convidados = o solicitante + jogadores PLAYER CONECTADOS com ficha (o mestre
 * nunca entra; quem está offline não entra). A lista é congelada aqui. Se o
 * solicitante for o único elegível, a solicitação é aprovada na hora (nenhum
 * PENDING sobra) e sua sessão ACTIVE nasce na mesma transação.
 */
export async function createShortRestRequest(
  actor: Actor,
  input: CreateShortRestRequestInput,
): Promise<ShortRestRequestResult> {
  const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

  const fingerprint = '{}';
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<ShortRestRequestDto>(previous, CREATE_TYPE, fingerprint),
      replayed: true,
    };
  }

  // Elegíveis: o solicitante e os jogadores PLAYER online, todos com ficha.
  const onlineIds = getOnlineUsers()
    .filter((user) => user.role === 'PLAYER')
    .map((user) => user.userId);
  const candidateIds = [...new Set([actor.userId, ...onlineIds])];
  const candidates = await prisma.user.findMany({
    where: { id: { in: candidateIds }, role: 'PLAYER' },
    select: { id: true, character: { select: { id: true } } },
  });
  const eligible = candidates
    .filter((candidate) => candidate.character !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  // O solicitante fica sempre em primeiro (ordem de exibição/gravação).
  eligible.sort((a, b) => (a.id === actor.userId ? -1 : b.id === actor.userId ? 1 : 0));

  let dto!: ShortRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.shortRestRequest.create({
        data: {
          requestedByUserId: actor.userId,
          participants: {
            create: eligible.map((candidate) => ({
              userId: candidate.id,
              characterId: candidate.character!.id,
              response: candidate.id === actor.userId ? 'ACCEPTED' : 'PENDING',
              respondedAt: candidate.id === actor.userId ? now : null,
            })),
          },
        },
      });

      // Só o solicitante (nenhum PENDING) → resolve na hora.
      await settleIfAnswered(tx, created.id, null);

      const loaded = await loadRequestDto(tx, created.id);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CREATE_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<ShortRestRequestDto>(raced, CREATE_TYPE, fingerprint),
          replayed: true,
        };
      }
      const target = uniqueViolationTarget(error);
      if (target.includes('short_rest_sessions')) {
        throw new HttpError(
          'Um dos personagens já tem um Descanso Curto ativo; a solicitação não foi aprovada.',
          409,
          SHORT_REST_SESSION_ALREADY_ACTIVE,
        );
      }
      throw new HttpError(
        'Já existe uma solicitação de Descanso Curto aguardando resposta.',
        409,
        SHORT_REST_REQUEST_ALREADY_PENDING,
      );
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * Responde à solicitação (ACCEPTED/DECLINED).
 *
 * Só um participante responde, e só enquanto a solicitação está PENDING — a
 * resposta pode ser TROCADA quantas vezes quiser até a aprovação (a troca é
 * idempotente por `operationId`). Depois de resolver, a mudança é recusada.
 * Quando a última resposta chega, a solicitação é resolvida na mesma transação.
 */
export async function respondToShortRestRequest(
  actor: Actor,
  requestId: string,
  input: RespondShortRestRequestInput,
): Promise<ShortRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId, response: input.response });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<ShortRestRequestDto>(previous, RESPOND_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: ShortRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.shortRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          SHORT_REST_REQUEST_CLOSED,
        );
      }

      const participant = await tx.shortRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant) {
        throw new HttpError(
          'Você não participa desta solicitação de descanso.',
          403,
          NOT_A_PARTICIPANT,
        );
      }

      await tx.shortRestRequestParticipant.update({
        where: { requestId_userId: { requestId, userId: actor.userId } },
        data: { response: input.response, respondedAt: new Date(), closedByMaster: false },
      });

      await settleIfAnswered(tx, requestId, null);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: RESPOND_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<ShortRestRequestDto>(raced, RESPOND_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * FORÇA a aprovação (exclusivo do mestre).
 *
 * ACCEPTED continua aceito, DECLINED continua recusado e o PENDING vira um NÃO
 * PARTICIPANTE (persistido como DECLINED + `closedByMaster`). Cria sessões
 * apenas para os ACCEPTED; sem nenhum ACCEPTED → CANCELLED / NO_PARTICIPANTS.
 */
export async function forceApproveShortRestRequest(
  actor: Actor,
  requestId: string,
  input: ShortRestRequestActionInput,
): Promise<ShortRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<ShortRestRequestDto>(previous, FORCE_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: ShortRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.shortRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          SHORT_REST_REQUEST_CLOSED,
        );
      }

      await settleIfAnswered(tx, requestId, actor.userId);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: FORCE_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<ShortRestRequestDto>(raced, FORCE_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * CANCELA a solicitação (exclusivo do mestre).
 *
 * PENDING → CANCELLED, sem criar sessões e sem alterar as respostas já dadas.
 */
export async function cancelShortRestRequest(
  actor: Actor,
  requestId: string,
  input: ShortRestRequestActionInput,
): Promise<ShortRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<ShortRestRequestDto>(previous, CANCEL_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: ShortRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.shortRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          SHORT_REST_REQUEST_CLOSED,
        );
      }

      await tx.shortRestRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CANCEL_TYPE,
          requestFingerprint: fingerprint,
          result: loaded as unknown as Prisma.InputJsonValue,
        },
      });
      return loaded;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return {
          ...replaySnapshot<ShortRestRequestDto>(raced, CANCEL_TYPE, fingerprint),
          replayed: true,
        };
      }
    }
    throw error;
  }

  publishRequest(dto);
  return { ...dto, replayed: false };
}

/**
 * Solicitação "aberta" da mesa: a única PENDING ou, se ela já foi aprovada, a
 * que está EM ANDAMENTO (APPROVED). Devolve `null` quando não há descanso
 * coletivo aberto (COMPLETED/CANCELLED não contam).
 */
export async function getOpenShortRestRequest(): Promise<ShortRestRequestDto | null> {
  const pending = await prisma.shortRestRequest.findFirst({
    where: { status: 'PENDING' },
    include: REQUEST_DTO_INCLUDE,
  });
  if (pending) return toShortRestRequestDto(pending);

  const approved = await prisma.shortRestRequest.findFirst({
    where: { status: 'APPROVED' },
    orderBy: { approvedAt: 'desc' },
    include: REQUEST_DTO_INCLUDE,
  });
  return approved ? toShortRestRequestDto(approved) : null;
}

/**
 * Resultado das operações que podem CONCLUIR o descanso coletivo (ready e
 * force-complete): o DTO da solicitação + o resultado da Song of Rest (quando a
 * conclusão aconteceu nesta chamada; `null` quando o descanso segue aberto).
 */
export interface ShortRestCollectiveResult extends ShortRestRequestDto {
  replayed: boolean;
  completion: ShortRestCompletionDto | null;
}

/** Snapshot idempotente persistido em `ShortRestOperation.result`. */
interface StoredCollectiveResult {
  request: ShortRestRequestDto;
  completion: ShortRestCompletionDto | null;
}

/** Formata o snapshot guardado de volta à resposta pública. */
function storedToResult(stored: StoredCollectiveResult, replayed: boolean): ShortRestCollectiveResult {
  return { ...stored.request, replayed, completion: stored.completion };
}

/**
 * MARCA/DESMARCA "pronto para finalizar".
 *
 * Só um participante ACCEPTED (com sessão ACTIVE e solicitação APPROVED) pode.
 * Enquanto pronto, ele não gasta outro Dado de Vida (ver `spendHitDie`). Quando
 * TODOS os ACCEPTED ficam prontos, a conclusão coletiva dispara na MESMA
 * transação — o lock da linha da solicitação garante que só uma chamada
 * concorrente conclua.
 */
export async function setShortRestReady(
  actor: Actor,
  requestId: string,
  input: SetReadyInput,
): Promise<ShortRestCollectiveResult> {
  const fingerprint = JSON.stringify({ requestId, ready: input.ready });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return storedToResult(
      replaySnapshot<StoredCollectiveResult>(previous, READY_TYPE, fingerprint),
      true,
    );
  }

  let outcome!: {
    request: ShortRestRequestDto;
    completion: ShortRestCompletionDto | null;
    detail: CollectiveCompletionOutcome | null;
  };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.shortRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status === 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso ainda não foi aprovada.',
          409,
          SHORT_REST_REQUEST_NOT_APPROVED,
        );
      }
      if (request.status !== 'APPROVED') {
        throw new HttpError('Este descanso coletivo já terminou.', 409, SHORT_REST_REQUEST_CLOSED);
      }

      const participant = await tx.shortRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant) {
        throw new HttpError(
          'Você não participa desta solicitação de descanso.',
          403,
          NOT_A_PARTICIPANT,
        );
      }
      if (participant.response !== 'ACCEPTED') {
        throw new HttpError(
          'Apenas quem aceitou o descanso pode marcar-se pronto.',
          403,
          NOT_ACCEPTED,
        );
      }

      const session = await tx.shortRestSession.findFirst({
        where: {
          shortRestRequestId: requestId,
          characterId: participant.characterId,
          status: 'ACTIVE',
        },
      });
      if (!session) {
        throw new HttpError('Sua sessão de descanso não está ativa.', 409, SHORT_REST_REQUEST_CLOSED);
      }

      await tx.shortRestSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { readyAt: input.ready ? new Date() : null },
      });

      // Conclusão automática: nenhuma sessão do descanso pendente de ready.
      let detail: CollectiveCompletionOutcome | null = null;
      if (input.ready) {
        const notReady = await tx.shortRestSession.count({
          where: { shortRestRequestId: requestId, status: 'ACTIVE', readyAt: null },
        });
        if (notReady === 0) detail = await completeCollectiveShortRest(tx, requestId);
      }

      const loaded = await loadRequestDto(tx, requestId);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: READY_TYPE,
          requestFingerprint: fingerprint,
          result: {
            request: loaded,
            completion: detail?.completion ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { request: loaded, completion: detail?.completion ?? null, detail };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return storedToResult(
          replaySnapshot<StoredCollectiveResult>(raced, READY_TYPE, fingerprint),
          true,
        );
      }
    }
    throw error;
  }

  publishRequest(outcome.request);
  if (outcome.detail) await publishCollectiveCompletion(requestId, outcome.detail);
  return { ...outcome.request, replayed: false, completion: outcome.completion };
}

/**
 * FORÇA a conclusão coletiva (exclusivo do mestre).
 *
 * Ignora o `ready` faltante: conclui todas as sessões ACCEPTED, aplica a Song of
 * Rest normalmente e restaura os recursos. DECLINED continua fora e as respostas
 * não mudam. Idempotente por `operationId` (um reenvio NÃO rola de novo).
 */
export async function forceCompleteShortRestRequest(
  actor: Actor,
  requestId: string,
  input: ShortRestRequestActionInput,
): Promise<ShortRestCollectiveResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return storedToResult(
      replaySnapshot<StoredCollectiveResult>(previous, FORCE_COMPLETE_TYPE, fingerprint),
      true,
    );
  }

  let outcome!: {
    request: ShortRestRequestDto;
    completion: ShortRestCompletionDto;
    detail: CollectiveCompletionOutcome;
  };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.shortRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status === 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso ainda não foi aprovada.',
          409,
          SHORT_REST_REQUEST_NOT_APPROVED,
        );
      }
      if (request.status !== 'APPROVED') {
        throw new HttpError('Este descanso coletivo já terminou.', 409, SHORT_REST_REQUEST_CLOSED);
      }

      const detail = await completeCollectiveShortRest(tx, requestId);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.shortRestOperation.create({
        data: {
          operationId: input.operationId,
          type: FORCE_COMPLETE_TYPE,
          requestFingerprint: fingerprint,
          result: {
            request: loaded,
            completion: detail.completion,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { request: loaded, completion: detail.completion, detail };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return storedToResult(
          replaySnapshot<StoredCollectiveResult>(raced, FORCE_COMPLETE_TYPE, fingerprint),
          true,
        );
      }
    }
    throw error;
  }

  publishRequest(outcome.request);
  await publishCollectiveCompletion(requestId, outcome.detail);
  return { ...outcome.request, replayed: false, completion: outcome.completion };
}
