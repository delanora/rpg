import { prisma } from '../../config/prisma.js';
import type { EffectActor } from './effects.service.js';
import { toEffectDto, type EffectDto } from './effects.dto.js';
import { BLESS_SPELL_ID } from './definitions/bless.js';
import { castProofSpell } from '../spells/execution/spell-cast.service.js';
import type { ApplyBlessInput } from './effects.schema.js';

/**
 * FASE 6.6A — BLESS como WRAPPER FINO do Spell Cast Service.
 *
 * A rota de prova continua existindo (UI do Mestre e compatibilidade), mas NÃO
 * controla mais o lifecycle: validação → commit → resolução → Effects →
 * Concentração são do contrato genérico. Aqui só se traduz o payload do Bless
 * (caster + até 3 alvos) e se devolve o grupo/efeitos esperados pela UI.
 *
 * Bless segue MASTER-only. Desde a 6.6B o cast registra a FONTE de conjuração e
 * o snapshot do perfil (CD/ataque mágico); desde a 6.6C gasta um espaço
 * NORMAL/PACTO real no COMMIT; desde a 6.6D consome Ação em combate; e desde a
 * 6.6E o espaço escolhido define o MÁXIMO DE ALVOS (3 no 1º, +1 por espaço
 * acima), com alcance de 30 pés e caminho livre confirmados pelo Mestre quando
 * não há geometria. Nenhum outro benefício de upcast é aplicado.
 */

export interface BlessResult {
  groupId: string;
  effects: EffectDto[];
  replayed: boolean;
}

export async function applyBless(
  actor: EffectActor,
  input: ApplyBlessInput,
): Promise<BlessResult> {
  const result = await castProofSpell(actor, {
    operationId: input.operationId,
    spellId: BLESS_SPELL_ID,
    caster: input.caster,
    targets: input.targets,
    // Bless não usa CD/ataque mágico, mas TODO cast real registra sua fonte
    // (6.6B): a matemática de conjuração e a mecânica do efeito são separadas.
    ...(input.spellcastingSource ? { spellcastingSource: input.spellcastingSource } : {}),
    // 6.6C: Blessed deixa de ser cast grátis — o COMMIT gasta um espaço real.
    ...(input.castingResource ? { castingResource: input.castingResource } : {}),
    // 6.6E: alcance/caminho livre são confirmados pelo Mestre quando o servidor
    // não consegue medir; a quantidade de alvos já é derivada do espaço.
    ...(input.spatialConfirmation
      ? { spatialConfirmation: input.spatialConfirmation }
      : {}),
  });
  if (!result.effectGroupId) {
    // A definição de Bless é immediate-effect; sem grupo não há o que devolver.
    throw new Error('Bless não produziu um grupo de efeitos.');
  }
  const rows = await prisma.effectInstance.findMany({
    where: { groupId: result.effectGroupId },
    orderBy: { createdAt: 'asc' },
  });
  return {
    groupId: result.effectGroupId,
    effects: rows.map((row) => toEffectDto(row)),
    replayed: result.replayed,
  };
}
