import { api } from './api';

/**
 * API de conjuração do jogador (Fase 6.6F).
 *
 * Regra de ouro desta camada: o cliente manda o MÍNIMO — caster, magia, fonte
 * (quando ambígua), espaço escolhido, alvos e `operationId`. CD, atributo,
 * proficiência, nível do cast, alcance, máximo de alvos e custo de Ação são
 * DERIVADOS no servidor. Nada disso é enviado daqui.
 */

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

export interface SpellCastIntent {
  id: string;
  spellId: string;
  spellName: string;
  status: 'pending' | 'committed' | 'denied' | 'cancelled' | 'invalidated';
  caster: { kind: string; id: string; label: string | null };
  targets: { kind: string; id: string; name: string }[];
  requiredConfirmations: string[];
  createdAt: string;
  resolvedAt: string | null;
  reason: string | null;
  spellCastId: string | null;
}

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

export interface CastRequest {
  operationId: string;
  spellId: string;
  caster: { kind: string; id: string };
  targets: { kind: string; id: string }[];
  spellcastingSource?: { kind: string; id: string };
  castingResource?: { kind: 'spell-slot' | 'pact-slot'; level: number };
}

export type CastResponse =
  | { cast: { id: string }; effectGroupId: string | null; pendingIds: string[]; replayed: boolean }
  | { intent: SpellCastIntent };

/** Conjuração real. Sem `unknown` espacial o cast acontece; com `unknown`, vira intenção. */
export async function castSpell(body: CastRequest): Promise<CastResponse> {
  return api<CastResponse>('/api/spells/cast', { method: 'POST', body });
}

export async function listIntents(): Promise<SpellCastIntent[]> {
  const { intents } = await api<{ intents: SpellCastIntent[] }>('/api/spells/intents');
  return intents;
}

/** Confirmação espacial do Mestre: SÓ os requisitos que o servidor pediu. */
export async function approveIntent(
  id: string,
  confirmation: Record<string, boolean>,
): Promise<CastResponse> {
  return api<CastResponse>(`/api/spells/intents/${id}/approve`, {
    method: 'POST',
    body: { spatialConfirmation: confirmation },
  });
}

export async function denyIntent(id: string, reason?: string): Promise<SpellCastIntent> {
  const { intent } = await api<{ intent: SpellCastIntent }>(`/api/spells/intents/${id}/deny`, {
    method: 'POST',
    body: reason ? { reason } : {},
  });
  return intent;
}

export async function cancelIntent(id: string): Promise<SpellCastIntent> {
  const { intent } = await api<{ intent: SpellCastIntent }>(`/api/spells/intents/${id}/cancel`, {
    method: 'POST',
  });
  return intent;
}
