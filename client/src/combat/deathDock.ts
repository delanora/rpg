import type { DeathState } from '../types';

/**
 * CICLO DE MORTE × DOCK DO JOGADOR (6.6M.8) — derivado PURO.
 *
 * A dock moderna NÃO desmonta em nenhum estado do ciclo de morte: ela continua
 * mostrando retrato, vida, recursos, Hotbar de 48 slots e utilitários, e o que
 * muda é só o que está DISPONÍVEL. Para isso existem duas perguntas, e elas
 * vivem aqui (sem estado e sem I/O) para o tracker, a dock e os testes lerem a
 * MESMA regra:
 *
 *  • `deathLifecycleOf` — o personagem está no ciclo (0 PV, Death Saves, oferta
 *    de Resistência Implacável, estabilizado, morto ou decisão pendente)? Quem
 *    responde isso continua sendo o SERVIDOR no DTO; aqui só se lê.
 *  • `deathDockLabel` — qual identificação discreta vai sobre a Hotbar
 *    bloqueada. `null` = dock operacional.
 *
 * Nada aqui concede ou retira autoridade: Ação, Ataque, Teste contra a Morte e
 * decisões continuam validados no servidor.
 */
export function deathLifecycleOf(state: DeathState | null | undefined): boolean {
  if (!state) return false;
  return Boolean(
    state.dead ||
      state.pending ||
      state.stabilized ||
      state.deathSaves ||
      state.relentless ||
      state.successes > 0 ||
      state.failures > 0,
  );
}

/**
 * Rótulo do estado de morte exibido sobre a Hotbar indisponível.
 *
 * A ORDEM é a do ciclo: morto vence tudo (nada mais acontece), depois a decisão
 * do Mestre (o jogador só espera), a oferta de Resistência Implacável, o
 * estabilizado — e por último o fluxo de Testes contra a Morte, que é o estado
 * em que a rolagem existe (no Registro, nunca nesta superfície).
 */
export function deathDockLabel(state: DeathState | null | undefined): string | null {
  if (!deathLifecycleOf(state) || !state) return null;
  if (state.dead) return 'Morto';
  if (state.pending) return 'Aguardando decisão do Mestre';
  if (state.relentless) return 'Resistência Implacável';
  if (state.stabilized) return 'Estabilizado';
  return 'Teste contra a Morte';
}
