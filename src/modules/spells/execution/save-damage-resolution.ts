import type { PendingEffectSave, Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { rollDie } from '../../shared/dice.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import { publishDeathUpdated } from '../../death/death.service.js';
import { publishCharacter } from '../../combat/combat.service.js';
import { publishEffects } from '../../effects/effects.service.js';
import {
  publishPendingEffectSaves,
  toPendingEffectSaveDto,
  type PendingEffectSaveDto,
} from '../../effects/pending-effect-saves.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import {
  parseSpellResolutionSnapshot,
  type SaveDamageCastSnapshot,
  type SaveDamageTargetResult,
} from './spell-resolution-snapshot.js';
import { buildSaveResultSnapshot } from './save-result-snapshot.js';
import { finalizeSaveDamageCast } from './save-damage-finalizer.js';

/**
 * FASE 6.6J.1 + 6.6J.2 — RESOLUÇÃO DE `save-damage` (1 ou N alvos).
 *
 * Divisão de responsabilidades:
 *
 *  • ESTA função só resolve UMA pendência: grava o resultado do SEU save e
 *    entrega o controle à barreira do cast. Nada de rolar dano por alvo.
 *  • A BARREIRA (`save-damage-finalizer.ts`) espera TODAS as pendências iniciais
 *    serem terminais e então rola o dano UMA vez (PHB 2014: efeito simultâneo),
 *    aplica defenses/HP/Concentração/morte POR ALVO e fecha o `SpellCast`.
 *
 * Com um alvo o comportamento observável é o de 6.6J.1: a barreira já está
 * satisfeita no único save. `Sacred Flame` (sucesso = `none`) continua sem dano
 * no sucesso, e a meia-dano por componente continua valendo.
 *
 * Invariantes:
 *  • o claim `pending → resolved` e a finalização acontecem na MESMA transação;
 *  • lock por pendência (esta resolução) → lock do cast (barreira): ordem única;
 *  • retry devolve o snapshot sem rerrolar dano nem reaplicar PV;
 *  • identidades: roll compartilhado `spell-cast:<castId>:damage-roll:0`, evento
 *    de dano por alvo `spell-cast:<castId>:target:<kind>:<id>:damage`.
 */

/**
 * Visão do resultado DESTE alvo (usada pelo log e pela Concentração).
 *
 * Deriva do snapshot do CAST (fonte de verdade), nunca de uma cópia por
 * pendência: o roll bruto é UM só e `rolls` mostra exatamente os dados rolados
 * para ele.
 */
export interface SaveDamageSnapshotView {
  damageType: string;
  rawDamage: number;
  damageAfterSave: number;
  finalDamage: number;
  /** Todos os dados do roll COMPARTILHADO (auditoria). */
  rolls: number[];
  /** Evento de dano DESTE alvo (nunca o id do roll compartilhado). */
  eventId: string;
  outcome: { success: string; failure: string };
  components: {
    type: string | null;
    count: number;
    sides: number;
    rolls: number[];
    raw: number;
    afterSave: number;
    applied: number;
    modifier: string | null;
  }[];
}

export interface SaveDamageResolution {
  pending: PendingEffectSaveDto;
  success: boolean;
  replayed: boolean;
  label: string;
  dc: number;
  target: MechanicalEntity;
  castId: string | null;
  /** `null` enquanto a barreira não foi satisfeita (sem dano ainda). */
  snapshot: SaveDamageSnapshotView | null;
  /** `true` quando a barreira foi satisfeita e o cast fechou. */
  castCompleted: boolean;
  /** Resultado de TODOS os alvos (ordem canônica do targeting). */
  targets: SaveDamageTargetResult[];
  castSnapshot: SaveDamageCastSnapshot | null;
  publications: string[];
  deathTargets: MechanicalEntity[];
  concentrationChanged: boolean;
  affectedEffects: MechanicalEntity[];
}

/** Fonte de aleatoriedade injetável (testes determinísticos). */
export interface SaveDamageResolveOptions {
  roll?: (sides: number) => number;
}

function entityOf(kind: string, id: string): MechanicalEntity {
  return { kind: kind as MechanicalEntity['kind'], id };
}

function sameTarget(
  left: { kind: string; id: string },
  right: MechanicalEntity,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function viewOf(
  snapshot: SaveDamageCastSnapshot | null,
  target: MechanicalEntity,
): SaveDamageSnapshotView | null {
  if (!snapshot) return null;
  const found = snapshot.targets.find((item) => sameTarget(item.target, target));
  if (!found) return null;
  return {
    damageType: snapshot.damageType,
    rawDamage: found.rawDamage,
    damageAfterSave: found.damageAfterSave,
    finalDamage: found.finalDamage,
    rolls: snapshot.damageRoll?.components.flatMap((component) => component.rolls) ?? [],
    eventId: found.eventId,
    outcome: snapshot.outcome,
    components: found.components.map((component, index) => ({
      type: component.type,
      count: snapshot.damageRoll?.components[index]?.count ?? 0,
      sides: snapshot.damageRoll?.components[index]?.sides ?? 0,
      rolls: snapshot.damageRoll?.components[index]?.rolls ?? [],
      raw: component.raw,
      afterSave: component.afterSave,
      applied: component.applied,
      modifier: component.modifier,
    })),
  };
}

async function replayedResolution(row: PendingEffectSave): Promise<SaveDamageResolution> {
  const cast = row.spellCastId
    ? await prisma.spellCast.findUnique({ where: { id: row.spellCastId } })
    : null;
  const stored = cast ? parseSpellResolutionSnapshot(cast.resolutionSnapshot) : null;
  const castSnapshot = stored?.kind === 'save-damage' ? stored : null;
  const target = entityOf(row.targetEntityKind, row.targetEntityId);
  return {
    pending: toPendingEffectSaveDto(row),
    success: row.result === 'success',
    replayed: true,
    label: toPendingEffectSaveDto(row).label,
    dc: row.dc,
    target,
    castId: row.spellCastId ?? null,
    snapshot: viewOf(castSnapshot, target),
    castCompleted: cast ? cast.status !== 'resolving' : true,
    targets: castSnapshot?.targets ?? [],
    castSnapshot,
    publications: [],
    deathTargets: [],
    concentrationChanged: false,
    affectedEffects: [],
  };
}

/**
 * Resolve a pendência com o TOTAL do save já rolado.
 *
 * `total` vem do pipeline de dados (server-authoritative); atributo e CD vêm da
 * própria pendência. Nenhum dano é rolado ou aplicado aqui: quem decide é a
 * barreira, que só age quando não sobra nenhum save inicial obrigatório aberto.
 */
export async function resolveSaveDamagePending(
  pendingId: string,
  total: number,
  actorName = 'Sistema',
  options: SaveDamageResolveOptions = {},
): Promise<SaveDamageResolution> {
  const roll = options.roll ?? rollDie;
  const initial = await prisma.pendingEffectSave.findUnique({ where: { id: pendingId } });
  if (!initial) throw new HttpError('Aplicação pendente não encontrada.', 404);
  if (initial.status !== 'pending') return replayedResolution(initial);

  return prisma.$transaction(async (db) => {
    // Serializa a resolução da MESMA pendência entre processos/abas: duas
    // resoluções concorrentes não gravam dois resultados.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pendingId}))`;

    const row = await db.pendingEffectSave.findUnique({ where: { id: pendingId } });
    if (!row) throw new HttpError('Aplicação pendente não encontrada.', 404);
    if (row.status !== 'pending') return replayedResolution(row);

    const cast = row.spellCastId
      ? await db.spellCast.findUnique({ where: { id: row.spellCastId } })
      : null;
    const execution = cast ? spellExecutionDefinition(cast.spellId) : null;
    const resolution = execution?.resolution;
    if (!cast || !execution || resolution?.kind !== 'save-damage') {
      throw new HttpError(
        'Esta salvaguarda não pertence a uma magia de dano executável.',
        409,
        'SPELL_EXECUTION_NOT_IMPLEMENTED',
      );
    }

    const success = total >= row.dc;
    const claimed = await db.pendingEffectSave.updateMany({
      where: { id: pendingId, status: 'pending' },
      data: {
        status: 'resolved',
        result: success ? 'success' : 'failure',
        resolvedAt: new Date(),
        // A pendência guarda SÓ o save. O dano pertence ao cast (roll único).
        resolutionSnapshot: buildSaveResultSnapshot({
          ability: row.ability,
          dc: row.dc,
          total,
          success,
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    if (!claimed.count) {
      const later = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
      return replayedResolution(later);
    }

    // BARREIRA + roll COMPARTILHADO + aplicação por alvo, na MESMA transação.
    const finalization = await finalizeSaveDamageCast(cast.id, db, { roll });
    const fresh = await db.pendingEffectSave.findUniqueOrThrow({ where: { id: pendingId } });
    const target = entityOf(row.targetEntityKind, row.targetEntityId);

    return {
      pending: toPendingEffectSaveDto(fresh),
      success,
      replayed: false,
      label: toPendingEffectSaveDto(fresh).label,
      dc: row.dc,
      target,
      castId: cast.id,
      snapshot: viewOf(finalization.snapshot, target),
      castCompleted: finalization.completed,
      targets: finalization.targets,
      castSnapshot: finalization.snapshot,
      publications: finalization.publications,
      deathTargets: finalization.deathTargets,
      concentrationChanged: finalization.concentrationChanged,
      affectedEffects: finalization.affectedEffects,
    } satisfies SaveDamageResolution;
  });
}

/**
 * Publica depois do commit: TODOS os alvos afetados pela finalização (ficha,
 * morte, Effects e o card que deixou de estar pendente). Nenhuma publicação
 * acontece dentro da transação.
 */
export async function publishSaveDamageResult(
  result: SaveDamageResolution,
): Promise<void> {
  if (result.replayed) {
    await publishPendingEffectSaves([result.target]);
    return;
  }
  const entities: MechanicalEntity[] = result.targets.map((item) =>
    entityOf(item.target.kind, item.target.id),
  );
  const publications = new Set(result.publications);
  for (const entity of entities) {
    // A ficha do dono precisa refletir HP/Concentração derivados do evento.
    if (entity.kind === 'character') publications.add(entity.id);
  }
  for (const id of publications) await publishCharacter(id);
  for (const entity of result.deathTargets) await publishDeathUpdated(entity);
  if (entities.length > 0) {
    await publishEffects([...entities, ...result.affectedEffects]);
  }
  await publishPendingEffectSaves(entities.length > 0 ? entities : [result.target]);
  void result.castCompleted;
}
