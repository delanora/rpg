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

  // CA e vida do alvo só entram quando não estão ocultas (criatura x jogador).
  const hpPart = payload.targetStatsHidden
    ? ''
    : ` com ${payload.targetHpCurrent}/${payload.targetHpMax} HP`;
  const vsPart = payload.targetStatsHidden
    ? ''
    : ` (${payload.attackTotal} vs CA ${payload.targetArmorClass})`;

  const sneak = payload.sneakAttack
    ? ` (inclui ${payload.sneakAttack.expression} de Ataque Furtivo)`
    : '';

  // Quebra por PARCELA (principal + extras), já com o que entrou de cada tipo.
  const components = payload.components ?? [];
  const breakdown = components
    .filter((component) => component.applied > 0)
    .map((component) =>
      component.type ? `${component.applied} ${component.type}` : `${component.applied}`,
    )
    .join(' + ');
  const typePart =
    breakdown !== '' ? ` [${breakdown}]` : payload.damageType ? ` (${payload.damageType})` : '';

  // Explica ao mestre por que o total não bate com a soma crua das rolagens.
  const defended = components
    .filter((component) => component.modifier !== null)
    .map((component) => {
      const label = component.type || 'sem tipo';
      if (component.modifier === 'immunity') return `${label} imune`;
      if (component.modifier === 'vulnerability') return `${label} vulnerável (×2)`;
      return `${label} resistido (${component.rolled}→${component.applied})`;
    });
  const defense = defended.length > 0 ? ` [${defended.join('; ')}]` : '';

  const allImmune = payload.hit && payload.damageRolled === 0 && defended.length > 0;
  const damage =
    payload.hit && payload.damageRolled > 0
      ? ` · ${payload.damageRolled} de dano${typePart}${sneak}${defense} → ${payload.targetName}${hpPart}`
      : allImmune
        ? ` · sem dano${defense} → ${payload.targetName}${hpPart}`
        : '';

  return {
    id: nextLogId(),
    kind: 'result',
    text: `${payload.attackerName} usou ${payload.attackName} em ${payload.targetName} e ${outcome}${vsPart}`,
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
