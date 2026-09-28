/**
 * Configuração global da mesa.
 *
 * Guarda o contador de liberações de Level Up e o nível inicial da mesa. Cada
 * clique do mestre em "Liberar Level Up" incrementa `levelUpRelease`, e cada
 * jogador compara com o `Character.lastLevelUpRelease` dele: quem ainda não usou
 * a liberação atual sobe um nível. Sem liga/desliga — o mestre libera e o
 * jogador upa, e basta liberar de novo para o próximo.
 */
export interface GameConfigDto {
  /** Número da liberação atual, comparado com `Character.lastLevelUpRelease`. */
  levelUpRelease: number;
  /**
   * Nível em que os personagens começam a mesa. Quando é maior que 1, o
   * assistente de criação aplica os níveis 2 até ele ao concluir a montagem.
   */
  startingLevel: number;
  updatedAt: string;
}
