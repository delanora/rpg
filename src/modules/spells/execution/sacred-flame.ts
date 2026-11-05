import type { AbilityKey } from '../../shared/dnd5e.js';
import type { LevelScalingDefinition } from '../../shared/spells/cantrip-scaling.js';

/**
 * FASE 6.6I.2 — CHAMA SAGRADA (PHB 2014, p. 272).
 *
 * Chama Sagrada é INSTANTÂNEA e não deixa efeito durável: por isso NÃO existe
 * Effect Definition para ela. O que ela declara aqui é só o que a execução
 * precisa saber — atributo do save, tipo e dados de dano e as faixas de truque.
 *
 * O id canônico é o do catálogo (`sacred-flame`): nada de duplicar nome, nível,
 * escola, alcance ou componentes. Os componentes V/S e a Ação vêm de lá.
 */

export const SACRED_FLAME_SPELL_ID = 'sacred-flame';

export const SACRED_FLAME_LABEL = 'Chama Sagrada';

/** Salvaguarda de Destreza — fixada no SERVIDOR, nunca no request. */
export const SACRED_FLAME_SAVE_ABILITY = 'dexterity' as const satisfies AbilityKey;

/** Tipo canônico do projeto (o mesmo do catálogo). */
export const SACRED_FLAME_DAMAGE_TYPE = 'Radiante';

/** Dano base do truque: 1d8 radiante; sem modificador de atributo. */
export const SACRED_FLAME_BASE_DICE = { count: 1, sides: 8 } as const;

/**
 * Faixas de truque (PHB 2014): 5º → 2d8, 11º → 3d8, 17º → 4d8.
 * `dice` é o TOTAL de dados na faixa (base inclusa).
 */
export const SACRED_FLAME_SCALING: LevelScalingDefinition = {
  kind: 'character-level',
  thresholds: [
    { minLevel: 1, dice: 1 },
    { minLevel: 5, dice: 2 },
    { minLevel: 11, dice: 3 },
    { minLevel: 17, dice: 4 },
  ],
};

/**
 * PHB 2014: "The target gains no benefit from cover for this saving throw."
 * Metadado declarativo: a engine ainda não possui cover numérico, então nada é
 * somado/subtraído hoje — guardar a regra evita inventar bônus de cobertura.
 */
export const SACRED_FLAME_IGNORE_SAVE_COVER = true;
