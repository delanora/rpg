import { bodyDistanceFeet, type SpatialBody } from './spatial-distance.js';
import type { SpatialPosition2D } from './spatial.types.js';

/**
 * FASE 6.6L.3.1 — OPPORTUNITY ATTACK: MOTOR PURO (D&D 5e PHB 2014).
 *
 * PHB 2014, p. 195: "You can make an opportunity attack when a hostile creature
 * that you can see moves out of your reach. [...] The attack interrupts the
 * provoking creature's movement, occurring right before the creature leaves
 * your reach."
 *
 * Este módulo só responde DUAS perguntas, sem I/O e sem nome de magia/feature:
 *
 *  1. Em QUAL passo do caminho pretendido cada ataque corpo a corpo deixaria de
 *     alcançar o alvo (`detectReachBoundaries`)?
 *  2. Dado o estado do reactor, ele PODE reagir (`opportunityEligibility`)?
 *
 * Decisões estruturais registradas (aprovadas no domínio):
 *
 *  • REACH É POR ATAQUE, nunca "raio de ameaça" da criatura. Uma criatura com
 *    espada curta (5 pés) e glaive (10 pés) provoca janelas DIFERENTES: sair de
 *    5 oferece só a espada; sair de 10 oferece só a glaive. Somar os dois num
 *    reach global seria inventar alcance que nenhum ataque tem.
 *  • ENTRAR no alcance não provoca nada (isso é Polearm Master, fora de escopo).
 *  • Ficar dentro do alcance não provoca nada.
 *  • A janela nasce ANTES do passo: o mover continua na posição anterior até a
 *    Reação resolver. Quem aplica o passo é o serviço, nunca este módulo.
 *  • Alcance e distância usam o MESMO motor da 6.6L.2 (footprints, nunca centro
 *    do token, nunca distância euclidiana).
 *  • Hostilidade, visão e Reação disponível NÃO são geometria: entram por
 *    `opportunityEligibility`, com `unknown` explícito — nada é assumido.
 */

/** Identidade auditável do algoritmo (mudar a regra muda isto). */
export const OPPORTUNITY_ATTACK_ALGORITHM = 'phb-opportunity-attack-v1';

/**
 * Estado de VISIBILIDADE reactor → mover.
 *
 * `known-not-visible` é autoritativo e NUNCA é sobrescrito por confirmação
 * manual. `unknown` só existe quando há algo que o servidor não mede (por
 * exemplo, obstrução geométrica quando paredes existirem no futuro) — sem
 * geometria o projeto não assume visão: pede adjudicação do Mestre.
 */
export type OpportunityVisibilityStatus =
  | 'known-visible'
  | 'known-not-visible'
  | 'unknown';

/** Um ataque corpo a corpo com alcance ESTRUTURADO (nunca inferido do nome). */
export interface OpportunityAttackProfile {
  attackId: string;
  attackName: string;
  reachFeet: number;
}

/** Potencial reactor com o corpo (posição + tamanho efetivo) e seus ataques. */
export interface ReachThreat {
  reactorCombatantId: string;
  reactorName: string;
  body: SpatialBody;
  /** Já filtrados: só corpo a corpo com reach estruturado e usáveis agora. */
  attacks: readonly OpportunityAttackProfile[];
}

export interface ReachBoundaryAttack extends OpportunityAttackProfile {
  /** Distância (pés) ANTES do passo — dentro do alcance por definição. */
  distanceBeforeFeet: number;
}

/** Janela de UM reactor num passo específico do caminho. */
export interface ReachBoundary {
  /** Índice do passo (0 = primeiro passo do caminho avaliado). */
  stepIndex: number;
  reactorCombatantId: string;
  reactorName: string;
  attacks: ReachBoundaryAttack[];
}

/**
 * Detecta os boundaries de reach de UM caminho.
 *
 * Para cada passo: distância reactor → posição ANTERIOR e posição POSTERIOR. Um
 * ataque provoca quando `antes <= reach` e `depois > reach`. O passo em que cada
 * ataque dispara pela PRIMEIRA vez é a janela dele; ataques com alcances
 * diferentes geram janelas em passos diferentes, na ordem do caminho.
 *
 * Devolve no máximo UMA entrada por `(passo, reactor)` — vários ataques que
 * saem do alcance no MESMO passo viram opções da mesma janela.
 */
export function detectReachBoundaries(input: {
  mover: SpatialBody;
  path: readonly SpatialPosition2D[];
  threats: readonly ReachThreat[];
}): ReachBoundary[] {
  const { mover } = input;
  if (!mover.position) return [];

  const boundaries = new Map<string, ReachBoundary>();
  let cursor = mover.position;

  for (let index = 0; index < input.path.length; index += 1) {
    const next = input.path[index];
    const after = { position: next, size: mover.size };
    for (const threat of input.threats) {
      if (threat.attacks.length === 0) continue;
      const before = bodyDistanceFeet(threat.body, { position: cursor, size: mover.size });
      const ahead = bodyDistanceFeet(threat.body, after);
      if (before === null || ahead === null) continue;

      for (const attack of threat.attacks) {
        // Só a SAÍDA do alcance provoca: entrar ou permanecer nunca provoca.
        const leaving = before <= attack.reachFeet && ahead > attack.reachFeet;
        if (!leaving) continue;

        const key = `${index}:${threat.reactorCombatantId}`;
        const existing = boundaries.get(key);
        const entry: ReachBoundaryAttack = {
          ...attack,
          distanceBeforeFeet: before,
        };
        if (existing) {
          if (!existing.attacks.some((item) => item.attackId === attack.attackId)) {
            existing.attacks.push(entry);
          }
        } else {
          boundaries.set(key, {
            stepIndex: index,
            reactorCombatantId: threat.reactorCombatantId,
            reactorName: threat.reactorName,
            attacks: [entry],
          });
        }
      }
    }
    cursor = next;
  }

  return [...boundaries.values()].sort(
    (a, b) =>
      a.stepIndex - b.stepIndex ||
      a.reactorCombatantId.localeCompare(b.reactorCombatantId),
  );
}

/**
 * Motivos de NÃO abrir janela. A identidade estável é o código; o texto é
 * exibição/diagnóstico do Mestre.
 */
export type OpportunityIneligibleReason =
  | 'same-side'
  | 'relation-unknown'
  | 'reaction-used'
  | 'incapacitated'
  | 'cannot-see'
  | 'no-melee-attack';

export type OpportunityEligibility =
  | { eligible: true }
  | { eligible: false; reason: OpportunityIneligibleReason };

export interface OpportunityEligibilityInput {
  /** Relação já derivada pelo motor de movimento (`same|hostile|unknown`). */
  relation: 'same' | 'hostile' | 'unknown';
  reactionAvailable: boolean;
  /** `false` = Incapacitado/0 PV/morte: não pode fazer Ação, Bônus nem Reação. */
  canAct: boolean;
  /** O MOVER está com Disengage ativo neste turno (PHB 2014). */
  disengaging: boolean;
  visibility: OpportunityVisibilityStatus;
  /** Existe pelo menos um ataque corpo a corpo com alcance estruturado. */
  hasMeleeOption: boolean;
}

/**
 * O reactor pode reagir NESTE movimento?
 *
 * Ordem deliberada: primeiro as identidades (lado, Reação, capacidade), depois a
 * visão. `relation-unknown` NUNCA é tratado como hostil nem como aliado.
 * `disengaging` é do MOVER (Disengage suprime a OA contra ele, sem desligar as
 * Reações dos inimigos para outros gatilhos).
 */
export function opportunityEligibility(
  input: OpportunityEligibilityInput,
): OpportunityEligibility {
  if (input.relation === 'same') return { eligible: false, reason: 'same-side' };
  if (input.relation === 'unknown') return { eligible: false, reason: 'relation-unknown' };
  if (input.disengaging) return { eligible: false, reason: 'reaction-used' };
  if (!input.reactionAvailable) return { eligible: false, reason: 'reaction-used' };
  if (!input.canAct) return { eligible: false, reason: 'incapacitated' };
  if (input.visibility === 'known-not-visible') {
    return { eligible: false, reason: 'cannot-see' };
  }
  if (!input.hasMeleeOption) return { eligible: false, reason: 'no-melee-attack' };
  return { eligible: true };
}

/**
 * Classifica a visão reactor → mover.
 *
 * Sem obstáculos no modelo (esta fase NÃO tem paredes nem linha de visão), o
 * fato mecânico (`canSee`) é autoritativo: nada pode obstruir. Quando existirem
 * occluders, a resposta correta é `unknown` e o Mestre adjudica — nunca
 * `known-visible` por omissão.
 */
export function opportunityVisibilityOf(input: {
  canSeeMover: boolean;
  /** `true` quando a cena passa a ter obstáculos/LoS que o servidor não mede. */
  occludersExist: boolean;
  geometry?: 'pass' | 'fail' | 'unknown';
}): OpportunityVisibilityStatus {
  if (!input.canSeeMover || input.geometry === 'fail') return 'known-not-visible';
  if (input.geometry === 'pass') return 'known-visible';
  if (input.geometry === 'unknown') return 'unknown';
  return input.occludersExist ? 'unknown' : 'known-visible';
}

/**
 * O Mestre PODE confirmar esta janela? Só `unknown` é adjudicável: um fato
 * autoritativo (`known-not-visible`) jamais é sobrescrito para `visible`.
 */
export function canConfirmOpportunityVisibility(
  status: OpportunityVisibilityStatus,
): boolean {
  return status === 'unknown';
}

/** Rótulo curto e seguro para UI (sem números privados do alvo). */
export function opportunityOptionLabel(attackName: string): string {
  return `Ataque de Oportunidade — ${attackName}`;
}

/** Opção exposta ao reactor: o id do ataque é a ÚNICA entrada aceita depois. */
export interface OpportunityOption {
  spell?: {spellId: string; spellcastingSource: import('../../spells/execution/spellcasting-source.js').SpellcastingSourceRef; castingResource?: {kind: 'spell-slot' | 'pact-slot'; level: number}};
  id: string;
  attackId: string;
  label: string;
  description: string;
  reachFeet: number;
}

/** Converte um boundary em opções de UI (uma por ataque que sairia do alcance). */
export function opportunityOptionsOf(boundary: ReachBoundary): OpportunityOption[] {
  return boundary.attacks.map((attack) => ({
    id: `${boundary.reactorCombatantId}:${attack.attackId}`,
    attackId: attack.attackId,
    label: opportunityOptionLabel(attack.attackName),
    description: `Corpo a corpo · alcance ${attack.reachFeet} pés`,
    reachFeet: attack.reachFeet,
  }));
}

/**
 * Ordena reactors pela ORDEM DE INICIATIVA já canônica do combate (índice em
 * `orderCombatants`). Nunca por id, nome ou posição: o desempate é o MESMO da
 * iniciativa (iniciativa desc → Destreza → nome).
 */
export function orderOpportunityReactors(
  reactors: readonly { reactorCombatantId: string; orderIndex: number }[],
): { reactorCombatantId: string; orderIndex: number }[] {
  return [...reactors].sort((a, b) => a.orderIndex - b.orderIndex);
}

/** Resumo de risco do caminho para o PREVIEW (nunca promete "seguro"). */
export type MovementReactionRisk =
  | 'none'
  | 'possible'
  | 'relation-unknown'
  | 'master-adjudication-required';

export function movementReactionRiskOf(input: {
  possible: boolean;
  relationUnknown: boolean;
  awaitingMaster: boolean;
}): MovementReactionRisk {
  if (input.possible) return 'possible';
  if (input.relationUnknown) return 'relation-unknown';
  if (input.awaitingMaster) return 'master-adjudication-required';
  return 'none';
}
