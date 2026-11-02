import { randomUUID } from 'node:crypto';
import type {
  ConditionInstance,
  Condition,
  MechanicalEntity,
  MechanicalState,
} from '../shared/conditions.js';
import { deriveConditionEffects } from '../shared/conditions.js';

/**
 * FASE 6.5C — helpers de DOMÍNIO para ConditionInstance.
 *
 * Existem para que a aplicação/remoção de Conditions seja a MESMA em todos os
 * caminhos (mutação manual do Mestre e Effect Engine), sem chamar HTTP
 * internamente e sem uma segunda cópia das regras.
 *
 * O que NÃO mora aqui: fórmula dos efeitos derivados. `deriveConditionEffects`
 * continua sendo a ÚNICA interpretação (Paralyzed ⇒ Incapacitated, etc.).
 */

/** Fonte de uma ConditionInstance: quem a criou e como rastreá-la. */
export interface ConditionSource {
  /** `manual`, `effect`, `posture`, `hp-zero`, ... */
  sourceType?: string;
  /** Chave estável da fonte (id do Effect, operationId manual...). */
  sourceId?: string;
  /** Rótulo legível (nome do Effect público, "Mestre", ...). */
  sourceLabel?: string;
  /** Entidade responsável (Caster do Charmed/Frightened). */
  sourceEntity?: MechanicalEntity;
}

/**
 * Motivo pelo qual a mesa já BLOQUEIA esta Condition agora (`null` = aplicável).
 *
 * Extraído do `mutateMechanicalState` para o Effect Engine respeitar exatamente
 * as mesmas regras: nada de atalho "porque veio de um efeito".
 */
export function conditionBlockedReason(
  state: MechanicalState,
  condition: Condition,
): string | null {
  const effects = deriveConditionEffects(state);
  if (condition === 'poisoned' && effects.poisonImmune) {
    return 'Petrificado: imune a novo envenenamento.';
  }
  return null;
}

/**
 * Acrescenta as ConditionInstances ao estado e devolve as criadas.
 *
 * Regras preservadas do motor atual:
 *  • UMA instância por fonte — duas fontes (manual + Effect, Effect A + Effect
 *    B) geram instâncias separadas, nunca um "merge" por nome;
 *  • Unconscious acrescenta a Queda (postura física) SOMENTE se ainda não
 *    houver nenhuma Queda ativa. Vinda de um Effect, a Queda carrega a MESMA
 *    origem, para o cleanup do Effect removê-la junto — sem tocar numa Queda
 *    independente;
 *  • nenhuma condição derivada (Incapacitated de Paralyzed, por exemplo) é
 *    materializada aqui.
 */
export function applyConditionInstances(
  state: MechanicalState,
  conditions: readonly Condition[],
  source: ConditionSource,
  appliedBy?: string,
): ConditionInstance[] {
  const created: ConditionInstance[] = [];
  const appliedAt = new Date().toISOString();
  const sourceFields = {
    ...(source.sourceType ? { sourceType: source.sourceType } : {}),
    ...(source.sourceId ? { sourceId: source.sourceId } : {}),
    ...(source.sourceLabel ? { sourceLabel: source.sourceLabel } : {}),
    ...(source.sourceEntity ? { sourceEntity: source.sourceEntity } : {}),
  };

  for (const condition of conditions) {
    const instance: ConditionInstance = {
      id: randomUUID(),
      condition,
      appliedAt,
      ...(appliedBy ? { appliedBy } : {}),
      ...sourceFields,
    };
    state.conditions.push(instance);
    created.push(instance);

    if (condition === 'unconscious' && !state.conditions.some((item) => item.condition === 'prone')) {
      // Queda é postura FÍSICA independente (continua depois de acordar). Vinda
      // de um Effect, herda a origem dele para o cleanup ser coerente.
      const posture: ConditionInstance = {
        id: randomUUID(),
        condition: 'prone',
        appliedAt,
        ...(appliedBy ? { appliedBy } : {}),
        ...(source.sourceType === 'effect'
          ? {
              sourceType: 'effect',
              ...(source.sourceId ? { sourceId: source.sourceId } : {}),
              ...(source.sourceLabel ? { sourceLabel: source.sourceLabel } : {}),
            }
          : { sourceType: 'posture', sourceLabel: 'Queda por inconsciência' }),
      };
      state.conditions.push(posture);
      created.push(posture);
    }
  }
  return created;
}

/**
 * Remove as instâncias de UMA fonte (sourceType + sourceId) e devolve as
 * removidas.
 *
 * A identidade é SEMPRE `sourceType + sourceId` — nunca `condition`, `label`
 * ou `sourceLabel`. Isso preserva fonte manual, outro Effect e as derivadas
 * protegidas (`hp-zero`) sem precisar de lista de exceções.
 */
export function removeConditionInstancesBySource(
  state: MechanicalState,
  sourceType: string,
  sourceIds: readonly string[],
): ConditionInstance[] {
  if (sourceIds.length === 0) return [];
  const ids = new Set(sourceIds);
  const removed = state.conditions.filter(
    (instance) => instance.sourceType === sourceType && instance.sourceId !== undefined && ids.has(instance.sourceId),
  );
  if (removed.length === 0) return [];
  state.conditions = state.conditions.filter(
    (instance) => !(instance.sourceType === sourceType && instance.sourceId !== undefined && ids.has(instance.sourceId)),
  );
  return removed;
}
