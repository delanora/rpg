import type { Character, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import type { CampSupplyOverrideType } from '../shared/camp-supplies.js';
import { parseJson } from '../shared/json.js';
import {
  normalizeClassEntries,
  normalizeClassState,
  pactMagicSlots,
  restoreLongRestResources,
  totalCharacterLevel,
} from '../shared/classes.js';
import {
  applyHitDiceRecovery,
  deriveHitDice,
  hitDiceRecoveryAllowance,
  hitDiceSelectionProblem,
  invalidHitDiceSelectionKeys,
  normalizeHitDiceSelection,
  type HitDiceSelection,
} from '../shared/hit-dice.js';
import { raceSpells } from '../shared/races/index.js';
import { inventoryListSchema, raceChoicesSchema, spellsStateSchema } from '../characters/characters.schema.js';
import {
  characterClassAdjustments,
  characterMaxHp,
  type InventoryItemDto,
  type SpellsStateDto,
} from '../characters/characters.dto.js';
import { loadCatalogLookup } from '../characters/inventory-sync.js';
import { publishChange, type SheetOwner } from '../characters/characters.service.js';
import {
  computeCampSupplies,
  consumeCampSupplies,
  type ConsumedCampSupply,
} from './camp-supplies-calculator.js';

/**
 * CONCLUSÃO REAL do Descanso Longo coletivo (PHB 2014).
 *
 * Roda dentro da transação de quem a dispara (o último `ready` da mesa — quando
 * é permitido — ou o `force-complete` do mestre) e faz TUDO numa operação
 * lógica única, na ordem do PASSO 31:
 *
 *   1. trava e valida a solicitação APPROVED;
 *   2. valida os ACCEPTED (sessão ACTIVE) e o ready (ou o force do mestre);
 *   3. RECALCULA os recursos de acampamento pelo valor ATUAL (config, catálogo,
 *      reservas) — nunca confia no DTO antigo;
 *   4. exige a exceção narrativa do mestre quando falta suprimento;
 *   5. revalida e CONSOME as pilhas contribuídas;
 *   6. aplica os benefícios (PV, PV temporário, Dados de Vida escolhidos,
 *      espaços de magia normais, recursos de classe, usos raciais, toggles);
 *   7. conclui todas as sessões e a solicitação.
 *
 * ATENÇÃO (não violar): nada é publicado aqui. Os efeitos colaterais (eventos
 * `sheet:updated` e o `long-rest:request-updated` do chamador) só acontecem
 * DEPOIS do commit — ver `publishLongRestCompletion`.
 *
 * A MAGIA DE PACTO (Bruxo) é um POOL PRÓPRIO (PHB 2014) e recupera nos dois
 * descansos: aqui o `spells.pactMagic.used` volta a zero na MESMA escrita
 * atômica dos espaços normais. O `max`/`slotLevel` continuam DERIVADOS do nível
 * de Bruxo (`pactMagicSlots`) — nunca persistidos.
 */

/** Código de erro: a solicitação não está mais em andamento. */
export const LONG_REST_REQUEST_CLOSED = 'LONG_REST_REQUEST_CLOSED';
/** Código de erro: nem todos os ACCEPTED marcaram ready (e não é force). */
export const LONG_REST_NOT_ALL_READY = 'LONG_REST_NOT_ALL_READY';
/** Código de erro: faltam recursos de acampamento e não houve exceção do mestre. */
export const CAMP_SUPPLIES_INSUFFICIENT = 'CAMP_SUPPLIES_INSUFFICIENT';
/** Código de erro: a seleção de Dados de Vida é inválida. */
export const HIT_DICE_INVALID = 'HIT_DICE_INVALID';
/** Código de erro: uma ficha mudou no meio da conclusão. */
export const LONG_REST_CONFLICT = 'LONG_REST_CONFLICT';

/** Exceção NARRATIVA declarada pelo mestre ao concluir sem suprimento. */
export interface CampSupplyOverrideInput {
  type: CampSupplyOverrideType;
  note?: string;
}

/** Opções da conclusão: quem forçou e se houve exceção declarada. */
export interface LongRestCompletionOptions {
  /** Mestre que forçou a conclusão (`null` no fluxo automático). */
  forcedByUserId: string | null;
  /** Exceção narrativa declarada (só MASTER chega aqui). */
  override: CampSupplyOverrideInput | null;
}

/** Um tipo de Dado de Vida recuperado (auditoria do resultado). */
export interface LongRestHitDiceRecoveredDto {
  die: number;
  count: number;
}

/**
 * Benefícios aplicados a UM participante ACCEPTED. Existe para a mesa conseguir
 * AUDITAR a conclusão (quem foi afetado e com o quê), sem abrir nenhuma ficha.
 */
export interface LongRestCharacterCompletionDto {
  characterId: string;
  userId: string;
  username: string;
  hpBefore: number;
  hpAfter: number;
  /** PV temporário removido (o PHB encerra os PV temporários no descanso). */
  hpTempBefore: number;
  hitDiceRecovered: LongRestHitDiceRecoveredDto[];
  /** Níveis de espaço de magia normal cujo uso voltou a zero. */
  spellSlotLevelsRestored: number[];
  /** Ids de recursos de classe restaurados (recarga curta ou longa). */
  classResourcesRestored: string[];
  /** Ids de usos RACIAIS restaurados (ex.: `race-spell:...`). */
  racialUsesRestored: string[];
  /**
   * A Magia de Pacto (Bruxo) foi efetivamente recuperada (tinha uso e o
   * personagem tem pool). `false` quando não havia o que recuperar — o descanso
   * não "finge" uma mudança (PHB 2014: pool próprio do Bruxo).
   */
  pactMagicRestored: boolean;
  /** Toggles de classe que estavam ativos e foram encerrados. */
  activeTogglesCleared: string[];
}

/**
 * Auditoria dos recursos de acampamento no resultado idempotente (PASSO 15).
 *
 * `contributed` é o que o grupo ofereceu de verdade; `consumedPoints` é o que
 * saiu do inventário. Com `overridden: true` os pontos FALTANTES não são
 * inventados nem cobrados — só o que existia é consumido (PASSO 16/17).
 */
export interface LongRestCampSupplyAuditDto {
  enabled: boolean;
  costPerParticipant: number;
  required: number;
  contributed: number;
  consumedPoints: number;
  /** `remaining` no instante da conclusão (0 quando satisfeito normalmente). */
  remainingAtCompletion: number;
  /** O requisito foi cumprido pelas regras normais? */
  requirementSatisfiedNormally: boolean;
  /** A exigência foi DISPENSADA pelo mestre (nunca em silêncio). */
  overridden: boolean;
  overrideType: CampSupplyOverrideType | null;
  overrideNote: string | null;
  overriddenByUserId: string | null;
}

/** Resultado persistido da conclusão (também devolvido ao cliente). */
export interface LongRestCompletionDto {
  requestId: string;
  completedAt: string;
  /** Mestre que forçou a conclusão (`null` na conclusão automática). */
  forcedByUserId: string | null;
  campSupplies: LongRestCampSupplyAuditDto;
  /** Pilhas efetivamente consumidas. */
  suppliesConsumed: ConsumedCampSupply[];
  characters: LongRestCharacterCompletionDto[];
  sessions: { id: string; characterId: string; status: 'COMPLETED' }[];
}

/** Ficha alterada pela conclusão, para publicar `sheet:updated` DEPOIS do commit. */
export interface LongRestChangedSheet extends SheetOwner {
  character: Character;
  changes: Record<string, unknown>;
}

/** O que a conclusão produziu: o resultado + o que publicar depois do commit. */
export interface LongRestCompletionOutcome {
  completion: LongRestCompletionDto;
  sheets: LongRestChangedSheet[];
}

/**
 * Valida a seleção de Dados de Vida recebida do cliente contra a ficha ATUAL e
 * devolve a seleção normalizada (só as faces válidas, sem zeros).
 *
 * Server-authoritative (PASSO 7): rejeita faces que não são 6/8/10/12, valores
 * não inteiros/negativos, recuperar mais de um tipo do que foi gasto e soma
 * acima da cota. Seleção vazia (ou só zeros) é permitida.
 */
export function assertHitDiceSelection(
  character: Character,
  selection: unknown,
): HitDiceSelection {
  const invalidKeys = invalidHitDiceSelectionKeys(selection);
  if (invalidKeys.length > 0) {
    throw new HttpError(
      `Tipos de Dado de Vida inválidos: ${invalidKeys.join(', ')}. Use 6, 8, 10 ou 12.`,
      400,
      HIT_DICE_INVALID,
    );
  }

  const normalized = normalizeHitDiceSelection(selection);
  const hitDice = deriveHitDice(normalizeClassEntries(character.classes), character.hitDice);
  const allowance = hitDiceRecoveryAllowance(hitDice.total, hitDice.used);
  const problem = hitDiceSelectionProblem(normalized, hitDice, allowance.effective);
  if (problem) throw new HttpError(problem, 400, HIT_DICE_INVALID);

  return normalized;
}

/** Uma linha de participante ACCEPTED já carregada com a sessão e a ficha. */
interface AcceptedRow {
  characterId: string;
  userId: string;
  username: string;
  character: Character;
  session: { id: string; hitDiceRecoverySelection: unknown };
}

/**
 * Consome as pilhas contribuídas e aplica os benefícios — TUDO numa escrita por
 * personagem, guardada pela VERSÃO lida dentro da transação.
 *
 * Uma ficha que mudou no meio (gasto concorrente de Dado de Vida, edição do
 * mestre, uso de item) derruba a conclusão inteira: não existe consumo sem
 * benefício nem benefício sem consumo (PASSO 20/49-56).
 */
export async function completeLongRest(
  tx: Prisma.TransactionClient,
  requestId: string,
  options: LongRestCompletionOptions,
): Promise<LongRestCompletionOutcome> {
  const request = await tx.longRestRequest.findUnique({
    where: { id: requestId },
    include: {
      participants: {
        include: {
          user: { select: { id: true, username: true } },
          character: true,
        },
      },
      sessions: true,
    },
  });

  if (!request) throw new HttpError('Solicitação de descanso não encontrada.', 404);
  if (request.status !== 'APPROVED') {
    throw new HttpError(
      'Este descanso coletivo não está em andamento.',
      409,
      LONG_REST_REQUEST_CLOSED,
    );
  }

  const now = new Date();
  const accepted = request.participants.filter((participant) => participant.response === 'ACCEPTED');
  if (accepted.length === 0) {
    throw new HttpError(
      'Este descanso coletivo não tem participantes aceitos.',
      409,
      LONG_REST_REQUEST_CLOSED,
    );
  }

  // Cada ACCEPTED precisa de uma sessão da MESMA solicitação, ainda ACTIVE.
  const sessionByCharacter = new Map(
    request.sessions
      .filter((session) => session.longRestRequestId === requestId)
      .map((session) => [session.characterId, session]),
  );
  const rows: AcceptedRow[] = accepted.map((participant) => {
    const session = sessionByCharacter.get(participant.characterId);
    if (!session || session.status !== 'ACTIVE') {
      throw new HttpError(
        'Uma sessão do descanso coletivo não está mais ativa.',
        409,
        LONG_REST_REQUEST_CLOSED,
      );
    }
    return {
      characterId: participant.characterId,
      userId: participant.userId,
      username: participant.user.username,
      character: participant.character,
      session: { id: session.id, hitDiceRecoverySelection: session.hitDiceRecoverySelection },
    };
  });

  // Ready: o force do mestre ignora o que falta; a conclusão automática não.
  if (!options.forcedByUserId) {
    const notReady = rows.filter((row) => {
      const session = sessionByCharacter.get(row.characterId)!;
      return session.readyAt === null;
    });
    if (notReady.length > 0) {
      throw new HttpError(
        'Ainda há participantes que não terminaram suas decisões neste descanso.',
        409,
        LONG_REST_NOT_ALL_READY,
      );
    }
  }

  // RECALCULA os recursos de acampamento pelo valor ATUAL (PASSO 18/19).
  const supplies = await computeCampSupplies(
    tx,
    requestId,
    rows.map((row) => row.characterId),
  );

  if (supplies.enabled && !supplies.satisfied && !options.override) {
    throw new HttpError(
      'Faltam recursos de acampamento para este Descanso Longo. ' +
        'O mestre pode permitir o descanso com uma exceção narrativa.',
      409,
      CAMP_SUPPLIES_INSUFFICIENT,
      {
        required: supplies.required,
        contributed: supplies.contributed,
        remaining: supplies.remaining,
        campSupplies: supplies,
      },
    );
  }

  // Reservas ATIVAS: só as pilhas da PRÓPRIA solicitação (o lock garante que
  // ninguém está mexendo nelas agora).
  const contributionRows = await tx.longRestCampSupplyContribution.findMany({
    where: { requestId },
  });
  const acceptedIds = new Set(rows.map((row) => row.characterId));
  for (const contribution of contributionRows) {
    if (!acceptedIds.has(contribution.characterId)) {
      throw new HttpError(
        'Uma contribuição de acampamento não pertence a um participante aceito.',
        409,
        LONG_REST_REQUEST_CLOSED,
      );
    }
  }

  // Fichas FRESCAS dentro da transação (a do `include` pode ter sido lida antes
  // de outra operação e é usada só para derivar o que fazer).
  const characters = new Map<string, Character>();
  const inventories = new Map<string, InventoryItemDto[]>();
  for (const row of rows) {
    const character = await tx.character.findUniqueOrThrow({ where: { id: row.characterId } });
    characters.set(row.characterId, character);
    inventories.set(
      row.characterId,
      parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []),
    );
  }

  // CONSUMO das pilhas selecionadas (só quando a mecânica está ligada; com ela
  // desligada nada é devido e as contribuições ficam inertes).
  const consumption: {
    consumedPoints: number;
    consumed: ConsumedCampSupply[];
    inventories: Map<string, InventoryItemDto[]>;
  } =
    supplies.enabled && contributionRows.length > 0
      ? consumeCampSupplies({
          rows: contributionRows.map((contribution) => ({
            characterId: contribution.characterId,
            inventoryItemId: contribution.inventoryItemId,
            quantity: contribution.quantity,
          })),
          inventories,
          catalog: await loadCatalogLookup([...inventories.values()]),
        })
      : { consumedPoints: 0, consumed: [], inventories: new Map() };

  const completionCharacters: LongRestCharacterCompletionDto[] = [];
  const sheets: LongRestChangedSheet[] = [];
  const completedSessions: { id: string; characterId: string; status: 'COMPLETED' }[] = [];

  for (const row of rows) {
    const character = characters.get(row.characterId)!;

    // --- Dados de Vida: SÓ a seleção persistida (PASSO 23) -------------------
    const hitDiceBefore = deriveHitDice(
      normalizeClassEntries(character.classes),
      character.hitDice,
    );
    const allowance = hitDiceRecoveryAllowance(hitDiceBefore.total, hitDiceBefore.used);
    const selection = normalizeHitDiceSelection(row.session.hitDiceRecoverySelection);
    const selectionProblem = hitDiceSelectionProblem(selection, hitDiceBefore, allowance.effective);
    if (selectionProblem) {
      throw new HttpError(selectionProblem, 409, HIT_DICE_INVALID);
    }
    const hitDiceAfter = applyHitDiceRecovery(character.hitDice, selection);
    const hitDiceRecovered: LongRestHitDiceRecoveredDto[] = Object.entries(selection)
      .filter(([, count]) => count > 0)
      .map(([die, count]) => ({ die: Number(die), count }))
      .sort((a, b) => b.die - a.die);

    // --- Espaços de magia NORMAIS: zera o uso mantendo a estrutura (PASSO 24)
    const spells = parseJson<SpellsStateDto>(spellsStateSchema, character.spells, {
      list: [],
      slots: {},
      pactMagic: { used: 0 },
    });
    const spellSlotLevelsRestored: number[] = [];
    const nextSlots: Record<string, { max: number; used: number }> = {};
    for (const [level, slot] of Object.entries(spells.slots)) {
      if (slot.used > 0) spellSlotLevelsRestored.push(Number(level));
      nextSlots[level] = { ...slot, used: 0 };
    }

    // --- MAGIA DE PACTO: pool PRÓPRIO, também zerado pelo descanso (PHB 2014).
    //     Só o USO é persistido; o total vem do nível de Bruxo (nunca gravado).
    const pactMax =
      pactMagicSlots(normalizeClassEntries(character.classes))?.max ?? null;
    const pactMagicRestored = pactMax !== null && (spells.pactMagic?.used ?? 0) > 0;

    // --- Recursos de CLASSE: recarga curta E longa (PASSO 26) ---------------
    const classAdjustments = characterClassAdjustments(character);
    const classState = normalizeClassState(character.classState);
    const restored = restoreLongRestResources(classState, classAdjustments.resources);
    const classResourcesRestored = classAdjustments.resources
      .filter((resource) => resource.recharge === 'short' || resource.recharge === 'long')
      .map((resource) => resource.id);

    // --- Usos RACIAIS: 1x/descanso longo persistidos em `classState.used` ----
    const raceChoices = parseJson<Record<string, string>>(
      raceChoicesSchema,
      character.raceChoices,
      {},
    );
    const racialUsesRestored: string[] = [];
    const nextUsed = { ...restored.used };
    for (const grant of raceSpells(
      { raceId: character.raceId, subraceId: character.subraceId, choices: raceChoices },
      totalCharacterLevel(normalizeClassEntries(character.classes)),
    )) {
      if (grant.perRest !== 'long') continue;
      const resourceId = `race-spell:${grant.key}`;
      if (nextUsed[resourceId] !== undefined) racialUsesRestored.push(resourceId);
      delete nextUsed[resourceId];
    }

    // --- Toggles ativos: encerrados no descanso (TODO: motor de duração 6) ---
    // TODO(Fase 6): trocar esta limpeza pelo motor de duração/efeitos, que saberá
    // quais efeitos realmente terminam num Descanso Longo (ex.: Fúria).
    const activeTogglesCleared = [...restored.active];
    const nextClassState = { ...restored, used: nextUsed, active: [] as string[] };

    const hpBefore = character.hpCurrent;
    const hpAfter = characterMaxHp(character);
    const nextInventory = consumption.inventories.get(row.characterId);

    // Uma escrita por personagem, guardada pela versão lida nesta transação.
    const written = await tx.character.updateMany({
      where: { id: character.id, version: character.version },
      data: {
        hpCurrent: hpAfter,
        hpTemp: 0,
        hitDice: hitDiceAfter as unknown as Prisma.InputJsonValue,
        spells: { ...spells, slots: nextSlots, pactMagic: { used: 0 } } as unknown as Prisma.InputJsonValue,
        classState: nextClassState as unknown as Prisma.InputJsonValue,
        ...(nextInventory
          ? { inventory: nextInventory as unknown as Prisma.InputJsonValue }
          : {}),
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new HttpError(
        'Uma ficha mudou durante a conclusão do descanso; tente novamente.',
        409,
        LONG_REST_CONFLICT,
      );
    }
    const updated = await tx.character.findUniqueOrThrow({ where: { id: character.id } });

    // ACTIVE → COMPLETED (transição condicional: só uma vence).
    const closed = await tx.longRestSession.updateMany({
      where: { id: row.session.id, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    if (closed.count === 0) {
      throw new HttpError(
        'Uma sessão do descanso não está mais ativa.',
        409,
        LONG_REST_REQUEST_CLOSED,
      );
    }
    completedSessions.push({
      id: row.session.id,
      characterId: row.characterId,
      status: 'COMPLETED',
    });

    completionCharacters.push({
      characterId: row.characterId,
      userId: row.userId,
      username: row.username,
      hpBefore,
      hpAfter,
      hpTempBefore: character.hpTemp,
      hitDiceRecovered,
      spellSlotLevelsRestored,
      classResourcesRestored,
      racialUsesRestored,
      pactMagicRestored,
      activeTogglesCleared,
    });

    sheets.push({
      userId: row.userId,
      username: row.username,
      character: updated,
      changes: {
        hpCurrent: hpAfter,
        hpTemp: 0,
        hitDice: hitDiceAfter,
        spells: { ...spells, slots: nextSlots, pactMagic: { used: 0 } },
        ...(pactMagicRestored ? { pactMagicRestored: true } : {}),
        classState: nextClassState,
        ...(nextInventory ? { inventory: nextInventory } : {}),
      },
    });
  }

  // APPROVED → COMPLETED: só uma transição vence (idempotência/concorrência).
  const transitioned = await tx.longRestRequest.updateMany({
    where: { id: requestId, status: 'APPROVED' },
    data: { status: 'COMPLETED', completedAt: now },
  });
  if (transitioned.count === 0) {
    throw new HttpError(
      'Este descanso coletivo não está em andamento.',
      409,
      LONG_REST_REQUEST_CLOSED,
    );
  }

  const requirementSatisfiedNormally = supplies.satisfied;
  // A exceção só é registrada como USADA quando ela realmente dispensou a
  // exigência — nunca limpamos recursos de acampamento em silêncio (PASSO 11).
  const overridden = options.override !== null && !requirementSatisfiedNormally;

  return {
    completion: {
      requestId,
      completedAt: now.toISOString(),
      forcedByUserId: options.forcedByUserId,
      campSupplies: {
        enabled: supplies.enabled,
        costPerParticipant: supplies.costPerParticipant,
        required: supplies.required,
        contributed: supplies.contributed,
        consumedPoints: consumption.consumedPoints,
        remainingAtCompletion: supplies.remaining,
        requirementSatisfiedNormally,
        overridden,
        overrideType: overridden ? options.override!.type : null,
        overrideNote: overridden ? options.override!.note ?? null : null,
        overriddenByUserId: overridden ? options.forcedByUserId : null,
      },
      suppliesConsumed: consumption.consumed,
      characters: completionCharacters,
      sessions: completedSessions,
    },
    sheets,
  };
}

/**
 * Publica os efeitos da conclusão SÓ DEPOIS do commit.
 *
 * Cada ficha alterada recebe `sheet:updated` pelo mecanismo de sempre (o
 * jogador vê PV, Dados de Vida, espaços e recursos novos). O evento
 * `long-rest:request-updated` com status COMPLETED é emitido pelo chamador,
 * junto das demais operações da solicitação.
 */
export async function publishLongRestCompletion(
  outcome: LongRestCompletionOutcome,
): Promise<void> {
  for (const sheet of outcome.sheets) {
    await publishChange(
      { userId: sheet.userId, username: sheet.username },
      sheet.character,
      sheet.changes,
    );
  }
}
