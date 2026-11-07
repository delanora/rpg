import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { effectModifierSetsFor } from '../effects/effects.service.js';
import { withSpatial } from './spatial/spatial-projection.js';
import type { CombatSourced } from './combat.dto.js';

/**
 * CARREGADOR CANÔNICO do combate (6.6M.8.2).
 *
 * Existe UM jeito de carregar um combate para virar DTO, e ele é este arquivo —
 * `combat.service` e qualquer outro módulo que publique `combat:updated` (o
 * ciclo de morte, por exemplo) importam daqui.
 *
 * O motivo é concreto: o carregamento da morte omitia `scene`, então
 * `effectiveSceneConfigOf()` caía no `Combat.spatialConfig` LEGADO e publicava
 * uma cena `assisted` por cima de uma Scene `grid-2d` viva. Como
 * `publishCombat` roda a cada Teste contra a Morte, o grid desaparecia até um
 * F5 (que relê por `/api/combat/active`, com o loader completo).
 *
 * Regra: relação usada pelo DTO (`scene` + `obstacles`, combatentes com ficha e
 * criatura) é declarada AQUI, uma vez; quem precisar de um recorte diferente
 * deve recortar DEPOIS de carregar, nunca montar um `include` paralelo.
 */
export const combatInclude = {
  locality: { select: { id: true, name: true } },
  // CENA ESPACIAL (6.6L.4.1.1): configuração estrutural e paredes vêm da MESMA
  // consulta do combate — o cliente não precisa inventar join, e a cena é a
  // única fonte estrutural quando `sceneId` existe.
  scene: {
    include: { obstacles: { orderBy: { createdAt: 'asc' } } },
  },
  combatants: {
    include: {
      character: { include: { user: { select: { username: true } } } },
      creature: true,
    },
  },
} as const satisfies Prisma.CombatInclude;

/**
 * Anexa a cada combatente o resumo dos EFEITOS ativos (Fase 6.5B) numa ÚNICA
 * consulta em lote. Combatente de personagem usa a chave da FICHA, então o
 * mesmo efeito alimenta ficha e combate sem cópia. Sem isso, CA/deslocamento
 * do DTO ficariam sem os modificadores.
 */
export async function withEffectModifiers(
  combat: CombatSourced,
  db: Prisma.TransactionClient = prisma,
): Promise<CombatSourced> {
  const entities = combat.combatants.map((combatant) =>
    combatant.characterId
      ? { kind: 'character' as const, id: combatant.characterId }
      : { kind: 'combatant' as const, id: combatant.id },
  );
  const sets = await effectModifierSetsFor(entities, db);
  return {
    ...combat,
    combatants: combat.combatants.map((combatant) => ({
      ...combatant,
      effectModifiers: sets.get(
        combatant.characterId ? `character:${combatant.characterId}` : `combatant:${combatant.id}`,
      ),
    })),
  };
}

/**
 * Combate pronto para `toCombatDto`, ou `null` quando não existe.
 *
 * A ordem das etapas importa: efeitos primeiro (CA/deslocamento derivados), e a
 * projeção espacial por último (o tamanho BASE sai da raça/cadastro, nunca da
 * posição).
 */
export async function findCombatForDto(
  id: string,
  db: Prisma.TransactionClient = prisma,
): Promise<CombatSourced | null> {
  const combat = await db.combat.findUnique({ where: { id }, include: combatInclude });
  if (!combat) return null;
  return withSpatial(await withEffectModifiers(combat, db), db);
}

/** Igual ao anterior, mas 404 quando o combate não existe (rotas HTTP). */
export async function loadCombatById(
  id: string,
  db: Prisma.TransactionClient = prisma,
): Promise<CombatSourced> {
  const combat = await findCombatForDto(id, db);
  if (!combat) throw new HttpError('Combate não encontrado.', 404);
  return combat;
}
