import { api } from './api';
import type {
  DeathDecision,
  DeathDto,
  DeathOverrideAction,
  DiceRollDto,
  MechanicalEntity,
} from './types';
import { newId } from './utils';

/**
 * Ciclo de MORTE (Fase 6.3) — o cliente manda apenas a INTENÇÃO.
 *
 * Quem decide a morte é o Mestre (`resolve`/`override`), e quem rola o Teste
 * contra a Morte é o SERVIDOR (a bandeja só anima o resultado). A versão
 * esperada protege contra duas abas decidindo ao mesmo tempo.
 */

/** Leitura do ciclo de morte (Mestre ou dono). */
export function fetchDeath(entity: MechanicalEntity): Promise<DeathDto> {
  return api<{ death: DeathDto }>(`/api/death/${entity.kind}/${entity.id}`).then(
    (response) => response.death,
  );
}

/**
 * Decisões de morte em aberto (só Mestre). Usado no RECONNECT: o evento
 * `death:updated` não sobrevive a um refresh, então o painel recupera daqui as
 * pendências e reabre o modal sem esperar um novo evento.
 */
export function fetchPendingDeaths(): Promise<DeathDto[]> {
  return api<{ deaths: DeathDto[] }>('/api/death/pending').then((response) => response.deaths);
}

/** Decisão do Mestre sobre a morte pendente. */
export function resolveDeath(input: {
  entity: MechanicalEntity;
  decision: DeathDecision;
  expectedVersion: number;
}): Promise<{ death: DeathDto; replayed: boolean }> {
  return api<{ death: DeathDto; replayed: boolean }>('/api/death/resolve', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/** Override administrativo explícito do Mestre (tudo logado no servidor). */
export function overrideDeath(input: {
  entity: MechanicalEntity;
  action: DeathOverrideAction;
  expectedVersion: number;
  reason?: string;
}): Promise<{ death: DeathDto; replayed: boolean }> {
  return api<{ death: DeathDto; replayed: boolean }>('/api/death/override', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/** API genérica de estabilização (Medicine/Spare the Dying chegam na 6.6). */
export function stabilizeDeath(input: {
  entity: MechanicalEntity;
  expectedVersion: number;
  reason?: string;
}): Promise<{ death: DeathDto; replayed: boolean }> {
  return api<{ death: DeathDto; replayed: boolean }>('/api/death/stabilize', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/** Resposta do jogador à oferta da Resistência Implacável (Meio-Orc). */
export function answerRelentless(input: {
  entity: MechanicalEntity;
  answer: 'use' | 'decline';
  expectedVersion: number;
}): Promise<{ death: DeathDto; replayed: boolean }> {
  return api<{ death: DeathDto; replayed: boolean }>('/api/death/relentless', {
    method: 'POST',
    body: { ...input, operationId: newId() },
  });
}

/**
 * Rola o Teste contra a Morte de um NPC/criatura pela BANDEJA existente, com
 * audiência restrita aos mestres: o servidor valida, rola o d20 e aplica. O
 * jogador nunca recebe este evento.
 */
export function rollNpcDeathSave(
  entity: MechanicalEntity,
  label = 'Teste contra a Morte',
): Promise<DiceRollDto> {
  return api<{ roll: DiceRollDto }>('/api/dice/roll', {
    method: 'POST',
    body: {
      entity,
      kind: 'death-save',
      label,
      dice: [{ sides: 20 }],
      clientId: newId(),
    },
  }).then((response) => response.roll);
}
