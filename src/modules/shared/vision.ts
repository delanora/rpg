import { deriveConditionEffects } from './conditions.js';

/**
 * Verificação MÍNIMA de visão entre DUAS criaturas.
 *
 * NÃO modela linha de visão, paredes, iluminação, alcance geométrico nem
 * percepção automática complexa. Trabalha APENAS com o que é mecanicamente
 * confiável hoje:
 *
 *   • o OBSERVADOR Cego (falha automática de visão) ou alheio ao entorno
 *     (Petrificado/Inconsciente) não enxerga → não vê o observado;
 *   • o OBSERVADO Invisível só é visto se o observador tiver um meio CONFIÁVEL
 *     de enxergá-lo (`MechanicalState.seesInvisible`, preenchido por efeitos
 *     como "Ver o Invisível" ou percepção especial quando existirem);
 *   • caso contrário, assume-se visível — esta camada é só de ESTADO mecânico;
 *     bloqueio por parede mora em `combat/spatial/spatial-obstacle.ts`
 *     (`sightSegmentBlocked`) e ainda não é chamado daqui.
 *
 * NUNCA derivar vantagem/desvantagem apenas de "o alvo/atacante tem Invisible":
 * a regra do PHB 2014 depende da RELAÇÃO de visão, então quem pergunta precisa
 * consultar esta função nos dois sentidos (ver `conditionAttackMode`).
 */
export function canSee(viewer: unknown, subject: unknown): boolean {
  const viewerEffects = deriveConditionEffects(viewer);
  if (viewerEffects.sightChecksAutoFail || viewerEffects.unawareSurroundings) return false;
  const subjectEffects = deriveConditionEffects(subject);
  if (!subjectEffects.active.includes('invisible')) return true;
  return viewerEffects.seesInvisible;
}

/**
 * Alias histórico: "o ALVO consegue ver o ATACANTE?" — mesma checagem, com o
 * observador primeiro. Usado pela Esquiva e pelas regras de ataque.
 */
export function canSeeAttacker(target: unknown, attacker: unknown): boolean {
  return canSee(target, attacker);
}
