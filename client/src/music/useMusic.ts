import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicStateDto, MusicStatePayload, MusicTrackDto, MusicTracksPayload } from '../types';
import {
  deleteMusicTrack,
  fetchMusicState,
  fetchMusicTracks,
  readAudioFile,
  setMusicState,
  skipMusic,
  uploadMusicTrack,
} from './musicApi';

/** De quanto em quanto tempo conferimos o desvio da reprodução local. */
const RESYNC_MS = 2000;

/** Desvio tolerado entre o áudio local e a posição esperada (segundos). */
const DRIFT_TOLERANCE = 0.9;

export interface MusicController {
  state: MusicStateDto | null;
  tracks: MusicTrackDto[];
  /** Posição corrente do áudio local, em segundos (para a barra). */
  position: number;
  /** Duração da faixa, em segundos. */
  duration: number;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  toggleRepeat: () => void;
  select: (trackId: string) => void;
  seek: (seconds: number) => void;
  upload: (file: File) => Promise<void>;
  remove: (trackId: string) => Promise<void>;
  /** Handlers para o `useRealtime` da página. */
  handlers: {
    onMusicState: (payload: MusicStatePayload) => void;
    onMusicTracks: (payload: MusicTracksPayload) => void;
  };
}

/**
 * Segue a música ambiente da mesa.
 *
 * O SERVIDOR manda: cada evento `music:state` traz a faixa e a posição, e este
 * hook só aplica isso a um `<audio>` que vive fora do DOM (por isso o jogador
 * não vê nada — só escuta). Para o mestre, o mesmo hook expõe os comandos, que
 * são enviados por HTTP e voltam para TODOS como evento.
 *
 * Entre um evento e outro a posição é projetada localmente e conferida de
 * tempos em tempos (corrige atraso de buffer/rede). O relógio do servidor não
 * entra na conta: usamos apenas o tempo decorrido desde o último estado.
 */
export function useMusic({ isMaster }: { isMaster: boolean }): MusicController {
  const [state, setState] = useState<MusicStateDto | null>(null);
  const [tracks, setTracks] = useState<MusicTrackDto[]>([]);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Último estado aplicado (lido em callbacks sem recriar o elemento). */
  const stateRef = useRef<MusicStateDto | null>(null);
  /** Ponto de partida da projeção local da posição. */
  const anchorRef = useRef({ position: 0, at: Date.now(), playing: false });
  /** URL da faixa carregada no `<audio>`. */
  const loadedUrlRef = useRef<string | null>(null);
  stateRef.current = state;

  const audio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  /** Onde a faixa deveria estar agora, segundo o último estado do servidor. */
  const expectedPosition = useCallback((): number => {
    const anchor = anchorRef.current;
    if (!anchor.playing) return anchor.position;
    return anchor.position + (Date.now() - anchor.at) / 1000;
  }, []);

  /** Aplica o estado do servidor ao áudio local. */
  const applyState = useCallback(
    (next: MusicStateDto): void => {
      setState(next);
      anchorRef.current = { position: next.position, at: Date.now(), playing: next.playing };

      const element = audio();
      const url = next.track?.url ?? null;

      if (url !== loadedUrlRef.current) {
        // Faixa nova (ou nenhuma): recarrega e posiciona no ponto certo.
        loadedUrlRef.current = url;
        if (url) {
          element.src = url;
          element.currentTime = Math.max(0, next.position);
        } else {
          element.removeAttribute('src');
          element.load();
        }
      } else if (url && element.readyState > 0) {
        const drift = Math.abs(element.currentTime - next.position);
        if (drift > DRIFT_TOLERANCE) element.currentTime = Math.max(0, next.position);
      }

      if (url && next.playing) {
        // Autoplay bloqueado (comum para quem só escuta): tentamos de novo no
        // primeiro gesto do usuário — ver o efeito mais abaixo.
        void element.play().catch(() => undefined);
      } else {
        element.pause();
      }
    },
    [audio],
  );

  // Relógio da barra e duração real do arquivo carregado.
  useEffect(() => {
    const element = audio();
    const onTime = () => setPosition(element.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);

    element.addEventListener('timeupdate', onTime);
    element.addEventListener('durationchange', onDuration);
    element.addEventListener('loadedmetadata', onDuration);

    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('durationchange', onDuration);
      element.removeEventListener('loadedmetadata', onDuration);
      element.pause();
    };
  }, [audio]);

  // Corrige o desvio: se o áudio local saiu do lugar, volta para a projeção.
  useEffect(() => {
    const timer = setInterval(() => {
      const current = stateRef.current;
      if (!current?.playing || !current.track) return;

      const element = audio();
      const expected = expectedPosition();
      if (Math.abs(element.currentTime - expected) > DRIFT_TOLERANCE) {
        element.currentTime = Math.max(0, expected);
      }
    }, RESYNC_MS);

    return () => clearInterval(timer);
  }, [audio, expectedPosition]);

  // Autoplay bloqueado: o primeiro clique/tecla destrava a reprodução.
  useEffect(() => {
    const retry = () => {
      const current = stateRef.current;
      if (current?.playing && current.track) void audio().play().catch(() => undefined);
    };

    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
  }, [audio]);

  // Estado inicial: quem entra no meio de uma música já começa no ponto certo.
  useEffect(() => {
    let active = true;

    void fetchMusicState()
      .then((next) => {
        if (active) applyState(next);
      })
      .catch(() => undefined);

    if (isMaster) {
      void fetchMusicTracks()
        .then((list) => {
          if (active) setTracks(list);
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [applyState, isMaster]);

  /** Roda um comando do mestre e adota o estado que o servidor devolver. */
  const run = useCallback(
    async (action: () => Promise<MusicStateDto>): Promise<void> => {
      setBusy(true);
      try {
        applyState(await action());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao comandar a música.');
      } finally {
        setBusy(false);
      }
    },
    [applyState],
  );

  const toggle = useCallback((): void => {
    const current = stateRef.current;
    if (!current) return;

    if (!current.track) {
      // Sem faixa escolhida, o play começa pela primeira do catálogo.
      const first = tracks[0];
      if (first) void run(() => setMusicState({ trackId: first.id, playing: true }));
      return;
    }

    void run(() => setMusicState({ playing: !current.playing }));
  }, [run, tracks]);

  const next = useCallback((): void => {
    void run(() => skipMusic('next'));
  }, [run]);

  const prev = useCallback((): void => {
    void run(() => skipMusic('prev'));
  }, [run]);

  const toggleRepeat = useCallback((): void => {
    const current = stateRef.current;
    if (!current) return;
    void run(() => setMusicState({ repeat: !current.repeat }));
  }, [run]);

  const select = useCallback(
    (trackId: string): void => {
      void run(() => setMusicState({ trackId, playing: true }));
    },
    [run],
  );

  const seek = useCallback(
    (seconds: number): void => {
      void run(() => setMusicState({ position: Math.max(0, seconds) }));
    },
    [run],
  );

  const upload = useCallback(async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const { dataUrl, duration: measured } = await readAudioFile(file);
      const track = await uploadMusicTrack(dataUrl, file.name.replace(/\.[^.]+$/, ''), measured);
      setTracks((prev) => (prev.some((item) => item.id === track.id) ? prev : [...prev, track]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a faixa.');
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (trackId: string): Promise<void> => {
    setBusy(true);
    try {
      await deleteMusicTrack(trackId);
      setTracks((prev) => prev.filter((item) => item.id !== trackId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover a faixa.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handlers = useMemo(
    () => ({
      onMusicState: (payload: MusicStatePayload) => applyState(payload.state),
      onMusicTracks: (payload: MusicTracksPayload) => setTracks(payload.tracks),
    }),
    [applyState],
  );

  return {
    state,
    tracks,
    position,
    duration,
    busy,
    error,
    clearError: () => setError(null),
    toggle,
    next,
    prev,
    toggleRepeat,
    select,
    seek,
    upload,
    remove,
    handlers,
  };
}
