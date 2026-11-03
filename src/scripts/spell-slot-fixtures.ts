import { prisma } from '../config/prisma.js';

/**
 * Fixtures dos smokes da Fase 6.6C.
 *
 * Os espaços MÁXIMOS são sempre DERIVADOS — o teste não inventa capacidade. O
 * que ele pode fazer é (a) perguntar ao SERVIDOR quais espaços estão
 * disponíveis e escolher um deles e (b) simular um DESCANSO LONGO zerando o
 * uso persistido, que é exatamente o que o motor de descanso grava.
 */
export interface CastingResourceChoice {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
}

interface ResourceDto {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
  max: number;
  remaining: number;
}

/** Escolhe o espaço de MENOR nível compatível que ainda tenha uso livre. */
export async function pickCastingResource(
  baseUrl: string,
  token: string,
  entity: { kind: string; id: string },
  spellLevel: number,
): Promise<CastingResourceChoice | null> {
  const res = await fetch(`${baseUrl}/api/spells/resources/${entity.kind}/${entity.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { resources?: ResourceDto[] };
  const eligible = (data.resources ?? [])
    .filter((resource) => resource.level >= spellLevel && resource.remaining > 0)
    .sort((a, b) => a.level - b.level);
  const chosen = eligible[0];
  return chosen ? { kind: chosen.kind, level: chosen.level } : null;
}

/** Consome o uso gravado de um personagem (equivalente a um Descanso Longo). */
export async function resetCastingSlots(characterId: string): Promise<void> {
  await prisma.character.update({
    where: { id: characterId },
    data: {
      spells: {
        list: [],
        slotsUsed: {},
        pactMagic: { used: 0 },
      } as never,
      version: { increment: 1 },
    },
  });
}
