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

/**
 * O Teste Contra a Morte OBRIGATÓRIO deste turno ainda está por rolar?
 *
 * Regra PURA espelhada do servidor (`deathSaveRequiredThisTurn`): 0 PV, dentro
 * do fluxo, vivo, sem decisão/oferta pendente e sem `saveTurnKey` DESTE turno.
 * Estabilizado não rola mais. `currentTurnKey` usa a MESMA fórmula do servidor
 * (`id:rodada:índice`).
 */
export function deathSavePendingFor(
  state: DeathState | null | undefined,
  currentTurnKey: string,
): boolean {
  if (!state) return false;
  return Boolean(
    state.deathSaves &&
      !state.dead &&
      !state.stabilized &&
      !state.pending &&
      !state.relentless &&
      state.saveTurnKey !== currentTurnKey,
  );
}

/**
 * "ENCERRAR TURNO" no ciclo de morte — derivação PURA, uma só para a UI e para
 * os testes.
 *
 * Só duas coisas desabilitam o pedido: não ser o turno do jogador e o Teste
 * Contra a Morte OBRIGATÓRIO deste turno ainda estar por rolar. O ciclo de
 * morte (Estabilizado, morto, decisão do Mestre, oferta da Resistência
 * Implacável) NÃO desabilita: negar Ação/Ataque/Movimento é uma permissão,
 * encerrar o próprio turno é outra — e o SERVIDOR é quem decide se o turno
 * avança (`DEATH_SAVE_PENDING`, `TURN_END_TRIGGER_PENDING`, pendências, 403).
 */
export function endTurnAvailability(input: {
  isMyTurn: boolean;
  busy: boolean;
  deathSavePending: boolean;
}): { disabled: boolean; reason: string | null } {
  if (!input.isMyTurn) return { disabled: true, reason: 'Encerrar turno — aguardando o seu turno' };
  if (input.deathSavePending) {
    return {
      disabled: true,
      reason: 'Você precisa realizar seu Teste Contra a Morte antes de encerrar o turno.',
    };
  }
  if (input.busy) return { disabled: true, reason: null };
  return { disabled: false, reason: null };
}
