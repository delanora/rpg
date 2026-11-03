import { z } from 'zod';

/**
 * FASE 6.6C — SPELL SLOTS & CASTING RESOURCES.
 *
 * Um `CastingResource` é o RECURSO GASTO por uma conjuração. Ele é ORTOGONAL à
 * `SpellcastingSource`: a fonte responde "qual matemática de conjuração (CD,
 * ataque, atributo)?"; o recurso responde "qual espaço foi gasto?".
 *
 * Wizard/Bruxo lançando uma magia de Mago com um espaço de Pacto é VÁLIDO — por
 * isso os dois conceitos nunca são acoplados.
 *
 * Pool NORMAL (`spell-slot`): UM pool multiclasse compartilhado por todas as
 * classes que usam a tabela do livro (Wizard + Cleric NÃO têm pools separados).
 * Pool de PACTO (`pact-slot`): separado, do Bruxo, com nível único.
 *
 * A capacidade MÁXIMA é sempre DERIVADA (`spellSlotsForClasses` /
 * `pactMagicSlots`); o estado persistido é só o USO (`Character.spells`). Para
 * criaturas/NPCs, max e uso vivem no statblock e na instância (ver o service).
 */

export const CASTING_RESOURCE_KINDS = ['spell-slot', 'pact-slot'] as const;
export type CastingResourceKind = (typeof CASTING_RESOURCE_KINDS)[number];

/** Origem CONCEITUAL do pool (nunca uma classe isolada no multiclasse). */
export const SPELL_SLOT_SOURCE_ID = 'multiclass-spellcasting';
export const PACT_SLOT_SOURCE_ID = 'warlock-pact';

export const CASTING_RESOURCE_LABELS: Record<CastingResourceKind, (level: number) => string> = {
  'spell-slot': (level) => `Slot ${level}º`,
  'pact-slot': (level) => `Pacto ${level}º`,
};

/** Escolha do cliente: só `kind` + `level`; NUNCA remaining/max/atributo. */
export const castingResourceRefSchema = z.object({
  kind: z.enum(CASTING_RESOURCE_KINDS),
  level: z.number().int().min(1).max(9),
});
export type CastingResourceRef = z.infer<typeof castingResourceRefSchema>;

export interface CastingResource {
  kind: CastingResourceKind;
  /** Nível do espaço (1..9). */
  level: number;
  sourceId: string;
  /** Capacidade DERIVADA naquele momento. */
  max: number;
  /** `max - usado`, nunca negativo. */
  remaining: number;
  /** Rótulo de apresentação ("Slot 2º", "Pacto 3º"). */
  label: string;
}

/** Pools de um personagem (ou statblock) para montar os recursos. */
export interface CastingResourcePools {
  spellSlots: readonly { level: number; max: number }[];
  pactSlots: { max: number; slotLevel: number } | null;
  slotsUsed: Record<string, number>;
  pactUsed: number;
}

function usedOf(value: unknown, max: number): number {
  const parsed = typeof value === 'number' && Number.isInteger(value) ? value : 0;
  return Math.min(Math.max(0, parsed), Math.max(0, max));
}

/**
 * Recursos do caster. Inclui níveis com `remaining = 0` (a UI mostra "0/3"
 * desabilitado); a SELEÇÃO é que recusa espaço vazio.
 */
export function castingResourcesForPools(pools: CastingResourcePools): CastingResource[] {
  const resources: CastingResource[] = [];
  for (const slot of [...pools.spellSlots].sort((a, b) => a.level - b.level)) {
    if (slot.max <= 0) continue;
    const used = usedOf(pools.slotsUsed[String(slot.level)], slot.max);
    resources.push({
      kind: 'spell-slot',
      level: slot.level,
      sourceId: SPELL_SLOT_SOURCE_ID,
      max: slot.max,
      remaining: slot.max - used,
      label: CASTING_RESOURCE_LABELS['spell-slot'](slot.level),
    });
  }
  const pact = pools.pactSlots;
  if (pact && pact.max > 0) {
    const used = usedOf(pools.pactUsed, pact.max);
    resources.push({
      kind: 'pact-slot',
      level: pact.slotLevel,
      sourceId: PACT_SLOT_SOURCE_ID,
      max: pact.max,
      remaining: pact.max - used,
      label: CASTING_RESOURCE_LABELS['pact-slot'](pact.slotLevel),
    });
  }
  return resources;
}

/** Candidatos válidos para uma magia de nível `spellLevel` (> 0). */
export function eligibleCastingResources(
  resources: readonly CastingResource[],
  spellLevel: number,
): CastingResource[] {
  return resources.filter((resource) => resource.level >= spellLevel && resource.remaining > 0);
}

function notAvailable(): never {
  const error = new Error(
    'Este conjurador não possui espaço de magia disponível para esta conjuração.',
  );
  error.name = 'SPELLCASTING_RESOURCE_NOT_AVAILABLE';
  throw error;
}

function required(): never {
  const error = new Error(
    'Este conjurador possui mais de um espaço compatível: informe qual usar.',
  );
  error.name = 'SPELLCASTING_RESOURCE_REQUIRED';
  throw error;
}

function invalid(): never {
  const error = new Error('Espaço de magia inválido para esta conjuração.');
  error.name = 'SPELLCASTING_RESOURCE_INVALID';
  throw error;
}

/**
 * Escolhe o recurso da conjuração.
 *
 *  • magia de nível 0 (truque) → `null`, sem gasto e sem escolha;
 *  • uma única opção válida → automática;
 *  • várias → o request PRECISA dizer qual (nunca "o mais baixo/alto");
 *  • nenhuma com `remaining > 0` → indisponível.
 */
export function selectCastingResource(
  resources: readonly CastingResource[],
  spellLevel: number,
  requested: CastingResourceRef | undefined,
): CastingResource | null {
  if (spellLevel <= 0) {
    if (requested) invalid();
    return null;
  }
  const eligible = eligibleCastingResources(resources, spellLevel);
  if (requested) {
    const match = eligible.find(
      (resource) => resource.kind === requested.kind && resource.level === requested.level,
    );
    if (!match) invalid();
    return match;
  }
  if (eligible.length === 0) notAvailable();
  if (eligible.length > 1) required();
  return eligible[0];
}
