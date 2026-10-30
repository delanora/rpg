import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import {
  deriveConditionEffects,
  mechanicalStateOf,
  type MechanicalEntity,
  type MechanicalState,
} from '../shared/conditions.js';
import { concentrationDc, type ConcentrationSave } from '../shared/concentration.js';
import { abilityModifier, normalizeSaves, proficiencyBonus } from '../shared/dnd5e.js';
import { getClassDefinition, totalCharacterLevel } from '../shared/classes.js';
import { normalizeClassEntries } from '../shared/classes.js';
import { characterClassAdjustments } from '../characters/characters.dto.js';

/**
 * CONCENTRAÇÃO — o estado já mora em `mechanicalState` (ver `shared/concentration`).
 *
 * Este módulo concentra as DUAS pontas que precisam do mesmo domínio:
 *
 *  • DANO → pendência de teste (uma por evento, nunca sobrescrevendo a anterior);
 *  • TESTE → sucesso mantém, FALHA encerra a concentração e descarta as
 *    pendências da MESMA concentração (save antigo nunca atinge a nova).
 *
 * Ele NÃO publica eventos: quem chama (combate, bandeja de dados) é dono da
 * transação e dos eventos em tempo real, como no resto do projeto.
 */

export interface ConcentrationTarget {
  entity: MechanicalEntity;
  name: string;
  /** Dono da ficha (null em criatura/NPC: estado do Mestre). */
  ownerUserId: string | null;
  kind: 'character' | 'creature' | 'combatant';
  state: MechanicalState;
  version: number;
  combat: { id: string; version: number } | null;
  /** Ação de vida atual (para o save só existir com a criatura de pé). */
  hpCurrent: number;
}

export async function loadConcentrationTarget(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient = prisma,
): Promise<ConcentrationTarget> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const participant = await db.combatant.findFirst({
      where: { characterId: row.id, combat: { status: { in: ['ACTIVE', 'PENDING_INITIATIVE'] } } },
      include: { combat: true },
    });
    return {
      entity,
      name: row.name,
      ownerUserId: row.userId,
      kind: 'character',
      state: mechanicalStateOf(row.mechanicalState),
      version: row.version,
      combat: participant ? { id: participant.combat.id, version: participant.combat.version } : null,
      hpCurrent: row.hpCurrent,
    };
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return {
      entity,
      name: row.name,
      ownerUserId: null,
      kind: 'creature',
      state: mechanicalStateOf(row.mechanicalState),
      version: row.version,
      combat: null,
      hpCurrent: row.hpCurrent,
    };
  }
  const row = await db.combatant.findUnique({ where: { id: entity.id }, include: { combat: true } });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) return loadConcentrationTarget({ kind: 'character', id: row.characterId }, db);
  return {
    entity,
    name: row.name,
    ownerUserId: null,
    kind: 'combatant',
    state: mechanicalStateOf(row.mechanicalState),
    version: row.mechanicalVersion,
    combat: row.combat.status !== 'ENDED' ? { id: row.combat.id, version: row.combat.version } : null,
    hpCurrent: row.hpCurrent ?? 0,
  };
}

/** Grava o estado com trava de versão; chamar DENTRO da transação do evento. */
export async function saveConcentrationState(
  target: ConcentrationTarget,
  state: MechanicalState,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const data = { mechanicalState: state as unknown as Prisma.InputJsonValue };
  const changed =
    target.kind === 'character'
      ? await db.character.updateMany({
          where: { id: target.entity.id, version: target.version },
          data: { ...data, version: { increment: 1 } },
        })
      : target.kind === 'creature'
        ? await db.creature.updateMany({
            where: { id: target.entity.id, version: target.version },
            data: { ...data, version: { increment: 1 } },
          })
        : await db.combatant.updateMany({
            where: { id: target.entity.id, mechanicalVersion: target.version },
            data: { ...data, mechanicalVersion: { increment: 1 } },
          });
  if (!changed.count) throw new HttpError('Estado mecânico mudou. Atualize e tente novamente.', 409, 'CONFLICT');
  target.version += 1;
}

/**
 * Bônus do Teste de Concentração = SALVAGUARDA DE CONSTITUIÇÃO normal.
 *
 * Personagem: modificador de CON + proficiência (classe/feature/talento) +
 * bônus de salvaguarda de features (Aura de Proteção). Criatura: o modificador
 * do statblock. Nada de caminho paralelo: é a MESMA conta da ficha.
 */
export async function concentrationSaveBonus(
  entity: MechanicalEntity,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    const entries = normalizeClassEntries(row.classes);
    const adjustments = characterClassAdjustments(row);
    const locked = [
      ...(entries[0] ? (getClassDefinition(entries[0].classKey)?.savingThrows ?? []) : []),
      ...adjustments.saveProficiencies,
    ];
    const proficient = normalizeSaves(row.saves).constitution || locked.includes('constitution');
    return (
      abilityModifier(row.constitution) +
      (proficient ? proficiencyBonus(totalCharacterLevel(entries)) : 0) +
      adjustments.saveBonus
    );
  }
  const creature =
    entity.kind === 'creature'
      ? await db.creature.findUnique({ where: { id: entity.id } })
      : await db.combatant
          .findUnique({ where: { id: entity.id }, include: { creature: true } })
          .then((row) => row?.creature ?? null);
  if (!creature) throw new HttpError('Criatura não encontrada.', 404);
  return abilityModifier(creature.constitution);
}

/**
 * DANO → PENDÊNCIA de teste de concentração.
 *
 * Regras aplicadas (PHB 2014):
 *  • dano FINAL 0 não gera teste;
 *  • o evento inteiro (todos os componentes) vira UM teste, com o dano total;
 *  • cada evento separado gera a PRÓPRIA pendência (a lista nunca é sobrescrita);
 *  • se o dano deixou a criatura Incapacitada/Inconsciente, a concentração
 *    termina na hora e NÃO se pede teste depois.
 */
export async function noteDamageConcentration(
  entity: MechanicalEntity,
  damage: number,
  db: Prisma.TransactionClient,
  sourceName?: string,
): Promise<{ changed: boolean; ended: boolean; dc: number | null }> {
  const target = await loadConcentrationTarget(entity, db);
  const state = target.state;
  if (!state.concentration) return { changed: false, ended: false, dc: null };

  // Incapacitado (Inconsciente/Paralisado/Atordoado/Petrificado) ou já a 0 PV:
  // a concentração acaba SEM teste — inclusive quando o dano foi morte
  // instantânea e o ciclo de morte ainda aguarda a decisão do Mestre.
  const zeroHp = target.hpCurrent <= 0;
  if (deriveConditionEffects(state).incapacitated || zeroHp) {
    state.log = [
      ...state.log,
      {
        id: randomUUID(),
        actorName: sourceName ?? 'Sistema',
        message: `${target.name} perdeu a concentração em ${state.concentration.label} ao ${zeroHp ? 'chegar a 0 PV' : 'ficar Incapacitado'}.`,
        at: new Date().toISOString(),
      },
    ].slice(-100);
    state.concentration = null;
    state.pendingConcentrationSaves = [];
    await saveConcentrationState(target, state, db);
    return { changed: true, ended: true, dc: null };
  }

  if (damage <= 0) return { changed: false, ended: false, dc: null };

  const dc = concentrationDc(damage);
  const save: ConcentrationSave = {
    id: randomUUID(),
    concentrationId: state.concentration.id,
    dc,
    damage,
    // Id do evento de dano: repúblicações/retries não duplicam o teste.
    eventId: randomUUID(),
    ...(sourceName ? { sourceName } : {}),
    at: new Date().toISOString(),
  };
  state.pendingConcentrationSaves = [...state.pendingConcentrationSaves, save].slice(-20);
  state.log = [
    ...state.log,
    {
      id: randomUUID(),
      actorName: sourceName ?? 'Sistema',
      message: `${target.name} sofreu ${damage} de dano concentrando em ${state.concentration.label}: teste de Constituição CD ${dc} pendente.`,
      at: new Date().toISOString(),
    },
  ].slice(-100);
  await saveConcentrationState(target, state, db);
  return { changed: true, ended: false, dc };
}

/**
 * Resultado do teste de concentração (já rolado pelo pipeline de salvaguarda).
 *
 * `total < CD` encerra a concentração e DESCARTA as pendências da mesma
 * concentração; `total >= CD` só limpa a pendência resolvida. Uma pendência de
 * concentração que não existe mais (substituída/encerrada) é descartada sem
 * tocar na concentração atual.
 */
export async function resolveConcentrationSave(
  entity: MechanicalEntity,
  pendingId: string,
  total: number,
  db: Prisma.TransactionClient = prisma,
  actorName = 'Sistema',
): Promise<{
  name: string;
  pending: ConcentrationSave;
  success: boolean;
  ended: boolean;
  label: string;
  concentrationId: string;
}> {
  const target = await loadConcentrationTarget(entity, db);
  const state = target.state;
  const pending = state.pendingConcentrationSaves.find((item) => item.id === pendingId);
  if (!pending) throw new HttpError('Este teste de concentração não está mais pendente.', 409, 'CONFLICT');

  const concentration = state.concentration;
  const stale = !concentration || concentration.id !== pending.concentrationId;
  const success = total >= pending.dc;
  state.pendingConcentrationSaves = state.pendingConcentrationSaves.filter((item) => item.id !== pending.id);

  if (stale) {
    // Concentração antiga: o teste não pode quebrar a nova.
    state.log = [
      ...state.log,
      {
        id: randomUUID(),
        actorName,
        message: `Teste de concentração antigo (CD ${pending.dc}) descartado: a concentração não está mais ativa.`,
        at: new Date().toISOString(),
      },
    ].slice(-100);
    await saveConcentrationState(target, state, db);
    return { name: target.name, pending, success, ended: false, label: '', concentrationId: pending.concentrationId };
  }

  const label = concentration.label;
  if (!success) {
    state.concentration = null;
    state.pendingConcentrationSaves = [];
  }
  state.log = [
    ...state.log,
    {
      id: randomUUID(),
      actorName,
      message: `Concentração em ${label}: ${total} vs CD ${pending.dc} — ${success ? 'SUCESSO' : 'FALHA; concentração encerrada'}.`,
      at: new Date().toISOString(),
    },
  ].slice(-100);
  await saveConcentrationState(target, state, db);
  return { name: target.name, pending, success, ended: !success, label, concentrationId: pending.concentrationId };
}
