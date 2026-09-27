import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ServerEvents, type TableRollActivePayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { rollD20, rollDie } from '../shared/dice.js';
import type {
  ActiveRollDto,
  DiceRollDto,
  DiceRollKind,
  RollBoardDto,
  RolledDie,
} from './dice.dto.js';
import type { ActiveRollInput, TableRollInput } from './dice.schema.js';

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
 * Janela de dados aberta na mesa (ou `null`).
 *
 * Como a apresentação de imagens, é um estado efêmero da sessão: guardá-lo em
 * memória é o que permite reenviar a faixa a quem conectar no meio da rolagem.
 */
let activeRoll: ActiveRollDto | null = null;

/** Quem está com a janela de dados aberta (ou `null`). */
export function getActiveRoll(): ActiveRollDto | null {
  return activeRoll;
}

/** Divulga a faixa de "está rolando" para a mesa. */
function publishActive(payload: TableRollActivePayload): void {
  try {
    getBroadcaster().toTable(ServerEvents.DICE_ACTIVE, payload);
  } catch (error) {
    console.error('[dice] falha ao publicar a janela de dados em tempo real:', error);
  }
}

/** Monta o aviso a partir de quem está rolando (identidade carimbada no token). */
function activePayload(
  active: boolean,
  who: {
    userId: string;
    actorName: string;
    avatarUrl: string;
    kind: DiceRollKind;
    label: string;
    board: RollBoardDto;
  },
): TableRollActivePayload {
  return { active, ...who, at: new Date().toISOString() };
}

/**
 * Anuncia que a janela de dados abriu ou fechou.
 *
 * A rolagem privada do mestre não é divulgada: nesse caso o estado da mesa fica
 * vazio (e um anúncio anterior é desfeito, o que acontece quando o mestre marca
 * "Privada" com a janela já aberta).
 */
export async function setActiveRoll(
  actor: DiceActor,
  input: ActiveRollInput,
): Promise<ActiveRollDto | null> {
  const isPrivate = Boolean(input.private) && actor.role === 'MASTER';
  const active = input.active && !isPrivate;

  if (!active) {
    // Quem não está anunciando não derruba a faixa de outra pessoa.
    if (!activeRoll || activeRoll.userId !== actor.userId) return activeRoll;

    const previous = activeRoll;
    activeRoll = null;
    publishActive(activePayload(false, previous));

    return null;
  }

  // Nome e avatar saem da ficha (ou do nome de exibição, sem ficha) — nunca do
  // corpo da requisição.
  const character = await prisma.character.findUnique({
    where: { userId: actor.userId },
    select: { name: true, avatarUrl: true },
  });

  const who = {
    userId: actor.userId,
    actorName: character?.name?.trim() || actor.displayName,
    avatarUrl: character?.avatarUrl ?? '',
    kind: input.kind ?? ('free' as DiceRollKind),
    label: input.label ?? '',
    board: {
      pool: (input.pool ?? []).map((die) => ({ sides: die.sides, locked: Boolean(die.locked) })),
      advantage: Boolean(input.advantage) && !input.disadvantage,
      disadvantage: Boolean(input.disadvantage) && !input.advantage,
      bonus: input.bonus ?? 0,
      phase: input.phase === 'tumbling' ? ('tumbling' as const) : ('idle' as const),
    },
  };

  activeRoll = { ...who, at: new Date().toISOString() };
  publishActive(activePayload(true, who));

  return activeRoll;
}

/**
 * Esquece a janela aberta por um usuário que saiu da mesa.
 *
 * Sem isso a faixa ficaria presa no topo de todo mundo quando alguém fecha o
 * navegador no meio de uma rolagem.
 */
export function clearActiveRollFrom(userId: string): void {
  if (activeRoll?.userId !== userId) return;

  const previous = activeRoll;
  activeRoll = null;
  publishActive(activePayload(false, previous));
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
    actorUserId: actor.userId,
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
