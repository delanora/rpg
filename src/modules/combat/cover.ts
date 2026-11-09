import type { AbilityKey } from '../shared/dnd5e.js';
import type { MechanicalEntity } from '../shared/conditions.js';

/**
 * FASE 6.6J.5 — COVER (COBERTURA) DO PHB 2014.
 *
 * Cover é uma RELAÇÃO entre a ORIGEM de um ataque/efeito e o ALVO — nunca uma
 * Condition, um Effect global, um bônus permanente de CA nem uma tag fixa da
 * criatura. O mesmo alvo pode ter meia cobertura contra A e nenhuma contra B.
 *
 * PHB 2014:
 *  • Half Cover: +2 CA e +2 em salvaguardas de DESTREZA;
 *  • Three-Quarters Cover: +5 CA e +5 em salvaguardas de DESTREZA;
 *  • Total Cover: não pode ser escolhido como alvo DIRETO de um ataque/magia
 *    através da cobertura (é decisão de TARGETING, não "+999 CA").
 *
 * O provider de obstáculos usa o grau cadastrado e a interposição no grid;
 * onde a geometria não basta, conserva unknown/not-assessed e a confirmação
 * explícita do Mestre, sem inventar uma fração do corpo a partir do token.
 *
 * Este módulo é PURO: nada de banco, nada de dado, nada de nome de magia.
 */

export const COVER_LEVELS = ['none', 'half', 'three-quarters', 'total'] as const;
export type CoverLevel = (typeof COVER_LEVELS)[number];

/** De onde veio a avaliação (nunca se confunde com o NÍVEL). */
export type CoverProvenance = 'authoritative' | 'master-confirmed';

/**
 * Resultado de UMA avaliação de cobertura.
 *
 * `not-assessed` existe porque o sistema não tem geometria: ausência de
 * avaliação NÃO é "sem cobertura". Ele é tratado como 0 bônus (praticável), mas
 * fica auditável no snapshot.
 */
export type CoverEvaluation =
  | { status: 'known'; level: CoverLevel; provenance: CoverProvenance }
  | { status: 'unknown'; reason: string }
  | { status: 'not-assessed'; reason: string };

/** Interação avaliada: ataque, salvaguarda de Destreza ou propagação de área. */
export type CoverInteraction = 'attack' | 'dexterity-save' | 'area-propagation';

/**
 * POLÍTICAS de cover são SEPARADAS por dimensão (PHB):
 *  • `targetingCoverPolicy` decide se o alvo pode ser escolhido através da
 *    cobertura (Total Cover);
 *  • `saveCoverPolicy` decide se a salvaguarda ganha +2/+5.
 *
 * Chama Sagrada tem `saveCoverPolicy: 'ignore'` (não ganha o bônus) mas continua
 * exigindo ver o alvo — as duas coisas NÃO são a mesma regra.
 */
export type TargetingCoverPolicy = 'standard';
export type SaveCoverPolicy = 'standard' | 'ignore';

export function isCoverLevel(value: unknown): value is CoverLevel {
  return typeof value === 'string' && (COVER_LEVELS as readonly string[]).includes(value);
}

/**
 * Múltiplas fontes NÃO somam: vale o MAIOR nível (Half + Half = Half;
 * Half + Three-Quarters = Three-Quarters; Total é o máximo).
 */
export function highestCoverLevel(levels: readonly CoverLevel[]): CoverLevel {
  let best: CoverLevel = 'none';
  for (const level of levels) {
    if (COVER_LEVELS.indexOf(level) > COVER_LEVELS.indexOf(best)) best = level;
  }
  return best;
}

/** Bônus de CA da cobertura (Total Cover não vira bônus: é targeting). */
export function coverAcBonus(level: CoverLevel): number {
  if (level === 'half') return 2;
  if (level === 'three-quarters') return 5;
  return 0;
}

/** Bônus em salvaguardas de DESTREZA (as demais não recebem nada). */
export function coverDexSaveBonus(level: CoverLevel): number {
  if (level === 'half') return 2;
  if (level === 'three-quarters') return 5;
  return 0;
}

/**
 * Bônus de save aplicável: só DESTREZA, só com política `standard` e só quando
 * a cobertura é CONHECIDA (unknown/not-assessed = 0, nunca "meia cobertura").
 */
export function coverSaveBonusFor(
  policy: SaveCoverPolicy,
  evaluation: CoverEvaluation,
  ability: AbilityKey,
): number {
  if (policy === 'ignore') return 0;
  if (ability !== 'dexterity') return 0;
  if (evaluation.status !== 'known') return 0;
  return coverDexSaveBonus(evaluation.level);
}

/** Total Cover conhecido bloqueia o alvo DIRETO (falha de targeting). */
export function coverBlocksDirectTargeting(evaluation: CoverEvaluation): boolean {
  return evaluation.status === 'known' && evaluation.level === 'total';
}

/** Avaliação "conhecida" a partir de um nível (provider/confirmação). */
export function knownCover(
  level: CoverLevel,
  provenance: CoverProvenance = 'authoritative',
): CoverEvaluation {
  return { status: 'known', level, provenance };
}

/** Confirmação do Mestre só preenche o que o provider NÃO sabe. */
export function applyCoverConfirmation(
  evaluation: CoverEvaluation,
  confirmed: CoverLevel | undefined,
): CoverEvaluation {
  if (!confirmed) return evaluation;
  if (evaluation.status === 'known') return evaluation;
  return knownCover(confirmed, 'master-confirmed');
}

/** Forma SEGURA para snapshot/DTO (sem números inventados em unknown). */
export function coverSnapshotOf(evaluation: CoverEvaluation): {
  status: CoverEvaluation['status'];
  level: CoverLevel | null;
  acBonus: number;
  saveBonus: number;
  provenance: CoverProvenance | null;
} {
  if (evaluation.status !== 'known') {
    return {
      status: evaluation.status,
      level: null,
      acBonus: 0,
      saveBonus: 0,
      provenance: null,
    };
  }
  return {
    status: 'known',
    level: evaluation.level,
    acBonus: coverAcBonus(evaluation.level),
    saveBonus: coverDexSaveBonus(evaluation.level),
    provenance: evaluation.provenance,
  };
}

/**
 * Confirmação do MESTRE para UM alvo (fluxo assistido, 6.6J.5).
 * Só preenche o que o provider NÃO sabe; jamais sobrescreve fato autoritativo.
 */
export interface CoverConfirmation {
  targetKey: string;
  level: CoverLevel;
}

/** Contexto de avaliação entregue ao provider (origem ↔ alvo). */
export interface CoverEvaluationInput {
  origin: MechanicalEntity;
  target: MechanicalEntity;
  interaction: CoverInteraction;
}
