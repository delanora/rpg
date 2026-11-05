/**
 * FASE 6.6I.3 — ESCALONAMENTO DE DADOS POR ESPAÇO (genérico).
 *
 * Magias de nível escalam pelo ESPAÇO usado, não pelo nível do personagem:
 * Palavra Curativa é 1d4 no 1º e ganha +1d4 por nível acima. A definição da
 * magia declara os números e este helper faz a conta — nenhum `if (spellId)` e
 * nenhum uso de escalonamento de TRUQUE (que é por nível total).
 */

export interface SlotDiceScalingDefinition {
  /** Nível mínimo em que a magia pode ser conjurada (1 para Palavra Curativa). */
  baseSpellLevel: number;
  /** Quantidade de dados no nível base. */
  baseDice: number;
  /** Dados adicionais por nível de espaço acima do base. */
  dicePerLevelAboveBase: number;
}

/**
 * Total de dados para o espaço usado. Nunca abaixo do nível base nem negativo:
 * um `castAtLevel` inválido já falha antes, mas a função continua total.
 */
export function slotScaledDiceCount(
  scaling: SlotDiceScalingDefinition,
  castAtLevel: number,
): number {
  const base = Math.max(1, Math.trunc(scaling.baseSpellLevel));
  const level = Math.max(base, Math.trunc(castAtLevel));
  const extra = (level - base) * Math.max(0, Math.trunc(scaling.dicePerLevelAboveBase));
  return Math.max(0, Math.trunc(scaling.baseDice) + extra);
}
