import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import type { CombatActor } from '../combat.service.js';
import { emitCombat, loadCombatById } from '../combat.service.js';
import { toCombatDto, type CombatDto } from '../combat.dto.js';
import { ServerEvents } from '../../../realtime/events.js';
import {
  canonicalPosition,
  occupiedSpaceOf,
  parseStoredPosition,
  spaceWithinScene,
} from './occupied-space.js';
import {
  GRID_CELL_SIZE_FEET,
  spatialSceneOf,
  type SpatialPosition2D,
  type SpatialSceneConfig,
} from './spatial.types.js';
import { isGridAligned } from './spatial-distance.js';

/**
 * FASE 6.6L.1 — CONFIGURAÇÃO DA CENA E PLACEMENT.
 *
 * Regras de autoridade:
 *  • só o MASTER configura a cena e posiciona combatentes;
 *  • PLAYER NÃO tem endpoint livre de posição (movimento real é 6.6L.3);
 *  • placement é SETUP administrativo: não gasta Movimento/Ação/Bônus, não
 *    dispara Reação nem Opportunity Attack, não altera iniciativa;
 *  • a posição vive na INSTÂNCIA do combate — nunca na ficha global nem no
 *    template da criatura.
 *
 * Toda escrita passa por versão (expectedVersion) + operationId e incrementa a
 * versão do combate; o evento só é publicado DEPOIS do commit.
 */

export interface SpatialOperationInput {
  combatId: string;
  expectedVersion: number;
  operationId: string;
  /**
   * Campos do ALVO da operação. Entram no fingerprint de propósito: a mesma
   * `operationId` com OUTRO combatente/posição é reutilização de chave (409),
   * nunca um replay silencioso da posição antiga.
   */
  combatantId?: string;
  position?: SpatialPosition2D | null;
}

export interface SpatialConfigPatchInput extends SpatialOperationInput {
  mode: SpatialSceneConfig['mode'];
  widthFeet?: number;
  heightFeet?: number;
}

export interface SpatialPositionPatchInput {
  expectedVersion: number;
  operationId: string;
  position: SpatialPosition2D | null;
}

function requireMaster(actor: CombatActor): void {
  if (actor.role !== 'MASTER') {
    throw new HttpError('Apenas o mestre pode alterar o espaço da cena.', 403);
  }
}

/**
 * Executa uma mutação espacial com a MESMA semântica das operações de combate:
 * fingerprint + replay pelo `operationId`, versão esperada e publicação após o
 * commit. Combate em preparação (PENDING_INITIATIVE) já aceita placement — o
 * Mestre monta a cena antes de rolar iniciativa.
 */
async function runSpatialOperation<T extends { combat: CombatDto }>(
  actor: CombatActor,
  input: SpatialOperationInput,
  type: string,
  apply: (db: Prisma.TransactionClient, combat: Awaited<ReturnType<typeof loadCombatById>>) => Promise<T>,
): Promise<T> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ type, actor: actor.userId, input }))
    .digest('hex');
  const key = { combatId_operationId: { combatId: input.combatId, operationId: input.operationId } };
  const replay = (operation: { fingerprint: string; snapshot: unknown }) => {
    if (operation.fingerprint !== fingerprint) {
      throw new HttpError(
        'operationId reutilizado com outro payload/autor.',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return operation.snapshot as T;
  };

  const existing = await prisma.combatOperation.findUnique({ where: key });
  if (existing) return replay(existing);

  let result: T;
  try {
    result = await prisma.$transaction(async (db) => {
      const previous = await db.combatOperation.findUnique({ where: key });
      if (previous) return replay(previous);
      const changed = await db.combat.updateMany({
        where: {
          id: input.combatId,
          status: { in: ['PENDING_INITIATIVE', 'ACTIVE'] },
          version: input.expectedVersion,
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new HttpError('Combate mudou ou não está ativo. Atualize e tente novamente.', 409, 'CONFLICT');
      }
      const combat = await loadCombatById(input.combatId, db);
      const response = await apply(db, combat);
      await db.combatOperation.create({
        data: {
          combatId: combat.id,
          operationId: input.operationId,
          fingerprint,
          snapshot: response as unknown as Prisma.InputJsonValue,
        },
      });
      return response;
    }, { timeout: 15000 });
  } catch (error) {
    // Retry concorrente da MESMA operação: quem perdeu devolve o snapshot.
    const previous = await prisma.combatOperation.findUnique({ where: key });
    if (previous) return replay(previous);
    throw error;
  }

  emitCombat(
    ServerEvents.COMBAT_UPDATED,
    toCombatDto(await loadCombatById(input.combatId), 'MASTER'),
  );
  return result;
}

/** Configura a cena (dimensões/modo). MASTER-only. */
export async function updateSpatialScene(
  actor: CombatActor,
  input: SpatialConfigPatchInput,
): Promise<{ combat: CombatDto }> {
  requireMaster(actor);
  return runSpatialOperation(actor, input, 'spatial-config', async (db, combat) => {
    const current = spatialSceneOf(combat.spatialConfig);
    const next: SpatialSceneConfig = {
      mode: input.mode,
      widthFeet: input.widthFeet ?? current.widthFeet,
      heightFeet: input.heightFeet ?? current.heightFeet,
      cellSizeFeet: GRID_CELL_SIZE_FEET,
    };

    // Reduzir a cena NUNCA move combatentes: se algum espaço ocupado sair dos
    // novos limites, a alteração é rejeitada inteira (sem efeito parcial).
    const conflicting = combat.combatants.find((combatant) => {
      const position = parseStoredPosition(combatant.spatialPosition);
      const space = occupiedSpaceOf(position, combatant.baseSize ?? 'medium');
      return space !== null && !spaceWithinScene(space, next);
    });
    if (conflicting) {
      throw new HttpError(
        `${conflicting.name} ficaria fora da cena com essas dimensões. Reposicione antes de redimensionar.`,
        409,
        'SPATIAL_SCENE_RESIZE_CONFLICT',
      );
    }

    await db.combat.update({
      where: { id: combat.id },
      data: { spatialConfig: next as unknown as Prisma.InputJsonValue },
    });
    return { combat: toCombatDto(await loadCombatById(combat.id, db), actor.role) };
  });
}

/**
 * Posiciona (ou remove a posição de) UM combatente. MASTER-only.
 *
 * `position: null` = UNPLACED: o combatente continua no combate, na iniciativa,
 * com PV/condições/efeitos — só não está colocado espacialmente. Bounds são
 * derivados do TAMANHO EFETIVO + dimensões da cena; o cliente nunca envia
 * tamanho, `occupiedSpace`, distância ou alcance.
 */
export async function setCombatantSpatialPosition(
  actor: CombatActor,
  combatId: string,
  combatantId: string,
  input: SpatialPositionPatchInput,
): Promise<{ combat: CombatDto }> {
  requireMaster(actor);
  return runSpatialOperation(
    actor,
    {
      combatId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      combatantId,
      position: input.position,
    },
    'spatial-position',
    async (db, combat) => {
      const combatant = combat.combatants.find((item) => item.id === combatantId);
      if (!combatant) throw new HttpError('Combatente não encontrado neste combate.', 404);

      const position = canonicalPosition(input.position);
      if (position) {
        const scene = spatialSceneOf(combat.spatialConfig);
        const baseSize = combatant.baseSize ?? 'medium';
        // 6.6L.2 — ALINHAMENTO CANÔNICO: numa cena grid-2d, Small+ só pode ser
        // colocado em múltiplos de 5 pés e Tiny em múltiplos de 2,5 pés.
        // Sem isso a distância PHB-grid não teria significado. Um placement
        // NOVO desalinhado é recusado (posições legadas já gravadas não são
        // movidas: o resolver as trata como `unknown`).
        if (scene.mode === 'grid-2d' && !isGridAligned(position, baseSize)) {
          throw new HttpError(
            'A posição precisa estar alinhada ao grid: múltiplos de 5 pés (2,5 pés para Minúsculo).',
            400,
            'SPATIAL_POSITION_NOT_GRID_ALIGNED',
          );
        }
        const space = occupiedSpaceOf(position, baseSize);
        if (!space || !spaceWithinScene(space, scene)) {
          throw new HttpError(
            'O espaço ocupado não cabe na cena: escolha outra posição.',
            400,
            'SPATIAL_POSITION_OUT_OF_BOUNDS',
          );
        }
      }

      await db.combatant.update({
        where: { id: combatant.id },
        data: {
          spatialPosition: position
            ? (position as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });
      return { combat: toCombatDto(await loadCombatById(combat.id, db), actor.role) };
    },
  );
}

