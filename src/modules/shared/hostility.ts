/** Pergunta privada sobre um ataque já resolvido; não contém estado de jogo paralelo. */
export interface HostilityPromptDto {
  id: string;
  attackerId: string;
  targetId: string;
  npcId: string;
  attackName: string;
}
