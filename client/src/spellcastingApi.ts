import { ApiError, api } from './api';
import type { SpellCastIntentDto, SpellIntentUpdatedPayload } from './types';

/**
 * API de conjuração do jogador (Fases 6.6F / 6.6F.1).
 *
 * Regra de ouro: o cliente manda o MÍNIMO — caster, magia, fonte (quando
 * ambígua), espaço escolhido, alvos e `operationId`. CD, atributo, proficiência,
 * nível do cast, alcance, máximo de alvos e custo de Ação são DERIVADOS no
 * servidor. Nada disso é enviado daqui.
 */

/* -------------------------------------------------------------------------- */
/* Repertório (ACTIVE × PLANEJADO)                                             */
/* -------------------------------------------------------------------------- */

export interface RepertoireEntry {
  spellId: string;
  name: string;
  level: number;
  availabilityKind: string;
  executable: boolean;
  active: boolean;
  planned: boolean;
  recorded: boolean;
  known: boolean;
  alwaysPrepared: boolean;
}

export interface RepertoireSource {
  source: { kind: string; id: string; label: string; ability: string | null };
  mode: string;
  modeLabel: string;
  maxSpellLevel: number;
  manualLimit: number | null;
  activeCount: number;
  plannedCount: number;
  hasPlan: boolean;
  /** Plano diferente do ACTIVE: vale depois do próximo Descanso Longo válido. */
  planPending: boolean;
  entries: RepertoireEntry[];
  candidates: { spellId: string; name: string; level: number }[];
}

export interface CharacterRepertoire {
  characterId: string;
  version: number;
  sources: RepertoireSource[];
}

export type SpellCastIntent = SpellCastIntentDto;

export async function fetchRepertoire(characterId: string): Promise<CharacterRepertoire> {
  return api<CharacterRepertoire>(`/api/spells/repertoire/${characterId}`);
}

/** Salva SÓ os ids planejados de uma fonte. `expectedVersion` evita sobrescrever duas abas. */
export async function savePreparationPlan(input: {
  characterId: string;
  source: { kind: string; id: string };
  spellIds: string[];
  expectedVersion: number;
}): Promise<CharacterRepertoire> {
  return api<CharacterRepertoire>(
    `/api/spells/preparation-plan/${input.characterId}/${input.source.kind}/${encodeURIComponent(input.source.id)}`,
    {
      method: 'PUT',
      body: { spellIds: input.spellIds, expectedVersion: input.expectedVersion },
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Opções de conjuração (read-only, derivadas no servidor)                     */
/* -------------------------------------------------------------------------- */

export interface CastSourceOption {
  kind: string;
  id: string;
  label: string;
  ability: string | null;
  spellSaveDc: number | null;
  spellAttackBonus: number | null;
}

export interface CastResourceOption {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
  label: string;
  max: number;
  remaining: number;
}

export interface CastTargetingSummary {
  kind: string;
  minTargets: number;
  maxTargets: number;
  castAtLevel: number;
  rangeFeet: number | null;
  allowSelf: boolean;
  requiresSight: boolean;
  requiresClearPath: boolean;
  filters: string[];
  groupConstraints: { kind: string; feet: number }[];
}

export interface CastTargetOption {
  kind: 'character' | 'creature';
  id: string;
  name: string;
  /** Tipo de criatura (personagens do PHB: "Humanoide"); `null` se desconhecido. */
  type: string | null;
  isSelf: boolean;
}

export interface CastOptions {
  spell: { id: string; name: string; level: number; executable: boolean };
  /** Só fontes que AUTORIZAM a magia agora. */
  sources: CastSourceOption[];
  resources: CastResourceOption[];
  /** Máximo de alvos por NÍVEL de espaço — sempre derivado no servidor. */
  targeting: CastTargetingSummary[];
  targets: CastTargetOption[];
  inCombat: boolean;
  pendingIntent: SpellCastIntent | null;
}

/** Opções de conjuração: NÃO cria Intent, NÃO gasta espaço/Ação. */
export async function fetchCastOptions(
  characterId: string,
  spellId: string,
): Promise<CastOptions> {
  return api<CastOptions>(`/api/spells/cast-options/${characterId}/${spellId}`);
}

/* -------------------------------------------------------------------------- */
/* Conjuração real                                                             */
/* -------------------------------------------------------------------------- */

export interface CastRequest {
  operationId: string;
  spellId: string;
  caster: { kind: 'character'; id: string };
  targets: { kind: 'character' | 'creature'; id: string }[];
  spellcastingSource?: { kind: string; id: string };
  castingResource?: { kind: 'spell-slot' | 'pact-slot'; level: number };
}

/** Resultado normalizado do `POST /api/spells/cast`. */
export type CastOutcome =
  | {
      kind: 'cast';
      castId: string;
      effectGroupId: string | null;
      pendingIds: string[];
      replayed: boolean;
    }
  | { kind: 'intent'; intent: SpellCastIntent };

interface RawCastResponse {
  cast?: { id: string };
  effectGroupId?: string | null;
  pendingIds?: string[];
  replayed?: boolean;
  intent?: SpellCastIntent;
}

/**
 * Conjura sem `unknown` espacial → `kind: 'cast'`; com `unknown` → `kind:
 * 'intent'` (202, NADA gasto, aguardando o Mestre).
 */
export async function castSpell(body: CastRequest): Promise<CastOutcome> {
  const raw = await api<RawCastResponse>('/api/spells/cast', { method: 'POST', body });
  if (raw.intent) return { kind: 'intent', intent: raw.intent };
  return {
    kind: 'cast',
    castId: raw.cast?.id ?? '',
    effectGroupId: raw.effectGroupId ?? null,
    pendingIds: raw.pendingIds ?? [],
    replayed: Boolean(raw.replayed),
  };
}

export async function listIntents(): Promise<SpellCastIntent[]> {
  const { intents } = await api<{ intents: SpellCastIntent[] }>('/api/spells/intents');
  return intents;
}

export async function cancelIntent(id: string): Promise<SpellCastIntent> {
  const { intent } = await api<{ intent: SpellCastIntent }>(`/api/spells/intents/${id}/cancel`, {
    method: 'POST',
  });
  return intent;
}

/** Aprovação/negacão são do MESTRE (fila de confirmação espacial). */
export async function approveIntent(
  id: string,
  confirmation: Record<string, boolean>,
): Promise<CastOutcome> {
  const raw = await api<RawCastResponse>(`/api/spells/intents/${id}/approve`, {
    method: 'POST',
    body: { spatialConfirmation: confirmation },
  });
  if (raw.intent) return { kind: 'intent', intent: raw.intent };
  return {
    kind: 'cast',
    castId: raw.cast?.id ?? '',
    effectGroupId: raw.effectGroupId ?? null,
    pendingIds: raw.pendingIds ?? [],
    replayed: Boolean(raw.replayed),
  };
}

export async function denyIntent(id: string, reason?: string): Promise<SpellCastIntent> {
  const { intent } = await api<{ intent: SpellCastIntent }>(`/api/spells/intents/${id}/deny`, {
    method: 'POST',
    body: reason ? { reason } : {},
  });
  return intent;
}

/* -------------------------------------------------------------------------- */
/* Barramento local do evento `spells:intent-updated`                          */
/* -------------------------------------------------------------------------- */

type IntentListener = (intent: SpellCastIntent) => void;
const intentListeners = new Set<IntentListener>();

/** Assina as atualizações de intenção que o `useRealtime` recebe do servidor. */
export function subscribeSpellIntents(listener: IntentListener): () => void {
  intentListeners.add(listener);
  return () => {
    intentListeners.delete(listener);
  };
}

/** Ponte chamada pelo `useRealtime` quando o evento chega (já filtrado no servidor). */
export function publishSpellIntent(payload: SpellIntentUpdatedPayload): void {
  for (const listener of intentListeners) listener(payload.intent);
}

/* -------------------------------------------------------------------------- */
/* Mensagens de erro de domínio                                                */
/* -------------------------------------------------------------------------- */

const CAST_ERROR_MESSAGES: Record<string, string> = {
  SPELL_NOT_AVAILABLE_FROM_SOURCE: 'Esta magia não está disponível pela fonte escolhida.',
  SPELL_NOT_FOUND: 'Magia não encontrada no catálogo.',
  SPELLCASTING_SOURCE_REQUIRED: 'Selecione uma fonte de conjuração.',
  SPELLCASTING_SOURCE_INVALID: 'Fonte de conjuração inválida.',
  SPELLCASTING_SOURCE_NOT_AVAILABLE: 'Este personagem não tem fonte de conjuração utilizável.',
  SPELLCASTING_RESOURCE_REQUIRED: 'Selecione um espaço de magia.',
  SPELLCASTING_RESOURCE_NOT_AVAILABLE:
    'Você não possui mais um espaço válido para esta magia.',
  SPELLCASTING_RESOURCE_INVALID: 'O espaço escolhido não é válido para esta magia.',
  SPELL_ACTION_UNAVAILABLE: 'Sua ação já foi usada neste turno.',
  SPELL_BONUS_ACTION_UNAVAILABLE: 'Sua ação bônus já foi usada neste turno.',
  SPELL_REACTION_NOT_AVAILABLE: 'Ainda não existe janela de reação para conjurar esta magia.',
  SPELL_CAST_OUT_OF_TURN: 'Não é mais o turno deste personagem.',
  SPELL_CASTING_TIME_NOT_IMPLEMENTED: 'Este tempo de conjuração ainda não é suportado.',
  SPELL_TARGET_COUNT_INVALID: 'Quantidade de alvos inválida para este espaço.',
  SPELL_TARGET_TYPE_INVALID: 'Um dos alvos não é válido para esta magia.',
  SPELL_TARGET_NOT_FOUND: 'Um dos alvos não existe mais.',
  SPELL_TARGET_NOT_VISIBLE: 'O servidor não consegue confirmar a visão até um dos alvos.',
  SPELL_TARGET_RANGE_CONFIRMATION_REQUIRED: 'Aguardando confirmação do Mestre.',
  SPELL_CAST_INTENT_PENDING: 'Você já tem uma conjuração aguardando confirmação do Mestre.',
  SPELL_CAST_INTENT_IN_PROGRESS:
    'Você já tem uma conjuração aguardando confirmação do Mestre.',
  SPELL_CAST_IN_PROGRESS: 'Outra conjuração deste personagem está sendo resolvida.',
  SPELL_EXECUTION_NOT_IMPLEMENTED: 'Automação de conjuração ainda não implementada.',
  SPELL_CASTER_FORBIDDEN: 'Você só pode conjurar com o seu próprio personagem.',
  SPELL_SPATIAL_CONFIRMATION_FORBIDDEN: 'Somente o Mestre confirma requisitos espaciais.',
  IDEMPOTENCY_KEY_REUSED: 'Esta tentativa de conjuração já foi usada com outros dados.',
  CONFLICT: 'A ficha mudou durante a operação; recarregue e tente novamente.',
};

/** Traduz o código de domínio em texto compreensível (sem vazar detalhe interno). */
export function castErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && CAST_ERROR_MESSAGES[error.code]) return CAST_ERROR_MESSAGES[error.code];
    return error.message;
  }
  return error instanceof Error ? error.message : 'Não foi possível conjurar agora.';
}
