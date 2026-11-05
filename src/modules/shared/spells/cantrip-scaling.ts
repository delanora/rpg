/**
 * FASE 6.6I.2 — ESCALONAMENTO DE TRUQUE POR NÍVEL DE PERSONAGEM.
 *
 * Truques de dano crescem em 5º, 11º e 17º nível de PERSONAGEM (PHB 2014) — o
 * nível TOTAL, somando todas as classes, nunca o nível de UMA classe. Este
 * helper é declarativo e não conhece nenhuma magia: a definição de execução diz
 * quantos dados cada faixa concede e o chamador informa o nível total.
 *
 * NPC/criatura NÃO tem nível de personagem: quem conjura precisa declarar
 * `cantripScalingLevel` explicitamente no perfil do statblock. Nada é inferido
 * de ND (CR), dados de vida, proficiência ou espaços.
 */

export interface LevelScalingThreshold {
  /** Nível TOTAL de personagem a partir do qual a faixa vale. */
  minLevel: number;
  /** Quantos dados a magia rola nessa faixa. */
  dice: number;
}

export interface LevelScalingDefinition {
  /** Fonte do nível: hoje só o nível total de personagem. */
  kind: 'character-level';
  /** Faixas em ordem crescente; a MAIOR `minLevel` alcançada vence. */
  thresholds: readonly LevelScalingThreshold[];
}

/**
 * Quantidade de dados para o nível informado.
 *
 * Sem faixa alcançada → 0 (o chamador decide se isso é erro). O helper nunca
 * interpola por proficiência: PB muda em níveis parecidos, mas não é a fonte.
 */
export function scaledDiceCount(
  scaling: LevelScalingDefinition | undefined,
  characterLevel: number,
): number {
  if (!scaling) return 0;
  const level = Math.max(1, Math.trunc(characterLevel));
  let dice = 0;
  for (const threshold of scaling.thresholds) {
    if (level >= threshold.minLevel) dice = Math.max(dice, threshold.dice);
  }
  return dice;
}

/**
 * Dados EFETIVOS no nível informado.
 *
 * As faixas declaram o TOTAL de dados (1d8/2d8/3d8/4d8), não um acréscimo: o
 * resultado é `max(base, faixa)` — nunca base + faixa (que daria 3d8 no nível 5).
 */
export function scaledDice(
  base: { count: number; sides: number },
  scaling: LevelScalingDefinition | undefined,
  characterLevel: number,
): { count: number; sides: number } {
  const count = Math.max(Math.max(0, base.count), scaledDiceCount(scaling, characterLevel));
  return { count, sides: base.sides };
}
