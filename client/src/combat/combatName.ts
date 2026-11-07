/**
 * NOME DE EXIBIÇÃO NO COMBATE.
 *
 * A dock é apertada: em modo de combate o personagem aparece só pelo PRIMEIRO
 * nome ("Razzil da Silva" → "Razzil"). É formatação de tela — nenhum dado é
 * alterado, nenhum nome é enviado de volta ao servidor e a ficha inteira
 * continua mostrando o nome completo.
 */
import type { CombatantKind } from '../types';

export function combatDisplayName(name: string): string {
  const clean = name.trim();
  if (!clean) return clean;
  const [first] = clean.split(/\s+/);
  return first || clean;
}

/**
 * NOME DE EXIBIÇÃO DO COMBATENTE.
 *
 * Só PERSONAGEM é abreviado: criaturas e NPCs aparecem com o nome COMPLETO em
 * todo campo onde são citados (iniciativa, turno, alvos) — o nome é a
 * identidade deles na mesa e nunca deve ser cortado. O tipo vem do servidor.
 */
export function combatantDisplayName(combatant: {
  name: string;
  kind: CombatantKind;
}): string {
  return combatant.kind === 'CHARACTER' ? combatDisplayName(combatant.name) : combatant.name;
}
