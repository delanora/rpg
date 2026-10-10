import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CampSupplyOverrideType,
  LongRestCompletionDto,
  LongRestRequestDto,
  LongRestRequestParticipantDto,
} from '../types';
import type { RealtimeHandlers } from '../useRealtime';
import {
  abortLongRestRequest,
  cancelLongRestRequest,
  fetchOpenLongRestRequest,
  forceApproveLongRest,
  forceCompleteLongRest,
  longRestErrorMessage,
  requestLongRest,
  respondLongRest,
  setLongRestCampSupply,
  setLongRestHitDice,
  setLongRestReady,
  type HitDiceSelection,
  type LongRestDecision,
} from './longRestApi';

/**
 * Ação em andamento — usado para desabilitar só o controle certo (nunca a ficha
 * inteira) e evitar dupla submissão (PASSO 46).
 */
export type LongRestAction =
  | 'create'
  | 'respond'
  | 'ready'
  | 'hit-dice'
  | 'supply'
  | 'force-approve'
  | 'force-complete'
  | 'abort'
  | 'cancel';

export interface UseLongRestOptions {
  /** Personagem do jogador (casa participante/sessão); ausente no painel do mestre. */
  characterId?: string;
}

export interface LongRestController {
  /**
   * Solicitação aberta (PENDING/APPROVED) ou a última resolvida, enquanto o
   * resultado ainda está na tela (sai de cena com `dismissResolved`).
   */
  request: LongRestRequestDto | null;
  /**
   * O convite do PERSONAGEM do jogador nesta solicitação (ou `null` quando ele
   * não está entre os convidados / a página é do mestre).
   */
  me: LongRestRequestParticipantDto | null;
  /** Resultado da conclusão, quando ESTA sessão o recebeu (ready/force-complete). */
  completion: LongRestCompletionDto | null;
  loading: boolean;
  error: string | null;
  /** Ação em andamento (ou `null`). */
  pending: LongRestAction | null;
  clearError: () => void;
  /**
   * Esquece a solicitação JÁ RESOLVIDA (COMPLETED/CANCELLED) que está na tela.
   * Chamada ao fechar o resultado: o próximo clique no botão volta ao fluxo
   * inicial (nova solicitação) sem F5. Nunca toca uma solicitação viva
   * (PENDING/APPROVED) e não fala com o servidor.
   */
  dismissResolved: () => void;
  /**
   * Reconcilia a solicitação com o servidor (fonte única da verdade). O GET só
   * devolve uma solicitação ABERTA (PENDING/APPROVED) ou `null`: com aberta, ela
   * passa a ser a atual; com `null`, o descanso ativo acaba e também o resultado
   * em tela é descartado — o cliente não preserva COMPLETED/CANCELLED por conta
   * própria (mesmo contrato do `dismissResolved`).
   */
  refresh: () => Promise<void>;
  create: () => Promise<void>;
  respond: (response: LongRestDecision) => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  setHitDice: (selection: HitDiceSelection) => Promise<void>;
  setSupply: (inventoryItemId: string, quantity: number) => Promise<void>;
  forceApprove: () => Promise<void>;
  forceComplete: (override?: { type: CampSupplyOverrideType; note?: string }) => Promise<void>;
  abort: () => Promise<void>;
  cancel: () => Promise<void>;
  handlers: RealtimeHandlers;
}

/**
 * Estado do Descanso Longo coletivo para uma página.
 *
 * O servidor é a autoridade: aqui só guardamos a solicitação atual (vinda do GET
 * ou dos eventos `long-rest:request-updated`) e disparamos intenções. Nada de
 * decidir quem participa, quem ficou pronto, quantos Dados de Vida recuperar ou
 * quanto os suprimentos somam.
 *
 * Os handlers devolvidos devem ser mesclados no `useRealtime` da página (uma
 * única conexão de socket na aplicação).
 */
export function useLongRest({ characterId }: UseLongRestOptions = {}): LongRestController {
  const [request, setRequest] = useState<LongRestRequestDto | null>(null);
  const [completion, setCompletion] = useState<LongRestCompletionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LongRestAction | null>(null);

  /**
   * Reconcilia com o servidor: a solicitação aberta devolvida vira a atual e, se
   * não há nenhuma aberta, o estado ativo é limpo inteiro. Guardar uma
   * solicitação resolvida aqui prenderia a UI no resultado antigo (era a raiz do
   * BUG 1) — quem mostra o resultado é o realtime/a resposta da conclusão, e o
   * `completion` só é tocado quando o servidor confirma que não há descanso
   * aberto.
   */
  const refresh = useCallback(async () => {
    try {
      const current = await fetchOpenLongRestRequest();
      setRequest(current);
      if (!current) setCompletion(null);
    } catch (err) {
      setError(longRestErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchOpenLongRestRequest()
      .then((current) => {
        if (active) setRequest(current);
      })
      .catch((err: unknown) => {
        if (active) setError(longRestErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Roda uma ação marcando o `pending` e traduzindo o erro para o jogador. */
  const run = useCallback(
    async <T>(action: LongRestAction, task: () => Promise<T>): Promise<T | null> => {
      setPending(action);
      setError(null);
      try {
        return await task();
      } catch (err) {
        setError(longRestErrorMessage(err));
        return null;
      } finally {
        setPending(null);
      }
    },
    [],
  );

  /** Aplica a resposta de uma operação que pode ter CONCLUÍDO o descanso. */
  const adopt = useCallback((result: { completion: LongRestCompletionDto | null } | null) => {
    if (!result) return;
    // O servidor devolve a solicitação inteira junto (`...dto`), então ela é a
    // fonte do estado — não reconstruímos nada no cliente.
    setRequest(result as unknown as LongRestRequestDto);
    if (result.completion) setCompletion(result.completion);
  }, []);

  const create = useCallback(async () => {
    const result = await run('create', () => requestLongRest());
    if (result) {
      setCompletion(null);
      setRequest(result);
    }
  }, [run]);

  const respond = useCallback(
    async (response: LongRestDecision) => {
      if (!request) return;
      adopt(await run('respond', () => respondLongRest(request.id, response)));
    },
    [adopt, request, run],
  );

  const setReady = useCallback(
    async (ready: boolean) => {
      if (!request) return;
      const result = await run('ready', () => setLongRestReady(request.id, ready));
      if (result) {
        setRequest(result);
        // Concluir o descanso no MESMO ready traz o resultado aqui.
        if (result.completion) setCompletion(result.completion);
      }
    },
    [request, run],
  );

  const setHitDice = useCallback(
    async (selection: HitDiceSelection) => {
      if (!request) return;
      adopt(await run('hit-dice', () => setLongRestHitDice(request.id, selection)));
    },
    [adopt, request, run],
  );

  const setSupply = useCallback(
    async (inventoryItemId: string, quantity: number) => {
      if (!request) return;
      adopt(await run('supply', () => setLongRestCampSupply(request.id, inventoryItemId, quantity)));
    },
    [adopt, request, run],
  );

  const forceApprove = useCallback(async () => {
    if (!request) return;
    adopt(await run('force-approve', () => forceApproveLongRest(request.id)));
  }, [adopt, request, run]);

  const forceComplete = useCallback(
    async (override?: { type: CampSupplyOverrideType; note?: string }) => {
      if (!request) return;
      const result = await run('force-complete', () =>
        forceCompleteLongRest(request.id, override),
      );
      if (result) {
        setRequest(result);
        if (result.completion) setCompletion(result.completion);
      }
    },
    [request, run],
  );

  const abort = useCallback(async () => {
    if (!request) return;
    adopt(await run('abort', () => abortLongRestRequest(request.id)));
  }, [adopt, request, run]);

  const cancel = useCallback(async () => {
    if (!request) return;
    adopt(await run('cancel', () => cancelLongRestRequest(request.id)));
  }, [adopt, request, run]);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Limpa o estado ativo depois que o resultado de um descanso RESOLVIDO sai da
   * tela. A solicitação concluída não é "reaberta" pelo servidor (o GET só
   * devolve PENDING/APPROVED), então guardá-la no cliente prenderia a UI no ramo
   * do resultado para sempre — era exatamente o BUG 1.
   */
  const dismissResolved = useCallback(() => {
    if (!request || (request.status !== 'COMPLETED' && request.status !== 'CANCELLED')) return;
    setRequest(null);
    setCompletion(null);
  }, [request]);

  const me = useMemo(
    () =>
      characterId
        ? request?.participants.find((participant) => participant.characterId === characterId) ??
          null
        : null,
    [characterId, request],
  );

  const handlers = useMemo<RealtimeHandlers>(
    () => ({
      onLongRestRequestUpdated: (payload) => {
        setRequest(payload.request);
        // Solicitação nova (ou reaberta) começa sem resultado pendente.
        if (payload.request.status === 'PENDING' || payload.request.status === 'APPROVED') {
          setCompletion(null);
        }
      },
    }),
    [],
  );

  return {
    request,
    me,
    completion,
    loading,
    error,
    pending,
    clearError,
    dismissResolved,
    refresh,
    create,
    respond,
    setReady,
    setHitDice,
    setSupply,
    forceApprove,
    forceComplete,
    abort,
    cancel,
    handlers,
  };
}
