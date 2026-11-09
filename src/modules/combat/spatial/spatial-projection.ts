import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { getRace } from '../../shared/races/index.js';
import { baseSizeOfRaceSize, spatialSizeOfLabel } from './spatial-size.js';
import type { SpatialSize } from './spatial.types.js';
import type { CombatSourced } from '../combat.dto.js';

/**
 * Tamanho BASE de uma ficha: SEMPRE derivado da RAÇA canônica estruturada.
 *
 * Prioridade:
 *  1. `customRaceId` → `CustomRace.size` (raça homebrew do Mestre);
 *  2. `raceId` → `Race.size` do catálogo estruturado;
 *  3. nada disso (ficha legada com raça em texto livre) → `medium`, escolha
 *     EXPLÍCITA e documentada — o nome da raça NUNCA é interpretado.
 *
 * O jogador não escolhe tamanho: nem a ficha nem o placement recebem `size`.
 */
export async function characterBaseSize(character: {
  raceId: string | null;
  customRaceId: string | null;
}): Promise<SpatialSize> {
  if (character.customRaceId) {
    const customRace = await prisma.customRace.findUnique({
      where: { id: character.customRaceId },
      select: { size: true },
    });
    if (customRace) return baseSizeOfRaceSize(customRace.size);
  }
  if (character.raceId) {
    const race = getRace(character.raceId);
    if (race) return baseSizeOfRaceSize(race.size);
  }
  return 'medium';
}

/**
 * Anexa a CADA combatente o tamanho BASE derivado (a ficha/criatura NÃO é
 * mutada). O DTO calcula tamanho efetivo e espaço ocupado a partir daqui.
 *
 * Uma única consulta em lote para as raças personalizadas (sem N+1), e as
 * raças do catálogo são dado estático em memória.
 */
export async function withSpatial(
  combat: CombatSourced,
  db: Prisma.TransactionClient = prisma,
): Promise<CombatSourced> {
  const customRaceIds = [
    ...new Set(
      combat.combatants
        .map((combatant) => combatant.character?.customRaceId ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const customRaces =
    customRaceIds.length > 0
      ? await db.customRace.findMany({
          where: { id: { in: customRaceIds } },
          select: { id: true, size: true },
        })
      : [];
  const customSizeById = new Map(customRaces.map((race) => [race.id, race.size]));

  const liveCharacters = new Set(combat.combatants.filter(unit => unit.kind === 'CHARACTER' && unit.character).map(unit => unit.id));
  const activeDuels = (combat.duels ?? []).filter(duel => duel.status === 'active' && liveCharacters.has(duel.requesterId) && liveCharacters.has(duel.challengedId));
  return {
    ...combat,
    combatants: combat.combatants.map((combatant) => ({
      ...combatant,
      duelOpponentIds: activeDuels.flatMap(duel => duel.requesterId === combatant.id ? [duel.challengedId] : duel.challengedId === combatant.id ? [duel.requesterId] : []),
      baseSize: combatantSizeOf(combatant, customSizeById),
    })),
  };
}

function combatantSizeOf(
  combatant: CombatSourced['combatants'][number],
  customSizeById: Map<string, string>,
): SpatialSize {
  if (combatant.character) {
    const customSize = combatant.character.customRaceId
      ? customSizeById.get(combatant.character.customRaceId)
      : undefined;
    if (customSize) return baseSizeOfRaceSize(customSize);
    const race = combatant.character.raceId ? getRace(combatant.character.raceId) : undefined;
    return baseSizeOfRaceSize(race?.size ?? null);
  }
  // Criatura/NPC: tamanho PERSISTIDO no cadastro (autoridade do Mestre).
  if (combatant.creature) return spatialSizeOfLabel(combatant.creature.size);
  return 'medium';
}
