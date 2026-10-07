import { api } from '../api';
import type { MusicStateDto, MusicTrackDto } from '../types';

/**
 * Lê um arquivo de áudio como data URL e mede a DURAÇÃO no navegador.
 *
 * Mesma estratégia das imagens (o arquivo vai no JSON, sem multipart). A
 * duração medida aqui é o que permite o servidor agendar o fim da faixa e
 * virar a música para a mesa inteira sem depender de ninguém.
 */
export function readAudioFile(file: File): Promise<{ dataUrl: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Não foi possível ler "${file.name}".`));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const probe = new Audio();
      probe.preload = 'metadata';
      // Sem metadados (formato estranho), o upload segue com duração 0: o
      // arquivo toca, mas a virada automática de faixa não é agendada.
      probe.onloadedmetadata = () =>
        resolve({ dataUrl, duration: Number.isFinite(probe.duration) ? probe.duration : 0 });
      probe.onerror = () => resolve({ dataUrl, duration: 0 });
      probe.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}

/** Estado atual da reprodução (o mesmo que o jogador segue). */
export async function fetchMusicState(): Promise<MusicStateDto> {
  const { state } = await api<{ state: MusicStateDto }>('/api/music/state');
  return state;
}

/** Catálogo completo de faixas (só o mestre). */
export async function fetchMusicTracks(): Promise<MusicTrackDto[]> {
  const { tracks } = await api<{ tracks: MusicTrackDto[] }>('/api/music/tracks');
  return tracks;
}

/** Envia uma faixa (data URL) ao catálogo da mesa. */
export async function uploadMusicTrack(
  dataUrl: string,
  name: string,
  duration: number,
): Promise<MusicTrackDto> {
  const { track } = await api<{ track: MusicTrackDto }>('/api/music/tracks', {
    method: 'POST',
    body: { dataUrl, name, duration },
  });
  return track;
}

/** Remove uma faixa (e o arquivo dela). */
export async function deleteMusicTrack(trackId: string): Promise<void> {
  await api(`/api/music/tracks/${trackId}`, { method: 'DELETE' });
}

/** Mudança parcial do estado da reprodução. */
export interface MusicPatch {
  playing?: boolean;
  trackId?: string | null;
  position?: number;
  repeat?: boolean;
  /** Volume de 0 (mudo) a 1 (máximo) — vale para a mesa inteira. */
  volume?: number;
}

/** Comanda a reprodução (tocar, pausar, escolher faixa, buscar posição...). */
export async function setMusicState(patch: MusicPatch): Promise<MusicStateDto> {
  const { state } = await api<{ state: MusicStateDto }>('/api/music/state', {
    method: 'POST',
    body: patch,
  });
  return state;
}

/** Pula para a próxima/anterior. */
export async function skipMusic(direction: 'next' | 'prev'): Promise<MusicStateDto> {
  const { state } = await api<{ state: MusicStateDto }>('/api/music/skip', {
    method: 'POST',
    body: { direction },
  });
  return state;
}
