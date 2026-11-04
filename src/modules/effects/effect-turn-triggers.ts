import { z } from 'zod';
import type { AbilityKey } from '../shared/dnd5e.js';

/**
 * FASE 6.6H — TURN TRIGGERS DO EFEITO CONTÍNUO.
 *
 * Um trigger é COMPORTAMENTO DO EFEITO (declarado na Effect Definition e
 * SNAPSHOTADO na instância), nunca um `if (spellId === 'hold-person')` no
 * `nextTurn`/combat service. A engine só entende: "no fim do turno deste alvo,
 * este efeito oferece esta salvaguarda".
 *
 * PHB 2014 / Hold Person: "At the end of each of its turns, the target can make
 * another Wisdom saving throw." Logo:
 *  • timing `end-of-target-turn`;
 *  • `optional: true` — o texto diz "can": o alvo PODE rolar, recusar não
 *    encerra o efeito e o próximo turno oferece outra oportunidade;
 *  • `dc: 'origin-spell-cast'` — a CD é o SNAPSHOT do `SpellCast` de origem,
 *    nunca recalculada com o atributo atual do conjurador;
 *  • `onSuccess: 'end-effect'` — sucesso encerra SOMENTE aquela instância.
 */

export type TurnTriggerTiming = 'end-of-target-turn' | 'start-of-target-turn';

export interface EffectTurnTriggerDefinition {
  /** Chave estável do trigger dentro da definição (ex.: `repeat-save`). */
  key: string;
  timing: TurnTriggerTiming;
  kind: 'saving-throw';
  ability: AbilityKey;
  /** CD do save: o snapshot do cast de origem ou um valor fixo da definição. */
  dc: { kind: 'origin-spell-cast' } | { kind: 'fixed'; value: number };
  /** `true` = o alvo escolhe rolar ou recusar (nunca auto-rolar). */
  optional: boolean;
  repeat: 'every-turn';
  onSuccess: 'end-effect';
}

export const endOfTargetTurnTriggerSchema = z.object({
  key: z.string().trim().min(1).max(64),
  timing: z.literal('end-of-target-turn'),
  kind: z.literal('saving-throw'),
  ability: z.enum([
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]),
  dc: z.union([
    z.object({ kind: z.literal('origin-spell-cast') }),
    z.object({ kind: z.literal('fixed'), value: z.number().int().min(1).max(30) }),
  ]),
  optional: z.boolean(),
  repeat: z.literal('every-turn'),
  onSuccess: z.literal('end-effect'),
});

const turnTriggerListSchema = z.array(endOfTargetTurnTriggerSchema).max(8);

/**
 * Leitura DEFENSIVA do JSONB da instância: qualquer trigger inválido é
 * DESCARTADO (lista vazia), para dado corrompido nunca inventar salvaguarda.
 */
export function parseTurnTriggers(value: unknown): EffectTurnTriggerDefinition[] {
  const parsed = turnTriggerListSchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data as EffectTurnTriggerDefinition[];
}

/**
 * Identidade PERSISTENTE de UMA ocorrência de trigger.
 *
 * Determinística (combate + ativação + efeito + trigger), nunca timestamp: o
 * mesmo fim de turno gera sempre a mesma string, então o índice único do banco
 * garante no máximo UMA `PendingEffectSave` por ocorrência — inclusive sob
 * retry, duplo clique e concorrência entre processos.
 */
export function turnTriggerOccurrenceId(input: {
  combatId: string;
  turnSequence: number;
  effectInstanceId: string;
  triggerKey: string;
}): string {
  return `combat:${input.combatId}:turn:${input.turnSequence}:effect:${input.effectInstanceId}:trigger:${input.triggerKey}`;
}

/**
 * Ocorrência MANUAL (fora de combate, §93/§94): o Mestre dispara um "fim de
 * turno narrativo". O `operationId` entra na identidade para que o retry devolva
 * a MESMA pendência em vez de criar uma segunda oportunidade.
 */
export function manualTriggerOccurrenceId(input: {
  effectInstanceId: string;
  triggerKey: string;
  operationId: string;
}): string {
  return `manual:${input.effectInstanceId}:trigger:${input.triggerKey}:op:${input.operationId}`;
}

/** Trigger de fim de turno do alvo (o único implementado nesta fase). */
export function endOfTurnTriggers(
  triggers: readonly EffectTurnTriggerDefinition[],
): EffectTurnTriggerDefinition[] {
  return triggers.filter((trigger) => trigger.timing === 'end-of-target-turn');
}
