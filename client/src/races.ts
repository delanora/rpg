import type { AbilityKey, RaceOption } from './types';

/**
 * Catálogo de raças do Livro do Jogador, do lado do cliente.
 *
 * O servidor é a fonte da verdade (`RaceOption` na criação): aqui ficam só as
 * contas de exibição — achar a raça gravada e somar os `+1` à escolha — para o
 * assistente e a ficha usarem a MESMA regra.
 */

/** Acha a raça no catálogo pela chave ou pelo nome (mesmo critério do servidor). */
export function findRaceOption(
  catalog: readonly RaceOption[],
  race: string,
): RaceOption | null {
  const needle = race.trim().toLowerCase();
  if (!needle) return null;

  return (
    catalog.find(
      (option) => option.key.toLowerCase() === needle || option.name.toLowerCase() === needle,
    ) ?? null
  );
}

/** Bônus racial já com os `+1` à escolha do jogador (Meio-Elfo escolhe dois). */
export function raceBonusesWithChoices(
  option: RaceOption | null,
  choices: readonly AbilityKey[],
): Partial<Record<AbilityKey, number>> {
  if (!option) return {};

  const bonuses: Partial<Record<AbilityKey, number>> = { ...(option.abilityBonuses ?? {}) };
  const pick = option.abilityChoice ?? 0;

  for (const ability of choices.slice(0, pick)) {
    bonuses[ability] = (bonuses[ability] ?? 0) + 1;
  }

  return bonuses;
}
