import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playCrit, playDice } from '../sound';
import type { DiceRollDto, DiceRollKind, SessionUser } from '../types';
import type { RealtimeHandlers } from '../useRealtime';
import { clearDiceHistory as clearDiceHistoryRequest, fetchDiceHistory, rollTableDice } from './diceApi';

/** Tipos de dado usados em D&D 5e (d100 = percentual). */
export const DICE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

/** Um dado escolhido no pool. `locked` = d20 fixo da rolagem de perícia. */
export interface DicePoolDie {
  sides: number;
  locked: boolean;
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

  // Reconhece a própria rolagem no tempo real (para não repetir o aviso).
  const myClientId = useRef<string | null>(null);
  const settleTimer = useRef<number | null>(null);
  const toastTimers = useRef<number[]>([]);

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
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
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
    }
  }, [phase, pool, advantage, disadvantage, context, isPrivate, isMaster, user.id]);

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

  const handlers = useMemo<RealtimeHandlers>(
    () => ({
      onDiceRoll: (payload) => {
        const { roll } = payload;

        // O mestre guarda todas as rolagens (públicas e privadas) no log lateral.
        if (isMaster) {
          setHistory((prev) => [roll, ...prev.filter((item) => item.id !== roll.id)].slice(0, 100));
        }

        // A própria rolagem já aparece na janela: não vira aviso para o autor.
        if (roll.clientId && roll.clientId === myClientId.current) return;

        toastSequence += 1;
        const id = `dice-toast-${toastSequence}`;
        setToasts((prev) => [{ id, roll }, ...prev].slice(0, 5));

        // Some sozinho depois de 3 segundos (ou antes, se o usuário dispensar).
        toastTimers.current.push(
          window.setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
          }, TOAST_MS),
        );
      },
    }),
    [isMaster],
  );

  return {
    isMaster,
    open,
    context,
    pool,
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
