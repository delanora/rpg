import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { rollD20, rollDie } from '../shared/dice.js';
import type { DiceRollDto, DiceRollKind, RolledDie } from './dice.dto.js';
import type { TableRollInput } from './dice.schema.js';

/**
 * Histórico das rolagens da sessão.
 *
 * Vive só na memória do servidor (como a apresentação de imagens): a mesa é
 * única e os dados pessoais das rolagens não precisam ir para o banco. O mestre
 * consulta a lista pelo painel; some ao reiniciar o processo.
 */
let history: DiceRollDto[] = [];
const HISTORY_LIMIT = 100;

export function getDiceHistory(): DiceRollDto[] {
  return history;
}

/** Limpa o histórico da sessão (o mestre recomeça o log). */
export function clearDiceHistory(): void {
  history = [];
}

/** Autor da rolagem, sempre carimbado a partir do token. */
export interface DiceActor {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

/**
 * Rola cada dado do pool. Vantagem/desvantagem valem só para o d20: nesse caso
 * ele é rolado duas vezes e o maior (ou menor) é mantido.
 */
function rollGroup(sides: number, advantage: boolean, disadvantage: boolean): RolledDie[] {
  if (sides === 20 && (advantage || disadvantage)) {
    const first = rollD20();
    const second = rollD20();
    const keepFirst = advantage ? first >= second : first <= second;
    return [
      { sides, value: first, dropped: !keepFirst },
      { sides, value: second, dropped: keepFirst },
    ];
  }

  return [{ sides, value: rollDie(sides) }];
}

function publish(roll: DiceRollDto, actor: DiceActor): void {
  try {
    const broadcaster = getBroadcaster();
    const payload = { roll };

    // Rolagem privada não gera aviso para mais ninguém: vai só para as sessões
    // de quem rolou. A pública chega a toda a mesa (jogadores e mestres).
    if (roll.isPrivate) {
      broadcaster.toUser(actor.userId, ServerEvents.DICE_ROLL, payload);
    } else {
      broadcaster.toTable(ServerEvents.DICE_ROLL, payload);
    }
  } catch (error) {
    console.error('[dice] falha ao publicar rolagem em tempo real:', error);
  }
}

export async function rollTableDice(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  // Vantagem e desvantagem são mutuamente exclusivas; se vierem as duas, o
  // servidor ignora as duas (a interface já impede).
  const advantage = Boolean(input.advantage) && !input.disadvantage;
  const disadvantage = Boolean(input.disadvantage) && !input.advantage;

  const dice = input.dice.flatMap((die) => rollGroup(die.sides, advantage, disadvantage));

  const bonus = input.bonus ?? 0;
  const kind: DiceRollKind = input.kind ?? 'free';
  const diceTotal = dice.reduce((sum, die) => (die.dropped ? sum : sum + die.value), 0);

  // O nome de quem rolou vem da ficha do usuário (cai no nome de exibição
  // quando não há ficha) — nunca do corpo da requisição.
  const character = await prisma.character.findUnique({
    where: { userId: actor.userId },
    select: { name: true },
  });

  const roll: DiceRollDto = {
    id: randomUUID(),
    clientId: input.clientId ?? null,
    actorName: character?.name?.trim() || actor.displayName,
    kind,
    label: input.label ?? '',
    dice,
    bonus,
    total: diceTotal + bonus,
    advantage,
    disadvantage,
    isPrivate: Boolean(input.private) && actor.role === 'MASTER',
    crit: dice.some((die) => die.sides === 20 && !die.dropped && die.value === 20),
    at: new Date().toISOString(),
  };

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);

  return roll;
}
