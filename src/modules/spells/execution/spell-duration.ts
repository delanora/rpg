/**
 * FASE 6.6H — DURAÇÃO ESTRUTURADA E CLOCK DE COMBATE.
 *
 * Regras PHB 2014 que este módulo implementa (sem I/O):
 *  • a duração é um DADO TIPADO do catálogo/execução, nunca parseada do texto
 *    da magia ("Concentration, up to 1 minute" não é fonte de regra);
 *  • em combate o relógio é de ROUNDS de D&D (1 round ≈ 6 segundos), nunca
 *    segundos reais: 1 minuto = 10 rounds, 1 hora = 600 rounds;
 *  • o relógio é DERIVADO do `Combat.round`/`turnSequence` persistidos, não de
 *    `setTimeout`/`setInterval`/wall clock — pause, lag, refresh e restart não
 *    alteram a contagem;
 *  • a duração começa no COMMIT (o cast grava o snapshot), não quando o Effect
 *    nasce depois da resolution barrier.
 *
 * FRONTEIRA DE EXPIRAÇÃO (decisão de representação documentada): o sistema não
 * modela um sub-instante dentro da Action do conjurador. Uma magia com duração
 * N rounds expira ao INÍCIO da ativação do `anchorCombatantId` no round
 * `startedRoundNumber + N` — ou seja, 10 rounds completos transcorridos. Se o
 * anchor não puder mais receber turno naquele round (morto/removido/inelegível),
 * a expiração acontece na PRIMEIRA ativação real daquele round, para a duração
 * nunca ficar eterna.
 */

export type SpellDurationUnit = 'round' | 'minute' | 'hour';

/** Definição estruturada de duração (não é string, não é Concentração). */
export interface SpellDurationDefinition {
  kind: 'timed';
  amount: number;
  unit: SpellDurationUnit;
}

/** Âncora de combate do cast — persistida no COMMIT e imutável. */
export interface CombatDurationAnchor {
  combatId: string;
  /** Combatente cujo turno estava ativo quando a magia foi committed. */
  anchorCombatantId: string;
  startedRoundNumber: number;
  startedTurnSequence: number;
  /** Duração já convertida para rounds de D&D. */
  rounds: number;
  /** `startedRoundNumber + rounds` — onde a duração vence. */
  dueRoundNumber: number;
}

/**
 * Snapshot persistido no `SpellCast` e COPIADO para cada `EffectInstance`.
 *
 * `tracking: 'manual'` é o modo de fora de combate: o projeto ainda não tem
 * world-time engine, então não existe countdown real — o Mestre acompanha o
 * tempo narrativo e encerra a duração manualmente.
 */
export interface SpellDurationSnapshot {
  definition: SpellDurationDefinition;
  tracking: 'combat' | 'manual';
  combat: CombatDurationAnchor | null;
}

/** Clock mínimo de combate necessário para decidir expiração. */
export interface CombatClock {
  roundNumber: number;
  /** Combatente cuja ativação está começando/acontecendo. */
  currentCombatantId: string | null;
}

const UNITS_PER_ROUND: Record<SpellDurationUnit, number> = {
  round: 1,
  minute: 10,
  hour: 600,
};

/** 1 round ≈ 6 s (PHB 2014): converte a duração para rounds de combate. */
export function durationToCombatRounds(definition: SpellDurationDefinition): number {
  const perUnit = UNITS_PER_ROUND[definition.unit];
  if (!perUnit) return 0;
  return Math.max(0, Math.floor(definition.amount)) * perUnit;
}

/** Rótulo humano ("1 minuto", "10 rounds"). Nunca decide regra. */
export function durationLabel(definition: SpellDurationDefinition): string {
  const units: Record<SpellDurationUnit, [string, string]> = {
    round: ['round', 'rounds'],
    minute: ['minuto', 'minutos'],
    hour: ['hora', 'horas'],
  };
  const [singular, plural] = units[definition.unit];
  return `${definition.amount} ${definition.amount === 1 ? singular : plural}`;
}

/** Número do round em que a duração vence (N rounds completos transcorridos). */
export function dueRoundNumber(startedRoundNumber: number, rounds: number): number {
  return startedRoundNumber + Math.max(0, rounds);
}

/**
 * Rounds RESTANTES para a UI. É leitura pura: NUNCA autoridade de expiração
 * (quem decide é `isDurationDue`, chamado pelo processador do servidor).
 */
export function remainingCombatRounds(
  snapshot: SpellDurationSnapshot,
  clock: Pick<CombatClock, 'roundNumber'>,
): number | null {
  const anchor = snapshot.combat;
  if (snapshot.tracking !== 'combat' || !anchor) return null;
  const elapsed = Math.max(0, clock.roundNumber - anchor.startedRoundNumber);
  return Math.max(0, anchor.rounds - elapsed);
}

/**
 * A duração venceu nesta posição do clock?
 *
 * `anchorEligible` diz se o anchor ainda pode receber uma ativação válida
 * naquele round (vivo, na iniciativa). O chamador resolve isso com a MESMA
 * regra de turno do combate — este módulo não conhece combatentes.
 */
export function isDurationDue(
  snapshot: SpellDurationSnapshot,
  clock: CombatClock,
  anchorEligible: boolean,
): boolean {
  const anchor = snapshot.combat;
  if (snapshot.tracking !== 'combat' || !anchor) return false;
  if (clock.roundNumber < anchor.dueRoundNumber) return false;
  // Passou do round devido: venceu, independentemente do anchor.
  if (clock.roundNumber > anchor.dueRoundNumber) return true;
  // No round devido, o anchor ilegível não segura a magia até o fim do round.
  if (!anchorEligible) return true;
  // Fronteira determinística: expira no INÍCIO da ativação do anchor.
  return clock.currentCombatantId === anchor.anchorCombatantId;
}

function isUnit(value: unknown): value is SpellDurationUnit {
  return value === 'round' || value === 'minute' || value === 'hour';
}

function parseDefinition(value: unknown): SpellDurationDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { kind?: unknown; amount?: unknown; unit?: unknown };
  if (item.kind !== 'timed') return null;
  if (typeof item.amount !== 'number' || !Number.isFinite(item.amount)) return null;
  if (!isUnit(item.unit)) return null;
  return { kind: 'timed', amount: Math.max(0, Math.floor(item.amount)), unit: item.unit };
}

function parseAnchor(value: unknown): CombatDurationAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const number = (key: string): number | null =>
    typeof item[key] === 'number' && Number.isFinite(item[key]) ? (item[key] as number) : null;
  const combatId = typeof item.combatId === 'string' ? item.combatId : null;
  const anchorCombatantId = typeof item.anchorCombatantId === 'string' ? item.anchorCombatantId : null;
  const startedRoundNumber = number('startedRoundNumber');
  const startedTurnSequence = number('startedTurnSequence');
  const rounds = number('rounds');
  const due = number('dueRoundNumber');
  if (
    !combatId ||
    !anchorCombatantId ||
    startedRoundNumber === null ||
    startedTurnSequence === null ||
    rounds === null ||
    due === null
  ) {
    return null;
  }
  return {
    combatId,
    anchorCombatantId,
    startedRoundNumber,
    startedTurnSequence,
    rounds,
    dueRoundNumber: due,
  };
}

/**
 * Leitura DEFENSIVA do JSONB: dado corrompido vira `null` (efeito sem duração
 * automática) em vez de "ganhar" uma expiração inventada.
 */
export function parseDurationSnapshot(value: unknown): SpellDurationSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const definition = parseDefinition(item.definition);
  if (!definition) return null;
  const combat = parseAnchor(item.combat);
  const tracking = item.tracking === 'combat' && combat ? 'combat' : 'manual';
  return { definition, tracking, combat: tracking === 'combat' ? combat : null };
}

/** Snapshot do COMMIT: em combate ancora no clock; fora, acompanhamento manual. */
export function buildDurationSnapshot(input: {
  definition: SpellDurationDefinition;
  combat: {
    combatId: string;
    anchorCombatantId: string;
    roundNumber: number;
    turnSequence: number;
  } | null;
}): SpellDurationSnapshot {
  if (!input.combat) {
    return { definition: input.definition, tracking: 'manual', combat: null };
  }
  const rounds = durationToCombatRounds(input.definition);
  return {
    definition: input.definition,
    tracking: 'combat',
    combat: {
      combatId: input.combat.combatId,
      anchorCombatantId: input.combat.anchorCombatantId,
      startedRoundNumber: input.combat.roundNumber,
      startedTurnSequence: input.combat.turnSequence,
      rounds,
      dueRoundNumber: dueRoundNumber(input.combat.roundNumber, rounds),
    },
  };
}

/** Resumo sanitizado para DTO/UI (nunca expõe ids internos do combate). */
export function durationSummary(
  snapshot: SpellDurationSnapshot,
  clock: Pick<CombatClock, 'roundNumber'> | null,
): {
  label: string;
  unit: SpellDurationUnit;
  amount: number;
  tracking: 'combat' | 'manual';
  totalRounds: number | null;
  remainingRounds: number | null;
  dueRoundNumber: number | null;
} {
  const totalRounds = snapshot.combat?.rounds ?? null;
  return {
    label:
      snapshot.tracking === 'combat'
        ? `${durationLabel(snapshot.definition)} (${totalRounds ?? 0} rounds)`
        : `${durationLabel(snapshot.definition)} — acompanhamento manual`,
    unit: snapshot.definition.unit,
    amount: snapshot.definition.amount,
    tracking: snapshot.tracking,
    totalRounds,
    remainingRounds: clock ? remainingCombatRounds(snapshot, clock) : null,
    dueRoundNumber: snapshot.combat?.dueRoundNumber ?? null,
  };
}
