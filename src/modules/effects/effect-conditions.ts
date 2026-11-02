import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import {
  CONDITION_LABELS,
  deriveConditionEffects,
  type Condition,
  type MechanicalEntity,
  type MechanicalState,
} from '../shared/conditions.js';
import type { ConcentrationState } from '../shared/concentration.js';
import {
  applyConditionInstances,
  conditionBlockedReason,
  removeConditionInstancesBySource,
} from '../mechanical/condition-instances.js';
import { loadEntity, type LoadedEntity } from '../mechanical/mechanical.service.js';
import { parseEffectConditions } from './effect-modifiers.js';

/**
 * FASE 6.5C — Effect → Condition.
 *
 * Um Effect NÃO tem motor próprio de Conditions: ele cria ConditionInstances
 * NORMAIS no `mechanicalState` do alvo, com `sourceType: 'effect'` e
 * `sourceId = effect.id`. Toda a interpretação continua em
 * `deriveConditionEffects` (Paralyzed ⇒ Incapacitated, Invisible ⇒ visão,
 * Charmed ⇒ charmers...).
 *
 * Consequências de projeto:
 *  • identidade da fonte é `sourceType + sourceId` (nunca nome/label), então
 *    duas fontes iguais coexistem e o cleanup de uma não toca na outra;
 *  • fonte manual, fonte de outro Effect e as derivadas protegidas (`hp-zero`)
 *    ficam naturalmente intocadas;
 *  • a origem legível é sanitizada na GRAVAÇÃO quando o efeito é privado
 *    (`sourceLabel: 'Efeito'`), então nada secreto chega a DTO algum;
 *  • `sourceEntity` é preservado porque é estado MECÂNICO (Charmed/Frightened
 *    precisam do charmer), e o motor já o expõe como relação, não como segredo.
 */

/** Efeito mínimo necessário para aplicar/limpar Conditions. */
export interface EffectConditionCarrier {
  id: string;
  label: string;
  visibility: string;
  conditions: unknown;
  createdBy: string | null;
  sourceEntityKind: string | null;
  sourceEntityId: string | null;
}

export interface ApplyEffectConditionsResult {
  /**
   * Concentração do ALVO que terminou por ficar Incapacitado. Quem chama
   * encerra o grupo ligado a ela DENTRO da mesma transação — assim o ciclo
   * Effect → Incapacitado → Concentração → Group termina deterministicamente.
   */
  endedConcentration: ConcentrationState | null;
}

function logInto(state: MechanicalState, actorName: string, message: string): void {
  state.log = [
    ...state.log,
    {
      id: randomUUID(),
      actorName,
      message,
      at: new Date().toISOString(),
    },
  ].slice(-100);
}

/** Grava o estado mecânico e incrementa a versão canônica (+ combate ativo). */
async function saveMechanicalState(
  loaded: LoadedEntity,
  state: MechanicalState,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  const data = { mechanicalState: state as unknown as Prisma.InputJsonValue };
  if (loaded.entity.kind === 'character') {
    await db.character.update({
      where: { id: loaded.entity.id },
      data: { ...data, version: { increment: 1 } },
    });
  } else if (loaded.entity.kind === 'creature') {
    await db.creature.update({
      where: { id: loaded.entity.id },
      data: { ...data, version: { increment: 1 } },
    });
  } else {
    await db.combatant.update({
      where: { id: loaded.entity.id },
      data: { ...data, mechanicalVersion: { increment: 1 } },
    });
  }
  // Mudança de estado no meio de um combate também move a versão do combate:
  // sem isso o tabuleiro/painel ficaria com o snapshot anterior.
  if (loaded.combat) {
    await db.combat.updateMany({
      where: { id: loaded.combat.id, status: { in: ['ACTIVE', 'PENDING_INITIATIVE'] } },
      data: { version: { increment: 1 } },
    });
  }
}

function sourceEntityOf(effect: EffectConditionCarrier): MechanicalEntity | undefined {
  if (!effect.sourceEntityKind || !effect.sourceEntityId) return undefined;
  return {
    kind: effect.sourceEntityKind as MechanicalEntity['kind'],
    id: effect.sourceEntityId,
  };
}

/**
 * Aplica as Conditions declaradas pelo Effect no alvo dele.
 *
 * Deve rodar DENTRO da transação que cria a instância do efeito: nunca existe
 * "effect gravado sem Condition" nem "Condition criada sozinha".
 */
export async function applyEffectConditions(
  effect: EffectConditionCarrier,
  target: MechanicalEntity,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<ApplyEffectConditionsResult> {
  const conditions = parseEffectConditions(effect.conditions);
  if (conditions.length === 0) return { endedConcentration: null };

  // `loadEntity` canonicaliza combatente de PERSONAGEM para a ficha: a
  // Condition vive no `mechanicalState` da ficha (o combatente só projeta).
  const loaded = await loadEntity(target, db);
  const state = loaded.state;

  // Imunidades/regras de domínio são as MESMAS da aplicação manual: se a mesa
  // já bloqueia (Petrified impede novo Poisoned), o efeito também não passa.
  for (const condition of conditions) {
    const blocked = conditionBlockedReason(state, condition);
    if (blocked) {
      throw new HttpError(`${blocked} (efeito: ${effect.label})`, 409, 'CONDITION_IMMUNE');
    }
  }

  const isPrivate = effect.visibility === 'private';
  const applied = applyConditionInstances(
    state,
    conditions,
    {
      sourceType: 'effect',
      sourceId: effect.id,
      // Efeito privado grava um rótulo NEUTRO: o nome secreto não existe em
      // nenhum DTO (nem no de Mestre, que o lê da própria instância do efeito).
      sourceLabel: isPrivate ? 'Efeito' : effect.label,
      sourceEntity: sourceEntityOf(effect),
    },
    effect.createdBy ?? undefined,
  );

  // Uma linha por Condition aplicada (nome mecânico sempre; nome do efeito só
  // quando público). `applied` inclui a Queda derivada de Unconscious.
  for (const instance of applied) {
    if (instance.condition === 'prone') continue;
    logInto(
      state,
      isPrivate ? 'Efeito' : effect.label,
      `${loaded.name} ficou ${CONDITION_LABELS[instance.condition]}${isPrivate ? '' : ` — ${effect.label}`}.`,
    );
  }

  // CONCENTRAÇÃO DO ALVO: ficar Incapacitado encerra a dele. NÃO confundir com
  // o concentrador que criou o efeito (o alvo pode ser outro).
  const derived = deriveConditionEffects(state);
  const endedConcentration =
    state.concentration !== null && derived.incapacitated ? state.concentration : null;
  if (endedConcentration) {
    logInto(
      state,
      'Efeito',
      `${loaded.name} perdeu a concentração em ${endedConcentration.label} ao ficar Incapacitado.`,
    );
    state.concentration = null;
    state.pendingConcentrationSaves = [];
  }

  await saveMechanicalState(loaded, state, db);
  return { endedConcentration };
}

/**
 * Estado de um alvo já carregado DENTRO da transação do chamador.
 *
 * Quem chama (mutação mecânica, Concentração) está no meio da própria escrita
 * desse alvo: se o cleanup relesse e regravasse a linha, a guarda de versão
 * do chamador falharia (409). Nesse caso as Conditions são removidas do MESMO
 * objeto de estado e quem persiste continua sendo o chamador.
 */
export interface EffectConditionTarget {
  entity: MechanicalEntity;
  state: MechanicalState;
}

/**
 * Remove as Conditions de origem dos efeitos informados (identidade: `sourceId`).
 *
 * `items` já traz o alvo de cada efeito (o mesmo efeito aplica em UM alvo).
 * Só toca instâncias com `sourceType = 'effect'` e `sourceId` daquele efeito:
 * Condition manual, outro Effect e `hp-zero` permanecem.
 */
export async function removeEffectConditions(
  items: readonly { id: string; target: MechanicalEntity; conditions: unknown }[],
  db: Prisma.TransactionClient | typeof prisma,
  context?: EffectConditionTarget,
): Promise<void> {
  const withConditions = items.filter((item) => parseEffectConditions(item.conditions).length > 0);
  if (withConditions.length === 0) return;

  // Agrupa por alvo: um lote de carga por alvo, não uma consulta por Condition.
  const byTarget = new Map<string, { target: MechanicalEntity; ids: string[] }>();
  for (const item of withConditions) {
    const key = `${item.target.kind}:${item.target.id}`;
    const entry = byTarget.get(key) ?? { target: item.target, ids: [] };
    entry.ids.push(item.id);
    byTarget.set(key, entry);
  }

  for (const { target, ids } of byTarget.values()) {
    // `loadEntity` canonicaliza (combatente de personagem → ficha). O contexto
    // é comparado já na forma canônica, para não errar por kind/id de origem.
    const loaded = await loadEntity(target, db);
    const inContext =
      context !== undefined &&
      context.entity.kind === loaded.entity.kind &&
      context.entity.id === loaded.entity.id;
    const state = inContext ? context.state : loaded.state;
    const removed = removeConditionInstancesBySource(state, 'effect', ids);
    if (removed.length === 0) continue;
    // Alvo do chamador: ele grava (e incrementa a versão) uma única vez.
    if (inContext) continue;
    await saveMechanicalState(loaded, state, db);
  }
}
