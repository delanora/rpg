import { useCallback, useEffect, useMemo, useState } from 'react';
import { playCrit, playDice, playTurn } from '../sound';
import type {
  AttackResolvedPayload,
  CombatDto,
  DamageBreakdownPayload,
  DamageComponentPayload,
  DiceRolledPayload,
} from '../types';
import type { RealtimeHandlers } from '../useRealtime';

/**
 * Tipos de evento do log. Hoje o sistema emite rolagens (`dice:rolled`),
 * resoluções de ataque (`attack:resolved`) e início de turno (`combat:turn`);
 * os demais existem como espaço de estilo para quando o servidor passar a
 * enviá-los — a UI nunca inventa um evento.
 */
export type CombatLogKind =
  | 'initiative'
  | 'attack'
  | 'damage'
  | 'result'
  | 'turn'
  | 'heal'
  | 'hp'
  | 'condition'
  | 'rage'
  | 'feature'
  | 'spell';

export interface CombatLogEntry {
  id: string;
  kind: CombatLogKind;
  /** Quem protagonizou o evento (quem rolou, atacou ou começou o turno). */
  actorName: string;
  message?: string;
  /** Ação catalogada do registro (ex.: `death-save`, `stabilize`). */
  action?: string;
  at: string;
  crit?: boolean;

  /** Rolagem crua (iniciativa, dado de ataque ou de dano). */
  expression?: string;
  rolls?: number[];
  sides?: number;
  modifier?: number;
  total?: number;
  /** Quebra legível do dano (presente nas rolagens de DANO). */
  breakdown?: DamageBreakdownPayload;

  /** Ataque resolvido pelo servidor. */
  attackName?: string;
  targetName?: string;
  attackRoll?: number;
  /** Todos os d20 do teste (dois com vantagem/desvantagem). */
  attackRolls?: number[];
  attackBonus?: number;
  attackTotal?: number;
  targetArmorClass?: number | null;
  hit?: boolean;
  critical?: boolean;
  /** 1 natural no d20 (falha crítica) — só apresentação. */
  naturalOne?: boolean;
  advantage?: boolean;
  disadvantage?: boolean;
  damageRolled?: number;
  damageType?: string;
  components?: DamageComponentPayload[];
  sneakAttack?: AttackResolvedPayload['sneakAttack'];
  targetStatsHidden?: boolean;
  targetHpCurrent?: number | null;
  targetHpMax?: number | null;

  /** Rodada do combate (início de turno). */
  round?: number;
}

export interface TurnAlert {
  /** "É SEU TURNO!" (jogador) ou "TURNO DO MESTRE" (criatura/NPC). */
  title: string;
  combatantName: string;
  round: number;
  /** Audiência do toast — só apresentação; a privacidade é do servidor. */
  role: 'PLAYER' | 'MASTER';
}

/** Duração do toast central: 2 s, sem clique. */
export const TURN_TOAST_MS = 2000;

let logSequence = 0;
const nextLogId = (): string => `log-${(logSequence += 1)}`;

function describeRoll(payload: DiceRolledPayload): CombatLogEntry {
  return {
    id: nextLogId(),
    kind: payload.kind,
    actorName: payload.actorName,
    expression: payload.expression,
    rolls: payload.rolls,
    sides: payload.sides,
    modifier: payload.modifier,
    total: payload.total,
    crit: payload.crit,
    at: payload.at,
    ...(payload.breakdown ? { breakdown: payload.breakdown } : {}),
  };
}

function describeAttack(payload: AttackResolvedPayload): CombatLogEntry {
  return {
    id: nextLogId(),
    kind: 'result',
    actorName: payload.attackerName,
    attackName: payload.attackName,
    targetName: payload.targetName,
    attackRoll: payload.attackRoll,
    attackRolls: payload.attackRolls,
    attackBonus: payload.attackBonus,
    attackTotal: payload.attackTotal,
    targetArmorClass: payload.targetArmorClass,
    hit: payload.hit,
    critical: payload.critical,
    naturalOne: payload.attackRoll === 1 && !payload.critical,
    advantage: payload.advantage,
    disadvantage: payload.disadvantage,
    damageRolled: payload.damageRolled,
    damageType: payload.damageType,
    components: payload.components,
    sneakAttack: payload.sneakAttack,
    targetStatsHidden: payload.targetStatsHidden,
    targetHpCurrent: payload.targetHpCurrent,
    targetHpMax: payload.targetHpMax,
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
export function useCombatState(userId: string, role: 'PLAYER' | 'MASTER') {
  const [combat, storeCombat] = useState<CombatDto | null>(null);
  const setCombat = useCallback((incoming: CombatDto | null) => {
    storeCombat(previous => previous && incoming && previous.id === incoming.id && previous.version > incoming.version ? previous : incoming);
  }, []);
  const [log, setLog] = useState<CombatLogEntry[]>([]);
  const [turnAlert, setTurnAlert] = useState<TurnAlert | null>(null);

  // Toast do turno: some sozinho em 2 s. O timer é refeito a cada turno novo —
  // um turno que chega durante o fade reinicia a contagem, sem empilhar.
  useEffect(() => {
    if (!turnAlert) return;
    const timer = setTimeout(() => setTurnAlert(null), TURN_TOAST_MS);
    return () => clearTimeout(timer);
  }, [turnAlert]);

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
        // Audiência do toast (o servidor já pulou turnos de mortos/estabilizados,
        // então o evento é sempre de quem VAI agir):
        // • jogador: só o PRÓPRIO personagem;
        // • Mestre: criaturas/NPCs que ele controla (ownerUserId nulo).
        const ownCharacter = payload.ownerUserId === userId && payload.kind === 'CHARACTER';
        const masterCombatant =
          role === 'MASTER' && payload.ownerUserId === null && payload.kind !== 'CHARACTER';
        if (ownCharacter || masterCombatant) {
          playTurn();
          setTurnAlert({
            title: ownCharacter ? 'É SEU TURNO!' : 'TURNO DO MESTRE',
            combatantName: payload.combatantName,
            round: payload.round,
            role: ownCharacter ? 'PLAYER' : 'MASTER',
          });
        }
        // O início de turno entra no log de todos — dado já enviado pelo socket.
        setLog((previous) =>
          [
            {
              id: nextLogId(),
              kind: 'turn' as const,
              actorName: payload.combatantName,
              round: payload.round,
              at: new Date().toISOString(),
            },
            ...previous,
          ].slice(0, 40),
        );
      },
      onDiceRolled: (payload) => {
        playDice();
        if (payload.crit) playCrit();
        // Ataque + dano viram UM evento visual: as rolagens de ataque e de dano
        // não entram soltas no log — o cartão de `combat:attack` já traz tudo.
        // A iniciativa continua aparecendo (não há cartão de resultado dela).
        if (payload.kind !== 'initiative') return;
        setLog((previous) => [describeRoll(payload), ...previous].slice(0, 40));
      },
      onAttackResolved: (payload) => {
        setLog((previous) => [describeAttack(payload), ...previous].slice(0, 40));
      },
    }),
    [userId, role, setCombat],
  );

  const dismissTurnAlert = useCallback(() => setTurnAlert(null), []);

  return { combat, setCombat, log, turnAlert, dismissTurnAlert, handlers };
}
