/**
 * PLANEJAMENTO DO PRÓXIMO TURNO — regra PURA (sem I/O), reutilizada por
 * `nextTurn` e `finalizeInitiative`.
 *
 * PHB 2014 + decisão desta fase:
 * • combatente MORTO não recebe turno (é pulado; continua na iniciativa);
 * • 0 PV + ESTABILIZADO (sem pendência) processa o início do turno, não rola
 *   Death Save, não recebe economia e o restante do turno é pulado;
 * • 0 PV com Testes contra a Morte ATIVOS **não** é pulado (é nele que a
 *   rolagem acontece);
 * • se todos estiverem inelegíveis, devolve `null` — quem chama decide o
 *   fallback reportável. Nunca há laço infinito: no máximo uma volta.
 */

export interface TurnPlan {
  /** Posição do próximo combatente elegível na ordem. */
  index: number;
  /** Quantas vezes a ordem deu a volta (incrementa a rodada). */
  rounds: number;
  /** Posições puladas, na ordem em que foram avaliadas. */
  skipped: number[];
}

/**
 * @param total quantidade de combatentes na ordem (> 0)
 * @param currentIndex posição do combatente que está encerrando o turno
 * @param isEligible decide se a posição pode RECEBER o turno
 */
export function planNextTurn(
  total: number,
  currentIndex: number,
  isEligible: (index: number) => boolean,
): TurnPlan | null {
  if (!Number.isInteger(total) || total <= 0) return null;
  const start = ((Math.trunc(currentIndex) % total) + total) % total;
  let index = start;
  let rounds = 0;
  const skipped: number[] = [];

  for (let step = 0; step < total; step += 1) {
    index += 1;
    if (index >= total) {
      index = 0;
      rounds += 1;
    }
    if (isEligible(index)) return { index, rounds, skipped };
    skipped.push(index);
  }

  return null;
}
