/**
 * FASE 6.6J.1 — CONSEQUÊNCIA GENÉRICA DO SAVE SOBRE O DANO.
 *
 * Uma magia `save-damage` declara, por desfecho, quanto do dano BRUTO segue:
 * `none` (sucesso zera — Chama Sagrada), `half` ("save for half damage") ou
 * `full`. O multiplicador é aplicado POR COMPONENTE e ANTES das defesas do
 * alvo, exatamente na ordem do PHB 2014:
 *
 *   dano bruto → consequência do save (floor por componente)
 *              → resistência/imunidade/vulnerabilidade (núcleo de dano)
 *              → dano final → PV → Concentração
 *
 * Somar os componentes antes do `half` perderia o tipo de cada parcela e
 * arredondaria uma única vez (15 → 7), quando o correto é 5 Fogo → 2 e
 * 5 Frio → 2. Por isso o helper trabalha sobre a LISTA, preservando a
 * identidade de cada componente.
 *
 * Este módulo é PURO: não rola dados, não lê o banco, não aplica defesas e
 * nunca chama `resolveDamage`. O núcleo de dano continua sem saber o que é
 * salvaguarda.
 */

/** Quanto do dano BRUTO de uma parcela sobrevive ao desfecho do save. */
export type SaveDamageShare = 'none' | 'half' | 'full';

/**
 * Aplica o desfecho a UMA parcela.
 *
 * `half` arredonda para BAIXO (PHB 2014) e `none` zera — nunca existe dano
 * negativo, mesmo com entrada inconsistente.
 */
export function applySaveDamageShare(raw: number, share: SaveDamageShare): number {
  const amount = Math.max(0, Math.trunc(raw));
  if (share === 'none') return 0;
  if (share === 'half') return Math.floor(amount / 2);
  return amount;
}

/**
 * Aplica o desfecho a TODOS os componentes, um a um.
 *
 * Devolve NOVOS objetos (mesmo tipo/ordem) com `rawAmount` já ajustado; a
 * identidade (tipo) de cada parcela sobrevive até as defesas do alvo.
 */
export function applySaveDamageOutcome<T extends { rawAmount: number }>(
  components: readonly T[],
  share: SaveDamageShare,
): T[] {
  return components.map(
    (component) =>
      ({
        ...component,
        rawAmount: applySaveDamageShare(component.rawAmount, share),
      }) as T,
  );
}
