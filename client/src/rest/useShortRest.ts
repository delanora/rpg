import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, ShortRestCompletionDto, ShortRestRequestDto } from '../types';
import type { RealtimeHandlers } from '../useRealtime';
import {
  cancelShortRestRequest,
  fetchOpenShortRestRequest,
  forceApproveShortRest,
  forceCompleteShortRest,
  requestShortRest,
  respondShortRest,
  restErrorMessage,
  setShortRestReady,
  spendShortRestHitDie,
  type SpendHitDieResult,
} from './restApi';

/**
 * Ação em andamento — usado para desabilitar só o botão certo (nunca a ficha
 * inteira) e evitar dupla submissão.
 */
export type ShortRestAction =
  | 'create'
  | 'respond'
  | 'ready'
  | 'spend'
  | 'force-approve'
  | 'force-complete'
  | 'cancel';

export interface UseShortRestOptions {
  /** Personagem do jogador (casa participante/sessão); ausente no painel do mestre. */
  characterId?: string;
  /** Aplica a ficha devolvida pelo gasto de Dado de Vida (fonte de verdade). */
  onCharacterUpdated?: (character: Character) => void;
}

export interface ShortRestController {
  /** Solicitação aberta (PENDING/APPROVED) ou a última resolvida vista ao vivo. */
  request: ShortRestRequestDto | null;
  loading: boolean;
  error: string | null;
  /** Ação em andamento (ou `null`). */
  pending: ShortRestAction | null;
  /** Resultado da conclusão coletiva (Song of Rest), quando chegou. */
  completion: ShortRestCompletionDto | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  create: () => Promise<void>;
  respond: (response: 'ACCEPTED' | 'DECLINED') => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  spendHitDie: (die: number, expectedVersion: number) => Promise<SpendHitDieResult | null>;
  forceApprove: () => Promise<void>;
  forceComplete: () => Promise<void>;
  cancel: () => Promise<void>;
  handlers: RealtimeHandlers;
}

/**
 * Estado do Descanso Curto coletivo para uma página.
 *
 * O servidor é a autoridade: aqui só guardamos a solicitação atual (vinda do GET
 * ou dos eventos `short-rest:*`) e disparamos as intenções. Nada de decidir
 * quem participa, quem ficou pronto ou quanto curar.
 *
 * Os handlers devolvidos devem ser mesclados no `useRealtime` da página (uma
 * única conexão de socket na aplicação).
 */
export function useShortRest({
  characterId,
  onCharacterUpdated,
}: UseShortRestOptions = {}): ShortRestController {
  const [request, setRequest] = useState<ShortRestRequestDto | null>(null);
  const [completion, setCompletion] = useState<ShortRestCompletionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ShortRestAction | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await fetchOpenShortRestRequest();
      // Só descarta a solicitação local quando o servidor confirma que não há
      // nada aberto E não temos uma solicitação resolvida recente na tela.
      setRequest((previous) => {
        if (current) return current;
        return previous && previous.status !== 'PENDING' && previous.status !== 'APPROVED'
          ? previous
          : null;
      });
    } catch (err) {
      setError(restErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchOpenShortRestRequest()
      .then((current) => {
        if (active) setRequest(current);
      })
      .catch((err: unknown) => {
        if (active) setError(restErrorMessage(err));
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
    async <T>(action: ShortRestAction, task: () => Promise<T>): Promise<T | null> => {
      setPending(action);
      setError(null);
      try {
        return await task();
      } catch (err) {
        setError(restErrorMessage(err));
        return null;
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const create = useCallback(async () => {
    const result = await run('create', () => requestShortRest());
    if (result) {
      setCompletion(null);
      setRequest(result);
    }
  }, [run]);

  const respond = useCallback(
    async (response: 'ACCEPTED' | 'DECLINED') => {
      if (!request) return;
      const result = await run('respond', () => respondShortRest(request.id, response));
      if (result) setRequest(result);
    },
    [request, run],
  );

  const setReady = useCallback(
    async (ready: boolean) => {
      if (!request) return;
      const result = await run('ready', () => setShortRestReady(request.id, ready));
      if (result) {
        setRequest(result);
        if (result.completion) setCompletion(result.completion);
      }
    },
    [request, run],
  );

  const spendHitDie = useCallback(
    async (die: number, expectedVersion: number): Promise<SpendHitDieResult | null> => {
      if (!request || !characterId) return null;
      const sessionId =
        request.participants.find((participant) => participant.characterId === characterId)
          ?.sessionId ?? null;
      if (!sessionId) {
        setError('Sua sessão de descanso não está ativa.');
        return null;
      }
      const result = await run('spend', () =>
        spendShortRestHitDie({ sessionId, die, expectedVersion }),
      );
      if (result) onCharacterUpdated?.(result.character);
      return result;
    },
    [characterId, onCharacterUpdated, request, run],
  );

  const forceApprove = useCallback(async () => {
    if (!request) return;
    const result = await run('force-approve', () => forceApproveShortRest(request.id));
    if (result) setRequest(result);
  }, [request, run]);

  const forceComplete = useCallback(async () => {
    if (!request) return;
    const result = await run('force-complete', () => forceCompleteShortRest(request.id));
    if (result) {
      setRequest(result);
      if (result.completion) setCompletion(result.completion);
    }
  }, [request, run]);

  const cancel = useCallback(async () => {
    if (!request) return;
    const result = await run('cancel', () => cancelShortRestRequest(request.id));
    if (result) setRequest(result);
  }, [request, run]);

  const clearError = useCallback(() => setError(null), []);

  const handlers = useMemo<RealtimeHandlers>(
    () => ({
      onShortRestRequestUpdated: (payload) => {
        setRequest(payload.request);
        // Uma solicitação nova (ou reaberta) começa sem conclusão pendente.
        if (payload.request.status === 'PENDING' || payload.request.status === 'APPROVED') {
          setCompletion(null);
        }
      },
      onShortRestCompleted: (payload) => setCompletion(payload.completion),
    }),
    [],
  );

  return {
    request,
    loading,
    error,
    pending,
    completion,
    clearError,
    refresh,
    create,
    respond,
    setReady,
    spendHitDie,
    forceApprove,
    forceComplete,
    cancel,
    handlers,
  };
}
