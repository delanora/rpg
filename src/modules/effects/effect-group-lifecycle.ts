import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { MechanicalEntity } from '../shared/conditions.js';
import { loadEntity } from '../mechanical/mechanical.service.js';
import { saveMechanicalState } from './effect-conditions.js';
import { endEffectInstances, uniqueTargets } from './effect-lifecycle.js';
import type { EffectEndReason } from './effects.schema.js';

/**
 * FASE 6.6H — LIFECYCLE DE GRUPO CONCENTRADO (direção Effect → Concentração).
 *
 * A 6.5D criou a direção Concentração → Grupo (perder a concentração desmonta o
 * grupo). O comportamento simétrico entra aqui, de forma GENÉRICA:
 *
 *   quando o ÚLTIMO Effect ATIVO de um grupo termina, a Concentração associada
 *   àquele `groupId` também termina.
 *
 * Não existe `if (spellId === 'hold-person')`: o vínculo é `groupId`, que a
 * Concentração já declara (`sourceType: 'effect'`, `sourceId = groupId`). A
 * checagem é idempotente e termina em estado estável (`endEffect(last)` →
 * grupo vazio → concentração nula → nada mais a fazer, sem recursão).
 */

type Db = Prisma.TransactionClient | typeof prisma;

interface EndedRowsResult {
  targets: MechanicalEntity[];
  concentrationEnded: boolean;
}

/**
 * Limpa a Concentração do conjurador quando ela aponta para este grupo.
 *
 * Idempotente: se a concentração já foi encerrada (por dano, Incapacitado ou
 * pela própria magia), não reescreve nada. O estado é gravado pelo caminho
 * canônico (`saveMechanicalState`), nunca por SQL paralelo.
 */
async function clearConcentrationForGroup(
  groupId: string,
  source: { kind: string; id: string },
  db: Db,
): Promise<boolean> {
  const loaded = await loadEntity(
    { kind: source.kind as MechanicalEntity['kind'], id: source.id },
    db,
  );
  const state = loaded.state;
  const concentration = state.concentration;
  if (!concentration) return false;
  if (concentration.sourceType !== 'effect' || concentration.sourceId !== groupId) return false;
  state.concentration = null;
  // Pendências de concentração pertencem àquela concentração: saem junto.
  state.pendingConcentrationSaves = [];
  await saveMechanicalState(loaded, state, db);
  return true;
}

/**
 * Encerra as instâncias ATIVAS que casam com o filtro e, para cada grupo que
 * ficou VAZIO, encerra a Concentração correspondente.
 *
 * Devolve os alvos que precisam ser republicados e se alguma concentração caiu
 * (o chamador publica; nada é publicado dentro da transação).
 */
export async function endEffectRows(
  where: Prisma.EffectInstanceWhereInput,
  reason: EffectEndReason,
  db: Db,
): Promise<EndedRowsResult> {
  const rows = await db.effectInstance.findMany({
    where: { ...where, status: 'active' },
    select: { id: true, groupId: true, sourceEntityKind: true, sourceEntityId: true },
  });
  if (rows.length === 0) return { targets: [], concentrationEnded: false };

  const ended = await endEffectInstances({ id: { in: rows.map((row) => row.id) } }, reason, db);

  const groups = new Map<string, { kind: string; id: string }>();
  for (const row of rows) {
    if (!row.groupId || !row.sourceEntityKind || !row.sourceEntityId) continue;
    groups.set(row.groupId, { kind: row.sourceEntityKind, id: row.sourceEntityId });
  }

  let concentrationEnded = false;
  for (const [groupId, source] of groups) {
    const remaining = await db.effectInstance.count({
      where: { groupId, status: 'active' },
    });
    if (remaining > 0) continue;
    if (await clearConcentrationForGroup(groupId, source, db)) concentrationEnded = true;
  }

  return { targets: uniqueTargets(ended), concentrationEnded };
}

/** Encerramento por INSTÂNCIA (save repetido com sucesso, duração por alvo). */
export function endEffectInstance(
  effectInstanceId: string,
  reason: EffectEndReason,
  db: Db,
): Promise<EndedRowsResult> {
  return endEffectRows({ id: effectInstanceId }, reason, db);
}

/** Encerramento do GRUPO inteiro (expiração de duração/manual). */
export function endEffectGroupByDuration(
  groupId: string,
  db: Db,
): Promise<EndedRowsResult> {
  return endEffectRows({ groupId }, 'duration-expired', db);
}

/**
 * Cancela as pendências CONTÍNUAS dos efeitos que estão terminando.
 *
 * Sem isso, um turno ficaria bloqueado (`TURN_END_TRIGGER_PENDING`) esperando o
 * save de um efeito que não existe mais. Só `status = 'pending'` e
 * `phase = 'ongoing'` mudam — a barreira inicial tem o próprio fluxo.
 */
export async function cancelOngoingPendingsForEffects(
  effectInstanceIds: readonly string[],
  db: Db,
): Promise<number> {
  if (effectInstanceIds.length === 0) return 0;
  const cancelled = await db.pendingEffectSave.updateMany({
    where: {
      effectInstanceId: { in: [...effectInstanceIds] },
      phase: 'ongoing',
      status: 'pending',
    },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  return cancelled.count;
}
