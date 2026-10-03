import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ServerEvents, type TableRollActivePayload } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import { rollD20, rollDice, rollDie } from '../shared/dice.js';
import { hasLuckyReroll } from '../shared/races/index.js';
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

/**
 * Esquece as rolagens de um usuário.
 *
 * Chamado quando a conta dele é excluída (o log da sessão não deve guardar
 * rolagens de quem não existe mais).
 */
export function forgetRollsFrom(userId: string): void {
  history = history.filter((roll) => roll.actorUserId !== userId);
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
    lastRoll: DiceRollDto | null;
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
      phase: 'idle' as const,
    },
    // Mexeu no tabuleiro: o resultado anterior deixa de valer (é o mesmo
    // comportamento da janela de quem rola).
    lastRoll: null,
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
/**
 * Marca o tabuleiro anunciado como "os dados estão caindo".
 *
 * O anúncio da queda é feito aqui, no começo da rolagem — e não pelo cliente,
 * em um pedido paralelo ao da rolagem. Com uma requisição só, a ordem
 * (queda → resultado) fica garantida para a mesa inteira: nenhum espectador
 * recebe o total antes de o próprio tabuleiro entrar em queda.
 */
export function markRollTumbling(actor: DiceActor): void {
  if (!activeRoll || activeRoll.userId !== actor.userId) return;

  activeRoll = {
    ...activeRoll,
    board: { ...activeRoll.board, phase: 'tumbling' },
    // A rolagem nova ainda não existe: o resultado guardado é o antigo.
    lastRoll: null,
    at: new Date().toISOString(),
  };

  publishActive(activePayload(true, activeRoll));
}

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

function publish(roll: DiceRollDto, actor: { userId: string }): void {
  try {
    const broadcaster = getBroadcaster();
    const payload = { roll };

    // Rolagem privada não gera aviso para mais ninguém: vai só para as sessões
    // de quem rolou. A pública chega a toda a mesa (jogadores e mestres).
    if (roll.isPrivate) {
      broadcaster.toUser(actor.userId, ServerEvents.DICE_ROLL, payload);
    } else if (roll.kind === 'creation') {
      // Rolagem de criação de personagem: a mesa NÃO é avisada (e nem vê o
      // "está rolando"), mas ela entra no log do mestre — é para lá que o
      // evento vai. O autor já recebeu o resultado na resposta da rota.
      broadcaster.toMasters(ServerEvents.DICE_ROLL, payload);
    } else {
      broadcaster.toTable(ServerEvents.DICE_ROLL, payload);
    }
  } catch (error) {
    console.error('[dice] falha ao publicar rolagem em tempo real:', error);
  }
}

export async function rollTableDice(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  const kind: DiceRollKind = input.kind ?? 'free';

  // Antes de sortear, avisa a mesa que os dados estão rolando (a janela de
  // quem assiste entra na mesma animação de queda). A rolagem da criação de
  // personagem passa longe disso: ela não é anunciada na mesa.
  if (kind !== 'creation') markRollTumbling(actor);

  // Vantagem e desvantagem são mutuamente exclusivas; se vierem as duas, o
  // servidor ignora as duas (a interface já impede).
  const advantage = Boolean(input.advantage) && !input.disadvantage;
  const disadvantage = Boolean(input.disadvantage) && !input.advantage;

  const dice = input.dice.flatMap((die) => rollGroup(die.sides, advantage, disadvantage));

  const bonus = input.bonus ?? 0;
  const diceTotal = dice.reduce((sum, die) => (die.dropped ? sum : sum + die.value), 0);

  // O nome de quem rolou vem da ficha do usuário (cai no nome de exibição
  // quando não há ficha) — nunca do corpo da requisição.
  const character = await prisma.character.findUnique({
    where: { userId: actor.userId },
    select: { name: true, race: true, raceId: true, subraceId: true },
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
    // Sortudo (Halfling): 1 natural num d20 de quem tem o traço. O combate fica
    // de fora por ora (o fluxo de ataque será revisto).
    lucky:
      dice.some((die) => die.sides === 20 && !die.dropped && die.value === 1) &&
      hasLuckyReroll({
        raceId: character?.raceId,
        subraceId: character?.subraceId,
        race: character?.race,
      }),
    at: new Date().toISOString(),
  };

  // Guarda o resultado no tabuleiro anunciado: quem chegar depois (recarga da
  // página, reconexão) vê o mesmo total, e não o dado parado sem resultado.
  if (activeRoll?.userId === actor.userId) {
    activeRoll = { ...activeRoll, lastRoll: roll };
  }

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);

  return roll;
}

/**
 * Rola o `effectRoll` de um item CONSUMÍVEL e registra a rolagem no log.
 *
 * Não há aviso de "está rolando" (ninguém está na janela de dados) e nenhum
 * efeito é aplicado na ficha: a rolagem entra no histórico do mestre como
 * `kind: 'item'`, rotulada com o nome do item, e volta na resposta para o
 * jogador ver o resultado. Devolve `null` quando a expressão não é válida —
 * aí o item é consumido mesmo assim, sem rolagem.
 */
export function rollItemEffect(
  actor: { userId: string },
  actorName: string,
  itemName: string,
  expression: string,
): DiceRollDto | null {
  const result = rollDice(expression);
  if (!result) return null;

  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: null,
    actorName,
    kind: 'item',
    label: `Item: ${itemName}`,
    // Expressão fixa (ex.: "4") não tem dado: o valor vai como bônus.
    dice: result.rolls.map((value) => ({ sides: result.sides, value })),
    bonus: result.modifier,
    total: result.total,
    advantage: false,
    disadvantage: false,
    isPrivate: false,
    crit: false,
    lucky: false,
    at: new Date().toISOString(),
  };

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);

  return roll;
}

/**
 * Registra no log a cura de uma poção JÁ rolada e devolve a rolagem.
 *
 * O resultado (dados e total) é calculado antes, por `rollHealingDice` do
 * `shared/dice.ts`, para que o total aplicado na ficha seja EXATAMENTE o que
 * aparece no histórico. A rolagem entra como `kind: 'item'`, rotulada como
 * "Cura (<nome>)" — o `rollDebug` do cliente mostra o detalhe dado a dado.
 */
export function recordHealingRoll(
  actor: { userId: string },
  actorName: string,
  itemName: string,
  result: { rolls: number[]; sides: number; bonus: number; total: number },
): DiceRollDto {
  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: null,
    actorName,
    kind: 'item',
    label: `Cura (${itemName})`,
    dice: result.rolls.map((value) => ({ sides: result.sides, value })),
    bonus: result.bonus,
    total: result.total,
    advantage: false,
    disadvantage: false,
    isPrivate: false,
    crit: false,
    lucky: false,
    at: new Date().toISOString(),
  };

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);

  return roll;
}
