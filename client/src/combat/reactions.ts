/**
 * REACTION WINDOW — arquitetura de extensão (PHB 2014).
 *
 * Hoje o sistema NÃO possui uma reação mecânica executável (Shield pertence à
 * futura Spell Engine; ataque de oportunidade depende de posicionamento/grid).
 * O que existe aqui é só o PONTO DE EXTENSÃO: um evento de turno pode oferecer
 * a UM participante a chance de reagir ANTES da resolução final.
 *
 * Decisões deliberadas:
 * • a janela é uma LISTA — no futuro mais de um participante pode ter uma
 *   reação para o mesmo evento (ex.: dois conjuradores com Counterspell). Nada
 *   aqui assume um reactor único;
 * • `reactorUserId` é a identidade do USUÁRIO (não do combatente): cada jogador
 *   vê apenas as PRÓPRIAS opções, e o Mestre vê as dele;
 * • a janela é efêmera (`expiresAt`) e contextual. NUNCA existe uma barra de
 *   Reação permanente fora do próprio turno;
 * • recusar/resolver fecha a janela e devolve o foco ao turno em andamento.
 *
 * Enquanto nenhuma regra concreta emitir uma oportunidade, a lista chega vazia
 * e NENHUMA interface de Reação é renderizada — nada de "Contra-ataque" ou
 * Shield falsos.
 */

/** Uma opção que o reactor pode escolher (só o que a regra concreta concede). */
export interface ReactionOption {
  id: string;
  /** Nome curto da reação/feature (ex.: "Escudo"). */
  label: string;
  /** Efeito resumido, para o jogador decidir sem abrir outra tela. */
  description: string;
  /** Origem auditável (feature/magia) — não executa nada sozinho. */
  sourceId?: string;
}

/** Oportunidade concreta detectada pelo motor para UM reactor. */
export interface ReactionOpportunity {
  id: string;
  /** Usuário que pode reagir: cada um vê somente as próprias oportunidades. */
  reactorUserId: string;
  /** Combatente do reactor (ficha, criatura ou NPC). */
  reactorCombatantId: string;
  /** Texto do gatilho (ex.: "Você foi alvo de um ataque."). */
  trigger: string;
  sourceCombatantId: string | null;
  targetCombatantId: string | null;
  availableReactions: ReactionOption[];
  /** ISO-8601; `null` = fecha quando a ação que abriu a janela resolver. */
  expiresAt: string | null;
}

/**
 * Oportunidades visíveis para este usuário. A filtragem por identidade evita
 * que o cliente renderize a reação de outro jogador ou os recursos do Mestre.
 */
export function reactionOpportunitiesForViewer(
  opportunities: readonly ReactionOpportunity[],
  userId: string,
): ReactionOpportunity[] {
  return opportunities.filter((opportunity) => opportunity.reactorUserId === userId);
}
