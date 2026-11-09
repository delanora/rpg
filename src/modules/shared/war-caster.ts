import { creatureAbilitiesOf } from './creature-abilities.js';

/** Identidade mecânica explícita; nomes/descrições livres nunca concedem talento. */
export function hasWarCaster(
  features: unknown,
  abilities: unknown = [],
): boolean {
  return (
    (Array.isArray(features) &&
      features.some(
        (feature) =>
          feature?.source === 'feat' && feature.featId === 'war-caster',
      )) ||
    creatureAbilitiesOf(abilities).some(
      (ability) =>
        ability.cost === 'passive' && ability.execution === 'war-caster',
    )
  );
}
