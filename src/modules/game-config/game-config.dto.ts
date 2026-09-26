/**
 * Configuração global da mesa.
 *
 * Por enquanto só guarda o controle de Level Up liberado pelo mestre: enquanto
 * desligado, nenhum jogador sobe de nível; cada liberação (desligar → ligar)
 * incrementa `levelUpRelease` e libera o botão uma vez para cada personagem.
 */
export interface GameConfigDto {
  /** Verdadeiro enquanto o mestre deixou o Level Up liberado. */
  levelUpUnlocked: boolean;
  /** Número da liberação atual, comparado com `Character.lastLevelUpRelease`. */
  levelUpRelease: number;
  updatedAt: string;
}
