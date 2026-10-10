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
  /**
   * Solicitação aberta (PENDING/APPROVED) ou a última resolvida, enquanto o
   * resultado ainda está na tela (sai de cena com `dismissResolved`).
   */
  request: ShortRestRequestDto | null;
  loading: boolean;
  error: string | null;
  /** Ação em andamento (ou `null`). */
  pending: ShortRestAction | null;
  /** Resultado da conclusão coletiva (Song of Rest), quando chegou. */
  completion: ShortRestCompletionDto | null;
  clearError: () => void;
  /**
   * Esquece a solicitação JÁ RESOLVIDA (COMPLETED/CANCELLED) que está na tela.
   * Chamada ao fechar o painel: o próximo clique volta ao estado inicial (nova
   * solicitação) sem F5. Num descanso vivo (PENDING/APPROVED) é no-op — fechar
   * no meio nunca perde o descanso em andamento — e não fala com o servidor.
   */
  dismissResolved: () => void;
  /**
   * Reconcilia a solicitação com o servidor (fonte única da verdade). O GET só
   * devolve um descanso ABERTO (PENDING/APPROVED) ou `null`: com aberto, ele
   * passa a ser o atual; com `null`, o descanso ativo acabou e o resultado em
   * tela também é descartado — o cliente não preserva COMPLETED/CANCELLED por
   * conta própria (mesmo contrato do `dismissResolved`).
   */
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

  /**
   * Reconcilia com o servidor: o descanso aberto devolvido pelo GET vira o atual
   * e, se não há nenhum aberto, o estado é limpo inteiro. Guardar aqui uma
   * solicitação resolvida prenderia a UI no resultado antigo (era o BUG 1 do
   * Descanso Longo, com a mesma forma): quem exibe o resultado é o realtime/a
   * resposta da conclusão, e só o fechamento o descarta.
   */
  const refresh = useCallback(async () => {
    try {
      const current = await fetchOpenShortRestRequest();
      setRequest(current);
      if (!current) setCompletion(null);
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

  /**
   * Descarta o estado resolvido depois que o resultado sai da tela. A conclusão
   * continua visível até o usuário fechar (`PASSO 3`): só aqui `request` e
   * `completion` somem, e só quando o status é COMPLETED/CANCELLED.
   */
  const dismissResolved = useCallback(() => {
    if (!request || (request.status !== 'COMPLETED' && request.status !== 'CANCELLED')) return;
    setRequest(null);
    setCompletion(null);
  }, [request]);

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
    dismissResolved,
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
