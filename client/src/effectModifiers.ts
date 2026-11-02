import type { AbilityKey, EffectModifierDto, EffectRollType } from './types';

/**
 * Texto humano dos modificadores de EFEITO (Fase 6.5B).
 *
 * Só exibição: nenhuma regra depende do rótulo. Os labels de atributo/escopo
 * ficam aqui para a UI das duas pontas (painel do Mestre e ficha do jogador).
 */
export const EFFECT_ROLL_LABELS: Record<EffectRollType, string> = {
  attack: 'ataques',
  save: 'salvaguardas',
  check: 'testes de habilidade',
};

export const EFFECT_ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

export function describeEffectModifier(modifier: EffectModifierDto): string {
  if (modifier.kind === 'ac-flat') return `CA ${signed(modifier.value)}`;
  if (modifier.kind === 'speed-flat') return `Deslocamento ${signed(modifier.value)} m`;
  const scope = `${EFFECT_ROLL_LABELS[modifier.roll]}${
    modifier.ability ? ` (${EFFECT_ABILITY_LABELS[modifier.ability]})` : ''
  }`;
  if (modifier.kind === 'roll-flat') return `${signed(modifier.value)} em ${scope}`;
  if (modifier.kind === 'roll-dice') {
    return `${modifier.sign > 0 ? '+' : '−'}${modifier.count}d${modifier.sides} em ${scope}`;
  }
  if (modifier.kind === 'roll-advantage') return `Vantagem em ${scope}`;
  return `Desvantagem em ${scope}`;
}

export function describeEffectModifiers(modifiers: readonly EffectModifierDto[]): string {
  return modifiers.map(describeEffectModifier).join(' · ');
}
