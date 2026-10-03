import { dragonborn } from './dragonborn.js';
import type { Race, Subrace } from './types.js';

/**
 * Registro agregado do catálogo ESTRUTURADO de raças (fundação).
 *
 * Segue o padrão de `shared/classes/index.ts`: aqui ficam a lista e as funções
 * utilitárias; cada raça vive no seu próprio arquivo (`dwarf.ts`, `elf.ts`…),
 * importado nesta lista nos próximos prompts.
 *
 * Enquanto o catálogo novo não substituir o `RACE_CATALOG` de `shared/creation.ts`
 * (Prompt 2.10), o assistente de criação e o compêndio continuam lendo o
 * catálogo antigo — os dois coexistem sem que nada em produção dependa daqui
 * ainda.
 */
export * from './types.js';

export const RACES: readonly Race[] = [dragonborn];

const RACE_BY_ID: ReadonlyMap<string, Race> = new Map(RACES.map((race) => [race.id, race]));

/** Todas as raças do catálogo (cópia defensiva). */
export function allRaces(): Race[] {
  return [...RACES];
}

/** Uma raça pelo id, ou `undefined` quando não existe. */
export function getRace(id: string): Race | undefined {
  return RACE_BY_ID.get(id);
}

/** Uma sub-raça pelo id da raça + o id da sub-raça, ou `undefined`. */
export function getSubrace(raceId: string, subraceId: string): Subrace | undefined {
  return getRace(raceId)?.subraces?.find((subrace) => subrace.id === subraceId);
}
