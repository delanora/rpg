import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { allSpells } from '../shared/spells/index.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import { deathStateOf, turnKey, type DeathState } from '../shared/death.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { spellExecutionDefinition } from '../spells/execution/spell-execution-registry.js';
import { definitionLabel } from '../effects/pending-effect-saves.js';
import { appendCombatJournal } from './combat-journal.js';
import { orderCombatants } from './combat.dto.js';

/**
 * FASE 6.6I — COMBAT RESOLUTION CARDS (read-model).
 *
 * Toda decisão MECÂNICA que exige ação de alguém durante o combate aparece no
 * REGISTRO lateral como um card interativo. Este módulo é só de APRESENTAÇÃO:
 *
 *  • ele NÃO guarda estado próprio nem cria uma segunda engine de regras;
 *  • a fonte de verdade de uma salvaguarda de magia continua sendo
 *    `PendingEffectSave` (6.5H/6.6E/6.6H);
 *  • a de um Teste contra a Morte continua sendo o `deathState` + o turno reais
 *    (6.3). A oportunidade é DERIVADA (`combat + turnSequence + estado`), o que
 *    sobrevive a refresh/reconnect/restart sem persistir um "card pendente";
 *  • o cliente nunca envia título, descrição, atributo, CD, ações ou bônus: o
 *    servidor deriva tudo e filtra a privacidade ANTES de enviar.
 *
 * Tipos desta fase: `spell-saving-throw` e `death-saving-throw`. Reação,
 * oportunidade de ataque, Counterspell, Shield e escolha genérica ficam para as
 * fases seguintes — a união já está preparada para recebê-los.
 */

/** Tipos implementados nesta fase. */
export type CombatResolutionKind = 'spell-saving-throw' | 'ability-saving-throw' | 'death-saving-throw';

/** Status de um card (só `pending` é emitido hoje; os demais são histórico). */
export type CombatResolutionStatus =
  | 'pending'
  | 'resolved'
  | 'declined'
  | 'cancelled'
  | 'invalidated';

/** Ações que o card oferece — o servidor decide QUAIS existem. */
export type CombatResolutionActionKind = 'roll' | 'decline';

export interface CombatResolutionActionDto {
  kind: CombatResolutionActionKind;
  /** Quem executa a ação (a autorização real é conferida na rota de origem). */
  actor: 'owner' | 'master';
  /** Só para criatura/NPC: o Mestre escolhe a audiência AO ROLAR. */
  visibility: 'public' | 'private' | null;
}

/** Alvo do card (identidade canônica: personagem é a FICHA). */
export interface CombatResolutionTargetDto {
  kind: MechanicalEntity['kind'];
  id: string;
  name: string;
  ownerUserId: string | null;
}

/**
 * Identidade de RESOLUÇÃO: o card não inventa um id próprio para a mecânica —
 * ele aponta para a pendência persistida ou para a entidade do Teste de morte.
 */
export interface CombatResolutionReferenceDto {
  pendingId: string | null;
  entity: MechanicalEntity | null;
}

export interface CombatResolutionCountersDto {
  successes: number;
  failures: number;
  stabilized: boolean;
}

export interface CombatResolutionCardDto {
  /** Id determinístico do card (nunca aleatório: o mesmo pedido tem o mesmo id). */
  id: string;
  kind: CombatResolutionKind;
  status: CombatResolutionStatus;
  target: CombatResolutionTargetDto;
  /** Nome da magia (catálogo/cast) ou "Salvaguarda contra a Morte". */
  title: string;
  /** Descrição CURTA de apresentação (metadata da execução, nunca o texto da magia). */
  shortDescription: string | null;
  /** Atributo da salvaguarda — vem do SERVIDOR; o jogador nunca escolhe. */
  ability: AbilityKey | null;
  /** `initial` = barreira da conjuração; `ongoing` = fim do turno do alvo. */
  phase: 'initial' | 'ongoing' | null;
  /** PHB: `ongoing` de Hold Person diz "can" — recusar é legítimo. */
  optional: boolean;
  canResolve: boolean;
  actions: CombatResolutionActionDto[];
  presentation: { tone: 'arcane' | 'peril'; icon: 'sparkle' | 'skull' };
  counters: CombatResolutionCountersDto | null;
  reference: CombatResolutionReferenceDto;
  createdAt: string;
}

export interface ResolutionRequestsPayload {
  combatId: string;
  requests: CombatResolutionCardDto[];
  at: string;
}

/** Autor carimbado do token (mesma forma usada no domínio de combate). */
export interface ResolutionActor {
  userId: string;
  username: string;
  role: 'MASTER' | 'PLAYER';
}

/** Título humano do atributo (só apresentação; a regra usa a chave). */
const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

export function abilityLabel(ability: AbilityKey): string {
  return ABILITY_LABELS[ability];
}

interface CombatTarget {
  entity: MechanicalEntity;
  combatantId: string;
  name: string;
  ownerUserId: string | null;
  hpCurrent: number;
  death: DeathState;
  inOwnTurn: boolean;
}

/**
 * Nome de exibição da magia: o catálogo é a única fonte. Um `spellId` sem
 * entrada (catálogo mudou) cai no rótulo da definição — nunca no cliente.
 */
function spellDisplayName(spellId: string | null): string | null {
  if (!spellId) return null;
  const spell = allSpells().find((item) => item.id === spellId);
  return spell ? spell.namePt : null;
}

/**
 * Lista as solicitações ATIVAS do combate para quem está pedindo.
 *
 * PLAYER recebe só o que pode resolver (o próprio personagem) e só o que é
 * público. MASTER recebe todas, inclusive as privadas de criatura/NPC — a
 * filtragem é do SERVIDOR, nunca de CSS.
 */
export async function resolutionRequestsForCombat(
  actor: ResolutionActor,
  combatId: string,
): Promise<ResolutionRequestsPayload> {
  const combat = await prisma.combat.findUnique({
    where: { id: combatId },
    include: {
      combatants: {
        include: {
          character: {
            select: { id: true, name: true, deathState: true, hpCurrent: true, userId: true },
          },
        },
      },
    },
  });
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  if (combat.status === 'ENDED') {
    return { combatId, requests: [], at: new Date().toISOString() };
  }

  const ordered = orderCombatants(combat.combatants as never);
  const current = combat.status === 'ACTIVE' && !combat.legendaryWindow ? ordered[combat.currentIndex] : null;
  const currentKey = current ? turnKey(combat.id, combat.round, combat.currentIndex) : null;

  // Alvos canônicos: personagem resolve para a FICHA; criatura/NPC para a
  // INSTÂNCIA de combate (duas cópias do mesmo Goblin são alvos diferentes).
  const targets: CombatTarget[] = [];
  for (const combatant of ordered) {
    const isCurrent = current?.id === combatant.id;
    if (combatant.characterId && combatant.character) {
      targets.push({
        entity: { kind: 'character', id: combatant.characterId },
        combatantId: combatant.id,
        name: combatant.character.name,
        ownerUserId: combatant.ownerUserId ?? combatant.character.userId,
        hpCurrent: combatant.character.hpCurrent,
        death: deathStateOf(combatant.character.deathState),
        inOwnTurn: isCurrent,
      });
      continue;
    }
    targets.push({
      entity: { kind: 'combatant', id: combatant.id },
      combatantId: combatant.id,
      name: combatant.name,
      ownerUserId: combatant.ownerUserId,
      hpCurrent: combatant.hpCurrent ?? 0,
      death: deathStateOf(combatant.deathState),
      inOwnTurn: isCurrent,
    });
  }

  // A privacidade é decidida AQUI: o jogador só recebe o próprio personagem.
  const visible =
    actor.role === 'MASTER'
      ? targets
      : targets.filter((target) => target.ownerUserId === actor.userId);

  const requests: CombatResolutionCardDto[] = [];
  const at = new Date().toISOString();

  // ---------------------------------------------------------------- spell save
  const pendings =
    visible.length === 0
      ? []
      : await prisma.pendingEffectSave.findMany({
          where: {
            status: 'pending',
            ...(actor.role === 'MASTER' ? {} : { visibility: 'public' }),
            OR: visible.map((target) => ({
              targetEntityKind: target.entity.kind,
              targetEntityId: target.entity.id,
            })),
          },
          orderBy: { createdAt: 'asc' },
        });

  const castIds = [
    ...new Set(
      pendings
        .map((row) => row.spellCastId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const casts =
    castIds.length === 0
      ? []
      : await prisma.spellCast.findMany({
          where: { id: { in: castIds } },
          select: { id: true, spellId: true },
        });
  const spellIdByCast = new Map(casts.map((row) => [row.id, row.spellId]));

  for (const row of pendings) {
    const target = visible.find(
      (item) =>
        item.entity.kind === row.targetEntityKind && item.entity.id === row.targetEntityId,
    );
    if (!target) continue;

    const spellId = row.spellCastId ? (spellIdByCast.get(row.spellCastId) ?? null) : null;
    const execution = spellId ? spellExecutionDefinition(spellId) : null;
    // Hold Person (e futuras magias com save) declaram os prompts; sem
    // metadata, o card continua legível com o rótulo da definição.
    const prompt =
      row.phase === 'ongoing'
        ? (execution?.ongoingPrompt ?? null)
        : (execution?.combatPrompt ?? null);
    const actions: CombatResolutionActionDto[] = [];
    if (actor.role === 'MASTER') {
      actions.push(
        { kind: 'roll', actor: 'master', visibility: 'public' },
        { kind: 'roll', actor: 'master', visibility: 'private' },
      );
    } else {
      actions.push({ kind: 'roll', actor: 'owner', visibility: null });
    }
    // PHB 2014: só a salvaguarda REPETIDA e OPCIONAL pode ser recusada.
    if (row.phase === 'ongoing' && row.optional) {
      actions.push({ kind: 'decline', actor: actor.role === 'MASTER' ? 'master' : 'owner', visibility: null });
    }

    requests.push({
      id: `spell-save:${row.id}`,
      kind: row.creatureAreaUseId ? 'ability-saving-throw' : 'spell-saving-throw',
      status: 'pending',
      target: {
        kind: target.entity.kind,
        id: target.entity.id,
        name: target.name,
        ownerUserId: target.ownerUserId,
      },
      title: row.sourceLabel ?? spellDisplayName(spellId) ?? definitionLabel(row.definitionId),
      shortDescription: prompt,
      ability: row.ability as AbilityKey,
      phase: row.phase === 'ongoing' ? 'ongoing' : 'initial',
      optional: row.optional,
      canResolve: true,
      actions,
      presentation: { tone: 'arcane', icon: 'sparkle' },
      counters: null,
      reference: { pendingId: row.id, entity: target.entity },
      createdAt: row.createdAt.toISOString(),
    });
  }

  // ---------------------------------------------------------------- death save
  for (const target of visible) {
    const death = target.death;
    if (target.hpCurrent > 0) continue;
    if (death.dead || death.pending || death.relentless || death.stabilized) continue;
    if (!death.deathSaves) continue;
    // A oportunidade é do INÍCIO do próprio turno (PHB 2014) e só existe com o
    // combate ATIVO — nunca em `PENDING_INITIATIVE`.
    if (!target.inOwnTurn || !currentKey) continue;
    if (death.saveTurnKey && death.saveTurnKey === currentKey) continue;

    requests.push({
      id: `combat:${combat.id}:turn:${combat.turnSequence}:${target.entity.kind}:${target.entity.id}:death-save`,
      kind: 'death-saving-throw',
      status: 'pending',
      target: {
        kind: target.entity.kind,
        id: target.entity.id,
        name: target.name,
        ownerUserId: target.ownerUserId,
      },
      title: 'Salvaguarda contra a Morte',
      shortDescription: 'Seu destino está por um fio.',
      ability: null,
      phase: null,
      optional: false,
      canResolve: actor.role === 'MASTER' || target.ownerUserId === actor.userId,
      // Teste contra a Morte NUNCA tem "não tentar": é obrigatório quando devido.
      actions: [
        {
          kind: 'roll',
          actor: actor.role === 'MASTER' ? 'master' : 'owner',
          visibility: actor.role === 'MASTER' && target.entity.kind !== 'character' ? 'private' : null,
        },
      ],
      presentation: { tone: 'peril', icon: 'skull' },
      counters: {
        successes: death.successes,
        failures: death.failures,
        stabilized: death.stabilized,
      },
      reference: { pendingId: null, entity: target.entity },
      createdAt: at,
    });
  }

  return { combatId, requests, at };
}

/**
 * Registra no REGISTRO do combate o desfecho de uma salvaguarda resolvida.
 *
 * É o que mantém o card "vivo" no histórico: quando a pendência deixa de estar
 * `pending`, o card interativo sai do topo e o resultado continua legível na
 * MESMA superfície (o log lateral), com o breakdown rolado pelo servidor.
 */
export async function journalSpellSaveOutcome(input: {
  target: MechanicalEntity;
  label: string;
  ability: AbilityKey;
  dc: number;
  total: number;
  success: boolean;
  phase: 'initial' | 'ongoing';
  privateRoll: boolean;
  actorName: string;
  /**
   * Dano instantâneo da resolução (save-damage) — resumido na MESMA linha.
   * `afterSave` é o valor DEPOIS da consequência do save e ANTES das defesas
   * (6.6J.1): é o que distingue "metade pela salvaguarda" de "resistência".
   */
  damage?: { type: string; raw: number; afterSave?: number; final: number; rolls: number[] };
}): Promise<void> {
  try {
    const combat = await prisma.combat.findFirst({
      where: {
        status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] },
        combatants: {
          some:
            input.target.kind === 'character'
              ? { characterId: input.target.id }
              : { id: input.target.id },
        },
      },
      select: { id: true },
    });
    if (!combat) return;
    const phaseLabel = input.phase === 'ongoing' ? ' — fim do turno' : '';
    const outcome = input.success ? 'SUCESSO' : 'FALHA';
    // Sem linha extra de "internals": o desfecho mecânico entra na MESMA linha.
    const damageLine = input.damage
      ? ` Dano ${input.damage.type.toLowerCase()}: ${input.damage.final}` +
        (input.damage.afterSave !== undefined && input.damage.afterSave !== input.damage.final
          ? ` (${input.damage.afterSave} após a salvaguarda)`
          : '') +
        '.'
      : '';
    await appendCombatJournal({
      combatId: combat.id,
      actorName: input.actorName,
      message: `${input.label} — Salvaguarda de ${abilityLabel(input.ability)}${phaseLabel}: ${input.total} vs CD ${input.dc} → ${outcome}.${damageLine}`,
      action: 'spell-save',
      private: input.privateRoll,
    });
  } catch (error) {
    // Log nunca derruba uma resolução já persistida.
    console.error('[combat] falha ao registrar o resultado da salvaguarda:', error);
  }
}
