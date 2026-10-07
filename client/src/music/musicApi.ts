import { api } from '../api';
import type { MusicStateDto, MusicTrackDto } from '../types';

/**
 * Mede a duração de um áudio a partir de uma URL (data URL ou `/uploads/...`).
 *
 * O caminho normal é o `loadedmetadata`, mas um MP3 de taxa variável costuma
 * chegar com `duration === Infinity` enquanto o navegador não conhece o arquivo
 * inteiro — e era daí que vinha a duração 0 salva no catálogo (sem duração o
 * servidor não consegue agendar o fim da faixa, então nem o repetir nem a
 * virada automática acontecem). Aqui tentamos, nesta ordem:
 *   1. `duration` dos metadados;
 *   2. o fim de `seekable` (o total já baixado);
 *   3. arrastar o `currentTime` para o fim, o que faz o navegador varrer o
 *      arquivo e recalcular a duração (`durationchange`).
 *
 * Devolve 0 quando realmente não dá para saber — aí a faixa toca, mas quem
 * manda no fim é o arquivo, não a mesa.
 */
export function measureAudioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';

    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** Valor conhecido AGORA, ou 0 se ainda não dá para saber. */
    function known(): number {
      if (Number.isFinite(probe.duration) && probe.duration > 0) return probe.duration;
      const seekableEnd = probe.seekable?.length ? probe.seekable.end(0) : NaN;
      return Number.isFinite(seekableEnd) && seekableEnd > 0 ? seekableEnd : 0;
    }

    function finish(duration: number): void {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      probe.removeAttribute('src');
      probe.load();
      resolve(duration);
    }

    function attempt(): void {
      const duration = known();
      if (duration > 0) finish(duration);
    }

    probe.addEventListener('loadedmetadata', () => {
      if (known() > 0) {
        attempt();
        return;
      }
      // Duração desconhecida: pedir o fim do arquivo força o navegador a
      // calcular o total e emitir `durationchange`.
      probe.addEventListener('durationchange', attempt);
      probe.addEventListener('timeupdate', attempt);
      probe.currentTime = 1e7;
    });

    // Um arquivo ilegível não pode travar o upload: segue com duração 0.
    probe.addEventListener('error', () => finish(0));
    timer = setTimeout(() => finish(known()), 12_000);
    probe.src = src;
  });
}

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
      void measureAudioDuration(dataUrl).then((duration) => resolve({ dataUrl, duration }));
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

/**
 * Corrige a duração de uma faixa já enviada.
 *
 * Serve para o catálogo que ficou sem duração (upload antigo, ou um navegador
 * que não conseguiu medir o arquivo) — sem ela o servidor não agenda o fim da
 * faixa e o repetir não funciona.
 */
export async function updateMusicTrackDuration(
  trackId: string,
  duration: number,
): Promise<MusicTrackDto> {
  const { track } = await api<{ track: MusicTrackDto }>(`/api/music/tracks/${trackId}`, {
    method: 'PATCH',
    body: { duration },
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
