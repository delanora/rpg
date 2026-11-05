import type { Prisma } from '@prisma/client';
import type { CombatSourced, CombatantSourced } from '../combat.dto.js';
import {
  combatantAttacks,
  combatantMechanicalState,
  orderCombatants,
} from '../combat.dto.js';
import { economyOf, type TurnEconomy } from '../../shared/action-economy.js';
import { deriveConditionEffects } from '../../shared/conditions.js';
import { canSee } from '../../shared/vision.js';
import { parseStoredPosition } from './occupied-space.js';
import { effectiveSizeOf } from './spatial-size.js';
import { movementRelationOf, normalizeSideKey } from './spatial-movement.js';
import type { SpatialSize } from './spatial.types.js';
import {
  detectReachBoundaries,
  opportunityEligibility,
  opportunityOptionsOf,
  opportunityVisibilityOf,
  orderOpportunityReactors,
  type OpportunityAttackProfile,
  type OpportunityOption,
  type OpportunityVisibilityStatus,
  type ReachBoundary,
  type ReachThreat,
} from './opportunity-attack.js';

/**
 * ABERTURA DE JANELAS DE REAÇÃO (Fase 6.6L.3.1).
 *
 * Traduz o estado do combate em "quem pode reagir" e grava as janelas quando o
 * movimento é pausado. Fica separado do serviço de movimento/serviço de Reação
 * de propósito: assim o commit de movimento e a resolução da Reação usam a MESMA
 * função de abertura, sem ciclo de imports entre os dois serviços.
 *
 * Nada aqui rola dado, gasta Reação ou move ninguém. O que este módulo decide é
 * só ELEGIBILIDADE (lado, Reação disponível, capacidade de agir, visão) e
 * GEOMETRIA (boundaries de reach por ataque).
 */

export interface ReactionThreatScan {
  /** Threats elegíveis, na ordem de iniciativa. */
  threats: ReachThreat[];
  /** Ordem de iniciativa (índice canônico de `orderCombatants`). */
  orderIndex: Map<string, number>;
  /** Existe alguma criatura com lado desconhecido e ataque corpo a corpo? */
  relationUnknown: boolean;
  /** Reactor com alcance sendo deixado, mas sem visão autoritativa. */
  masterAdjudication: boolean;
}

/** Ataques que podem virar Opportunity Attack: corpo a corpo com reach real. */
export function opportunityAttackProfilesOf(
  combatant: CombatantSourced,
): OpportunityAttackProfile[] {
  return combatantAttacks(combatant)
    .filter((attack) => {
      // Só CORPO A CORPO: ataque à distância (mesmo adjacente) nunca é OA básica.
      if (attack.ranged) return false;
      // Reach precisa ser ESTRUTURADO. Sem ele o ataque não entra por adivinhação.
      if (typeof attack.reachFeet !== 'number') return false;
      if (attack.blocked) return false;
      // Mão secundária é economia de Ação Bônus: o mesmo perfil da arma principal
      // já aparece como ataque próprio; oferecê-lo aqui inventaria economia.
      if (attack.id.startsWith('offhand:')) return false;
      return true;
    })
    .map((attack) => ({
      attackId: attack.id,
      attackName: attack.name,
      reachFeet: attack.reachFeet as number,
    }));
}

function spatialBodyOf(
  combatant: CombatantSourced,
): { position: { xFeet: number; yFeet: number }; size: SpatialSize } | null {
  const position = parseStoredPosition(combatant.spatialPosition);
  if (!position) return null;
  return {
    position,
    size: effectiveSizeOf((combatant.baseSize ?? 'medium') as SpatialSize),
  };
}

/**
 * Varre os possíveis reactors do movimento.
 *
 * `mover` precisa estar colocado. Cada candidato passa por:
 *  1. lado (hostil conhecido — `same` e `unknown` ficam de fora);
 *  2. Reação disponível e capacidade de agir (Incapacitado/0 PV/morte);
 *  3. visão autoritativa (`canSee` mecânico + ausência de occluders);
 *  4. pelo menos UM ataque corpo a corpo com reach estruturado.
 *
 * `disengaging` do MOVER suprime a janela: o movimento dele não provoca OA
 * naquele turno, mas as Reações dos inimigos continuam valendo para outros
 * gatilhos (nada de supressão global).
 */
export function scanReactionThreats(
  combat: CombatSourced,
  mover: CombatantSourced,
  moverEconomy: TurnEconomy,
): ReactionThreatScan {
  const ordered = orderCombatants(combat.combatants);
  const orderIndex = new Map(ordered.map((item, index) => [item.id, index]));
  const moverPosition = parseStoredPosition(mover.spatialPosition);
  const moverSide = normalizeSideKey(mover.sideKey ?? null);
  const moverState = combatantMechanicalState(mover);
  const threats: ReachThreat[] = [];
  let relationUnknown = false;
  let masterAdjudication = false;

  if (!moverPosition) {
    return { threats, orderIndex, relationUnknown, masterAdjudication };
  }

  for (const candidate of combat.combatants) {
    if (candidate.id === mover.id) continue;
    const body = spatialBodyOf(candidate);
    if (!body) continue;
    const profiles = opportunityAttackProfilesOf(candidate);
    if (profiles.length === 0) continue;

    const relation = movementRelationOf(moverSide, normalizeSideKey(candidate.sideKey ?? null));
    if (relation === 'unknown') {
      // Não afirma hostilidade nem aliança: só reporta que falta decisão.
      relationUnknown = true;
      continue;
    }

    const reactorEconomy = economyOf(candidate.turnEconomy);
    const reactorEffects = deriveConditionEffects(combatantMechanicalState(candidate));
    const visibility: OpportunityVisibilityStatus = opportunityVisibilityOf({
      canSeeMover: canSee(combatantMechanicalState(candidate), moverState),
      // Nesta fase a cena NÃO tem paredes nem linha de visão: nada pode obstruir.
      // Quando existirem occluders, isto vira `unknown` (Mestre adjudica).
      occludersExist: false,
    });
    const eligibility = opportunityEligibility({
      relation,
      reactionAvailable: reactorEconomy.reactionAvailable,
      canAct: reactorEffects.canAct,
      disengaging: moverEconomy.disengaging,
      visibility,
      hasMeleeOption: profiles.length > 0,
    });
    if (!eligibility.eligible) {
      if (visibility === 'unknown') masterAdjudication = true;
      continue;
    }
    if (visibility === 'unknown') masterAdjudication = true;

    threats.push({
      reactorCombatantId: candidate.id,
      reactorName: candidate.name,
      body,
      attacks: profiles,
    });
  }

  return { threats, orderIndex, relationUnknown, masterAdjudication };
}

/** Boundary já com as opções e a ordem determinística do reactor. */
export interface ScannedBoundary extends ReachBoundary {
  orderIndex: number;
  visibility: OpportunityVisibilityStatus;
  options: OpportunityOption[];
}

/** Boundaries de UM caminho, com ele ordenado pela iniciativa. */
export function scanReactionBoundaries(
  scan: ReactionThreatScan,
  mover: { position: { xFeet: number; yFeet: number }; size: SpatialSize },
  path: readonly { xFeet: number; yFeet: number }[],
): ScannedBoundary[] {
  const boundaries = detectReachBoundaries({
    mover: { position: mover.position, size: mover.size },
    path,
    threats: scan.threats,
  });
  return boundaries
    .map((boundary) => ({
      ...boundary,
      orderIndex: scan.orderIndex.get(boundary.reactorCombatantId) ?? Number.MAX_SAFE_INTEGER,
      visibility: 'known-visible' as OpportunityVisibilityStatus,
      options: opportunityOptionsOf(boundary),
    }))
    .sort((a, b) => a.stepIndex - b.stepIndex || a.orderIndex - b.orderIndex);
}

/** Linha criada no banco, no formato mínimo que o DTO consome. */
export interface OpenedOpportunityRow {
  id: string;
  reactorCombatantId: string;
  reactorName: string;
  reactorUserId: string | null;
  boundaryIndex: number;
  reachFeet: number;
  orderIndex: number;
  visibilityStatus: string;
  options: OpportunityOption[];
}

export interface OpenBoundaryResult {
  /** Índice do passo (dentro do caminho restante) que provocou as janelas. */
  stepIndex: number;
  opportunities: OpenedOpportunityRow[];
}

/**
 * Abre as janelas do PRIMEIRO boundary de reach do caminho restante.
 *
 * Cria UMA linha por reactor (com todas as opções daquele passo) e devolve o
 * índice do passo que deve ser SEGURADO: o movimento só o aplica depois de todas
 * as janelas daquele passo fecharem. Nenhuma janela nasce sem opção válida.
 */
export async function openOpportunitiesAtBoundary(
  db: Prisma.TransactionClient,
  params: {
    combat: CombatSourced;
    intentId: string;
    mover: CombatantSourced;
    moverEconomy: TurnEconomy;
    /** Posição a partir da qual o caminho restante começa. */
    remainingPath: { xFeet: number; yFeet: number }[];
  },
): Promise<OpenBoundaryResult | null> {
  const moverBody = spatialBodyOf(params.mover);
  if (!moverBody || params.remainingPath.length === 0) return null;
  const scan = scanReactionThreats(params.combat, params.mover, params.moverEconomy);
  const boundaries = scanReactionBoundaries(scan, moverBody, params.remainingPath);
  const first = boundaries[0];
  if (!first) return null;

  const opportunities: OpenedOpportunityRow[] = [];
  for (const boundary of boundaries.filter((item) => item.stepIndex === first.stepIndex)) {
    const reactor = params.combat.combatants.find(
      (candidate) => candidate.id === boundary.reactorCombatantId,
    );
    if (!reactor) continue;
    // Um reactor só tem UMA janela por posição do caminho — inclusive porque o
    // movimento é retomado do MESMO passo depois de resolvida.
    const row = await db.reactionOpportunity.create({
      data: {
        combatId: params.combat.id,
        movementIntentId: params.intentId,
        moverCombatantId: params.mover.id,
        reactorCombatantId: reactor.id,
        reactorUserId: reactor.ownerUserId,
        kind: 'opportunity-attack',
        status: 'pending',
        boundaryIndex: boundary.stepIndex,
        reachFeet: Math.min(...boundary.options.map((option) => option.reachFeet)),
        options: boundary.options as unknown as Prisma.InputJsonValue,
        visibilityStatus: boundary.visibility,
        orderIndex: boundary.orderIndex,
      },
      select: {
        id: true,
        reactorCombatantId: true,
        boundaryIndex: true,
        reachFeet: true,
        orderIndex: true,
        visibilityStatus: true,
      },
    });
    opportunities.push({
      id: row.id,
      reactorCombatantId: reactor.id,
      reactorName: reactor.name,
      reactorUserId: reactor.ownerUserId,
      boundaryIndex: row.boundaryIndex,
      reachFeet: row.reachFeet,
      orderIndex: row.orderIndex,
      visibilityStatus: row.visibilityStatus,
      options: boundary.options,
    });
  }

  if (opportunities.length === 0) return null;
  return {
    stepIndex: first.stepIndex,
    opportunities: opportunities.sort((a, b) => a.orderIndex - b.orderIndex),
  };
}
