import type { CombatantDto } from '../types';

/**
 * TARGETING DIRETO A PARTIR DA HOTBAR (6.6M.6.4) — regras PURAS de SELEÇÃO.
 *
 * Este módulo decide apenas "este clique pode virar ALVO?", nunca "este ataque
 * acerta". Não compara distância com alcance, não avalia cobertura, não olha
 * condições e não gasta Ação/Ação Bônus/Reação: quem julga a execução continua
 * sendo o servidor (Attack Resolution + Action Economy). O grid só encaminha a
 * INTENÇÃO de alvo para o fluxo de ataque que já existe.
 */

/** O mínimo que o grid precisa saber de um combatente para oferecê-lo como alvo. */
export type TargetCandidate = Pick<CombatantDto, 'id' | 'spatial'> & { missing?: boolean };

/**
 * Quem pode ser escolhido como alvo nesta fase.
 *
 * Só entram combatentes do DTO VISÍVEL ao usuário (a privacidade é filtrada no
 * servidor), POSICIONADOS no grid, com identidade válida e que não sejam o
 * próprio atacante nem estejam marcados como removidos. Nada de alvo oculto,
 * coordenada inventada ou token fictício: quem não tem posição continua sendo
 * escolhido pelos cartões do painel.
 *
 * Facção NÃO entra na conta: aliados e outras facções são oferecidos do mesmo
 * jeito — o fluxo de ataque existente é quem aceita ou recusa.
 */
export function targetableCombatantIds(
  combatants: readonly TargetCandidate[],
  attackerId: string | null | undefined,
): string[] {
  if (!attackerId) return [];
  return combatants
    .filter((item) => item.id !== attackerId && !item.missing && Boolean(item.spatial))
    .map((item) => item.id);
}

/**
 * O targeting normal do grid pode ser ligado agora?
 *
 * Distingue ELEGIBILIDADE DE SELEÇÃO de elegibilidade mecânica: isto só diz que
 * a UI pode oferecer alvos. Mesmo `true`, o servidor pode recusar o ataque
 * (alcance, cobertura total, economia gasta) e nada aqui tenta prever isso.
 *
 * Nunca liga antes de rolar iniciativa, em espera (turno de outro), durante a
 * edição da Hotbar, em Testes Contra a Morte ou para o Mestre (que tem a própria
 * superfície de ataques). Reações fora do turno continuam nos fluxos próprios.
 */
export function targetingEligible(input: {
  isMaster: boolean;
  ownTurn: boolean;
  /** Existe ataque real escolhido (pedido da Hotbar ao painel). */
  attackSelected: boolean;
  awaitingInitiative: boolean;
  hotbarEditing: boolean;
  deathSavePending: boolean;
}): boolean {
  if (input.isMaster) return false;
  if (!input.ownTurn || !input.attackSelected) return false;
  if (input.awaitingInitiative) return false;
  if (input.hotbarEditing) return false;
  if (input.deathSavePending) return false;
  return true;
}

/**
 * Clique curto em token → alvo pretendido (`null` = nada selecionado).
 *
 * A PRECEDÊNCIA dos gestos do grid é preservada aqui, de cima para baixo:
 * 1. clique sintético de fim de arrasto nunca seleciona;
 * 2. régua ativa escolhe EXTREMO da medição, não alvo;
 * 3. ferramenta de posicionamento do Mestre (placement) é exclusiva;
 * 4. só com targeting ligado e o combatente na lista de elegíveis o clique
 *    vira alvo.
 *
 * Pan (Space/botão do meio) não chega até aqui: o gesto cancela o clique. Fundo
 * do mapa não passa por token algum, então também não altera a seleção.
 */
export function gridTargetPick(input: {
  targetingActive: boolean;
  targetableIds: readonly string[];
  combatantId: string;
  rulerActive?: boolean;
  placementActive?: boolean;
  suppressClick?: boolean;
}): string | null {
  if (input.suppressClick) return null;
  if (input.rulerActive) return null;
  if (input.placementActive) return null;
  if (!input.targetingActive) return null;
  if (!input.targetableIds.includes(input.combatantId)) return null;
  return input.combatantId;
}

/**
 * A seleção de alvo ainda vale?
 *
 * Atualização de realtime pode remover o combatente, escondê-lo do DTO do
 * jogador ou mudar de instância de combate. Nesses casos a seleção é descartada
 * na DERIVAÇÃO (sem efeito, sem operação de combate): nunca se mantém um alvo
 * de um combate ou de um estado anterior.
 */
export function targetStillValid(
  targetId: string | null | undefined,
  targetableIds: readonly string[],
): boolean {
  if (!targetId) return false;
  return targetableIds.includes(targetId);
}
