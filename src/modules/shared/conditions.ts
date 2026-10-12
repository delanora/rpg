import { z } from 'zod';
import type { AbilityKey } from './dnd5e.js';
import type { TurnEconomy } from './action-economy.js';
import { exhaustionRuleEnabled } from './exhaustion-flag.js';

export const CONDITION_LABELS = {
  blinded: 'Cego', charmed: 'Enfeitiçado', deafened: 'Surdo', frightened: 'Amedrontado',
  grappled: 'Agarrado', incapacitated: 'Incapacitado', invisible: 'Invisível',
  paralyzed: 'Paralisado', petrified: 'Petrificado', poisoned: 'Envenenado',
  prone: 'Caído', restrained: 'Contido', stunned: 'Atordoado', unconscious: 'Inconsciente',
} as const;
export const conditionSchema = z.enum(Object.keys(CONDITION_LABELS) as [keyof typeof CONDITION_LABELS, ...(keyof typeof CONDITION_LABELS)[]]);
export type Condition = z.infer<typeof conditionSchema>;
export const entitySchema = z.object({ kind: z.enum(['character', 'creature', 'combatant']), id: z.string().min(1) });
export type MechanicalEntity = z.infer<typeof entitySchema>;
export const conditionInstanceSchema = z.object({
  id: z.string().min(1), condition: conditionSchema,
  sourceType: z.string().max(100).optional(), sourceId: z.string().max(128).optional(),
  sourceEntity: entitySchema.optional(), sourceLabel: z.string().max(200).optional(),
  appliedBy: z.string().optional(), appliedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type ConditionInstance = z.infer<typeof conditionInstanceSchema>;
export const mechanicalStateSchema = z.object({
  conditions: z.array(conditionInstanceSchema).max(200).default([]),
  exhaustionLevel: z.number().int().min(0).max(6).default(0),
  log: z.array(z.object({ id: z.string(), message: z.string(), actorName: z.string(), at: z.string() })).max(100).default([]),
});
export type MechanicalState = z.infer<typeof mechanicalStateSchema>;
export function mechanicalStateOf(value: unknown): MechanicalState { return mechanicalStateSchema.parse(value ?? {}); }

/**
 * Nível de Exaustão que a REGRA da mesa considera ATIVO agora.
 *
 * A Exaustão é uma regra OPCIONAL (`GameConfig.exhaustionEnabled`). Com a regra
 * DESLIGADA, o nível persistido continua no estado (nunca é apagado), mas é
 * mecanicamente inerte: aqui ele é lido como 0 por todas as derivações. Usar
 * esta função — em vez de `state.exhaustionLevel` direto — em qualquer leitura
 * mecânica é o que mantém uma única fonte de verdade do valor.
 */
export function effectiveExhaustionLevel(value: unknown): number {
  const state = mechanicalStateOf(value);
  return exhaustionRuleEnabled() ? state.exhaustionLevel : 0;
}

/** PHB 2014: basta UMA fonte de cada lado; quantidades nunca se acumulam. */
export function resolveRollMode(advantages: readonly unknown[], disadvantages: readonly unknown[]) {
  return { advantage: advantages.length > 0 && disadvantages.length === 0, disadvantage: disadvantages.length > 0 && advantages.length === 0 };
}

/** Efeitos equivalentes são derivados: Paralyzed não grava Incapacitated extra. */
export function deriveConditionEffects(value: unknown) {
  const state = mechanicalStateOf(value);
  const active = new Set(state.conditions.map(instance => instance.condition));
  const petrified = active.has('petrified');
  const incapacitated = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'].some(condition => active.has(condition as Condition));
  const prone = active.has('prone') || active.has('unconscious');
  const poisoned = active.has('poisoned') && !petrified;
  // Regra OPCIONAL da mesa: desligada, o nível salvo é INERTE em todo o domínio.
  const exhaustionEnabled = exhaustionRuleEnabled();
  const exhaustionLevel = exhaustionEnabled ? state.exhaustionLevel : 0;
  const speedZero = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'].some(condition => active.has(condition as Condition)) || exhaustionLevel >= 5;
  return {
    /** Falso quando a mesa não usa a regra de Exaustão (a UI esconde o status). */
    exhaustionEnabled,
    exhaustionSummary: [
      exhaustionLevel >= 1 ? 'Desvantagem em testes de habilidade.' : '',
      exhaustionLevel >= 2 ? 'Deslocamento reduzido à metade.' : '',
      exhaustionLevel >= 3 ? 'Desvantagem em ataques e salvaguardas.' : '',
      exhaustionLevel >= 4 ? 'PV máximo reduzido à metade.' : '',
      exhaustionLevel >= 5 ? 'Deslocamento zero.' : '',
      exhaustionLevel === 6 ? 'Exaustão fatal: morte pela regra; resolução assistida pelo Mestre.' : '',
    ].filter(Boolean),
    assistedNotes: [
      active.has('frightened') ? 'Amedrontado: linha de visão da fonte e aproximação são resolvidas pelo Mestre; não há posição/visibilidade modeladas.' : '',
      prone || active.has('paralyzed') || active.has('unconscious') ? 'Modificadores que dependem de distância de 1,5 m (5 pés) aguardam distância confiável.' : '',
      active.has('unconscious') ? 'Inconsciente: larga objetos segurados; colocação/manuseio no chão são resolvidos manualmente pelo Mestre. O inventário não é movido.' : '',
      active.has('charmed') && !state.conditions.some(instance => instance.condition === 'charmed' && instance.sourceEntity) ? 'Enfeitiçado: origem não vinculada; restrição contra o enfeitiçador permanece assistida.' : '',
    ].filter(Boolean),
    labels: CONDITION_LABELS, active: [...active], incapacitated, canAct: !incapacitated, canReact: !incapacitated,
    canBonusAct: !incapacitated, speedZero, speedMultiplier: exhaustionLevel >= 2 ? 0.5 : 1,
    prone, movementCostMultiplier: prone ? 2 : 1,
    attackAdvantages: active.has('invisible') ? ['invisible'] : [],
    attackDisadvantages: [active.has('blinded') ? 'blinded' : '', poisoned ? 'poisoned' : '', prone ? 'prone' : '', active.has('restrained') ? 'restrained' : '', exhaustionLevel >= 3 ? 'exhaustion' : ''].filter(Boolean),
    attacksAgainstAdvantages: ['blinded', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'].filter(condition => active.has(condition as Condition)),
    attacksAgainstDisadvantages: active.has('invisible') ? ['invisible'] : [],
    autoFailSaves: ['paralyzed', 'petrified', 'stunned', 'unconscious'].some(condition => active.has(condition as Condition)) ? ['strength', 'dexterity'] as AbilityKey[] : [],
    dexSaveDisadvantage: active.has('restrained'), saveDisadvantage: exhaustionLevel >= 3,
    checkDisadvantage: poisoned || exhaustionLevel >= 1,
    sightChecksAutoFail: active.has('blinded'), hearingChecksAutoFail: active.has('deafened'),
    socialAdvantageSources: state.conditions.filter(instance => instance.condition === 'charmed').flatMap(instance => instance.sourceEntity ? [instance.sourceEntity] : []),
    charmers: state.conditions.filter(instance => instance.condition === 'charmed').flatMap(instance => instance.sourceEntity ? [instance.sourceEntity] : []),
    fearSources: state.conditions.filter(instance => instance.condition === 'frightened').map(instance => ({ source: instance.sourceEntity, label: instance.sourceLabel })),
    fearRequiresLineOfSight: active.has('frightened'), fearPreventsApproaching: active.has('frightened'),
    proximityCritical: active.has('paralyzed') || active.has('unconscious'), proneTargetRequiresDistance: prone,
    allDamageResistance: petrified, poisonImmune: petrified, diseaseImmune: petrified,
    poisonSuspended: petrified && active.has('poisoned'), agingSuspended: petrified, weightMultiplier: petrified ? 10 : 1,
    cannotSpeak: active.has('paralyzed') || petrified || active.has('unconscious'),
    hesitantSpeech: active.has('stunned'), unawareSurroundings: petrified || active.has('unconscious'),
    dropsHeldObjects: active.has('unconscious'), hpMaxMultiplier: exhaustionLevel >= 4 ? 0.5 : 1,
    fatalByExhaustion: exhaustionLevel === 6,
  };
}
export type ConditionEffects = ReturnType<typeof deriveConditionEffects>;

export function effectiveSpeed(base: number, value: unknown): number {
  const effects = deriveConditionEffects(value);
  return effects.speedZero ? 0 : Math.max(0, base * effects.speedMultiplier);
}
export function effectiveMaxHp(base: number, value: unknown): number {
  return Math.max(0, Math.floor(base * deriveConditionEffects(value).hpMaxMultiplier));
}

/** Mantém orçamento nominal e gasto real; remover condição não cria movimento novo. */
export function reconcileMovement(state: TurnEconomy, baseSpeed: number, speed: number): TurnEconomy {
  const ratio = baseSpeed > 0 ? Math.min(1, speed / baseSpeed) : 0;
  return { ...state, movementBudget: Math.max(state.movementUsed, speed <= 0 ? state.movementUsed : (state.movementOverrideBudget ?? state.movementBudget * ratio)) };
}

/** Atributo canônico, sem interpretar rótulo livre do cliente. */
export function deriveSaveEffects(value: unknown, ability: AbilityKey, advantages: readonly unknown[] = [], disadvantages: readonly unknown[] = []) {
  const effects = deriveConditionEffects(value);
  return {
    autoFail: effects.autoFailSaves.includes(ability),
    ...resolveRollMode(advantages, [...disadvantages, ...(effects.saveDisadvantage || (ability === 'dexterity' && effects.dexSaveDisadvantage) ? ['conditions'] : [])]),
  };
}

export function conditionAttackMode(attacker: unknown, target: unknown, advantage: boolean, disadvantage: boolean) {
  const own = deriveConditionEffects(attacker), other = deriveConditionEffects(target);
  return resolveRollMode(
    [...own.attackAdvantages, ...other.attacksAgainstAdvantages, ...(advantage ? ['manual'] : [])],
    [...own.attackDisadvantages, ...other.attacksAgainstDisadvantages, ...(disadvantage ? ['manual'] : [])],
  );
}
