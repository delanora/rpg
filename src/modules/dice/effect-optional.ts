import { HttpError } from '../../lib/http-error.js';
import { rollDie } from '../shared/dice.js';
import {
  selectOptionalModifiers,
  type EffectRollModifiers,
} from '../effects/effect-modifiers.js';

/** Dado opcional já rolado pelo SERVIDOR (nunca pelo cliente). */
export interface OptionalEffectDie {
  sides: number;
  value: number;
  sign: 1 | -1;
  /** Rótulo seguro da fonte ("Bless"; `null`/`Efeito` quando privada). */
  label: string | null;
}

export interface OptionalEffectRoll {
  /** Soma dos `roll-flat` opcionais escolhidos. */
  bonus: number;
  dice: OptionalEffectDie[];
}

/**
 * Resolve os modificadores OPCIONAIS escolhidos para UMA rolagem (6.5G).
 *
 * O cliente só manda os IDs que o servidor ofereceu. Aqui a escolha é
 * revalidada: um ID de efeito encerrado, de outro ator/escopo ou inventado é
 * REJEITADO (nunca aplicado em silêncio). Em rolagem com falha automática
 * (Paralyzed em FOR/DES etc.) nenhum dado é rolado — o modificador opcional não
 * transforma falha automática em sucesso.
 */
export function rollSelectedOptional(
  mods: EffectRollModifiers,
  selected: readonly string[] | undefined,
  autoFail = false,
  /** Fonte de aleatoriedade injetável (testes determinísticos). */
  roll: (sides: number) => number = (sides: number) => rollDie(sides),
): OptionalEffectRoll {
  if (autoFail || !selected || selected.length === 0) return { bonus: 0, dice: [] };

  const { options, invalid } = selectOptionalModifiers(mods, selected);
  if (invalid.length > 0) {
    throw new HttpError(
      'Modificador de efeito indisponível para esta rolagem.',
      400,
      'INVALID_EFFECT_MODIFIER',
    );
  }

  let bonus = 0;
  const dice: OptionalEffectDie[] = [];
  for (const option of options) {
    if (option.kind === 'roll-flat') {
      bonus += option.value ?? 0;
      continue;
    }
    const count = option.count ?? 1;
    const sides = option.sides ?? 4;
    const sign = option.sign ?? 1;
    for (let index = 0; index < count; index += 1) {
      dice.push({ sides, value: roll(sides), sign, label: option.label });
    }
  }
  return { bonus, dice };
}
