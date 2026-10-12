import { deriveConditionEffects } from './conditions.js';

/**
 * Verificação MÍNIMA de visão usada por regras que dependem de "o alvo VÊ o
 * atacante" (hoje, só a Esquiva/Dodge).
 *
 * NÃO modela linha de visão, paredes, iluminação, alcance geométrico nem
 * percepção automática complexa. Trabalha APENAS com o que é mecanicamente
 * confiável hoje:
 *
 *   • alvo Cego (falha automática de visão) ou alheio ao entorno
 *     (Petrificado/Inconsciente) não enxerga → não vê o atacante;
 *   • atacante Invisível só é visto se o alvo tiver um meio CONFIÁVEL de
 *     enxergá-lo (`MechanicalState.seesInvisible`, preenchido por efeitos como
 *     "Ver o Invisível" ou percepção especial quando existirem);
 *   • caso contrário, assume-se visível — o projeto não modela posição/visão,
 *     então seguir esse comportamento assistido é o padrão, sem inventar
 *     geometria.
 *
 * NUNCA derivar isto apenas de "o atacante tem Invisible": a regra depende de o
 * ALVO conseguir vê-lo.
 */
export function canSeeAttacker(target: unknown, attacker: unknown): boolean {
  const targetEffects = deriveConditionEffects(target);
  if (targetEffects.sightChecksAutoFail || targetEffects.unawareSurroundings) return false;
  const attackerEffects = deriveConditionEffects(attacker);
  if (!attackerEffects.active.includes('invisible')) return true;
  return targetEffects.seesInvisible;
}
