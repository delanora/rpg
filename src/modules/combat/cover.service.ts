import { HttpError } from '../../lib/http-error.js';
import type { CoverEvaluation, CoverEvaluationInput } from './cover.js';

/**
 * FASE 6.6J.5 — PROVIDER DE COBERTURA.
 *
 * O projeto NÃO tem coordenadas, volumes ocupados, paredes nem eixo vertical
 * (6.6J.3). Inventar cobertura seria pior do que admitir ignorância, então:
 *
 *  • o provider PADRÃO (`assistedCoverProvider`) responde `not-assessed`;
 *  • `not-assessed` NÃO é `known:none`: o snapshot guarda a diferença;
 *  • o bônus mecânico de uma avaliação não conhecida é 0 (o jogo continua
 *    praticável — nenhuma jogada vira "aguardando o Mestre");
 *  • quem sabe (provider autoritativo ou confirmação do Mestre no fluxo
 *    assistido) informa o nível, e só então +2/+5/Total valem.
 *
 * O provider NÃO conhece nome de magia/arma: recebe origem, alvo e a interação.
 */

export interface CoverSpatialProvider {
  readonly mode: 'assisted' | 'authoritative';
  evaluate(input: CoverEvaluationInput): CoverEvaluation | Promise<CoverEvaluation>;
}

export const assistedCoverProvider: CoverSpatialProvider = {
  mode: 'assisted',
  evaluate() {
    return {
      status: 'not-assessed',
      reason: 'o modelo espacial atual não representa obstáculos/cobertura',
    };
  },
};

/** Avalia a relação origem ↔ alvo para UMA interação. */
export async function coverFor(
  input: CoverEvaluationInput,
  provider: CoverSpatialProvider = assistedCoverProvider,
): Promise<CoverEvaluation> {
  return provider.evaluate(input);
}

/**
 * Total Cover é decisão de TARGETING, nunca "+999 CA": recusa o alvo DIRETO
 * antes de qualquer rolagem/custo. Quem chama escolhe o código do domínio.
 */
export function assertCoverAllowsDirectTargeting(
  evaluation: CoverEvaluation,
  code: string,
  message: string,
): void {
  if (evaluation.status === 'known' && evaluation.level === 'total') {
    throw new HttpError(message, 409, code);
  }
}
