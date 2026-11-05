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
import { effectModifierSetFor, publishEffects } from '../effects/effects.service.js';
import {
  publicEffectLabel,
  rollModifierSourceLabels,
  rollModifiersFor,
  toOptionalModifierDtos,
  type EffectOptionalModifierDto,
  type EffectRollModifiers,
} from '../effects/effect-modifiers.js';
import { rollSelectedOptional } from './effect-optional.js';
import {
  loadPendingEffectSaveForRoll,
  publishHoldPersonResult,
  resolvePendingEffectSave,
} from '../effects/hold-person.service.js';
import { spellExecutionDefinition } from '../spells/execution/spell-execution-registry.js';
import {
  publishSaveDamageResult,
  resolveSaveDamagePending,
} from '../spells/execution/save-damage-resolution.js';
import { savingThrowBonus } from '../shared/saving-throws.js';
import { loadEntity } from '../mechanical/mechanical.service.js';
import { ABILITY_LABELS, type AbilityKey } from '../shared/dnd5e.js';
import { applyDeathSave, deathSaveAvailability, type DeathActor } from '../death/death.service.js';
import { journalSpellSaveOutcome } from '../combat/resolution-requests.js';
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

/** A entidade é do próprio ator? (Mestre lê qualquer uma.) */
async function entityBelongsTo(actor: DiceActor, entity: MechanicalEntity): Promise<boolean> {
  if (actor.role === 'MASTER') return true;
  if (entity.kind === 'combatant') {
    const row = await prisma.combatant.findUnique({
      where: { id: entity.id },
      select: { characterId: true },
    });
    if (!row?.characterId) return false;
    const character = await prisma.character.findUnique({
      where: { id: row.characterId },
      select: { userId: true },
    });
    return character?.userId === actor.userId;
  }
  if (entity.kind !== 'character') return false;
  const row = await prisma.character.findUnique({
    where: { id: entity.id },
    select: { userId: true },
  });
  return row?.userId === actor.userId;
}

/**
 * OPÇÕES OPCIONAIS de efeito para UMA rolagem (6.5G).
 *
 * O servidor deriva do estado real (efeitos ATIVOS do alvo, já resolvido o
 * stacking e a privacidade) quais modificadores o ator PODE usar. O cliente
 * recebe só `id`, escopo e rótulo seguro — nunca valores ou estrutura livre.
 *
 * Bless não aparece em Ability Checks (seus modificadores só declaram ataque e
 * salvaguarda); um efeito de teste com `ability` só aparece no atributo certo.
 */
export async function optionalEffectModifiersFor(
  actor: DiceActor,
  entity: MechanicalEntity,
  roll: 'attack' | 'save' | 'check',
  ability?: AbilityKey,
): Promise<EffectOptionalModifierDto[]> {
  if (!(await entityBelongsTo(actor, entity))) {
    throw new HttpError('Você só pode consultar as opções do seu personagem.', 403);
  }
  const set = await effectModifierSetFor(entity);
  return toOptionalModifierDtos(rollModifiersFor(set, roll, ability).optional);
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
 * dentro de `deriveSaveEffects`. O deslocamento usado é o MESMO do combate —
 * `effectiveSpeed(base, estado, bônus de efeito)` —, nunca o movimento restante:
 * um `speed-flat` que zere a velocidade invalida a Esquiva, e gastar o
 * movimento do turno NÃO invalida.
 *
 * Fora de combate não existe turno: sem combatente ativo, não há Esquiva.
 */
async function dodgeBenefitForSave(
  entity: MechanicalEntity | null,
  /** Soma dos `speed-flat` dos EFEITOS ativos (6.5B) — já resolvida em lote. */
  effectSpeedBonus = 0,
): Promise<boolean> {
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
    effectiveSpeed: effectiveSpeed(baseSpeed, mechanical, effectSpeedBonus),
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
 *
 * `advantage`/`disadvantage` do corpo da requisição são IGNORADOS: eles são a
 * escolha do cliente para rolagens livres, não uma fonte mecânica. Confiar
 * neles deixaria qualquer cliente adulterado pedir vantagem num teste de
 * Constituição. As fontes abaixo são só server-side (hoje nenhuma feature
 * concede vantagem em Concentração; War Caster, quando existir, entra AQUI).
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

  // Mesmas regras de vantagem/desvantagem de qualquer salvaguarda — mas as
  // fontes extras vêm SÓ do servidor. `input.advantage`/`input.disadvantage`
  // não entram na conta (ver comentário da função).
  //
  // EFEITOS ativos (6.5B) entram como fonte SERVER-SIDE: um efeito que modifica
  // Saving Throws de Constituição vale aqui (ex.: +2, +1d4, vantagem). Nada
  // disso vem do payload do cliente.
  const effectMods = rollModifiersFor(
    await effectModifierSetFor(entity),
    'save',
    'constitution',
  );
  const mode = deriveSaveEffects(target.state, 'constitution', [], [], {
    effects: { advantage: effectMods.advantage, disadvantage: effectMods.disadvantage },
  });
  // OPCIONAIS escolhidos (6.5G): revalidados AQUI e rolados pelo servidor. Um
  // Bless do próprio caster pode entrar neste Constitution Save — o efeito
  // ainda está ativo no momento do teste.
  const optionalEffects = rollSelectedOptional(
    effectMods,
    input.selectedEffectModifiers,
    mode.autoFail,
  );
  const baseBonus = await concentrationSaveBonus(entity);
  const effectBonus = mode.autoFail ? 0 : effectMods.bonus + optionalEffects.bonus;
  const bonus = baseBonus + effectBonus;
  const effectDice = mode.autoFail
    ? []
    : [
        ...effectMods.dice.flatMap((modifier) =>
          Array.from({ length: modifier.count }, () => ({
            sides: modifier.sides,
            value: rollDie(modifier.sides),
            sign: modifier.sign,
            label: publicEffectLabel(modifier.source),
          })),
        ),
        ...optionalEffects.dice.map(({ sides, value, sign, label }) => ({
          sides,
          value,
          sign,
          label,
        })),
      ];
  const effectDiceTotal = effectDice.reduce((sum, die) => sum + die.value * die.sign, 0);
  const dice = mode.autoFail ? [] : rollGroup(20, mode.advantage, mode.disadvantage);
  const kept = dice.reduce((sum, die) => (die.dropped ? sum : sum + die.value), 0);
  // Natural 1/20 NÃO é sucesso/falha automática: vale o total contra o CD.
  const total = mode.autoFail ? 0 : kept + bonus + effectDiceTotal;

  const outcome = await resolveConcentrationSave(entity, pending.id, total, prisma, actor.displayName);
  // Falha na concentração encerra o grupo de efeitos que ela mantinha (quando
  // a concentração aponta explicitamente para um grupo).
  if (outcome.endedEffectTargets.length > 0) await publishEffects(outcome.endedEffectTargets);

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
    ...(effectBonus !== 0 || effectDice.length > 0
      ? {
          effectModifiers: {
            bonus: effectBonus,
            dice: effectDice.map(({ sides, value, sign, label }) => ({ sides, value, sign, label })),
            sources: rollModifierSourceLabels(effectMods),
          },
        }
      : {}),
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

/**
 * FASE 6.5H — SALVAGUARDA de uma aplicação de efeito pendente.
 *
 * Mesmo pipeline de qualquer save: o SERVIDOR rola, calcula o bônus e aplica as
 * fontes mecânicas existentes (Condições, Exaustão, Esquiva e modificadores de
 * Effect). O que vem da pendência é a AUTORIDADE: atributo e CD. O cliente só
 * envia o id — nunca atributo, bônus, CD, dados ou resultado.
 *
 * `optionalModifiers` (ex.: Bless +1d4) também passam pela revalidação normal,
 * então o segundo efeito real compõe com o primeiro sem que este módulo
 * conheça nenhum dos dois.
 */
/**
 * Desfecho declarado pela execução da magia dona da pendência.
 *
 * `null` = pendência legada (sem SpellCast) ou `ongoing`: continuam no fluxo de
 * efeito contínuo. Uma magia nova não precisa de `if` aqui.
 */
async function pendingCastResolutionKind(pending: {
  spellCastId: string | null;
  phase: string;
}): Promise<'immediate-effect' | 'save-effect' | 'save-damage' | null> {
  if (pending.phase !== 'initial' || !pending.spellCastId) return null;
  const cast = await prisma.spellCast.findUnique({
    where: { id: pending.spellCastId },
    select: { spellId: true },
  });
  const kind = cast ? (spellExecutionDefinition(cast.spellId)?.resolution.kind ?? null) : null;
  // Cura imediata (6.6I.3) nunca cria pendência: se uma aparecer por dado
  // histórico, ela não ganha um caminho de resolução inventado aqui.
  return kind === 'save-damage' || kind === 'save-effect' || kind === 'immediate-effect'
    ? kind
    : null;
}

async function rollPendingEffectSave(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  if (!input.pendingEffectSaveId) {
    throw new HttpError('Informe a salvaguarda pendente.', 400, 'VALIDATION_ERROR');
  }
  const { pending, targetEntity } = await loadPendingEffectSaveForRoll(
    actor,
    input.pendingEffectSaveId,
  );
  const ability = pending.ability;
  const loaded = await loadEntity(targetEntity);
  // Salvaguarda de criatura/NPC: visibilidade escolhida pelo Mestre AO ROLAR.
  const privateRoll = actor.role === 'MASTER' && input.visibility === 'private';

  const effectSet = await effectModifierSetFor(targetEntity);
  const effectMods = rollModifiersFor(effectSet, 'save', ability);
  // 6.6J.1: a ESQUIVA vale para salvaguardas de DESTREZA também quando a
  // pendência veio de uma magia (`save-damage`) — mesma regra do save comum,
  // com o mesmo deslocamento EFETIVO e sem hardcode por spell.
  const dodge = ability === 'dexterity'
    ? await dodgeBenefitForSave(targetEntity, effectSet.speedBonus ?? 0)
    : false;
  // Vantagem/desvantagem: só fontes server-side (Condições + Effects). O
  // `advantage`/`disadvantage` do corpo é escolha de rolagem livre, não vale aqui.
  const mode = deriveSaveEffects(loaded.state, ability, [], [], {
    dodge,
    effects: { advantage: effectMods.advantage, disadvantage: effectMods.disadvantage },
  });
  const optionalEffects = rollSelectedOptional(
    effectMods,
    input.selectedEffectModifiers,
    mode.autoFail,
  );

  const baseBonus = await savingThrowBonus(targetEntity, ability);
  const effectBonus = mode.autoFail ? 0 : effectMods.bonus + optionalEffects.bonus;
  const bonus = baseBonus + effectBonus;
  const effectDice = mode.autoFail
    ? []
    : [
        ...effectMods.dice.flatMap((modifier) =>
          Array.from({ length: modifier.count }, () => ({
            sides: modifier.sides,
            value: rollDie(modifier.sides),
            sign: modifier.sign,
            label: publicEffectLabel(modifier.source),
          })),
        ),
        ...optionalEffects.dice.map(({ sides, value, sign, label }) => ({
          sides,
          value,
          sign,
          label,
        })),
      ];
  const effectDiceTotal = effectDice.reduce((sum, die) => sum + die.value * die.sign, 0);
  // O pool do cliente é ignorado: a pendência fixa UM d20 (ou dois com
  // vantagem/desvantagem), sempre rolado pelo servidor.
  const dice = mode.autoFail ? [] : rollGroup(20, mode.advantage, mode.disadvantage);
  const kept = dice.reduce((sum, die) => (die.dropped ? sum : sum + die.value), 0);
  const total = mode.autoFail ? 0 : kept + bonus + effectDiceTotal;

  // FASE 6.6I.2: o MESMO pipeline de salvaguarda serve a dois desfechos. A
  // magia declara qual é o dela; nada aqui conhece o nome da spell.
  const resolutionKind = await pendingCastResolutionKind(pending);
  let success = false;
  let damageSummary: {
    type: string;
    raw: number;
    afterSave: number;
    final: number;
    rolls: number[];
  } | null = null;
  if (resolutionKind === 'save-damage') {
    const outcome = await resolveSaveDamagePending(pending.id, total, actor.username);
    success = outcome.success;
    await publishSaveDamageResult(outcome);
    // 6.6J.1: SUCESSO também pode causar dano (meia-dano). O resumo do registro
    // vem do snapshot, então o log mostra o valor DEPOIS do save e o valor
    // final — sem o cliente recalcular nada.
    damageSummary = outcome.snapshot && outcome.snapshot.finalDamage > 0
      ? {
          type: outcome.snapshot.damageType,
          raw: outcome.snapshot.rawDamage,
          afterSave: outcome.snapshot.damageAfterSave ?? outcome.snapshot.rawDamage,
          final: outcome.snapshot.finalDamage,
          rolls:
            outcome.snapshot.components?.flatMap((component) => component.rolls ?? []) ??
            outcome.snapshot.dice?.rolls ??
            [],
        }
      : null;
  } else {
    const outcome = await resolvePendingEffectSave(pending.id, total, actor.displayName);
    success = outcome.success;
    // Pendência resolvida + Paralyzed/Effect/Concentração publicados pelo
    // lifecycle existente quando houve falha.
    await publishHoldPersonResult(outcome, actor.username);
  }
  // 6.6I: o card deixa de estar pendente; o RESULTADO fica no registro lateral,
  // com a conta rolada pelo servidor (sucesso/falha não é recalculado no cliente).
  await journalSpellSaveOutcome({
    target: targetEntity,
    label: pending.label,
    ability,
    dc: pending.dc,
    total,
    success,
    phase: pending.phase,
    privateRoll,
    actorName: loaded.name,
    ...(damageSummary ? { damage: damageSummary } : {}),
  });

  const roll: DiceRollDto = {
    id: randomUUID(),
    actorUserId: actor.userId,
    clientId: input.clientId ?? null,
    actorName: loaded.name,
    kind: 'save',
    ...(mode.autoFail ? { autoFail: true } : {}),
    // 6.6H: a pendência CONTÍNUA é identificada como "no fim do turno" para a
    // mesa não confundir com a salvaguarda inicial da mesma magia.
    label:
      pending.phase === 'ongoing'
        ? `${pending.label} — Salvaguarda de ${ABILITY_LABELS[ability]} no fim do turno (CD ${pending.dc})`
        : `${pending.label} — Salvaguarda de ${ABILITY_LABELS[ability]} (CD ${pending.dc})`,
    dice,
    bonus,
    total,
    advantage: mode.advantage,
    disadvantage: mode.disadvantage,
    ...(effectBonus !== 0 || effectDice.length > 0
      ? {
          effectModifiers: {
            bonus: effectBonus,
            dice: effectDice.map(({ sides, value, sign, label }) => ({ sides, value, sign, label })),
            sources: rollModifierSourceLabels(effectMods),
          },
        }
      : {}),
    isPrivate: privateRoll,
    ...(privateRoll ? { audience: 'masters' as const } : {}),
    crit: dice.some((die) => die.sides === 20 && !die.dropped && die.value === 20),
    lucky: false,
    at: new Date().toISOString(),
  };

  history = [roll, ...history].slice(0, HISTORY_LIMIT);
  publish(roll, actor);
  return roll;
}

export async function rollTableDice(actor: DiceActor, input: TableRollInput): Promise<DiceRollDto> {
  const kind: DiceRollKind = input.kind ?? 'free';

  // Teste contra a Morte (Fase 6.3): caminho PRÓPRIO e server-authoritative.
  if (kind === 'death-save') return rollDeathSave(actor, input);

  // Teste de CONCENTRAÇÃO (Fase 6.4): resolve uma pendência derivada de dano.
  if (kind === 'concentration') return rollConcentrationSave(actor, input);

  // SALVAGUARDA de aplicação de efeito (Fase 6.5H): Hold Person e futuros
  // efeitos com save inicial resolvem por aqui, com atributo/CD do servidor.
  if (input.pendingEffectSaveId) return rollPendingEffectSave(actor, input);

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
  // EFEITOS ATIVOS (6.5B): o servidor resolve os modificadores da entidade.
  // Só salvaguarda e teste de habilidade têm escopo aqui (rolagem livre não).
  const effectRollKind = kind === 'save' ? 'save' : kind === 'skill' ? 'check' : null;
  // UMA leitura de efeitos por rolagem: serve ao modificador da rolagem E à
  // validade da Esquiva (speed-flat). Nada de segunda consulta.
  const effectSet = entity && effectRollKind ? await effectModifierSetFor(entity) : null;
  const effectMods: EffectRollModifiers = effectSet && effectRollKind
    ? rollModifiersFor(effectSet, effectRollKind, input.ability)
    : { bonus: 0, dice: [], advantage: [], disadvantage: [], sources: [], optional: [] };
  const advantages = input.advantage ? ['manual'] : [];
  const disadvantages = input.disadvantage ? ['manual'] : [];
  // Esquiva: só a salvaguarda de Destreza se beneficia, e só com o benefício
  // válido (não Incapacitado, deslocamento efetivo > 0).
  const dodge = kind === 'save'
    ? await dodgeBenefitForSave(entity, effectSet?.speedBonus ?? 0)
    : false;
  const mode = kind === 'save' && input.ability
    ? deriveSaveEffects(state, input.ability, advantages, disadvantages, {
        dodge,
        effects: { advantage: effectMods.advantage, disadvantage: effectMods.disadvantage },
      })
    : {
        autoFail: false,
        ...resolveRollMode(
          [...advantages, ...effectMods.advantage],
          [
            ...disadvantages,
            ...effectMods.disadvantage,
            ...(kind === 'skill' && effects.checkDisadvantage || kind === 'save' && effects.saveDisadvantage
              ? ['conditions']
              : []),
          ],
        ),
      };
  const { advantage, disadvantage } = mode;

  // OPCIONAIS (6.5G): só entram os IDs oferecidos pelo servidor para ESTA
  // rolagem. Falha automática continua falha automática (nenhum d4 é rolado).
  const optionalEffects = rollSelectedOptional(
    effectMods,
    input.selectedEffectModifiers,
    mode.autoFail,
  );

  if (kind !== 'creation' && !mode.autoFail) markRollTumbling(actor);
  const dice = mode.autoFail ? [] : input.dice.flatMap((die) => rollGroup(die.sides, advantage, disadvantage));

  // Dados extras de efeito: pool INDEPENDENTE (nunca viram bônus fixo).
  const effectDice = mode.autoFail
    ? []
    : [
        ...effectMods.dice.flatMap((modifier) =>
          Array.from({ length: modifier.count }, () => ({
            sides: modifier.sides,
            value: rollDie(modifier.sides),
            sign: modifier.sign,
            label: publicEffectLabel(modifier.source),
          })),
        ),
        ...optionalEffects.dice.map(({ sides, value, sign, label }) => ({
          sides,
          value,
          sign,
          label,
        })),
      ];
  const effectDiceTotal = effectDice.reduce((sum, die) => sum + die.value * die.sign, 0);
  const effectBonus = mode.autoFail ? 0 : effectMods.bonus + optionalEffects.bonus;

  const bonus = (input.bonus ?? 0) + effectBonus;
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
    total: mode.autoFail ? 0 : diceTotal + bonus + effectDiceTotal,
    advantage,
    disadvantage,
    ...(effectBonus !== 0 || effectDice.length > 0
      ? {
          effectModifiers: {
            bonus: effectBonus,
            dice: effectDice.map(({ sides, value, sign, label }) => ({ sides, value, sign, label })),
            sources: rollModifierSourceLabels(effectMods),
          },
        }
      : {}),
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
