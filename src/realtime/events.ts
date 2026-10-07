import type { Role } from '@prisma/client';
import type { CharacterDto } from '../modules/characters/characters.dto.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import type { CreatureDto } from '../modules/creatures/creatures.dto.js';
import type { DiceRollDto, DiceRollKind, RollBoardDto } from '../modules/dice/dice.dto.js';
import type { GameConfigDto } from '../modules/game-config/game-config.dto.js';
import type { ItemDto } from '../modules/items/items.dto.js';
import type { LocalityDto } from '../modules/localities/localities.dto.js';
import type { MusicStateDto, MusicTrackDto } from '../modules/music/music.dto.js';
import type { RegionDto } from '../modules/regions/regions.dto.js';

/**
 * Contrato central de eventos do Socket.io.
 *
 * Manter os nomes aqui (em vez de strings soltas pelo código) evita erros de
 * digitação e serve de referência única para o frontend.
 *
 * Convenção de nomes: `dominio:acao`
 *
 * Observação: as escritas da ficha acontecem por HTTP (PATCH /api/characters/me),
 * que persiste e então publica `sheet:updated`. O WebSocket é o canal de
 * *notificação*, não de escrita — evita dois caminhos de gravação divergentes.
 */

/** Usuário conectado no momento, usado no relatório de presença. */
export interface OnlineUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

/** Payload de confirmação de conexão, entregue logo após o handshake. */
export interface ConnectionReadyPayload {
  socketId: string;
  connectedAt: string;
  user: {
    userId: string;
    username: string;
    role: Role;
  };
}

/** Lista de quem está online na mesa. */
export interface PresenceUpdatePayload {
  online: OnlineUser[];
}

/**
 * Alteração de ficha publicada em tempo real.
 *
 * Vai para a sala dos mestres e para as sessões do próprio autor. O `userId`
 * e o `username` são carimbados pelo servidor a partir do token — o cliente
 * nunca os informa, então não há como se passar por outro jogador.
 *
 * `changes` traz o patch aplicado; `character` traz a ficha completa já
 * calculada, para o painel do mestre apenas substituir o estado.
 */
export interface SheetUpdatedPayload {
  /** Dono da ficha (e destino do evento), nunca quem editou. */
  userId: string;
  username: string;
  characterId: string;
  version: number;
  changes: Record<string, unknown>;
  character: CharacterDto;
  /**
   * Nome de exibição de quem editou quando não é o dono da ficha — ou seja,
   * o mestre. Ausente nas edições do próprio jogador.
   */
  editedBy?: string;
  at: string;
}

/**
 * Personagem (e a conta do jogador dono dele) excluído pelo mestre.
 *
 * Vai para o painel dos mestres (a ficha sai da lista) e para as sessões do
 * próprio dono, que é desconectado em seguida — a conta não existe mais.
 */
export interface CharacterDeletedPayload {
  characterId: string;
  /** Dono da ficha — a conta de usuário também foi excluída. */
  userId: string;
  /** Nome do personagem no momento da exclusão. */
  name: string;
  /** Nome de usuário da conta excluída. */
  username: string;
}

/** Eventos enviados pelo cliente (frontend) para o servidor. */
export const ClientEvents = {
  /** Entra na sala da mesa para receber os eventos de sessão. */
  TABLE_JOIN: 'table:join',
  /** Sai da sala da mesa. */
  TABLE_LEAVE: 'table:leave',
} as const;

/** Eventos enviados pelo servidor para os clientes. */
export const ServerEvents = {
  /** Confirmação de conexão (com os dados do usuário autenticado). */
  CONNECTION_READY: 'connection:ready',
  /** Erro genérico de tempo real (payload inválido, permissão, etc.). */
  ERROR: 'app:error',
  /** Lista atualizada de quem está online na mesa. */
  PRESENCE_UPDATE: 'presence:update',
  /** Ficha alterada — entregue aos mestres e às sessões do autor. */
  SHEET_UPDATED: 'sheet:updated',
  /**
   * Personagem excluído pelo mestre (com a conta do jogador): os mestres
   * tiram a ficha da lista e o dono é avisado e desconectado.
   */
  CHARACTER_DELETED: 'character:deleted',
  /** Criatura cadastrada pelo mestre. */
  CREATURE_CREATED: 'creature:created',
  /** Criatura alterada pelo mestre. */
  CREATURE_UPDATED: 'creature:updated',
  /** Criatura removida pelo mestre. */
  CREATURE_DELETED: 'creature:deleted',

  // Regiões (entrega apenas à sala dos mestres)
  /** Região cadastrada pelo mestre. */
  REGION_CREATED: 'region:created',
  /** Região alterada pelo mestre. */
  REGION_UPDATED: 'region:updated',
  /** Região removida pelo mestre. */
  REGION_DELETED: 'region:deleted',

  // Localidades (entrega apenas à sala dos mestres)
  /** Localidade cadastrada pelo mestre. */
  LOCALITY_CREATED: 'locality:created',
  /** Localidade alterada pelo mestre. */
  LOCALITY_UPDATED: 'locality:updated',
  /** Localidade removida pelo mestre. */
  LOCALITY_DELETED: 'locality:deleted',

  // Catálogo de itens (entrega para toda a mesa: jogadores consultam na ficha)
  /** Item cadastrado no catálogo pelo mestre. */
  ITEM_CREATED: 'item:created',
  /** Item alterado no catálogo pelo mestre. */
  ITEM_UPDATED: 'item:updated',
  /** Item removido do catálogo pelo mestre. */
  ITEM_DELETED: 'item:deleted',

  // Apresentação de imagens (entrega para toda a mesa: o mestre mostra uma
  // imagem no centro da tela dos jogadores até mandar fechar)
  /** O mestre começou a apresentar uma imagem para a mesa. */
  PRESENTATION_SHOWN: 'presentation:shown',
  /** O mestre encerrou a apresentação. */
  PRESENTATION_CLOSED: 'presentation:closed',

  // Configuração da mesa (entrega para toda a mesa)
  /** O mestre liberou um Level Up (ou outra config da mesa mudou). */
  GAME_CONFIG: 'game:config',

  // Música ambiente (entrega para toda a mesa: todos escutam a mesma faixa)
  /**
   * Estado da reprodução mudou (tocar, pausar, trocar de faixa, repetir).
   * O servidor é a fonte de verdade: este evento é o que mantém mestre e
   * jogadores no MESMO ponto da mesma música.
   */
  MUSIC_STATE: 'music:state',
  /** Catálogo de faixas mudou (upload/remoção). Entrega só aos mestres. */
  MUSIC_TRACKS: 'music:tracks',

  // Combate (entrega para toda a mesa: jogadores e mestre participam)
  /** Combate iniciado — também é o gatilho do pedido de iniciativa. */
  COMBAT_STARTED: 'combat:started',
  /** Estado completo do combate mudou (HP, rolagens, ordem...). */
  COMBAT_UPDATED: 'combat:updated',
  /** Virou o turno de alguém. */
  COMBAT_TURN: 'combat:turn',
  /** Combate encerrado pelo mestre. */
  COMBAT_ENDED: 'combat:ended',
  /** Um dado foi rolado (usado para o efeito sonoro e o log). */
  DICE_ROLLED: 'dice:rolled',
  /**
   * Rolagem da janela de dados (livre, perícia ou salvaguarda). Chega a toda a
   * mesa nas rolagens públicas e apenas ao autor nas privadas.
   */
  DICE_ROLL: 'dice:roll',
  /**
   * Alguém abriu (ou fechou) a janela de dados. Serve para a mesa acompanhar
   * quem está rolando: quem recebe vê a faixa no topo do tabuleiro, não a
   * janela. Rolagem marcada como privada pelo mestre não é divulgada.
   */
  DICE_ACTIVE: 'dice:active',
  /** Resultado de um ataque, com acerto/erro e dano aplicado. */
  ATTACK_RESOLVED: 'combat:attack',
} as const;

/** Eventos de criaturas (entregues apenas à sala dos mestres). */
export interface CreatureCreatedPayload {
  creature: CreatureDto;
}

export interface CreatureUpdatedPayload {
  creature: CreatureDto;
  changes: Record<string, unknown>;
}

export interface CreatureDeletedPayload {
  creatureId: string;
}

/** Eventos de regiões (entregues apenas à sala dos mestres). */
export interface RegionCreatedPayload {
  region: RegionDto;
}

export interface RegionUpdatedPayload {
  region: RegionDto;
  changes: Record<string, unknown>;
}

export interface RegionDeletedPayload {
  regionId: string;
}

/** Eventos de localidades (entregues apenas à sala dos mestres). */
export interface LocalityCreatedPayload {
  locality: LocalityDto;
}

export interface LocalityUpdatedPayload {
  locality: LocalityDto;
  changes: Record<string, unknown>;
}

export interface LocalityDeletedPayload {
  localityId: string;
}

/** Eventos do catálogo de itens (entregues para toda a mesa). */
export interface ItemCreatedPayload {
  item: ItemDto;
}

export interface ItemUpdatedPayload {
  item: ItemDto;
  changes: Record<string, unknown>;
}

export interface ItemDeletedPayload {
  itemId: string;
}

/**
 * Imagem que o mestre está mostrando para a mesa.
 *
 * A apresentação é efêmera (não vai para o banco): vive na memória do
 * servidor enquanto o mestre quiser e é reenviada a quem conectar depois.
 */
export interface PresentationDto {
  id: string;
  /** URL da imagem (`/uploads/...`). */
  imageUrl: string;
  /** Texto alternativo/rótulo mostrado abaixo da imagem. */
  alt: string;
  /** Nome de quem apresentou (o mestre). */
  presentedBy: string;
  at: string;
}

export interface PresentationShownPayload {
  presentation: PresentationDto;
}

export interface PresentationClosedPayload {
  presentationId: string;
}

/** Configuração da mesa alterada (Level Up liberado, nível inicial...). */
export interface GameConfigPayload {
  config: GameConfigDto;
}

/** Estado da reprodução da música ambiente — vai para a mesa inteira. */
export interface MusicStatePayload {
  state: MusicStateDto;
}

/** Catálogo de faixas (só a interface do mestre consome). */
export interface MusicTracksPayload {
  tracks: MusicTrackDto[];
}

/** --- Combate ----------------------------------------------------------------- */

export interface CombatStartedPayload {
  combat: CombatDto;
}

export interface CombatUpdatedPayload {
  combat: CombatDto;
}

export interface CombatTurnPayload {
  combatId: string;
  combatantId: string;
  combatantName: string;
  /** Dono do turno, quando for um personagem de jogador. */
  ownerUserId: string | null;
  round: number;
  index: number;
}

export interface CombatEndedPayload {
  combatId: string;
}

/** Rolagem de dado divulgada para todos — dispara o efeito sonoro. */
/**
 * Origem canônica de uma parte do dano. O frontend só APRESENTA: usa o rótulo
 * que veio no payload e nunca infere a origem (sem lógica exclusiva do
 * Ataque Furtivo, por exemplo).
 */
export type DamagePartSource =
  /** Dado base do golpe/arma. */
  | 'weapon'
  /** Dados de um dano extra (outro tipo, ex.: fogo). */
  | 'extra'
  /** Ataque Furtivo (Ladino). */
  | 'sneakAttack'
  /** Modificador de atributo (FOR/DES...). */
  | 'attribute'
  /** Bônus estruturado da arma (mágico). */
  | 'weaponBonus'
  /** Bônus fixo genérico. */
  | 'flat'
  /** Fúria (Bárbaro). */
  | 'rage'
  /** Bônus de dano da munição. */
  | 'ammo'
  /** Dados extras do Crítico Brutal. */
  | 'critical';

/**
 * Uma parte da quebra de uma parcela de dano. Ex.: o dado da arma (`1d8`,
 * com os resultados rolados), o Ataque Furtivo (`1d6`), o modificador do
 * atributo (`Destreza`, sem dados) ou um bônus fixo (`Fúria`, `Munição`...).
 */
export interface DamagePartPayload {
  /** Origem canônica (a UI não infere; só rotula pelo `label`). */
  source: DamagePartSource;
  /** Rótulo legível já pronto: `Arma`, `Ataque Furtivo`, `Destreza`, `Fúria`... */
  label: string;
  /** Expressão de dados da parte (`1d8`, `2d6`); vazia em bônus fixos. */
  dice: string;
  /** Dados rolados nesta parte (vazio em bônus fixos, como o atributo). */
  rolls: number[];
  /** Valor somado desta parte (dados + bônus dela). */
  value: number;
}

/** Quebra legível de uma parcela: `1d8(4)+1d6(2)+DES(+3)=9`. */
export interface DamageBreakdownPayload {
  parts: DamagePartPayload[];
  /** Total rolado da parcela, antes da defesa do alvo. */
  total: number;
}

export interface DiceRolledPayload {
  kind: 'initiative' | 'attack' | 'damage';
  actorName: string;
  expression: string;
  rolls: number[];
  sides: number;
  modifier: number;
  total: number;
  crit: boolean;
  at: string;
  /** Presente nas rolagens de DANO: a quebra de cada parte da parcela. */
  breakdown?: DamageBreakdownPayload;
}

/** Rolagem da janela de dados divulgada em tempo real. */
export interface TableRollPayload {
  roll: DiceRollDto;
}

/**
 * Janela de dados aberta (ou fechada) por alguém da mesa.
 *
 * `active: false` é enviado ao fechar a janela — inclusive quando o mestre
 * marca a rolagem como privada ou sai da mesa no meio dela.
 */
export interface TableRollActivePayload {
  active: boolean;
  /** Quem está rolando (o autor é carimbado pelo servidor, a partir do token). */
  userId: string;
  actorName: string;
  /** Avatar do personagem (`''` quando não há imagem). */
  avatarUrl: string;
  kind: DiceRollKind;
  /** Perícia/salvaguarda em teste (vazio na rolagem livre). */
  label: string;
  /** Tabuleiro montado por quem está rolando (a mesa assiste; só ele interage). */
  board: RollBoardDto;
  /** Última rolagem do tabuleiro (para quem sincroniza no meio ou depois). */
  lastRoll: DiceRollDto | null;
  at: string;
}

/**
 * Uma PARCELA de dano do ataque (o principal + cada `extraDamage`), com o que
 * foi rolado e o que efetivamente entrou depois da defesa do alvo.
 *
 * `modifier` explica por que `applied` difere de `rolled`: `resistance` (½),
 * `immunity` (0) ou `vulnerability` (×2). `null` = sem defesa contra o tipo.
 */
export interface DamageComponentPayload {
  /** Tipo canônico da parcela ('' quando o dano não tem tipo). */
  type: string;
  /** Expressão textual rolada ("2d6+3"). */
  expression: string;
  /** Total rolado da parcela, antes da defesa do alvo. */
  rolled: number;
  /** Total que entrou no HP depois da defesa do alvo. */
  applied: number;
  modifier: 'resistance' | 'immunity' | 'vulnerability' | null;
  /** Quebra legível do que compôs `rolled` (dados + bônus por parte). */
  breakdown: DamageBreakdownPayload;
}

/** Resultado de um ataque, do teste de acerto ao dano aplicado. */
export interface AttackResolvedPayload {
  attackerName: string;
  attackName: string;
  targetName: string;
  attackRoll: number;
  /**
   * Todos os d20 rolados no teste de ataque (um, ou dois com
   * vantagem/desvantagem). `attackRoll` é o mantido.
   */
  attackRolls: number[];
  /** Rolagem feita com vantagem (2d20, mantém o maior). */
  advantage: boolean;
  /** Rolagem feita com desvantagem (2d20, mantém o menor). */
  disadvantage: boolean;
  attackBonus: number;
  attackTotal: number;
  /** `null` quando o alvo é uma criatura e quem vê é um jogador. */
  targetArmorClass: number | null;
  hit: boolean;
  critical: boolean;
  damageRolled: number;
  damageType: string;
  /** Cada parcela do ataque, com o efeito da defesa do alvo (vazio se errou). */
  components: DamageComponentPayload[];
  /**
   * Dano extra de Ataque Furtivo já somado a `damageRolled` (nulo se não houve).
   * `reason` indica a condição que o habilitou (vantagem / aliado adjacente).
   */
  sneakAttack: { expression: string; total: number; reason: string } | null;
  /** `null` quando a vida do alvo está oculta (criatura vista por jogador). */
  targetHpCurrent: number | null;
  targetHpMax: number | null;
  /** Verdadeiro quando CA/vida do alvo existem mas ficam ocultas para quem vê. */
  targetStatsHidden: boolean;
  at: string;
}

export type ClientEvent = (typeof ClientEvents)[keyof typeof ClientEvents];
export type ServerEvent = (typeof ServerEvents)[keyof typeof ServerEvents];
