import { useCallback, useMemo, useState } from 'react';
import { playCrit, playDice, playTurn } from '../sound';
import type { AttackResolvedPayload, CombatDto, DiceRolledPayload } from '../types';
import type { RealtimeHandlers } from '../useRealtime';

export interface CombatLogEntry {
  id: string;
  kind: 'initiative' | 'attack' | 'damage' | 'result';
  text: string;
  detail?: string;
  crit?: boolean;
  at: string;
}

export interface TurnAlert {
  combatantName: string;
  round: number;
}

let logSequence = 0;
const nextLogId = (): string => `log-${(logSequence += 1)}`;

function describeRoll(payload: DiceRolledPayload): CombatLogEntry {
  const label =
    payload.kind === 'initiative'
      ? 'Iniciativa'
      : payload.kind === 'attack'
        ? 'Ataque'
        : 'Dano';

  const modifier = payload.modifier === 0 ? '' : payload.modifier > 0 ? ` +${payload.modifier}` : ` ${payload.modifier}`;
  const dice = payload.rolls.length > 0 ? `[${payload.rolls.join(', ')}]` : '';

  return {
    id: nextLogId(),
    kind: payload.kind,
    text: `${label}: ${payload.actorName} rolou ${payload.expression}${modifier} = ${payload.total}`,
    detail: dice,
    crit: payload.crit,
    at: payload.at,
  };
}

function describeAttack(payload: AttackResolvedPayload): CombatLogEntry {
  const outcome = payload.critical
    ? 'CRÍTICO!'
    : payload.hit
      ? 'acertou'
      : 'errou';

  const damage =
    payload.hit && payload.damageRolled > 0
      ? ` · ${payload.damageRolled} de dano${payload.damageType ? ` (${payload.damageType})` : ''} → ${payload.targetName} com ${payload.targetHpCurrent}/${payload.targetHpMax} HP`
      : '';

  return {
    id: nextLogId(),
    kind: 'result',
    text: `${payload.attackerName} usou ${payload.attackName} em ${payload.targetName} e ${outcome} (${payload.attackTotal} vs CA ${payload.targetArmorClass})`,
    detail: damage || undefined,
    crit: payload.critical,
    at: payload.at,
  };
}

/**
 * Estado do combate compartilhado por jogador e mestre.
 *
 * Devolve os handlers que devem ser mesclados no `useRealtime` — assim existe
 * uma única conexão de socket na aplicação.
 */
export function useCombatState(userId: string) {
  const [combat, setCombat] = useState<CombatDto | null>(null);
  const [log, setLog] = useState<CombatLogEntry[]>([]);
  const [turnAlert, setTurnAlert] = useState<TurnAlert | null>(null);

  const handlers = useMemo<RealtimeHandlers>(
    () => ({
      onCombatStarted: (payload) => {
        setCombat(payload.combat);
      },
      onCombatUpdated: (payload) => {
        setCombat(payload.combat);
      },
      onCombatEnded: () => {
        setCombat(null);
        setTurnAlert(null);
      },
      onCombatTurn: (payload) => {
        // O som e o destaque são para quem vai jogar agora.
        if (payload.ownerUserId === userId) {
          playTurn();
          setTurnAlert({ combatantName: payload.combatantName, round: payload.round });
        }
      },
      onDiceRolled: (payload) => {
        playDice();
        if (payload.crit) playCrit();
        setLog((previous) => [describeRoll(payload), ...previous].slice(0, 40));
      },
      onAttackResolved: (payload) => {
        setLog((previous) => [describeAttack(payload), ...previous].slice(0, 40));
      },
    }),
    [userId],
  );

  const dismissTurnAlert = useCallback(() => setTurnAlert(null), []);

  return { combat, setCombat, log, turnAlert, dismissTurnAlert, handlers };
}
