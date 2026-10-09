import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { getOnlineUsers } from '../../realtime/presence.js';
import { parseJson } from '../shared/json.js';
import { inventoryListSchema } from '../characters/characters.schema.js';
import type { InventoryItemDto } from '../characters/characters.dto.js';
import { loadCatalogLookup, syncInventory } from '../characters/inventory-sync.js';
import { availableQuantity, reservedQuantities } from './camp-supply-reservations.js';
import { computeCampSupplies } from './camp-supplies-calculator.js';
import {
  assertHitDiceSelection,
  completeLongRest,
  publishLongRestCompletion,
  LONG_REST_REQUEST_CLOSED,
  type CampSupplyOverrideInput,
  type LongRestCompletionDto,
  type LongRestCompletionOutcome,
} from './long-rest-completion.js';
import { normalizeHitDiceSelection, type HitDiceSelection } from '../shared/hit-dice.js';
import {
  toLongRestRequestDto,
  type LongRestRequestBaseDto,
  type LongRestRequestDto,
} from './long-rest-request.dto.js';
import type {
  CreateLongRestRequestInput,
  ForceCompleteLongRestInput,
  LongRestRequestActionInput,
  RespondLongRestRequestInput,
  SetCampSupplyContributionInput,
  SetHitDiceRecoveryInput,
  SetLongRestReadyInput,
} from './long-rest.schema.js';

/**
 * Solicitação COLETIVA de Descanso Longo (consenso da mesa) — com CONCLUSÃO REAL.
 *
 * Fluxo: um PLAYER solicita → a lista de convidados é CONGELADA (jogadores
 * PLAYER conectados com ficha) → solicitante nasce ACCEPTED, os demais PENDING →
 * cada um aceita/recusa enquanto a solicitação está PENDING → quando não há mais
 * PENDING ela é resolvida: APPROVED (cria uma `LongRestSession` ACTIVE SÓ para os
 * ACCEPTED) ou CANCELLED (ninguém aceitou). O MESTRE não participa do descanso:
 * pode forçar a aprovação, cancelar/abortar e FORÇAR a conclusão.
 *
 * Depois de aprovado, cada ACCEPTED marca "pronto para descansar" e escolhe os
 * Dados de Vida a recuperar. Quando TODOS estão prontos (e os recursos de
 * acampamento permitem), a conclusão aplica os benefícios do PHB 2014 na MESMA
 * transação; o mestre também pode concluir por conta própria (`force-complete`),
 * com ou sem a exceção narrativa de suprimentos. O motor de benefícios vive em
 * `long-rest-completion.ts`.
 *
 * Idempotência: a solicitação é global/multi-personagem, então NÃO reaproveita
 * `CharacterOperation` (que é por personagem) — usa `LongRestOperation`, com a
 * mesma semântica (chave única + tipo + fingerprint + resultado original).
 */

/** Tipo LÓGICO das operações da solicitação (`LongRestOperation.type`). */
const CREATE_TYPE = 'LONG_REST_REQUEST_CREATE';
const RESPOND_TYPE = 'LONG_REST_REQUEST_RESPOND';
const FORCE_TYPE = 'LONG_REST_REQUEST_FORCE_APPROVE';
const CANCEL_TYPE = 'LONG_REST_REQUEST_CANCEL';
/** Abortar um descanso EM ANDAMENTO (APPROVED) — exclusivo do mestre. */
const ABORT_TYPE = 'LONG_REST_REQUEST_ABORT';
/** Definir/atualizar/remover UMA contribuição de recurso de acampamento. */
const CAMP_SUPPLY_SET_TYPE = 'LONG_REST_CAMP_SUPPLY_SET';
/** Marcar/desmarcar "pronto para descansar" (pode concluir automaticamente). */
const READY_TYPE = 'LONG_REST_REQUEST_READY';
/** Escolher quais Dados de Vida recuperar na conclusão. */
const HIT_DICE_TYPE = 'LONG_REST_HIT_DICE_SELECTION';
/** Concluir o descanso forçado pelo mestre (com ou sem exceção narrativa). */
const COMPLETE_TYPE = 'LONG_REST_REQUEST_COMPLETE';

/** Mesma chave idempotente usada para outra operação. */
const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
/** Já existe uma solicitação coletiva aguardando resposta (uma PENDING global). */
const LONG_REST_REQUEST_ALREADY_PENDING = 'LONG_REST_REQUEST_ALREADY_PENDING';
/** Quem chamou não é participante da solicitação. */
const NOT_A_PARTICIPANT = 'NOT_A_PARTICIPANT';
/** Um dos personagens aceitos já tem um Descanso Longo ativo. */
const LONG_REST_SESSION_ALREADY_ACTIVE = 'LONG_REST_SESSION_ALREADY_ACTIVE';
/** Motivo gravado quando todos recusaram (nenhum ACCEPTED). */
const NO_PARTICIPANTS = 'NO_PARTICIPANTS';
/** Motivo gravado quando o mestre ABORTA um descanso em andamento. */
const ABORTED = 'ABORTED';
/** A mecânica de recursos de acampamento está desligada. */
const CAMP_SUPPLIES_DISABLED = 'CAMP_SUPPLIES_DISABLED';
/** O item escolhido não é um recurso de acampamento válido. */
const CAMP_SUPPLY_ITEM_INVALID = 'CAMP_SUPPLY_ITEM_INVALID';
/** A quantidade pedida excede o disponível (descontando reservas). */
const CAMP_SUPPLY_NOT_ENOUGH = 'CAMP_SUPPLY_NOT_ENOUGH';
/** A solicitação não está em andamento (APPROVED) para aceitar contribuições. */
const LONG_REST_NOT_IN_PROGRESS = 'LONG_REST_NOT_IN_PROGRESS';
/** A solicitação ainda não foi aprovada (PENDING): não há descanso em curso. */
const LONG_REST_REQUEST_NOT_APPROVED = 'LONG_REST_REQUEST_NOT_APPROVED';
/** Quem chamou aceitou o descanso? Só ACCEPTED age no descanso em curso. */
const NOT_ACCEPTED = 'NOT_ACCEPTED';
/** A contribuição alvo é de OUTRO personagem (só o dono mexe nela). */
const CONTRIBUTION_NOT_YOURS = 'CONTRIBUTION_NOT_YOURS';

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
  return prisma.longRestOperation.findUnique({ where: { operationId } });
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
  await tx.$queryRaw`SELECT "id" FROM "long_rest_requests" WHERE "id" = ${requestId} FOR UPDATE`;
}

/**
 * `include` padrão para montar o DTO: usuários e as SESSÕES da solicitação (de
 * onde sai o `sessionId` de cada participante).
 */
const REQUEST_DTO_INCLUDE = {
  requestedBy: { select: { id: true, username: true, displayName: true } },
  participants: {
    include: {
      user: { select: { id: true, username: true, displayName: true } },
      // Classes + uso dos Dados de Vida: o mínimo para derivar a cota do
      // Descanso Longo e as opções por tipo no DTO.
      character: { select: { classes: true, hitDice: true } },
    },
  },
  sessions: {
    select: {
      id: true,
      characterId: true,
      readyAt: true,
      hitDiceRecoverySelection: true,
    },
  },
} as const;

/**
 * Completa um DTO-base com a seção de recursos de acampamento (mecânica
 * opcional). Todo o cálculo vive em `camp-supplies-calculator.ts` — a config, as
 * contribuições e o VALOR do item são lidos pelo valor ATUAL, nunca de um
 * subtotal persistido.
 */
async function withCampSupplies(
  client: Db,
  base: LongRestRequestBaseDto,
): Promise<LongRestRequestDto> {
  const acceptedCharacterIds = base.participants
    .filter((participant) => participant.response === 'ACCEPTED')
    .map((participant) => participant.characterId);

  return {
    ...base,
    campSupplies: await computeCampSupplies(client, base.id, acceptedCharacterIds),
  };
}

/** Carrega a solicitação já no formato do DTO (com usuários, sessões e camp supplies). */
async function loadRequestDto(client: Db, requestId: string): Promise<LongRestRequestDto> {
  const request = await client.longRestRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: REQUEST_DTO_INCLUDE,
  });
  return withCampSupplies(client, toLongRestRequestDto(request));
}

/**
 * Carrega o participante de quem chamou, exigindo que ele tenha ACEITADO o
 * descanso. Só ACCEPTED age num descanso em andamento (ready, Dados de Vida).
 */
async function loadAcceptedParticipant(
  tx: Prisma.TransactionClient,
  requestId: string,
  userId: string,
) {
  const participant = await tx.longRestRequestParticipant.findUnique({
    where: { requestId_userId: { requestId, userId } },
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
      'Apenas quem aceitou o descanso pode fazer isso.',
      403,
      NOT_ACCEPTED,
    );
  }
  return participant;
}

/** Sessão ACTIVE deste personagem na solicitação (o descanso em curso). */
async function requireActiveSession(
  tx: Prisma.TransactionClient,
  requestId: string,
  characterId: string,
) {
  const session = await tx.longRestSession.findFirst({
    where: { longRestRequestId: requestId, characterId, status: 'ACTIVE' },
  });
  if (!session) {
    throw new HttpError(
      'Sua sessão de descanso não está ativa.',
      409,
      LONG_REST_REQUEST_CLOSED,
    );
  }
  return session;
}

/** Garante que a solicitação está EM ANDAMENTO (APPROVED) para agir no descanso. */
function assertApproved(request: { status: string }): void {
  if (request.status === 'PENDING') {
    throw new HttpError(
      'Esta solicitação de descanso ainda não foi aprovada.',
      409,
      LONG_REST_REQUEST_NOT_APPROVED,
    );
  }
  if (request.status !== 'APPROVED') {
    throw new HttpError(
      'Este descanso coletivo já terminou.',
      409,
      LONG_REST_REQUEST_CLOSED,
    );
  }
}

/**
 * Assinatura canônica da seleção de Dados de Vida (chaves ordenadas, sem
 * zeros) — dois envios equivalentes caem no MESMO fingerprint idempotente.
 */
function selectionFingerprint(selection: HitDiceSelection): string {
  const entries = Object.entries(normalizeHitDiceSelection(selection)).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  return JSON.stringify(Object.fromEntries(entries));
}

/** Normaliza a exceção narrativa recebida (ausente/desligada → sem exceção). */
function normalizeOverride(
  override: { enabled?: boolean; type: CampSupplyOverrideInput['type']; note?: string } | undefined,
): CampSupplyOverrideInput | null {
  if (!override || override.enabled === false) return null;
  const note = override.note?.trim();
  return { type: override.type, ...(note ? { note } : {}) };
}

/**
 * Resolve a solicitação quando não resta nenhum PENDING.
 *
 * `forcedByUserId` (force-approve do mestre) fecha os PENDING como DECLINED com
 * `closedByMaster = true` — NUNCA como aceitação. Sem ACCEPTED, cancela com
 * `NO_PARTICIPANTS`; caso contrário, valida TODOS os ACEITOS contra sessões
 * ativas (falha atômica se algum já tiver), cria as sessões ACTIVE e marca
 * APPROVED. Tudo na MESMA transação de quem chamou.
 *
 * ATENÇÃO: nenhum benefício de descanso é aplicado — apenas o vínculo da sessão.
 */
async function settleIfAnswered(
  tx: Prisma.TransactionClient,
  requestId: string,
  forcedByUserId: string | null,
): Promise<void> {
  if (forcedByUserId) {
    await tx.longRestRequestParticipant.updateMany({
      where: { requestId, response: 'PENDING' },
      data: { response: 'DECLINED', respondedAt: new Date(), closedByMaster: true },
    });
  } else {
    const pending = await tx.longRestRequestParticipant.count({
      where: { requestId, response: 'PENDING' },
    });
    if (pending > 0) return; // a coleta continua
  }

  const participants = await tx.longRestRequestParticipant.findMany({
    where: { requestId },
    select: { characterId: true, response: true },
  });
  const accepted = participants.filter((participant) => participant.response === 'ACCEPTED');

  // Ninguém aceitou → não faz sentido aprovar um descanso sem participantes.
  if (accepted.length === 0) {
    await tx.longRestRequest.update({
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
  const activeCount = await tx.longRestSession.count({
    where: { characterId: { in: characterIds }, status: 'ACTIVE' },
  });
  if (activeCount > 0) {
    throw new HttpError(
      'Um dos personagens já tem um Descanso Longo ativo; a solicitação não foi aprovada.',
      409,
      LONG_REST_SESSION_ALREADY_ACTIVE,
    );
  }

  // Uma sessão ACTIVE SÓ para cada ACCEPTED. DECLINED fica completamente fora.
  // O vínculo `longRestRequestId` é o que registra o descanso da mesa.
  for (const participant of accepted) {
    await tx.longRestSession.create({
      data: { characterId: participant.characterId, longRestRequestId: requestId },
    });
  }

  await tx.longRestRequest.update({
    where: { id: requestId },
    data: { status: 'APPROVED', approvedAt: new Date(), forcedByUserId },
  });
}

/** Publica o evento da solicitação para a mesa inteira (payload enxuto, sem fichas). */
function publishRequest(request: LongRestRequestDto): void {
  getBroadcaster().toTable(ServerEvents.LONG_REST_REQUEST_UPDATED, { request });
}

/** Resultado padrão de qualquer operação da solicitação. */
export interface LongRestRequestResult extends LongRestRequestDto {
  replayed: boolean;
}

/**
 * Resultado das operações que podem CONCLUIR o descanso (`ready` do último
 * participante e `force-complete` do mestre): o DTO da solicitação + o resultado
 * da conclusão (quando ela aconteceu nesta chamada; `null` quando o descanso
 * segue aberto).
 */
export interface LongRestCollectiveResult extends LongRestRequestDto {
  replayed: boolean;
  completion: LongRestCompletionDto | null;
}

/** Snapshot idempotente persistido em `LongRestOperation.result`. */
interface StoredLongRestResult {
  request: LongRestRequestDto;
  completion: LongRestCompletionDto | null;
}

/** Formata o snapshot guardado de volta à resposta pública. */
function storedToResult(
  stored: StoredLongRestResult,
  replayed: boolean,
): LongRestCollectiveResult {
  return { ...stored.request, replayed, completion: stored.completion };
}

/**
 * Cria a solicitação coletiva.
 *
 * Convidados = o solicitante + jogadores PLAYER CONECTADOS com ficha (o mestre
 * nunca entra; quem está offline não entra). A lista é congelada aqui. Se o
 * solicitante for o único elegível, a solicitação é aprovada na hora (nenhum
 * PENDING sobra) e sua sessão ACTIVE nasce na mesma transação.
 */
export async function createLongRestRequest(
  actor: Actor,
  input: CreateLongRestRequestInput,
): Promise<LongRestRequestResult> {
  const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

  const fingerprint = '{}';
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CREATE_TYPE, fingerprint),
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

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.longRestRequest.create({
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
      await tx.longRestOperation.create({
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
          ...replaySnapshot<LongRestRequestDto>(raced, CREATE_TYPE, fingerprint),
          replayed: true,
        };
      }
      const target = uniqueViolationTarget(error);
      if (target.includes('long_rest_sessions')) {
        throw new HttpError(
          'Um dos personagens já tem um Descanso Longo ativo; a solicitação não foi aprovada.',
          409,
          LONG_REST_SESSION_ALREADY_ACTIVE,
        );
      }
      throw new HttpError(
        'Já existe uma solicitação de Descanso Longo aguardando resposta.',
        409,
        LONG_REST_REQUEST_ALREADY_PENDING,
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
export async function respondToLongRestRequest(
  actor: Actor,
  requestId: string,
  input: RespondLongRestRequestInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId, response: input.response });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, RESPOND_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      const participant = await tx.longRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant) {
        throw new HttpError(
          'Você não participa desta solicitação de descanso.',
          403,
          NOT_A_PARTICIPANT,
        );
      }

      await tx.longRestRequestParticipant.update({
        where: { requestId_userId: { requestId, userId: actor.userId } },
        data: { response: input.response, respondedAt: new Date(), closedByMaster: false },
      });

      await settleIfAnswered(tx, requestId, null);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
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
          ...replaySnapshot<LongRestRequestDto>(raced, RESPOND_TYPE, fingerprint),
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
export async function forceApproveLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, FORCE_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await settleIfAnswered(tx, requestId, actor.userId);

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
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
          ...replaySnapshot<LongRestRequestDto>(raced, FORCE_TYPE, fingerprint),
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
export async function cancelLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CANCEL_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'PENDING') {
        throw new HttpError(
          'Esta solicitação de descanso já foi resolvida.',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await tx.longRestRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
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
          ...replaySnapshot<LongRestRequestDto>(raced, CANCEL_TYPE, fingerprint),
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
 * Define/atualiza/REMOVE a contribuição de UMA pilha do próprio inventário
 * (mecânica OPCIONAL de recursos de acampamento).
 *
 * Server-authoritative: só um participante ACCEPTED com sessão ACTIVE da MESMA
 * solicitação contribui, apenas com itens do PRÓPRIO inventário, e só quando a
 * mecânica está ligada. O cliente nunca envia valor/subtotal/total. Selecionar
 * NÃO consome: a quantidade fica RESERVADA (as operações de inventário respeitam
 * `quantity − reservado`).
 *
 * `quantity = 0` REMOVE a contribuição — e só isso: é uma remoção, não uma nova
 * contribuição, então NÃO revalida o item (a pilha pode ter saído do inventário,
 * o item pode ter deixado de ser recurso de acampamento e a quantidade não é
 * conferida). Sem contribuição existente, é um no-op coerente. `quantity > 0`
 * continua exigindo item existente, válido e quantidade disponível.
 *
 * Idempotente por `operationId` (tipo `LONG_REST_CAMP_SUPPLY_SET` + fingerprint
 * `{ requestId, inventoryItemId, quantity }`).
 */
export async function setCampSupplyContribution(
  actor: Actor,
  requestId: string,
  input: SetCampSupplyContributionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({
    requestId,
    inventoryItemId: input.inventoryItemId,
    quantity: input.quantity,
  });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, CAMP_SUPPLY_SET_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'APPROVED') {
        throw new HttpError(
          'Este descanso não está em andamento para receber contribuições.',
          409,
          LONG_REST_NOT_IN_PROGRESS,
        );
      }

      // Config lida DENTRO da transação (valor ATUAL — PASSO 29).
      const config = await tx.gameConfig.findUnique({ where: { id: 'main' } });
      if (!(config?.campSuppliesEnabled ?? false)) {
        throw new HttpError(
          'Os recursos de acampamento estão desligados nesta mesa.',
          403,
          CAMP_SUPPLIES_DISABLED,
        );
      }

      // Só participante ACCEPTED com sessão ACTIVE contribui (PASSO 7).
      const participant = await tx.longRestRequestParticipant.findUnique({
        where: { requestId_userId: { requestId, userId: actor.userId } },
      });
      if (!participant || participant.response !== 'ACCEPTED') {
        throw new HttpError(
          'Você não participa deste descanso como aceito.',
          403,
          NOT_A_PARTICIPANT,
        );
      }
      const session = await tx.longRestSession.findFirst({
        where: {
          characterId: participant.characterId,
          longRestRequestId: requestId,
          status: 'ACTIVE',
        },
      });
      if (!session) {
        throw new HttpError('Sua sessão de descanso não está ativa.', 409, NOT_A_PARTICIPANT);
      }

      // Contribuição JÁ existente desta pilha (se houver). A busca é por
      // `requestId + inventoryItemId` e NÃO depende de o item existir: remover
      // uma contribuição histórica é válido mesmo com a pilha fora do inventário.
      const current = await tx.longRestCampSupplyContribution.findUnique({
        where: { requestId_inventoryItemId: { requestId, inventoryItemId: input.inventoryItemId } },
      });
      // Só o DONO mexe na própria contribuição (nunca a de outro personagem).
      if (current && current.characterId !== participant.characterId) {
        throw new HttpError(
          'Esta contribuição de acampamento pertence a outro personagem.',
          403,
          CONTRIBUTION_NOT_YOURS,
        );
      }

      const character = await tx.character.findUnique({
        where: { id: participant.characterId },
        select: { id: true, inventory: true },
      });
      if (!character) throw new HttpError('Personagem não encontrado.', 404);

      // `quantity = 0` significa REMOVER esta contribuição (libera a reserva na
      // hora) — NÃO é uma nova contribuição. Por isso este caminho não revalida
      // o item: não exige que a pilha ainda exista, que o item continue marcado
      // como recurso de acampamento nem a quantidade disponível. Sem
      // contribuição existente é um no-op idempotente (a operação é registrada e
      // o DTO atual volta), como já era.
      if (input.quantity === 0) {
        if (current) {
          await tx.longRestCampSupplyContribution.delete({ where: { id: current.id } });
          await tx.character.update({
            where: { id: character.id },
            data: { version: { increment: 1 } },
          });
        }
        const loaded = await loadRequestDto(tx, requestId);
        await tx.longRestOperation.create({
          data: {
            operationId: input.operationId,
            type: CAMP_SUPPLY_SET_TYPE,
            requestFingerprint: fingerprint,
            result: loaded as unknown as Prisma.InputJsonValue,
          },
        });
        return loaded;
      }

      // Daqui em diante (`quantity > 0`) o item precisa EXISTIR no inventário do
      // PRÓPRIO personagem — o `characterId` NUNCA vem do cliente (PASSO 8).
      const currentQuantity = current?.quantity ?? 0;
      const inventory = parseJson<InventoryItemDto[]>(
        inventoryListSchema,
        character.inventory,
        [],
      );
      const catalog = await loadCatalogLookup([inventory]);
      const item = syncInventory(inventory, catalog).find(
        (entry) => entry.id === input.inventoryItemId,
      );
      if (!item) throw new HttpError('Item não encontrado no seu inventário.', 404);

      // O item precisa ser um recurso de acampamento VÁLIDO (PASSO 9.8/9.9).
      if (!item.campSupply.enabled || item.campSupply.value <= 0) {
        throw new HttpError(
          `O item ${item.name} não é um recurso de acampamento.`,
          400,
          CAMP_SUPPLY_ITEM_INVALID,
        );
      }

      // Reservas ATIVAS desta pilha, DESCONTANDO a contribuição desta própria
      // solicitação (que está sendo substituída). Nunca permite overcommit.
      const reserved = await reservedQuantities([item.id]);
      const reservedByOthers = Math.max(0, (reserved.get(item.id) ?? 0) - currentQuantity);
      const available = availableQuantity(item.quantity, reservedByOthers);
      if (input.quantity > available) {
        throw new HttpError(
          `Não há ${input.quantity} unidades de ${item.name} disponíveis para reservar ` +
            `(disponíveis: ${available}).`,
          409,
          CAMP_SUPPLY_NOT_ENOUGH,
        );
      }

      if (current) {
        await tx.longRestCampSupplyContribution.update({
          where: { id: current.id },
          data: { quantity: input.quantity },
        });
      } else {
        await tx.longRestCampSupplyContribution.create({
          data: {
            requestId,
            characterId: character.id,
            inventoryItemId: item.id,
            quantity: input.quantity,
          },
        });
      }
      // As reservas entram no `version` da ficha: qualquer operação que reduza a
      // quantidade revalida contra as reservas ao tentar de novo (evita
      // reservar + consumir simultâneos).
      await tx.character.update({
        where: { id: character.id },
        data: { version: { increment: 1 } },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: CAMP_SUPPLY_SET_TYPE,
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
          ...replaySnapshot<LongRestRequestDto>(raced, CAMP_SUPPLY_SET_TYPE, fingerprint),
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
 * MARCA/DESMARCA "pronto para descansar" (PASSO 2/3).
 *
 * Só um participante ACCEPTED, com sessão ACTIVE e a solicitação APPROVED.
 * Ready é apenas "terminei minhas decisões": recursos de acampamento
 * insuficientes NÃO impedem o ready — e, com todos prontos e suprimento
 * faltando, a solicitação segue APPROVED (estado válido, PASSO 9).
 *
 * Conclusão AUTOMÁTICA (PASSO 8): quando o ÚLTIMO participante fica pronto e os
 * recursos de acampamento estão satisfeitos (ou a mecânica está desligada), o
 * descanso é concluído na MESMA transação. O lock da solicitação garante que só
 * uma das chamadas concorrentes conclua.
 */
export async function setLongRestReady(
  actor: Actor,
  requestId: string,
  input: SetLongRestReadyInput,
): Promise<LongRestCollectiveResult> {
  const fingerprint = JSON.stringify({ requestId, ready: input.ready });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return storedToResult(
      replaySnapshot<StoredLongRestResult>(previous, READY_TYPE, fingerprint),
      true,
    );
  }

  let outcome!: { request: LongRestRequestDto; detail: LongRestCompletionOutcome | null };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      assertApproved(request);

      const participant = await loadAcceptedParticipant(tx, requestId, actor.userId);
      const session = await requireActiveSession(tx, requestId, participant.characterId);

      await tx.longRestSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { readyAt: input.ready ? new Date() : null },
      });

      // Conclusão automática: nenhuma sessão ACTIVE pendente de ready E os
      // recursos de acampamento satisfeitos (desligados contam como satisfeitos).
      let detail: LongRestCompletionOutcome | null = null;
      if (input.ready) {
        const notReady = await tx.longRestSession.count({
          where: { longRestRequestId: requestId, status: 'ACTIVE', readyAt: null },
        });
        if (notReady === 0) {
          const open = await loadRequestDto(tx, requestId);
          if (open.campSupplies.satisfied) {
            detail = await completeLongRest(tx, requestId, {
              forcedByUserId: null,
              override: null,
            });
          }
        }
      }

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
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

      return { request: loaded, detail };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return storedToResult(
          replaySnapshot<StoredLongRestResult>(raced, READY_TYPE, fingerprint),
          true,
        );
      }
    }
    throw error;
  }

  publishRequest(outcome.request);
  if (outcome.detail) await publishLongRestCompletion(outcome.detail);
  return {
    ...outcome.request,
    replayed: false,
    completion: outcome.detail?.completion ?? null,
  };
}

/**
 * ESCOLHE os Dados de Vida a recuperar (PASSO 4/5/6/7).
 *
 * O PHB 2014 manda recuperar metade do total (mínimo 1), mas NÃO define
 * prioridade entre tipos — em multiclasse o JOGADOR escolhe. A seleção fica
 * persistida na sessão ACTIVE e só é APLICADA na conclusão do descanso.
 *
 * Server-authoritative: a validação roda contra a ficha ATUAL (tipos 6/8/10/12,
 * inteiro ≥ 0, nunca mais do que foi gasto daquele tipo e soma ≤ cota efetiva).
 * Seleção vazia/zero é permitida.
 */
export async function setHitDiceRecovery(
  actor: Actor,
  requestId: string,
  input: SetHitDiceRecoveryInput,
): Promise<LongRestCollectiveResult> {
  const fingerprint = JSON.stringify({
    requestId,
    selection: selectionFingerprint(input.selection),
  });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return storedToResult(
      replaySnapshot<StoredLongRestResult>(previous, HIT_DICE_TYPE, fingerprint),
      true,
    );
  }

  let loaded!: LongRestRequestDto;
  try {
    loaded = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      assertApproved(request);

      const participant = await loadAcceptedParticipant(tx, requestId, actor.userId);
      const session = await requireActiveSession(tx, requestId, participant.characterId);

      const character = await tx.character.findUniqueOrThrow({
        where: { id: participant.characterId },
      });
      const selection = assertHitDiceSelection(character, input.selection);

      await tx.longRestSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { hitDiceRecoverySelection: selection as Prisma.InputJsonValue },
      });

      const dto = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: HIT_DICE_TYPE,
          requestFingerprint: fingerprint,
          result: { request: dto, completion: null } as unknown as Prisma.InputJsonValue,
        },
      });
      return dto;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return storedToResult(
          replaySnapshot<StoredLongRestResult>(raced, HIT_DICE_TYPE, fingerprint),
          true,
        );
      }
    }
    throw error;
  }

  publishRequest(loaded);
  return { ...loaded, replayed: false, completion: null };
}

/**
 * FORÇA a conclusão do Descanso Longo — exclusivo do MESTRE.
 *
 * Sem exceção, o force-complete NORMAL ignora apenas o `ready` que falta: os
 * recursos de acampamento continuam valendo e, se estiverem insuficientes, a
 * resposta é 409 `CAMP_SUPPLIES_INSUFFICIENT` com `required`/`contributed`/
 * `remaining`.
 *
 * Com `campSupplyOverride`, o mestre DECLARA a exceção narrativa (NARRATIVE —
 * resolveu na ficção — ou ADMINISTRATIVE — dispensou por decisão de mesa) e o
 * descanso conclui mesmo faltando suprimento. A exceção fica registrada no
 * resultado idempotente e as contribuições existentes seguem sendo consumidas:
 * os pontos que faltam NÃO são inventados nem cobrados.
 */
export async function forceCompleteLongRest(
  actor: Actor,
  requestId: string,
  input: ForceCompleteLongRestInput,
): Promise<LongRestCollectiveResult> {
  const override = normalizeOverride(input.campSupplyOverride);
  const fingerprint = JSON.stringify({
    requestId,
    override: override ? { type: override.type, note: override.note ?? null } : null,
  });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return storedToResult(
      replaySnapshot<StoredLongRestResult>(previous, COMPLETE_TYPE, fingerprint),
      true,
    );
  }

  let outcome!: { request: LongRestRequestDto; detail: LongRestCompletionOutcome };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      assertApproved(request);

      const detail = await completeLongRest(tx, requestId, {
        forcedByUserId: actor.userId,
        override,
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: COMPLETE_TYPE,
          requestFingerprint: fingerprint,
          result: {
            request: loaded,
            completion: detail.completion,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { request: loaded, detail };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findOperation(input.operationId);
      if (raced) {
        return storedToResult(
          replaySnapshot<StoredLongRestResult>(raced, COMPLETE_TYPE, fingerprint),
          true,
        );
      }
    }
    throw error;
  }

  publishRequest(outcome.request);
  await publishLongRestCompletion(outcome.detail);
  return { ...outcome.request, replayed: false, completion: outcome.detail.completion };
}

/**
 * ABORTA um Descanso Longo EM ANDAMENTO (APPROVED) — exclusivo do mestre.
 *
 * Encerra as sessões ACTIVE da solicitação (elas viram CANCELLED) e cancela a
 * solicitação com motivo `ABORTED`. As RESERVAS de acampamento deixam de valer
 * imediatamente (o helper só conta contribuições de solicitações APPROVED), sem
 * consumir nem remover nada do inventário. Não confundir com `cancel`, que só
 * vale para uma solicitação PENDING.
 */
export async function abortLongRestRequest(
  actor: Actor,
  requestId: string,
  input: LongRestRequestActionInput,
): Promise<LongRestRequestResult> {
  const fingerprint = JSON.stringify({ requestId });
  const previous = await findOperation(input.operationId);
  if (previous) {
    return {
      ...replaySnapshot<LongRestRequestDto>(previous, ABORT_TYPE, fingerprint),
      replayed: true,
    };
  }

  let dto!: LongRestRequestDto;
  try {
    dto = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);

      const request = await tx.longRestRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
      if (request.status !== 'APPROVED') {
        throw new HttpError(
          'Só é possível abortar um Descanso Longo em andamento (aprovado).',
          409,
          LONG_REST_REQUEST_CLOSED,
        );
      }

      await tx.longRestSession.updateMany({
        where: { longRestRequestId: requestId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.longRestRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: ABORTED },
      });

      const loaded = await loadRequestDto(tx, requestId);
      await tx.longRestOperation.create({
        data: {
          operationId: input.operationId,
          type: ABORT_TYPE,
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
          ...replaySnapshot<LongRestRequestDto>(raced, ABORT_TYPE, fingerprint),
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
 * Republica a solicitação aberta (se houver) — usado quando a CONFIG de recursos
 * de acampamento muda e o `required`/`satisfied` do DTO precisa refletir o valor
 * ATUAL para quem já está com o descanso aberto.
 */
export async function republishOpenLongRestRequest(): Promise<void> {
  try {
    const open = await getOpenLongRestRequest();
    if (open) publishRequest(open);
  } catch (error) {
    console.error('[long-rest] falha ao republicar a solicitação após mudança de config:', error);
  }
}

/**
 * Solicitação "aberta" da mesa: a única PENDING ou, se ela já foi aprovada, a
 * que está EM ANDAMENTO (APPROVED). Devolve `null` quando não há descanso
 * coletivo aberto (COMPLETED/CANCELLED não contam).
 */
export async function getOpenLongRestRequest(): Promise<LongRestRequestDto | null> {
  const pending = await prisma.longRestRequest.findFirst({
    where: { status: 'PENDING' },
    include: REQUEST_DTO_INCLUDE,
  });
  if (pending) return withCampSupplies(prisma, toLongRestRequestDto(pending));

  const approved = await prisma.longRestRequest.findFirst({
    where: { status: 'APPROVED' },
    orderBy: { approvedAt: 'desc' },
    include: REQUEST_DTO_INCLUDE,
  });
  return approved ? withCampSupplies(prisma, toLongRestRequestDto(approved)) : null;
}
