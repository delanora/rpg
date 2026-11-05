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
/**
 * 6.6J.5.1 — adjudicação do MESTRE não sobrescreve fato AUTORITATIVO.
 *
 * Se o provider já sabe o nível (geometria real), confirmar outro nível é erro
 * de domínio — nunca um "deixa passar". `none` também é um fato: um ataque
 * sem cobertura só pode ser declarado pelo provider, não pelo Mestre.
 */
export function assertCoverDecisionAllowed(
  evaluation: CoverEvaluation,
  confirmed: string | undefined,
): void {
  if (!confirmed) return;
  if (evaluation.status !== 'known') return;
  if (evaluation.level === confirmed) return;
  throw new HttpError(
    'O Mestre só decide cobertura que o servidor não conseguiu avaliar.',
    409,
    'COVER_DECISION_NOT_ALLOWED',
  );
}

export function assertCoverAllowsDirectTargeting(
  evaluation: CoverEvaluation,
  code: string,
  message: string,
): void {
  if (evaluation.status === 'known' && evaluation.level === 'total') {
    throw new HttpError(message, 409, code);
  }
}
