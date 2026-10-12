import { api } from './api';
import type { Character } from './types';
import { newId } from './utils';

/** Features especiais de recuperação de espaços (5.3C). */
export type RecoveryFeatureId = 'arcane-recovery' | 'natural-recovery';

/** Um nível de espaço recuperado e quantos. */
export interface RecoverySlotSelection {
  level: number;
  count: number;
}

/** Resultado de uma Recuperação Arcana/Natural (o servidor é a autoridade). */
export interface RecoverSlotsResult {
  character: Character;
  featureId: RecoveryFeatureId;
  featureName: string;
  /** Orçamento em níveis = ceil(nível da CLASSE / 2). */
  budget: number;
  /** Níveis efetivamente gastos na seleção. */
  spent: number;
  slots: RecoverySlotSelection[];
  version: number;
  replayed: boolean;
}

/**
 * Recuperação Arcana/Natural: roda DENTRO de um Descanso Curto ATIVO. O cliente
 * manda só a INTENÇÃO (quais níveis recuperar); o servidor deriva o orçamento, os
 * máximos/gastos, o limite de nível 5 e consome a feature.
 */
export function recoverSlots(input: {
  sessionId: string;
  featureId: RecoveryFeatureId;
  slots: Record<string, number>;
  expectedVersion: number;
}): Promise<RecoverSlotsResult> {
  return api<RecoverSlotsResult>('/api/characters/me/features/recovery', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/** Resultado do Mestre Místico (Bruxo 20). */
export interface EldritchMasterResult {
  character: Character;
  /** Quantos espaços de Magia de Pacto foram recuperados. */
  restoredSlots: number;
  version: number;
  replayed: boolean;
}

/**
 * Mestre Místico: ação PRÓPRIA (não é Descanso Curto). Recupera só a Magia de
 * Pacto gasta e consome a feature; o servidor valida o nível de Bruxo e o uso.
 */
export function requestEldritchMaster(expectedVersion: number): Promise<EldritchMasterResult> {
  return api<EldritchMasterResult>('/api/characters/me/features/eldritch-master', {
    method: 'POST',
    body: { expectedVersion, operationId: newId() },
  });
}

/** Resultado do uso de um recurso RACIAL limitado (5.3E.1). */
export interface UseRacialFeatureResult {
  character: Character;
  resourceId: string;
  resourceName: string;
  recharge: 'short' | 'long';
  max: number;
  used: number;
  remaining: number;
  version: number;
  replayed: boolean;
}

/**
 * Consome UM uso de um recurso racial limitado: Sopro Dracônico, Resistência
 * Implacável ou os usos diários do Legado Infernal/Magia Drow (5.3E.1).
 *
 * O cliente manda só o id do recurso e a `version` da ficha; o SERVIDOR deriva
 * a posse, o máximo, a recarga e o saldo. NÃO executa dano/save/magia nesta
 * fase — apenas marca o uso.
 */
export function useRacialFeature(
  resourceId: string,
  expectedVersion: number,
): Promise<UseRacialFeatureResult> {
  return api<UseRacialFeatureResult>('/api/characters/me/racial-features/use', {
    method: 'POST',
    body: { resourceId, expectedVersion, operationId: newId() },
  });
}

/** Resultado de ligar/desligar uma característica (o servidor é a autoridade). */
export interface FeatureToggleResult {
  character: Character;
  toggleId: string;
  /** Estado FINAL da característica. */
  active: boolean;
  /** Custo efetivamente cobrado (0 quando desligou ou não mudou nada). */
  cost: number;
  /** Recurso consumido pela característica (nulo quando não há). */
  resourceId: string | null;
  /** `false` quando o pedido foi um no-op idempotente (já estava no estado). */
  changed: boolean;
}

/**
 * Liga/desliga uma CARACTERÍSTICA com toggle.
 *
 * O cliente NÃO calcula o custo nem é autoridade sobre `used`/`active`: manda só
 * o id do toggle, o estado desejado e a `version` da ficha. O servidor deriva a
 * característica das classes atuais, cobra o `cost` do catálogo, valida o saldo
 * e devolve a ficha atualizada — que passa a ser a fonte de verdade na tela.
 */
export async function toggleFeature(
  toggleId: string,
  active: boolean,
  expectedVersion: number,
): Promise<FeatureToggleResult> {
  return api<FeatureToggleResult>('/api/characters/me/features/toggle', {
    method: 'POST',
    body: { toggleId, active, expectedVersion },
  });
}
