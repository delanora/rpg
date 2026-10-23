import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mechanicalStateOf, type ConditionInstance, type MechanicalState } from './conditions.js';

/**
 * Ciclo de vida de MORTE (Fase 6.3) — regras PURAS do PHB 2014.
 *
 * DECISÃO DE PROJETO central desta fase: **o sistema NÃO tem autoridade final
 * para declarar morte**. Ele determina "pelas regras, esta criatura morreria"
 * (`pending`) e o MESTRE escolhe o desfecho. Isso vale para morte instantânea,
 * para as três falhas em Death Saves, para NPCs e para criaturas.
 *
 * Por isso `dead` SÓ é gravado por decisão explícita do Mestre. Nenhuma regra
 * deste arquivo escreve `dead = true`.
 *
 * `deathState` é um estado PRÓPRIO (JSONB dedicado em `Character` e
 * `Combatant`), nunca em `classState`, `racialState`, `turnEconomy` ou numa
 * instância genérica de condição.
 *
 * Fonte de verdade do ciclo:
 * • `successes` / `failures` — contadores 0..3 dos Testes contra a Morte;
 * • `stabilized` — 3 sucessos (ou estabilização assistida): 0 PV, sem novas
 *   rolagens, ainda Inconsciente, vivo;
 * • `dead` — SÓ por confirmação do Mestre;
 * • `deathSaves` — a criatura está NO fluxo de Death Saves (personagens entram
 *   ao cair a 0 PV; criaturas só quando o Mestre escolhe "Rodar Death Saves");
 * • `pending` — DECISÃO PENDENTE do Mestre (morte instantânea, 3 falhas, 0 PV
 *   de NPC/criatura, Exaustão 6);
 * • `relentless` — oferta pendente da Resistência Implacável (Meio-Orc);
 * • `saveTurnKey` — turno do último Teste contra a Morte (uma rolagem por turno).
 */

/** Sufixo de `sourceType` das instâncias de Inconsciência causadas por 0 PV. */
export const HP_ZERO_SOURCE = 'hp-zero';

/**
 * Rótulo da Queda DERIVADA da inconsciência por 0 PV. É o marcador que a visão
 * do jogador usa para filtrar essa Queda sem esconder uma Queda independente
 * (empurrão, queda de cavalo...).
 */
export const HP_ZERO_PRONE_LABEL = 'Queda por inconsciência';

/** Instâncias que o ciclo de morte pode remover (só as de 0 PV, nunca outras). */
const HP_ZERO_SOURCE_TYPE = HP_ZERO_SOURCE;

export const deathPendingSchema = z.object({
  id: z.string().min(1),
  /** O que disparou a decisão: morte instantânea, 3 falhas, 0 PV de NPC ou Exaustão 6. */
  kind: z.enum(['instant-death', 'failures', 'npc-zero', 'exhaustion']),
  /** Explicação legível do que as regras indicaram. */
  reason: z.string().max(300).default(''),
  createdAt: z.string(),
  /** Aritmética da morte instantânea (auditoria do Mestre). */
  cause: z
    .object({ damage: z.number(), remaining: z.number(), hpMax: z.number() })
    .nullable()
    .default(null),
});
export type DeathPending = z.infer<typeof deathPendingSchema>;

/** Oferta pendente da Resistência Implacável (Meio-Orc, PHB 2014 p. 41). */
export const relentlessOfferSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  createdAt: z.string(),
});
export type RelentlessOffer = z.infer<typeof relentlessOfferSchema>;

export const deathStateSchema = z.object({
  successes: z.number().int().min(0).max(3).default(0),
  failures: z.number().int().min(0).max(3).default(0),
  stabilized: z.boolean().default(false),
  dead: z.boolean().default(false),
  /** Criaturas só entram no fluxo de Death Saves com decisão do Mestre. */
  deathSaves: z.boolean().default(false),
  pending: deathPendingSchema.nullable().default(null),
  relentless: relentlessOfferSchema.nullable().default(null),
  saveTurnKey: z.string().max(200).nullable().default(null),
  log: z
    .array(
      z.object({
        id: z.string(),
        actorName: z.string(),
        message: z.string(),
        at: z.string(),
      }),
    )
    .max(100)
    .default([]),
});
export type DeathState = z.infer<typeof deathStateSchema>;

/**
 * Normaliza o `deathState` do JSONB: campos ausentes ganham os padrões e
 * chaves desconhecidas são descartadas (mesma convenção de `mechanicalStateOf`
 * na 6.2).
 */
export function deathStateOf(value: unknown): DeathState {
  return deathStateSchema.parse(value ?? {});
}

export function emptyDeathState(): DeathState {
  return deathStateOf({});
}

/** Registra uma linha no log do ciclo de morte (mantém as 100 últimas). */
export function logDeath(state: DeathState, actorName: string, message: string): void {
  state.log = [
    ...state.log,
    { id: randomUUID(), actorName, message, at: new Date().toISOString() },
  ].slice(-100);
}

/**
 * O ciclo de morte está ATIVO? (contadores, estabilização, decisão pendente,
 * oferta da Resistência Implacável ou fluxo de Death Saves).
 */
export function hasDeathLifecycle(state: DeathState): boolean {
  return (
    state.successes > 0 ||
    state.failures > 0 ||
    state.stabilized ||
    state.deathSaves ||
    state.pending !== null ||
    state.relentless !== null
  );
}

/**
 * O estado de morte IMPEDE agir? (morto, decisão pendente do Mestre, oferta da
 * Resistência Implacável aguardando resposta ou 0 PV no fluxo de Testes contra
 * a Morte). Integra com a 6.1: o combatente não gasta Ação/Ação Bônus/Reação/
 * Movimento — no turno de Teste contra a Morte o recurso do turno é a rolagem.
 *
 * `stabilized` NÃO bloqueia por si só: estabilizado já sai do fluxo
 * (`deathSaves = false`) e continua Inconsciente pelos efeitos da 6.2.
 */
export function deathBlocksActions(state: DeathState): boolean {
  return state.dead || state.pending !== null || state.relentless !== null || state.deathSaves;
}

/** Fecha o ciclo (cura, "1 PV" narrativo, reinício do ciclo). NUNCA ressuscita. */
export function clearDeathLifecycle(state: DeathState): DeathState {
  state.successes = 0;
  state.failures = 0;
  state.stabilized = false;
  state.deathSaves = false;
  state.pending = null;
  state.relentless = null;
  state.saveTurnKey = null;
  return state;
}

/**
 * A criatura PRECISA rolar o Teste contra a Morte DESTE turno antes de
 * encerrá-lo? (PHB 2014: o Teste acontece no início do turno de quem está a
 * 0 PV.) Serve ao bloqueio do "Encerrar turno" do jogador e à confirmação do
 * Mestre; `saveTurnKey` é a fonte de verdade persistida no servidor.
 */
export function deathSaveRequiredThisTurn(
  state: DeathState,
  currentTurnKey: string | null,
): boolean {
  if (!currentTurnKey) return false;
  if (state.dead || state.pending !== null || state.relentless !== null) return false;
  if (state.stabilized || !state.deathSaves) return false;
  return state.saveTurnKey !== currentTurnKey;
}

/**
 * ESTABILIZAÇÃO (PHB 2014): 0 PV, vivo, Inconsciente, sem novos Testes contra a
 * Morte e com os contadores ZERADOS (o ciclo acabou). A Queda NÃO é removida —
 * a criatura continua Caída até levantar-se; a Inconsciência sai só com cura.
 *
 * Chamado por 3 caminhos que devem dar o MESMO estado:
 *  • 3 sucessos no Teste contra a Morte;
 *  • Medicina CD 10 de outra criatura;
 *  • decisão do Mestre ("Deixar estabilizado").
 */
export function stabilizeDeathLifecycle(state: DeathState): DeathState {
  state.successes = 0;
  state.failures = 0;
  state.stabilized = true;
  state.deathSaves = false;
  state.pending = null;
  state.relentless = null;
  state.saveTurnKey = null;
  return state;
}

/** Resultado de UM Teste contra a Morte (PHB 2014). */
export interface DeathSaveOutcome {
  /** Sucessos somados por esta rolagem (0, 1 ou 2). */
  successes: number;
  /** Falhas somadas por esta rolagem (0, 1 ou 2). */
  failures: number;
  /** 20 natural: o personagem volta com 1 PV e o ciclo é limpo. */
  revived: boolean;
  naturalOne: boolean;
  naturalTwenty: boolean;
}

/**
 * Teste contra a Morte (PHB 2014, p. 197):
 * • 10–20 → 1 sucesso;
 * • 2–9 → 1 falha;
 * • 1 natural → 2 falhas;
 * • 20 natural → 1 PV e o ciclo é limpo.
 * Nenhum modificador comum se aplica (só características específicas futuras).
 */
export function deathSaveOutcome(value: number): DeathSaveOutcome {
  if (value === 20) {
    return { successes: 0, failures: 0, revived: true, naturalOne: false, naturalTwenty: true };
  }
  if (value === 1) {
    return { successes: 0, failures: 2, revived: false, naturalOne: true, naturalTwenty: false };
  }
  if (value >= 10) {
    return { successes: 1, failures: 0, revived: false, naturalOne: false, naturalTwenty: false };
  }
  return { successes: 0, failures: 1, revived: false, naturalOne: false, naturalTwenty: false };
}

/** Aritmética do dano que chega ao PV atual, já descontados os PV temporários. */
export interface DamageBreakdown {
  /** Dano que realmente tocou os PV atuais (PV temporários absorvem antes). */
  toHp: number;
  hpBefore: number;
  hpAfter: number;
  /** Dano que "sobra" depois de derrubar a criatura a 0 PV. */
  remaining: number;
  /** PV máximo EFETIVO (com Exaustão 4+, por exemplo). */
  maxHp: number;
  /**
   * Morte instantânea (PHB 2014, p. 197): dano restante >= PV máximo. Isto NÃO
   * mata: abre uma decisão do Mestre.
   */
  instantDeath: boolean;
}

/** Calcula o dano restante e se as regras indicariam morte instantânea. */
export function damageBreakdown(input: {
  hpBefore: number;
  toHp: number;
  maxHp: number;
}): DamageBreakdown {
  const hpBefore = Math.max(0, input.hpBefore);
  const toHp = Math.max(0, input.toHp);
  const hpAfter = Math.max(0, hpBefore - toHp);
  const remaining = Math.max(0, toHp - hpBefore);
  return {
    toHp,
    hpBefore,
    hpAfter,
    remaining,
    maxHp: Math.max(0, input.maxHp),
    instantDeath: hpAfter === 0 && toHp > 0 && remaining >= Math.max(0, input.maxHp),
  };
}

/** Remove do estado mecânico SÓ a Inconsciência causada por 0 PV. */
export function removeHpZeroUnconscious(value: unknown): { state: MechanicalState; removed: boolean } {
  const state = mechanicalStateOf(value);
  const before = state.conditions.length;
  state.conditions = state.conditions.filter(
    (instance) => !(instance.condition === 'unconscious' && instance.sourceType === HP_ZERO_SOURCE_TYPE),
  );
  return { state, removed: state.conditions.length !== before };
}

/**
 * Aplica Inconsciente (e a Queda derivada, com a MESMA semântica da 6.2) por
 * estar a 0 PV. Idempotente: não duplica a fonte nem a Queda.
 */
export function addHpZeroUnconscious(value: unknown): { state: MechanicalState; added: boolean } {
  const state = mechanicalStateOf(value);
  const already = state.conditions.some(
    (instance) => instance.condition === 'unconscious' && instance.sourceType === HP_ZERO_SOURCE_TYPE,
  );
  if (already) return { state, added: false };

  const at = new Date().toISOString();
  const instance: ConditionInstance = {
    id: randomUUID(),
    condition: 'unconscious',
    sourceType: HP_ZERO_SOURCE_TYPE,
    sourceId: HP_ZERO_SOURCE_TYPE,
    sourceLabel: '0 pontos de vida',
    appliedAt: at,
  };
  state.conditions = [...state.conditions, instance];
  // Queda é postura física independente: continua caído depois de acordar.
  if (!state.conditions.some((item) => item.condition === 'prone')) {
    state.conditions = [
      ...state.conditions,
      {
        id: randomUUID(),
        condition: 'prone',
        sourceType: 'posture',
        sourceLabel: HP_ZERO_PRONE_LABEL,
        appliedAt: at,
      },
    ];
  }
  return { state, added: true };
}

/** Chave do turno (combate + rodada + posição) para a trava "1 rolagem por turno". */
export function turnKey(combatId: string, round: number, index: number): string {
  return `${combatId}:${round}:${index}`;
}

/** Texto humano da decisão pendente (aparece para o Mestre). */
export function pendingReasonLabel(pending: DeathPending): string {
  if (pending.kind === 'instant-death') return 'Morte instantânea segundo o PHB 2014';
  if (pending.kind === 'failures') return 'Três falhas em Testes contra a Morte';
  if (pending.kind === 'exhaustion') return 'Exaustão nível 6: as regras indicam morte';
  return 'Criatura/NPC chegou a 0 PV';
}
