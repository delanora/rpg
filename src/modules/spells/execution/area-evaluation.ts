import { HttpError } from '../../../lib/http-error.js';

/**
 * FASE 6.6J.3 — AVALIAÇÃO DE CANDIDATOS DA ÁREA (tri-state).
 *
 * Mesma filosofia da 6.6E: o servidor responde `pass`/`fail`/`unknown` para
 * cada fato que consegue medir. `fail` autoritativo NUNCA é sobrescrito pelo
 * Mestre; `pass` autoritativo NUNCA é removido à força; o Mestre decide
 * SOMENTE o que é `unknown`.
 *
 * Dois fatos espaciais independentes:
 *  • MEMBERSHIP — o alvo está dentro da FORMA?
 *  • PROPAGATION — o efeito consegue chegar da origem até ele (total cover)?
 *
 * A ordem das regras é: `rules` (filtros da definição) primeiro; depois os dois
 * fatos espaciais. Qualquer `fail` decide; qualquer `unknown` sem `fail` deixa o
 * candidato `unknown`.
 */

export type AreaTriState = 'pass' | 'fail' | 'unknown';

export type AreaRuleResult = 'pass' | 'fail';

export interface AreaCandidateEvaluation {
  /** Chave canônica (`kind:id`) — a identidade do alvo no domínio. */
  targetKey: string;
  kind: string;
  id: string;
  geometry: AreaTriState;
  propagation: AreaTriState;
  rules: AreaRuleResult;
  affected: AreaTriState;
  reasons: string[];
}

/** Combina os fatos. `fail` vence; `unknown` vem antes de `pass`. */
export function mergeAreaEvaluation(
  geometry: AreaTriState,
  propagation: AreaTriState,
  rules: AreaRuleResult,
): AreaTriState {
  if (rules === 'fail') return 'fail';
  if (geometry === 'fail' || propagation === 'fail') return 'fail';
  if (geometry === 'unknown' || propagation === 'unknown') return 'unknown';
  return 'pass';
}

export function areaCandidateEvaluation(input: {
  targetKey: string;
  kind: string;
  id: string;
  geometry: AreaTriState;
  propagation: AreaTriState;
  rules?: AreaRuleResult;
  reasons?: readonly string[];
}): AreaCandidateEvaluation {
  const rules = input.rules ?? 'pass';
  return {
    targetKey: input.targetKey,
    kind: input.kind,
    id: input.id,
    geometry: input.geometry,
    propagation: input.propagation,
    rules,
    affected: mergeAreaEvaluation(input.geometry, input.propagation, rules),
    reasons: [...(input.reasons ?? [])],
  };
}

export function canonicalTargetKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Ordem CANÔNICA: por chave (kind:id). A query do banco, a ordem da UI e a
 * ordem em que o Mestre clicou NÃO podem mudar o snapshot.
 */
export function sortAreaCandidates(
  evaluations: readonly AreaCandidateEvaluation[],
): AreaCandidateEvaluation[] {
  return [...evaluations].sort((a, b) => (a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0));
}

export interface AreaUnknownDecision {
  targetKey: string;
  affected: boolean;
}

export interface AreaDecisionOutcome {
  /** Chaves que ENTRAM na área (autoritativas ou confirmadas pelo Mestre). */
  affectedKeys: string[];
  /** Proveniência por alvo — auditoria, não estado mecânico. */
  provenance: Map<string, 'authoritative' | 'master-confirmed'>;
  /** `unknown` que ficaram sem decisão. */
  missing: string[];
  /** Decisões enviadas para alvos que NÃO são `unknown`. */
  invalid: string[];
}

/**
 * Aplica as decisões do Mestre APENAS sobre `unknown`.
 *
 * `pass` entra sozinho; `fail` fica fora; decisão sobre qualquer um dos dois é
 * recusada (não há "sobrescrever fato"). `unknown` sem decisão deixa a
 * resolução INCOMPLETA — o cast não pode ser commitado.
 */
export function applyAreaDecisions(
  evaluations: readonly AreaCandidateEvaluation[],
  decisions: readonly AreaUnknownDecision[],
): AreaDecisionOutcome {
  const byKey = new Map(evaluations.map((evaluation) => [evaluation.targetKey, evaluation]));
  const decided = new Map<string, boolean>();
  const invalid: string[] = [];
  for (const decision of decisions) {
    const evaluation = byKey.get(decision.targetKey);
    if (!evaluation || evaluation.affected !== 'unknown') {
      invalid.push(decision.targetKey);
      continue;
    }
    decided.set(decision.targetKey, decision.affected);
  }

  const affectedKeys: string[] = [];
  const provenance = new Map<string, 'authoritative' | 'master-confirmed'>();
  const missing: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.affected === 'pass') {
      affectedKeys.push(evaluation.targetKey);
      provenance.set(evaluation.targetKey, 'authoritative');
      continue;
    }
    if (evaluation.affected === 'fail') continue;
    const decision = decided.get(evaluation.targetKey);
    if (decision === undefined) {
      missing.push(evaluation.targetKey);
      continue;
    }
    if (decision) {
      affectedKeys.push(evaluation.targetKey);
      provenance.set(evaluation.targetKey, 'master-confirmed');
    }
  }
  return { affectedKeys, provenance, missing, invalid };
}

/** Erro de decisão inválida (Mestre tentando reescrever fato autoritativo). */
export function assertAreaDecisionsValid(outcome: AreaDecisionOutcome): void {
  if (outcome.invalid.length > 0) {
    throw new HttpError(
      'O Mestre só pode decidir alvos cuja área é desconhecida.',
      409,
      'AREA_DECISION_NOT_UNKNOWN',
      { targetKeys: outcome.invalid },
    );
  }
}

/** Erro de resolução incompleta (ainda há `unknown` sem decisão). */
export function assertAreaResolutionComplete(outcome: AreaDecisionOutcome): void {
  if (outcome.missing.length > 0) {
    throw new HttpError(
      'Ainda há alvos com posição desconhecida aguardando decisão do Mestre.',
      409,
      'AREA_RESOLUTION_INCOMPLETE',
      { targetKeys: outcome.missing },
    );
  }
}
