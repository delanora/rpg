import type { LongRestRequest, LongRestRequestParticipant, LongRestSession } from '@prisma/client';
import { normalizeClassEntries } from '../shared/classes.js';
import {
  deriveHitDice,
  hitDiceRecoveryAllowance,
  normalizeHitDiceSelection,
  selectedHitDiceTotal,
} from '../shared/hit-dice.js';

/**
 * DTO da SOLICITAÇÃO coletiva de Descanso Longo.
 *
 * A solicitação é GLOBAL (uma mesa única) e guarda a lista CONGELADA de
 * participantes com a resposta de cada um. Este DTO é o que o frontend recebe
 * (na resposta HTTP e no evento `long-rest:request-updated`) — só o necessário:
 * nenhuma ficha completa.
 *
 * Ciclo de status: `PENDING → APPROVED → COMPLETED` (ou `PENDING → CANCELLED`, ou
 * `APPROVED → CANCELLED` no aborto). APPROVED = sessões em andamento (o grupo
 * decide ready/seleção de Dados de Vida); COMPLETED = o Descanso Longo aplicou os
 * benefícios.
 */

export type LongRestRequestStatusDto = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
export type LongRestResponseDto = 'PENDING' | 'ACCEPTED' | 'DECLINED';

/** Referência mínima de um usuário (quem pediu / quem é convidado). */
export interface LongRestUserRefDto {
  userId: string;
  username: string;
  displayName: string;
}

export interface LongRestRequestParticipantDto {
  userId: string;
  username: string;
  displayName: string;
  characterId: string;
  response: LongRestResponseDto;
  respondedAt: string | null;
  /**
   * Verdadeiro quando o MESTRE fechou a resposta no force-approve (PENDING →
   * DECLINED). NUNCA indica aceitação.
   */
  closedByMaster: boolean;
  /**
   * Id da SESSÃO de Descanso Longo deste participante (`null` enquanto a
   * solicitação está PENDING ou quando ele recusou). É o vínculo persistente
   * criado na aprovação — e onde vive o `ready` e a seleção de Dados de Vida.
   */
  sessionId: string | null;
  /** Marcou "pronto para descansar" (só existe em ACCEPTED). */
  ready: boolean;
  readyAt: string | null;
  /**
   * Dados de Vida recuperáveis nesta sessão (só ACCEPTED com sessão): a cota do
   * PHB 2014, o uso atual por tipo e a escolha já persistida. `null` fora de um
   * descanso em andamento.
   */
  hitDiceRecovery: LongRestHitDiceRecoveryDto | null;
}

/** Uma face de Dado de Vida com o uso atual e a escolha desta sessão. */
export interface LongRestHitDieOptionDto {
  /** Faces do dado: 6, 8, 10 ou 12. */
  die: number;
  /** Total disponível (soma dos níveis das classes com esse dado de vida). */
  max: number;
  /** Gastos. */
  used: number;
  remaining: number;
  /** Quantos o jogador escolheu recuperar nesta sessão. */
  selected: number;
}

/**
 * Estado de recuperação de Dados de Vida da sessão: cota calculada pelo PHB
 * (metade do total, mínimo 1), uso atual e a escolha do JOGADOR (que decide os
 * TIPOS em multiclasse — o PHB não define prioridade).
 */
export interface LongRestHitDiceRecoveryDto {
  /** `max(1, floor(total / 2))`. */
  baseAllowance: number;
  /** `min(usado, baseAllowance)` — máximo recuperável AGORA. */
  allowance: number;
  /** Total de Dados de Vida gastos. */
  usedTotal: number;
  /** Soma da escolha atual. */
  selectedTotal: number;
  options: LongRestHitDieOptionDto[];
}

/**
 * Contribuição de RECURSO DE ACAMPAMENTO (mecânica OPCIONAL). Visão MÍNIMA
 * exposta à mesa: id da pilha (opaco) e pontos derivados — sem nome/descrição do
 * item alheio, para não vazar detalhes do inventário de outros jogadores. O
 * próprio jogador mapeia `inventoryItemId` na sua ficha (que já traz `campSupply`).
 */
export interface LongRestCampSupplyContributionDto {
  characterId: string;
  inventoryItemId: string;
  quantity: number;
  /** Pontos = `quantity × campSupply.value ATUAL` do item (nunca persistido). */
  points: number;
}

/** Pontos de acampamento por personagem (visão coletiva). */
export interface LongRestCampSupplyByCharacterDto {
  characterId: string;
  points: number;
}

/**
 * Seção de RECURSOS DE ACAMPAMENTO do DTO (mecânica OPCIONAL, DESLIGADA por
 * padrão). Com `enabled = false`, `required` é 0 e `satisfied` é sempre true — o
 * Descanso Longo oficial não muda.
 */
export interface LongRestCampSuppliesDto {
  enabled: boolean;
  costPerParticipant: number;
  /** `acceptedParticipants × costPerParticipant` (0 quando desligado). */
  required: number;
  /** Soma dos pontos das contribuições válidas. */
  contributed: number;
  /** `max(0, required − contributed)`. */
  remaining: number;
  /** `true` quando desligado ou `contributed ≥ required`. */
  satisfied: boolean;
  byCharacter: LongRestCampSupplyByCharacterDto[];
  contributions: LongRestCampSupplyContributionDto[];
}

export interface LongRestRequestDto {
  id: string;
  status: LongRestRequestStatusDto;
  /** Quem solicitou o descanso. */
  requestedBy: LongRestUserRefDto;
  /** Lista CONGELADA de convidados, com a resposta atual de cada um. */
  participants: LongRestRequestParticipantDto[];
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Motivo do cancelamento automático (ex.: `NO_PARTICIPANTS`) ou `null`. */
  cancelReason: string | null;
  /** Mestre que forçou a aprovação (`null` no fluxo normal). */
  forcedByUserId: string | null;
  /** Recursos de acampamento (mecânica opcional) — ver `LongRestCampSuppliesDto`. */
  campSupplies: LongRestCampSuppliesDto;
  /**
   * TODOS os ACCEPTED marcaram ready. Junto de `campSupplies.satisfied === false`
   * este é um estado VÁLIDO: o grupo terminou as decisões mas ainda há uma
   * questão de suprimentos para a mesa resolver (gancho de roleplay).
   */
  allReady: boolean;
}

/** Forma carregada da solicitação usada para montar o DTO. */
export type LongRestRequestWithParticipants = LongRestRequest & {
  requestedBy: { id: string; username: string; displayName: string };
  participants: (LongRestRequestParticipant & {
    user: { id: string; username: string; displayName: string };
    /**
     * Classes + uso persistido dos Dados de Vida: o mínimo para derivar a cota
     * do PHB e as opções por tipo SEM abrir a ficha inteira.
     */
    character: { classes: unknown; hitDice: unknown };
  })[];
  sessions: Pick<
    LongRestSession,
    'id' | 'characterId' | 'readyAt' | 'hitDiceRecoverySelection'
  >[];
};

/**
 * DTO da solicitação SEM a seção de recursos de acampamento. É o que a função
 * síncrona monta a partir da linha; o serviço anexa `campSupplies` (que exige
 * leituras de config/contribuições/catálogo) para fechar o `LongRestRequestDto`.
 */
export type LongRestRequestBaseDto = Omit<LongRestRequestDto, 'campSupplies'>;

const ISO = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Estado de Dados de Vida da sessão: cota do PHB, uso atual e a escolha
 * persistida. Calculado a partir das classes + do uso da ficha, sem expor nada
 * além do necessário.
 */
function hitDiceRecoveryOf(
  character: { classes: unknown; hitDice: unknown },
  selection: unknown,
): LongRestHitDiceRecoveryDto {
  const hitDice = deriveHitDice(normalizeClassEntries(character.classes), character.hitDice);
  const allowance = hitDiceRecoveryAllowance(hitDice.total, hitDice.used);
  const chosen = normalizeHitDiceSelection(selection);

  return {
    baseAllowance: allowance.base,
    allowance: allowance.effective,
    usedTotal: hitDice.used,
    selectedTotal: selectedHitDiceTotal(chosen),
    options: hitDice.byDie.map((entry) => ({
      die: entry.die,
      max: entry.max,
      used: entry.used,
      remaining: entry.remaining,
      selected: chosen[String(entry.die)] ?? 0,
    })),
  };
}

/**
 * Monta o DTO da solicitação. O `sessionId` de cada participante sai da SESSÃO
 * daquele personagem (a fonte real é a sessão; o participante só existe para
 * todos os convidados) — e é dela também que saem o `ready` e a seleção de
 * Dados de Vida.
 */
export function toLongRestRequestDto(
  request: LongRestRequestWithParticipants,
): LongRestRequestBaseDto {
  const sessionByCharacter = new Map(
    request.sessions.map((session) => [session.characterId, session]),
  );

  let acceptedCount = 0;
  let allReady = false;
  const participants = request.participants.map((participant) => {
    const session =
      participant.response === 'ACCEPTED'
        ? sessionByCharacter.get(participant.characterId) ?? null
        : null;
    const readyAt = session?.readyAt ?? null;
    if (participant.response === 'ACCEPTED') acceptedCount += 1;
    return {
      userId: participant.userId,
      username: participant.user.username,
      displayName: participant.user.displayName,
      characterId: participant.characterId,
      response: participant.response,
      respondedAt: ISO(participant.respondedAt),
      closedByMaster: participant.closedByMaster,
      sessionId: session?.id ?? null,
      ready: readyAt !== null,
      readyAt: ISO(readyAt),
      hitDiceRecovery: session
        ? hitDiceRecoveryOf(participant.character, session.hitDiceRecoverySelection)
        : null,
    };
  });
  // "Todos prontos" só faz sentido com pelo menos um ACCEPTED — e exige que
  // TODOS tenham marcado (é o gatilho da conclusão automática).
  allReady =
    acceptedCount > 0 &&
    participants
      .filter((participant) => participant.response === 'ACCEPTED')
      .every((participant) => participant.ready);
  // Ordem estável para a interface: quem solicitou primeiro, depois por nome.
  participants.sort((a, b) => {
    if (a.userId === request.requestedBy.id) return -1;
    if (b.userId === request.requestedBy.id) return 1;
    return a.username.localeCompare(b.username);
  });

  return {
    id: request.id,
    status: request.status,
    requestedBy: {
      userId: request.requestedBy.id,
      username: request.requestedBy.username,
      displayName: request.requestedBy.displayName,
    },
    participants,
    createdAt: request.createdAt.toISOString(),
    approvedAt: ISO(request.approvedAt),
    completedAt: ISO(request.completedAt),
    cancelledAt: ISO(request.cancelledAt),
    cancelReason: request.cancelReason,
    forcedByUserId: request.forcedByUserId,
    allReady,
  };
}
