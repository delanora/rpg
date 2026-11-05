import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { deathStateOf } from '../../shared/death.js';
import type { SlotDiceScalingDefinition } from '../../shared/spells/slot-scaling.js';
import type { SpellValidationContext } from './spell-execution-definition.js';

/**
 * FASE 6.6I.3 — PALAVRA CURATIVA (PHB 2014, p. 250).
 *
 * 1º nível de Evocação, 1 AÇÃO BÔNUS, 18 m, componentes V, instantânea. Uma
 * criatura visível recupera `1d4 + modificador de conjuração`; cada espaço acima
 * do 1º acrescenta 1d4. O modificador entra UMA vez por conjuração.
 *
 * Não afeta mortos-vivos nem constructos — mas eles CONTINUAM sendo alvos
 * válidos: a magia é conjurada (espaço/Ação Bônus gastos) e resolve sem efeito.
 * Isso é diferente de uma criatura MORTA, recusada antes do COMMIT.
 *
 * Nada aqui decide a matemática da fonte: atributo, CD e modificador vêm do
 * perfil de conjuração snapshotado no cast.
 */

export const HEALING_WORD_SPELL_ID = 'healing-word';

export const HEALING_WORD_LABEL = 'Palavra Curativa';

/** 1d4 base; o modificador de conjuração entra depois, uma única vez. */
export const HEALING_WORD_BASE_DICE = { count: 1, sides: 4 } as const;

/** 1d4 no 1º espaço, +1d4 por nível acima. NUNCA escala por nível de personagem. */
export const HEALING_WORD_SLOT_SCALING: SlotDiceScalingDefinition = {
  baseSpellLevel: 1,
  baseDice: 1,
  dicePerLevelAboveBase: 1,
};

/**
 * Tipos canônicos (normalizados por `shared/creature-types.ts`) que a magia NÃO
 * cura. A restrição pertence a ESTA definição — não é imunidade global a cura.
 */
export const HEALING_WORD_NO_EFFECT_ON_TYPES = ['undead', 'construct'] as const;

/**
 * Rejeita alvo morto ANTES do COMMIT (sem espaço, sem Ação Bônus).
 *
 * `loadEntity` já canonicaliza combatente de personagem para a FICHA, então o
 * estado de morte canônico é o da ficha. Criatura/NPC usa o `deathState` da
 * instância de combate; o cadastro solto do bestiário não tem ciclo de morte.
 */
export async function assertHealingWordTargets(
  context: SpellValidationContext,
): Promise<void> {
  for (const target of context.targets) {
    if (target.entity.kind === 'character') {
      const row = await context.db.character.findUnique({
        where: { id: target.entity.id },
        select: { deathState: true },
      });
      if (!row) throw new HttpError('Personagem não encontrado.', 404);
      if (deathStateOf(row.deathState).dead) {
        throw new HttpError(
          'Uma criatura morta não pode ser alvo de Palavra Curativa.',
          400,
          'SPELL_TARGET_DEAD',
        );
      }
      continue;
    }
    if (target.entity.kind === 'combatant') {
      const row = await context.db.combatant.findUnique({
        where: { id: target.entity.id },
        select: { deathState: true },
      });
      if (!row) throw new HttpError('Combatente não encontrado.', 404);
      if (deathStateOf(row.deathState).dead) {
        throw new HttpError(
          'Uma criatura morta não pode ser alvo de Palavra Curativa.',
          400,
          'SPELL_TARGET_DEAD',
        );
      }
    }
    // Criatura solta do bestiário: sem ciclo de morte canônico, alvo válido.
  }
}

void prisma;
