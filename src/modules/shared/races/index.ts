import { dragonborn } from './dragonborn.js';
import { dwarf } from './dwarf.js';
import { elf } from './elf.js';
import { gnome } from './gnome.js';
import { halfElf } from './half-elf.js';
import { halfOrc } from './half-orc.js';
import { halfling } from './halfling.js';
import { human } from './human.js';
import { tiefling } from './tiefling.js';
import type { Race, RaceTrait, Subrace } from './types.js';

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

export const RACES: readonly Race[] = [
  dragonborn,
  elf,
  dwarf,
  human,
  halfling,
  gnome,
  halfElf,
  halfOrc,
  tiefling,
];

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

/**
 * Soma dos efeitos `hpBonus` de uma raça + sub-raça no nível informado.
 *
 * É o ÚNICO efeito de raça aplicado de verdade hoje (a Robustez Anã, +1 PV por
 * nível TOTAL do personagem): o serviço de personagens usa `raceHpBonusDelta`
 * ao trocar a raça/sub-raça. Efeitos de traço podem vir em `mechanicalEffect`
 * (um) ou `mechanicalEffects` (vários).
 */
export function raceHpBonus(
  raceId: string | null | undefined,
  subraceId: string | null | undefined,
  level: number,
): number {
  const race = raceId ? getRace(raceId) : undefined;
  if (!race) return 0;
  const subrace = subraceId ? race.subraces?.find((item) => item.id === subraceId) : undefined;
  const traits = [...race.traits, ...(subrace?.traits ?? [])];

  let total = 0;
  for (const trait of traits) {
    const effects =
      trait.mechanicalEffects ?? (trait.mechanicalEffect ? [trait.mechanicalEffect] : []);
    for (const effect of effects) {
      if (effect.type === 'hpBonus') {
        total += (effect.value ?? 0) * (effect.perLevel ? level : 1);
      }
    }
  }
  return total;
}

/**
 * Delta de PV ao TROCAR de raça/sub-raça (positivo liga o bônus, negativo o
 * reverte). Compara o `hpBonus` da raça/sub-raça anterior com o da nova, no
 * mesmo nível total do personagem.
 */
export function raceHpBonusDelta(
  from: { raceId: string | null; subraceId: string | null },
  to: { raceId: string | null; subraceId: string | null },
  level: number,
): number {
  return raceHpBonus(to.raceId, to.subraceId, level) - raceHpBonus(from.raceId, from.subraceId, level);
}

/** Algum traço declara o Sortudo (`luckyReroll`)? */
function traitsHaveLucky(traits: readonly RaceTrait[]): boolean {
  for (const trait of traits) {
    const effects =
      trait.mechanicalEffects ?? (trait.mechanicalEffect ? [trait.mechanicalEffect] : []);
    if (effects.some((effect) => effect.type === 'luckyReroll')) return true;
  }
  return false;
}

/**
 * O personagem tem o Sortudo do Halfling?
 *
 * Resolve pelo catálogo ESTRUTURADO (`raceId`/`subraceId`) quando já estiver
 * gravado e, na falta dele, pelo texto livre `race` — o assistente de criação
 * ainda grava a linhagem como texto (ex.: "Halfling (Pés-Leves)") até o 2.10.
 * Usado pelo serviço de dados para marcar `lucky` no resultado.
 */
export function hasLuckyReroll(input: {
  raceId?: string | null;
  subraceId?: string | null;
  race?: string | null;
}): boolean {
  const race = input.raceId ? getRace(input.raceId) : undefined;
  if (race) {
    const subrace = input.subraceId
      ? race.subraces?.find((item) => item.id === input.subraceId)
      : undefined;
    return traitsHaveLucky([...race.traits, ...(subrace?.traits ?? [])]);
  }
  // Sem raceId: cai no texto livre da raça/linhagem.
  return (input.race ?? '').trim().toLowerCase().startsWith('halfling');
}
