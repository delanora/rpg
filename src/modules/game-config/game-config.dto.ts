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
  /**
   * Mostra as denominações EXTRAS (PL/pp e PE/ep) no bloco de moedas da ficha.
   * Desligado, a interface mostra só PO (gp), PP (sp) e PC (cp); os valores das
   * cinco denominações existem sempre no banco.
   */
  extraCoins: boolean;
  /**
   * RECURSOS DE ACAMPAMENTO do Descanso Longo coletivo (mecânica OPCIONAL,
   * inspirada no Baldur's Gate 3 — NÃO é regra do PHB 2014). DESLIGADO por
   * padrão: com `false`, o Descanso Longo oficial não é afetado em nada.
   */
  campSuppliesEnabled: boolean;
  /**
   * Custo em PONTOS por participante ACCEPTED (padrão 10). Só vale quando
   * `campSuppliesEnabled` é true.
   */
  campSupplyCostPerParticipant: number;
  updatedAt: string;
}

/**
 * Anotações privadas do mestre sobre a mesa.
 *
 * Ficam em `GameConfig.masterNotes`, mas NÃO entram no `GameConfigDto`: o
 * `GET /api/game` é acessível ao jogador (a ficha lê o contador de liberações),
 * então as anotações só trafegam pelas rotas próprias, exclusivas de MASTER.
 */
export interface MasterNotesDto {
  notes: string;
}
