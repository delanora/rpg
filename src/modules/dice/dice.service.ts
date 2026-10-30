import {
  deriveConditionEffects,
  deriveSaveEffects,
  dodgeBenefitAvailable,
  effectiveSpeed,
  resolveRollMode,
  type MechanicalEntity,
} from '../shared/conditions.js';
import { economyOf } from '../shared/action-economy.js';
import { getMechanicalState } from '../mechanical/mechanical.service.js';
import {
  appendConcentrationLog,
  emitCombat,
  loadCombatById,
  publishCharacter,
  restoreTurnEconomyAfterRevival,
} from '../combat/combat.service.js';
import { toCombatDto } from '../combat/combat.dto.js';
import {
  concentrationSaveBonus,
  loadConcentrationTarget,
  resolveConcentrationSave,
} from '../concentration/concentration.service.js';
import { concentrationSaveLabel } from '../shared/concentration.js';
import { applyDeathSave, deathSaveAvailability, type DeathActor } from '../death/death.service.js';
import { HttpError } from '../../lib/http-error.js';
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
    //
    // `audience: 'masters'` (Teste contra a Morte de NPC/criatura) vai SÓ para a
    // sala dos mestres: a privacidade é do SERVIDOR — nunca chega aos jogadores,
    // nem para ser escondida no cliente.
    if (roll.audience === 'masters') {
      broadcaster.toMasters(ServerEvents.DICE_ROLL, payload);
    } else if (roll.isPrivate) {
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

/**
 * Rola e APLICA um Teste contra a Morte (PHB 2014) na bandeja existente.
 *
 * Reutiliza o mesmo caminho de rolagem (DTO, histórico, evento `dice:roll`,
 * animação), mas a autoridade é do servidor: ele valida a elegibilidade (0 PV,
 * início do próprio turno, sem decisão pendente, uma rolagem por turno), rola o
 * d20 e aplica o resultado no ciclo de morte. O pool enviado pelo cliente é
 * IGNORADO — sempre um d20.
 *
 * A audiência decide a publicação: PERSONAGEM rola para a mesa (público);
 * criatura/NPC rola SÓ para a sala dos mestres (privado de verdade).
 */
async function rollDeathSave(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  const ownCharacter = input.entity
    ? null
    : await prisma.character.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  const entity = input.entity ?? (ownCharacter ? { kind: 'character' as const, id: ownCharacter.id } : null);
  if (!entity) {
    throw new HttpError('Informe de quem é o Teste contra a Morte.', 400, 'VALIDATION_ERROR');
  }

  const deathActor: DeathActor = { userId: actor.userId, username: actor.username, role: actor.role };
  const availability = await deathSaveAvailability(deathActor, entity);
  if (!availability.available) {
    throw new HttpError(availability.reason || 'Teste contra a Morte indisponível.', 409, 'CONFLICT');
  }

  // O dado é do SERVIDOR (crypto) — o cliente não escolhe faces nem resultado.
  const value = rollD20();
  // Anúncio da mesa ("está rolando") só na rolagem PÚBLICA: o Teste privado de
  // um NPC não avisa ninguém de que uma rolagem aconteceu.
  if (availability.audience === 'table') markRollTumbling(actor);

  const outcome = await applyDeathSave(deathActor, entity, value);
  // 20 natural: o personagem volta com 1 PV e SAI do fluxo. O turno dele volta
  // a ter a economia normal (é com o Movimento que ele se levanta; a Queda
  // continua até o "Levantar-se"). Sem isso, o turno iniciado como Teste
  // contra a Morte ficaria com 0 m e não haveria forma de levantar.
  if (outcome.revived) await restoreTurnEconomyAfterRevival(entity);
  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: input.clientId ?? null,
    actorName: availability.name,
    kind: 'death-save',
    label: input.label?.trim() || 'Teste contra a Morte',
    dice: [{ sides: 20, value }],
    bonus: 0,
    total: value,
    advantage: false,
    disadvantage: false,
    isPrivate: outcome.audience === 'masters',
    audience: outcome.audience,
    crit: value === 20,
    // Sortudo (Halfling) sobre um 1 natural no Teste contra a Morte fica para a
    // integração de características (Fase 6.10) — aqui, nenhum rerrolar implícito.
    lucky: false,
    at: new Date().toISOString(),
  };

  if (activeRoll?.userId === actor.userId) {
    activeRoll = { ...activeRoll, lastRoll: roll };
  }
  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);

  return roll;
}

/**
 * Esquiva ATIVA e VÁLIDA do autor da rolagem, para a salvaguarda de Destreza.
 *
 * `dodging` mora no estado de TURNO do combatente (`Combatant.turnEconomy`),
 * não no `MechanicalState` da ficha — por isso a busca acontece aqui, e não
 * dentro de `deriveSaveEffects`. O deslocamento usado é o mesmo do combate
 * (`effectiveSpeed` sobre a velocidade base), nunca o movimento restante.
 *
 * Fora de combate não existe turno: sem combatente ativo, não há Esquiva.
 */
async function dodgeBenefitForSave(entity: MechanicalEntity | null): Promise<boolean> {
  if (!entity || entity.kind === 'creature') return false;
  const combatant = await prisma.combatant.findFirst({
    where: {
      ...(entity.kind === 'combatant' ? { id: entity.id } : { characterId: entity.id }),
      combat: { status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] } },
    },
    include: {
      character: { select: { speed: true, mechanicalState: true } },
      creature: { select: { speed: true } },
    },
  });
  if (!combatant) return false;
  // Personagem usa o estado CANÔNICO da ficha; a instância usa o próprio.
  const mechanical = combatant.character?.mechanicalState ?? combatant.mechanicalState;
  const baseSpeed = Math.max(0, combatant.character?.speed ?? combatant.creature?.speed ?? 0);
  return dodgeBenefitAvailable({
    dodging: economyOf(combatant.turnEconomy).dodging,
    mechanicalState: mechanical,
    effectiveSpeed: effectiveSpeed(baseSpeed, mechanical),
  });
}

/**
 * Publica o estado mecânico/combate depois do teste de concentração.
 *
 * A ficha do jogador recebe `mechanical:updated` (o dono e os Mestres); o
 * combate é republicado com a visão de cada papel, para a etiqueta CONCENTRANDO
 * e a pendência sumirem/atualizarem na hora.
 */
async function publishConcentrationChange(
  actor: DiceActor,
  entity: MechanicalEntity,
  combatId: string | null,
): Promise<void> {
  try {
    if (entity.kind === 'character') await publishCharacter(entity.id);
    const mechanical = await getMechanicalState(
      { userId: actor.userId, username: actor.displayName, role: actor.role },
      entity,
    );
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.MECHANICAL_UPDATED, { mechanical });
    if (entity.kind === 'character') {
      const owner = await prisma.character.findUnique({ where: { id: entity.id }, select: { userId: true } });
      if (owner) broadcaster.toUser(owner.userId, ServerEvents.MECHANICAL_UPDATED, { mechanical });
    }
  } catch (error) {
    console.error('[dice] falha ao publicar o estado de concentração:', error);
  }
  if (combatId) {
    try {
      emitCombat(ServerEvents.COMBAT_UPDATED, toCombatDto(await loadCombatById(combatId), 'MASTER'));
    } catch (error) {
      console.error('[dice] falha ao publicar o combate após a concentração:', error);
    }
  }
}

/**
 * TESTE DE CONCENTRAÇÃO — Saving Throw de CONSTITUIÇÃO de verdade.
 *
 * O servidor é dono do tipo de save, do bônus (modificador + proficiência da
 * ficha), do modo de rolagem (Condições + fontes) e do CD — o cliente manda só
 * o ID da pendência. A bandeja existente mostra “Concentração (Constituição) —
 * CD X”; nada de segunda bandeja nem de `rollConcentration()` paralelo.
 */
async function rollConcentrationSave(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  const entity = input.entity;
  if (!entity) throw new HttpError('Informe a criatura que está concentrando.', 400, 'VALIDATION_ERROR');
  if (!input.pendingConcentrationSaveId) {
    throw new HttpError('Informe o teste de concentração pendente.', 400, 'VALIDATION_ERROR');
  }
  const target = await loadConcentrationTarget(entity);
  if (actor.role !== 'MASTER' && target.ownerUserId !== actor.userId) {
    throw new HttpError('Você só pode rolar o teste de concentração do seu personagem.', 403);
  }
  const pending = target.state.pendingConcentrationSaves.find(
    (item) => item.id === input.pendingConcentrationSaveId,
  );
  if (!pending) throw new HttpError('Este teste de concentração não está mais pendente.', 409, 'CONFLICT');

  // Teste de NPC/criatura: o Mestre escolhe público/privado AO ROLAR. Teste de
  // jogador é sempre público (o campo é ignorado).
  const privateRoll = actor.role === 'MASTER' && input.visibility === 'private';
  const combatId = target.combat?.id ?? null;

  // Mesmas regras de vantagem/desvantagem de qualquer salvaguarda.
  const mode = deriveSaveEffects(
    target.state,
    'constitution',
    input.advantage ? ['manual'] : [],
    input.disadvantage ? ['manual'] : [],
  );
  const bonus = await concentrationSaveBonus(entity);
  const dice = mode.autoFail ? [] : rollGroup(20, mode.advantage, mode.disadvantage);
  const kept = dice.reduce((sum, die) => (die.dropped ? sum : sum + die.value), 0);
  // Natural 1/20 NÃO é sucesso/falha automática: vale o total contra o CD.
  const total = mode.autoFail ? 0 : kept + bonus;

  const outcome = await resolveConcentrationSave(entity, pending.id, total, prisma, actor.displayName);

  // Registro de combate: público no teste de jogador/público; privado no de
  // criatura quando o Mestre escolhe privado (o DTO do jogador descarta).
  if (combatId) {
    await appendConcentrationLog(
      combatId,
      outcome.name,
      `CONCENTRAÇÃO ${outcome.label}: ${mode.autoFail ? 'falha automática' : `${total} vs CD ${pending.dc}`} — ${outcome.success ? 'SUCESSO' : 'FALHA; concentração encerrada'}.`,
      { private: privateRoll },
    );
  }

  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: input.clientId ?? null,
    actorName: outcome.name,
    kind: 'concentration',
    ...(mode.autoFail ? { autoFail: true } : {}),
    label: concentrationSaveLabel(pending.dc),
    dice,
    bonus,
    total,
    advantage: mode.advantage,
    disadvantage: mode.disadvantage,
    isPrivate: privateRoll,
    ...(privateRoll ? { audience: 'masters' as const } : {}),
    crit: dice.some((die) => die.sides === 20 && !die.dropped && die.value === 20),
    lucky: false,
    at: new Date().toISOString(),
  };

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);
  await publishConcentrationChange(actor, entity, combatId);
  return roll;
}

export async function rollTableDice(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  const kind: DiceRollKind = input.kind ?? 'free';

  // Teste contra a Morte (Fase 6.3): caminho PRÓPRIO e server-authoritative.
  if (kind === 'death-save') return rollDeathSave(actor, input);

  // Teste de CONCENTRAÇÃO (Fase 6.4): resolve uma pendência derivada de dano.
  if (kind === 'concentration') return rollConcentrationSave(actor, input);

  // Antes de sortear, avisa a mesa que os dados estão rolando (a janela de
  // quem assiste entra na mesma animação de queda). A rolagem da criação de
  // personagem passa longe disso: ela não é anunciada na mesa.


  // Vantagem e desvantagem são mutuamente exclusivas; se vierem as duas, o
  // servidor ignora as duas (a interface já impede).
  const ownCharacter = await prisma.character.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  const entity = input.entity ?? (ownCharacter ? { kind: 'character' as const, id: ownCharacter.id } : null);
  const mechanical = entity && (kind === 'skill' || kind === 'save')
    ? await getMechanicalState({ userId: actor.userId, username: actor.displayName, role: actor.role }, entity) : null;
  const state = mechanical?.state ?? {};
  const effects = deriveConditionEffects(state);
  const advantages = input.advantage ? ['manual'] : [], disadvantages = input.disadvantage ? ['manual'] : [];
  // Esquiva: só a salvaguarda de Destreza se beneficia, e só com o benefício
  // válido (não Incapacitado, deslocamento efetivo > 0).
  const dodge = kind === 'save' ? await dodgeBenefitForSave(entity) : false;
  const mode = kind === 'save' && input.ability
    ? deriveSaveEffects(state, input.ability, advantages, disadvantages, { dodge })
    : { autoFail: false, ...resolveRollMode(advantages, [...disadvantages, ...(kind === 'skill' && effects.checkDisadvantage || kind === 'save' && effects.saveDisadvantage ? ['conditions'] : [])]) };
  const { advantage, disadvantage } = mode;

  if (kind !== 'creation' && !mode.autoFail) markRollTumbling(actor);
  const dice = mode.autoFail ? [] : input.dice.flatMap((die) => rollGroup(die.sides, advantage, disadvantage));

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
    actorName: mechanical?.name || character?.name?.trim() || actor.displayName,
    kind,
    ...(mode.autoFail ? { autoFail: true } : {}),
    label: input.label ?? '',
    dice,
    bonus,
    total: mode.autoFail ? 0 : diceTotal + bonus,
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
/**
 * Registra no log a rolagem de um Dado de Vida gasto no DESCANSO CURTO.
 *
 * A cura já foi calculada e aplicada na ficha pelo serviço de personagens
 * (junto do consumo do dado), então aqui só entra o registro: `kind: 'rest'`,
 * com o resultado natural do dado (`dice[0].value`), o modificador de
 * Constituição (`bonus`) e a cura CALCULADA (`total` = dado + CON). A cura
 * efetivamente aplicada (pode ser menor por causa do teto de PV) volta na
 * resposta da rota, em `roll.actualHealed`.
 */
export function recordRestHitDieRoll(
  actor: { userId: string },
  actorName: string,
  result: { die: number; value: number; conMod: number; healing: number },
): DiceRollDto {
  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: null,
    actorName,
    kind: 'rest',
    label: 'Descanso Curto — Dado de Vida',
    dice: [{ sides: result.die, value: result.value }],
    bonus: result.conMod,
    total: result.healing,
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
 * Registra no log a rolagem da CANÇÃO DE DESCANSO (Song of Rest) de UM
 * personagem beneficiado no descanso coletivo.
 *
 * É chamada SÓ DEPOIS que a transação que aplicou a cura foi commitada (ver
 * `collective-completion.ts`): assim o log nunca mostra uma Song of Rest que
 * não chegou a acontecer. `kind: 'rest'`, sem modificador — a Song é somente o
 * dado da Canção (o Bardo não soma atributo nenhum). O dado é rolado pelo
 * servidor no momento da conclusão.
 */
export function recordRestSongOfRestRoll(
  actor: { userId: string },
  actorName: string,
  result: { die: number; value: number },
): DiceRollDto {
  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: null,
    actorName,
    kind: 'rest',
    label: 'Descanso Curto — Canção de Descanso',
    dice: [{ sides: result.die, value: result.value }],
    bonus: 0,
    total: result.value,
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
