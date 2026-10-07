import type { MusicState, MusicTrack } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage, saveDataUrlAudio } from '../../lib/uploads.js';
import { ServerEvents } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import type { MusicStateDto, MusicTrackDto } from './music.dto.js';
import type { MusicPatchInput, UploadTrackInput } from './music.schema.js';

/**
 * Música ambiente da mesa.
 *
 * O SERVIDOR é a fonte de verdade: o mestre manda as ações por HTTP, o estado
 * é persistido na linha única de `music_state` e publicado como `music:state`
 * para a mesa inteira. Ninguém toca nada por conta própria — mestre e jogadores
 * só SEGUEM o estado, então todos ouvem a mesma faixa no mesmo ponto.
 *
 * Como a duração de cada faixa é conhecida (medida no upload), o servidor
 * também agenda o fim: com `repeat` a faixa recomeça, sem ele passa para a
 * próxima. Assim a virada de faixa não depende de nenhum navegador aberto.
 */

/** Linha única do estado da reprodução. */
const STATE_ID = 'main';

/** De quanto em quanto tempo o servidor reafirma o estado (corrige desvio). */
const HEARTBEAT_MS = 10_000;

function toTrackDto(track: MusicTrack): MusicTrackDto {
  return {
    id: track.id,
    name: track.name,
    url: track.url,
    duration: track.duration,
    size: track.size,
    createdAt: track.createdAt.toISOString(),
  };
}

/** Catálogo na ordem de envio (mais antiga primeiro) — é a ordem da playlist. */
export async function listTracks(): Promise<MusicTrackDto[]> {
  const tracks = await prisma.musicTrack.findMany({ orderBy: { createdAt: 'asc' } });
  return tracks.map(toTrackDto);
}

/** Linha única do estado, criada na primeira leitura. */
async function readState(): Promise<MusicState> {
  return prisma.musicState.upsert({
    where: { id: STATE_ID },
    update: {},
    create: { id: STATE_ID },
  });
}

/**
 * Posição corrente. Enquanto toca, a posição gravada é só o ponto de partida
 * (válido em `updatedAt`); o resto é o tempo decorrido desde então.
 */
function livePosition(state: MusicState): number {
  if (!state.playing) return state.position;
  return state.position + (Date.now() - state.updatedAt.getTime()) / 1000;
}

/** Estado pronto para ir à mesa: faixa resolvida e posição "ao vivo". */
export async function getState(): Promise<MusicStateDto> {
  const state = await readState();
  const track = state.trackId
    ? await prisma.musicTrack.findUnique({ where: { id: state.trackId } })
    : null;

  return {
    track: track ? toTrackDto(track) : null,
    playing: state.playing && track !== null,
    position: Math.max(0, livePosition(state)),
    repeat: state.repeat,
    at: new Date().toISOString(),
  };
}

function publish(state: MusicStateDto): void {
  try {
    getBroadcaster().toTable(ServerEvents.MUSIC_STATE, { state });
  } catch (error) {
    console.error('[music] falha ao publicar o estado em tempo real:', error);
  }
}

// --- Temporizadores ----------------------------------------------------------

let endTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function clearTimers(): void {
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** (Re)agenda o fim da faixa e o reforço periódico do estado. */
async function schedule(): Promise<void> {
  clearTimers();

  const state = await readState();
  if (!state.playing || !state.trackId) return;

  const track = await prisma.musicTrack.findUnique({ where: { id: state.trackId } });
  if (!track) return;

  heartbeat = setInterval(() => {
    void getState()
      .then(publish)
      .catch(() => undefined);
  }, HEARTBEAT_MS);

  if (track.duration > 0) {
    const remaining = Math.max(0, track.duration - livePosition(state));
    endTimer = setTimeout(() => {
      void onTrackEnded();
    }, remaining * 1000);
  }
}

/**
 * Fim da faixa: com `repeat`, a MESMA recomeça do zero; sem ele, passamos para
 * a próxima (e a última dá a volta na primeira). Quem decide é o servidor, com
 * um único broadcast — a mesa inteira vira junto.
 */
async function onTrackEnded(): Promise<void> {
  const state = await readState();
  if (!state.playing) return;

  if (state.repeat && state.trackId) {
    await applyPatch({ trackId: state.trackId, playing: true, position: 0 });
    return;
  }

  await skip('next');
}

/**
 * Prepara o serviço no boot. Como o estado é persistido, uma reinicialização
 * no meio de uma faixa continua de onde o tempo "andaria": se o fim já passou,
 * o agendamento dispara na hora e a mesa recebe a próxima faixa.
 */
export function initMusic(): void {
  void readState()
    .then(() => schedule())
    .catch(() => undefined);
}

// --- Ações do mestre ---------------------------------------------------------

/**
 * Aplica um patch ao estado, persiste, publica para a mesa e reajusta os
 * temporizadores. É o ÚNICO caminho de escrita — toda ação do mestre passa por
 * aqui, então nunca há dois estados divergentes.
 */
export async function applyPatch(patch: MusicPatchInput): Promise<MusicStateDto> {
  const current = await readState();

  // A posição gravada é sempre a posição AO VIVO: pausar no meio da faixa
  // precisa guardar onde ela estava, não o ponto de partida antigo.
  let position = livePosition(current);
  const trackId = patch.trackId !== undefined ? patch.trackId : current.trackId;
  let playing = patch.playing !== undefined ? patch.playing : current.playing;
  const repeat = patch.repeat !== undefined ? patch.repeat : current.repeat;

  if (patch.trackId !== undefined && patch.trackId !== current.trackId) {
    // Troca de faixa: começa do zero (salvo quando o patch pede uma posição).
    position = patch.position ?? 0;
  } else if (patch.position !== undefined) {
    position = patch.position;
  }

  if (trackId === null) {
    // Sem faixa escolhida não há o que tocar.
    playing = false;
    position = 0;
  }

  await prisma.musicState.update({
    where: { id: STATE_ID },
    data: { trackId, playing, position, repeat },
  });

  const dto = await getState();
  publish(dto);
  await schedule();
  return dto;
}

/** Próxima/anterior, dando a volta na lista. */
export async function skip(direction: 'next' | 'prev'): Promise<MusicStateDto> {
  const tracks = await listTracks();
  const current = await readState();

  if (tracks.length === 0) {
    return applyPatch({ playing: false, position: 0 });
  }

  const index = current.trackId ? tracks.findIndex((track) => track.id === current.trackId) : -1;
  const step = direction === 'next' ? 1 : -1;
  // Sem faixa atual, "próxima" começa na primeira e "anterior" na última.
  const base = index === -1 ? (direction === 'next' ? -1 : 0) : index;
  const next = tracks[(base + step + tracks.length) % tracks.length];

  // `position: 0` também reinicia quando a "próxima" é a mesma faixa (lista de
  // uma só).
  return applyPatch({ trackId: next.id, playing: true, position: 0 });
}

/** Publica o catálogo novo (a lista só existe na interface do mestre). */
async function publishTracks(): Promise<void> {
  try {
    getBroadcaster().toMasters(ServerEvents.MUSIC_TRACKS, { tracks: await listTracks() });
  } catch (error) {
    console.error('[music] falha ao publicar o catálogo em tempo real:', error);
  }
}

/** Grava uma faixa enviada como data URL e publica o catálogo novo. */
export async function addTrack(input: UploadTrackInput): Promise<MusicTrackDto> {
  const stored = await saveDataUrlAudio(input.dataUrl, input.name);
  const track = await prisma.musicTrack.create({
    data: {
      name: input.name.trim(),
      url: stored.url,
      duration: Math.max(0, input.duration ?? 0),
      size: stored.size,
    },
  });

  await publishTracks();
  return toTrackDto(track);
}

/** Remove uma faixa (o arquivo junto). Se era a que tocava, a música para. */
export async function deleteTrack(id: string): Promise<void> {
  const track = await prisma.musicTrack.findUnique({ where: { id } });
  if (!track) throw new HttpError('Faixa não encontrada.', 404);

  await prisma.musicTrack.delete({ where: { id } });
  await deleteUploadedImage(track.url);

  const state = await readState();
  if (state.trackId === id) {
    await prisma.musicState.update({
      where: { id: STATE_ID },
      data: { trackId: null, playing: false, position: 0 },
    });
    publish(await getState());
    await schedule();
  }

  await publishTracks();
}
