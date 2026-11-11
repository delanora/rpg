import type { DiceRollKind } from '../types';

/** Só apresentação: o resultado e o ciclo de morte continuam no servidor. */
export function rollAnimationMs(kind?: DiceRollKind): number {
  return kind === 'death-save' ? 2100 : 1150;
}
