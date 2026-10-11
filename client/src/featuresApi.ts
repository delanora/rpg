import { api } from './api';
import type { Character } from './types';

/** Resultado de ligar/desligar uma característica (o servidor é a autoridade). */
export interface FeatureToggleResult {
  character: Character;
  toggleId: string;
  /** Estado FINAL da característica. */
  active: boolean;
  /** Custo efetivamente cobrado (0 quando desligou ou não mudou nada). */
  cost: number;
  /** Recurso consumido pela característica (nulo quando não há). */
  resourceId: string | null;
  /** `false` quando o pedido foi um no-op idempotente (já estava no estado). */
  changed: boolean;
}

/**
 * Liga/desliga uma CARACTERÍSTICA com toggle.
 *
 * O cliente NÃO calcula o custo nem é autoridade sobre `used`/`active`: manda só
 * o id do toggle, o estado desejado e a `version` da ficha. O servidor deriva a
 * característica das classes atuais, cobra o `cost` do catálogo, valida o saldo
 * e devolve a ficha atualizada — que passa a ser a fonte de verdade na tela.
 */
export async function toggleFeature(
  toggleId: string,
  active: boolean,
  expectedVersion: number,
): Promise<FeatureToggleResult> {
  return api<FeatureToggleResult>('/api/characters/me/features/toggle', {
    method: 'POST',
    body: { toggleId, active, expectedVersion },
  });
}
