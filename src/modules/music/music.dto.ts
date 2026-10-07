/** Faixa de música da mesa (o arquivo vive em `uploads/music/`). */
export interface MusicTrackDto {
  id: string;
  name: string;
  /** URL pública do arquivo (`/uploads/music/...`). */
  url: string;
  /** Duração em segundos (0 = desconhecida). */
  duration: number;
  /** Tamanho do arquivo em bytes. */
  size: number;
  createdAt: string;
}

/**
 * Estado da reprodução, tal como vai para a mesa.
 *
 * `position` é a posição no instante `at`: enquanto `playing` for verdadeiro, a
 * posição corrente é `position + (agora - at)`. A FAIXA vem resolvida de
 * propósito — o jogador só escuta e não recebe o catálogo, então precisa saber
 * qual arquivo tocar sem consultar a lista.
 */
export interface MusicStateDto {
  track: MusicTrackDto | null;
  playing: boolean;
  position: number;
  /** Repete a faixa atual em loop em vez de passar para a próxima. */
  repeat: boolean;
  at: string;
}
