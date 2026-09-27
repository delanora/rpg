import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playCrit, playDice } from '../sound';
import type {
  DiceRollDto,
  DiceRollKind,
  RollBoardDie,
  SessionUser,
  TableRollActivePayload,
} from '../types';
import type { RealtimeHandlers } from '../useRealtime';
import {
  announceActiveRoll,
  clearDiceHistory as clearDiceHistoryRequest,
  fetchActiveRoll,
  fetchDiceHistory,
  rollTableDice,
} from './diceApi';

/** Tipos de dado usados em D&D 5e (d100 = percentual). */
export const DICE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

/** Um dado escolhido no pool. `locked` = d20 fixo da rolagem de perícia. */
export interface DicePoolDie {
  sides: number;
  locked: boolean;
}

/**
 * O tabuleiro de quem está rolando, visto por quem apenas assiste.
 *
 * Chega pelo evento `dice:active` (pool, vantagem, fase) e é completado pelo
 * `dice:roll` com o resultado. Só o autor interage: aqui é tudo leitura.
 */
export interface RemoteBoard {
  userId: string;
  actorName: string;
  avatarUrl: string;
  kind: DiceRollKind;
  label: string;
  bonus: number;
  pool: RollBoardDie[];
  advantage: boolean;
  disadvantage: boolean;
  phase: RollPhase;
  result: DiceRollDto | null;
}

/** Contexto da rolagem aberta (livre ou de perícia/salvaguarda). */
export interface RollContext {
  kind: DiceRollKind;
  /** Perícia/salvaguarda; vazio na rolagem livre. */
  label: string;
  /** Bônus fixo pré-aplicado ao total. */
  bonus: number;
}

export type RollPhase = 'idle' | 'tumbling' | 'settled';

export interface DiceToast {
  id: string;
  roll: DiceRollDto;
}

let toastSequence = 0;

/** Duração da animação de queda dos dados, em milissegundos. */
const TUMBLE_MS = 1150;

/** Os avisos públicos somem sozinhos depois de 3 segundos. */
const TOAST_MS = 3000;

export function useDiceRoller(user: SessionUser) {
  const isMaster = user.role === 'MASTER';

  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<RollContext | null>(null);
  const [pool, setPool] = useState<DicePoolDie[]>([]);
  const [advantage, setAdvantageValue] = useState(false);
  const [disadvantage, setDisadvantageValue] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  const [phase, setPhase] = useState<RollPhase>('idle');
  const [result, setResult] = useState<DiceRollDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<DiceToast[]>([]);
  const [history, setHistory] = useState<DiceRollDto[]>([]);
  // Tabuleiro de outra pessoa da mesa, espelhado aqui (só para assistir).
  const [remote, setRemote] = useState<RemoteBoard | null>(null);

  // Reconhece a própria rolagem no tempo real (para não repetir o aviso).
  const myClientId = useRef<string | null>(null);
  const settleTimer = useRef<number | null>(null);
  const remoteSettleTimer = useRef<number | null>(null);
  const toastTimers = useRef<number[]>([]);
  // Quando os dados de outra pessoa começaram a cair (o aviso do resultado sai
  // quando eles pousam, nunca antes de quem rolou ver o resultado).
  const remoteTumbleAt = useRef<number | null>(null);
  // Dono do tabuleiro que está na tela (para casar a rolagem com ele sem
  // depender do estado, que muda a cada evento).
  const remoteUserId = useRef<string | null>(null);

  // O mestre carrega o histórico já acumulado ao abrir o painel.
  useEffect(() => {
    if (!isMaster) return;
    let active = true;

    fetchDiceHistory()
      .then((rolls) => {
        if (active) setHistory(rolls);
      })
      .catch(() => {
        // Sem histórico ainda: a lista começa vazia.
      });

    return () => {
      active = false;
    };
  }, [isMaster]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      if (remoteSettleTimer.current !== null) window.clearTimeout(remoteSettleTimer.current);
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  /** O tabuleiro assistido sai da tela quando a janela do autor fecha. */
  const clearRemote = useCallback(() => {
    if (remoteSettleTimer.current !== null) window.clearTimeout(remoteSettleTimer.current);
    remoteSettleTimer.current = null;
    remoteUserId.current = null;
    setRemote(null);
  }, []);

  /**
   * Os dados assistidos assentam junto com os do autor (mesma animação).
   *
   * `delay` é o que resta da queda: quem entra no meio só espera o restante.
   */
  const settleRemote = useCallback((delay: number = TUMBLE_MS) => {
    if (remoteSettleTimer.current !== null) window.clearTimeout(remoteSettleTimer.current);
    remoteSettleTimer.current = window.setTimeout(
      () => setRemote((current) => (current ? { ...current, phase: 'settled' } : current)),
      Math.max(0, delay),
    );
  }, []);

  /**
   * Coloca (ou atualiza) o tabuleiro de outra pessoa na tela.
   *
   * Quem manda no estado é o servidor: a fase diz se os dados estão caindo, o
   * `at` diz desde quando e o `lastRoll` traz o resultado já guardado. Assim,
   * quem entra no meio da rolagem assiste só o resto da queda e quem entra
   * depois vê o mesmo total de quem rolou — nunca fica o dado parado na tela
   * sem resultado.
   */
  const applyRemote = useCallback(
    (payload: TableRollActivePayload) => {
      const parsed = Date.parse(payload.at);
      // Data ausente ou inválida: trata como queda já terminada.
      const elapsed = Number.isFinite(parsed) ? Date.now() - parsed : TUMBLE_MS;
      const remaining = Math.max(0, TUMBLE_MS - elapsed);
      const tumbling = payload.board.phase === 'tumbling';

      if (remoteSettleTimer.current !== null) {
        window.clearTimeout(remoteSettleTimer.current);
        remoteSettleTimer.current = null;
      }

      remoteUserId.current = payload.userId;

      const board = {
        userId: payload.userId,
        actorName: payload.actorName,
        avatarUrl: payload.avatarUrl,
        kind: payload.kind,
        label: payload.label,
        bonus: payload.board.bonus,
        pool: payload.board.pool,
        advantage: payload.board.advantage,
        disadvantage: payload.board.disadvantage,
      };

      if (!tumbling) {
        setRemote({ ...board, phase: 'idle', result: null });
        return;
      }

      // Referência do aviso de resultado: o instante em que a queda começou.
      remoteTumbleAt.current = Date.now() - elapsed;

      if (remaining > 0) {
        // A queda começou a pouco tempo (o d20 do tabuleiro). O resultado
        // guardado viaja junto — quem entra no meio de uma rolagem já sabe o
        // total quando os dados pousarem —, mas só aparece depois da queda,
        // como para quem rolou.
        setRemote({ ...board, phase: 'tumbling', result: payload.lastRoll });
        settleRemote(remaining);
        return;
      }

      // A queda já passou: mostra o resultado guardado — ou volta para o pool,
      // quando a rolagem não chegou a acontecer (falha, por exemplo).
      setRemote(
        payload.lastRoll
          ? { ...board, phase: 'settled', result: payload.lastRoll }
          : { ...board, phase: 'idle', result: null },
      );
    },
    [settleRemote],
  );

  const reset = useCallback(() => {
    setContext(null);
    setPool([]);
    setAdvantageValue(false);
    setDisadvantageValue(false);
    setPrivate(false);
    setResult(null);
    setPhase('idle');
    setError(null);
  }, []);

  /** Rolagem livre: pool vazio, o jogador monta a combinação. */
  const openFree = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  /** Rolagem de perícia/salvaguarda: abre com 1d20 fixo e o bônus aplicado. */
  const openSkillRoll = useCallback(
    (input: RollContext) => {
      reset();
      setContext(input);
      setPool([{ sides: 20, locked: true }]);
      setOpen(true);
    },
    [reset],
  );

  const close = useCallback(() => setOpen(false), []);

  // A rolagem privada do mestre não é divulgada para a mesa.
  const isPrivateRoll = isPrivate && isMaster;
  const announcing = open && !isPrivateRoll;

  // O tabuleiro como a mesa o vê: pool, vantagem/desvantagem e o bônus do teste.
  const board = useMemo(
    () => ({
      pool: pool.map((die) => ({ sides: die.sides, locked: die.locked })),
      advantage,
      disadvantage,
      bonus: context?.bonus ?? 0,
    }),
    [pool, advantage, disadvantage, context?.bonus],
  );

  // Espelha o tabuleiro para a mesa (abrir/fechar, mexer no pool, trocar de
  // teste). A queda não é anunciada daqui: quem anuncia é o servidor, no início
  // da rolagem (ver `submit`), para não haver dois pedidos concorrentes.
  const announced = useRef(false);

  useEffect(() => {
    // Sem nada anunciado não há o que desfazer — evita um pedido por carga de tela.
    if (!announcing && !announced.current) return;
    announced.current = announcing;

    void announceActiveRoll({
      active: announcing,
      label: context?.label ?? '',
      kind: context?.kind ?? 'free',
      private: isPrivateRoll,
      ...board,
    }).catch(() => {
      // A mesa só não acompanha: a rolagem continua funcionando.
    });
  }, [announcing, isPrivateRoll, context?.label, context?.kind, board]);

  // Fechar a aba no meio da rolagem não pode deixar a faixa presa na mesa (o
  // servidor também limpa pelo disconnect, isto cobre o fechamento normal).
  useEffect(
    () => () => {
      if (announced.current) void announceActiveRoll({ active: false }).catch(() => {});
    },
    [],
  );

  // Tabuleiro que já estava aberto quando esta tela carregou.
  useEffect(() => {
    let active = true;

    fetchActiveRoll()
      .then((state) => {
        if (!active || !state || state.userId === user.id) return;
        // Mesmo caminho do evento: o tabuleiro pode chegar no meio da queda
        // (assiste o restante) ou depois dela (já com o resultado).
        applyRemote(state);
      })
      .catch(() => {
        // Sem estado: nenhum tabuleiro para assistir.
      });

    return () => {
      active = false;
    };
  }, [user.id, applyRemote]);

  const addDie = useCallback((sides: number) => {
    setPhase('idle');
    setResult(null);
    setPool((prev) => [...prev, { sides, locked: false }]);
  }, []);

  const removeDie = useCallback((index: number) => {
    setPhase('idle');
    setResult(null);
    setPool((prev) => prev.filter((die, position) => position !== index || die.locked));
  }, []);

  /** Limpa o pool mantendo os dados fixos (o d20 da perícia). */
  const clearPool = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setPool((prev) => prev.filter((die) => die.locked));
  }, []);

  const setAdvantage = useCallback((value: boolean) => {
    setAdvantageValue(value);
    if (value) setDisadvantageValue(false);
  }, []);

  const setDisadvantage = useCallback((value: boolean) => {
    setDisadvantageValue(value);
    if (value) setAdvantageValue(false);
  }, []);

  const submit = useCallback(async () => {
    if (phase === 'tumbling' || pool.length === 0) return;

    const clientId = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    myClientId.current = clientId;

    setPhase('tumbling');
    setResult(null);
    setError(null);

    // Não há anúncio de queda daqui: o servidor marca a fase `tumbling` no
    // começo da própria rolagem. Dois pedidos paralelos (anúncio + rolagem)
    // podiam chegar fora de ordem e o anúncio apagava o resultado recém-chegado
    // no tabuleiro de quem assiste — o dado ficava na tela sem total.
    try {
      const roll = await rollTableDice({
        dice: pool.map((die) => ({ sides: die.sides })),
        advantage,
        disadvantage,
        bonus: context?.bonus ?? 0,
        label: context?.label ?? '',
        kind: context?.kind ?? 'free',
        private: isPrivate && isMaster,
        clientId,
      });

      setResult(roll);
      playDice();
      if (roll.crit) playCrit();

      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => setPhase('settled'), TUMBLE_MS);
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Falha ao rolar os dados.');

      // A rolagem não aconteceu: devolve o tabuleiro da mesa ao estado parado
      // (o anúncio da queda foi feito pelo servidor e ficaria pendurado).
      if (announcing) {
        void announceActiveRoll({
          active: true,
          label: context?.label ?? '',
          kind: context?.kind ?? 'free',
          private: isPrivateRoll,
          ...board,
        }).catch(() => {});
      }
    }
  }, [
    phase,
    pool,
    advantage,
    disadvantage,
    context,
    isPrivate,
    isMaster,
    user.id,
    announcing,
    isPrivateRoll,
    board,
  ]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /** Zera o log lateral (mestre) no servidor e na memória local. */
  const clearHistory = useCallback(async () => {
    try {
      await clearDiceHistoryRequest();
      setHistory([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao limpar o histórico.');
    }
  }, []);

  /** Dados extras da vantagem/desvantagem: cada d20 do pool vira dois. */
  const extraD20 = useMemo(
    () =>
      advantage || disadvantage
        ? pool.filter((die) => die.sides === 20).length
        : 0,
    [pool, advantage, disadvantage],
  );

  const handlers = useMemo<RealtimeHandlers>(
    () => ({
      // O tabuleiro de outra pessoa da mesa (para assistir a rolagem).
      onDiceActive: (payload) => {
        if (!payload.active || payload.userId === user.id) {
          // Fechou — ou o tabuleiro é o meu (eu já vejo a janela de verdade).
          clearRemote();
          return;
        }

        applyRemote(payload);
      },

      onDiceRoll: (payload) => {
        const { roll } = payload;

        // O mestre guarda todas as rolagens (públicas e privadas) no log lateral.
        if (isMaster) {
          setHistory((prev) => [roll, ...prev.filter((item) => item.id !== roll.id)].slice(0, 100));
        }

        // A rolagem entra no tabuleiro espelhado de quem está assistindo.
        setRemote((current) =>
          current && current.userId === roll.actorUserId
            ? {
                ...current,
                result: roll,
                phase: current.phase === 'tumbling' ? 'tumbling' : 'settled',
              }
            : current,
        );

        // A resposta da rolagem chega a quem rolou no mesmo instante em que o
        // evento chega a quem assiste (os dois são uma perna de rede a partir
        // do servidor). Então a queda de quem assiste conta a partir daqui, e
        // não do anúncio de "rolando" — que sai meio round-trip mais cedo e
        // fazia os dados pousarem antes dos de quem rolou.
        if (roll.actorUserId === remoteUserId.current) settleRemote();

        // A própria rolagem já aparece na janela: não vira aviso para o autor.
        if (roll.clientId && roll.clientId === myClientId.current) return;

        // O aviso só entra quando os dados de quem rolou terminam de cair — sem
        // isso o resultado apareceria na mesa antes de aparecer para quem rolou.
        const tumbleAt = remoteTumbleAt.current;
        remoteTumbleAt.current = null;
        const remaining = tumbleAt === null ? TUMBLE_MS : Date.now() - tumbleAt;
        const delay = Math.max(0, TUMBLE_MS - remaining);

        toastSequence += 1;
        const id = `dice-toast-${toastSequence}`;

        toastTimers.current.push(
          window.setTimeout(() => {
            setToasts((prev) => [{ id, roll }, ...prev].slice(0, 5));

            // Some sozinho depois de 3 segundos (ou antes, se dispensarem).
            toastTimers.current.push(
              window.setTimeout(() => {
                setToasts((prev) => prev.filter((toast) => toast.id !== id));
              }, TOAST_MS),
            );
          }, delay),
        );
      },
    }),
    [isMaster, user.id, clearRemote, settleRemote, applyRemote],
  );

  return {
    isMaster,
    open,
    context,
    pool,
    extraD20,
    remote,
    advantage,
    disadvantage,
    isPrivate,
    phase,
    result,
    error,
    toasts,
    history,
    handlers,
    openFree,
    openSkillRoll,
    close,
    addDie,
    removeDie,
    clearPool,
    setAdvantage,
    setDisadvantage,
    setPrivate,
    submit,
    dismissToast,
    clearHistory,
  };
}

export type DiceRollerState = ReturnType<typeof useDiceRoller>;
