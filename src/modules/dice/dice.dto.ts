/**
 * Rolagem de dados da mesa (janela de dados).
 *
 * O resultado é calculado no servidor (dados justos, `crypto.randomInt`) e
 * divulgado em tempo real. O mesmo DTO serve para rolagens livres, de perícia
 * e de salvaguarda, públicas ou privadas.
 */

export type DiceRollKind = 'skill' | 'save' | 'free';

/** Um dado já rolado. */
export interface RolledDie {
  /** Número de faces (4, 6, 8, 10, 12, 20, 100...). */
  sides: number;
  value: number;
  /**
   * Descartado por vantagem/desvantagem. Cada d20 vira dois dados e o que não
   * vale fica marcado aqui (aparece apagado no resultado).
   */
  dropped?: boolean;
}

/** Um dado do pool, como o autor montou o tabuleiro. */
export interface RollBoardDie {
  sides: number;
  /** d20 fixo da rolagem de perícia/salvaguarda (não dá para remover). */
  locked: boolean;
}

/**
 * O tabuleiro de rolagem como quem está rolando o montou.
 *
 * A mesa inteira vê esse tabuleiro (para acompanhar a rolagem), mas só o autor
 * interage com ele — por isso o servidor é apenas o espelho do estado.
 */
export interface RollBoardDto {
  pool: RollBoardDie[];
  advantage: boolean;
  disadvantage: boolean;
  /** Bônus fixo do teste (perícia/salvaguarda). */
  bonus: number;
  /** `tumbling` = os dados estão rolando agora. */
  phase: 'idle' | 'tumbling';
}

/**
 * Alguém com a janela de dados aberta na mesa.
 *
 * É um estado efêmero (como a apresentação de imagens): vive na memória do
 * servidor enquanto a janela estiver aberta e é reenviado a quem conectar no
 * meio. Não vai para o banco.
 */
export interface ActiveRollDto {
  userId: string;
  /** Nome do personagem (ou do usuário, sem ficha) de quem está rolando. */
  actorName: string;
  /** Avatar do personagem (`''` quando não há imagem). */
  avatarUrl: string;
  kind: DiceRollKind;
  /** Perícia/salvaguarda em teste (vazio na rolagem livre). */
  label: string;
  /** Tabuleiro montado pelo autor (os demais só assistem). */
  board: RollBoardDto;
  /** Momento da última mudança de estado. */
  at: string;
}

export interface DiceRollDto {
  id: string;
  /** Dono da rolagem — a mesa usa isso para casar a rolagem com o tabuleiro. */
  actorUserId: string;
  /**
   * Identificador do pedido do cliente. O autor usa isso para reconhecer a
   * própria rolagem no tempo real e não repetir o aviso que ele mesmo vê na
   * janela.
   */
  clientId: string | null;
  /** Nome do personagem (ou do usuário, sem ficha) que rolou. */
  actorName: string;
  kind: DiceRollKind;
  /** Perícia/salvaguarda ("Percepção") ou vazio na rolagem livre. */
  label: string;
  dice: RolledDie[];
  /** Modificador fixo pré-aplicado (bônus de perícia/salvaguarda). */
  bonus: number;
  total: number;
  advantage: boolean;
  disadvantage: boolean;
  isPrivate: boolean;
  /** Algum d20 válido saiu 20. */
  crit: boolean;
  at: string;
}
