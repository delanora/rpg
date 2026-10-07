import { useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { formatTime } from './format';
import { MusicTrackList } from './MusicTrackList';
import type { MusicController } from './useMusic';

/**
 * Barra de reprodução do mestre, escondida no rodapé.
 *
 * Fica em qualquer aba (o mestre comanda a música de qualquer tela) e mostra a
 * faixa atual, o progresso, o tempo decorrido/total, os controles — anterior,
 * play/pause, próxima, repetir, volume — e a lista completa.
 *
 * Para não brigar com o conteúdo, a barra só sobe quando o mestre aproxima o
 * mouse do rodapé, como a barra de tarefas no modo "ocultar automaticamente".
 * A zona de hover é BEM mais alta que a linha visível: acertar um fio de 2px
 * seria um alvo ruim.
 */
export function MusicPlayerBar({ music }: { music: MusicController }) {
  const [listOpen, setListOpen] = useState(false);
  // Arrastar não dispara um comando por pixel: guardamos o valor e só mandamos
  // ao soltar (ou no teclado, ao soltar a tecla).
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);

  const track = music.state?.track ?? null;
  const playing = music.state?.playing ?? false;
  const repeat = music.state?.repeat ?? false;
  const duration = music.duration || track?.duration || 0;
  const max = Math.max(1, Math.round(duration));
  const shown = seekDraft ?? music.position;
  const volume = volumeDraft ?? music.volume;
  const muted = volume === 0;
  // A parte já percorrida dos controles é desenhada pelo CSS a partir daqui
  // (ver `.music-range` no styles.css).
  const progressFill = { '--music-fill': `${Math.min(100, (shown / max) * 100)}%` } as CSSProperties;
  const volumeFill = { '--music-fill': `${Math.round(volume * 100)}%` } as CSSProperties;

  function commitSeek(): void {
    if (seekDraft === null) return;
    music.seek(seekDraft);
    setSeekDraft(null);
  }

  function commitVolume(): void {
    if (volumeDraft === null) return;
    music.setVolume(volumeDraft);
    setVolumeDraft(null);
  }

  return (
    /* O painel da lista vive DENTRO do dock de propósito: parar o mouse nele
       conta como estar sobre o dock e mantém a barra no lugar. */
    <div className="music-dock">
      <span className="music-dock-line" aria-hidden="true" />

      {listOpen ? (
        <aside className="music-panel" role="dialog" aria-label="Lista de músicas da mesa">
          <header className="music-panel-head">
            <h3>
              <Icon name="music" size={16} /> Músicas da mesa
            </h3>
            <button
              type="button"
              className="music-panel-close"
              aria-label="Fechar a lista"
              onClick={() => setListOpen(false)}
            >
              ×
            </button>
          </header>

          <MusicTrackList
            tracks={music.tracks}
            currentTrackId={track?.id ?? null}
            playing={playing}
            busy={music.busy}
            onSelect={music.select}
            onRemove={(trackId) => void music.remove(trackId)}
            search
            empty="Nenhuma faixa enviada ainda."
          />
        </aside>
      ) : null}

      <div className="music-bar" role="region" aria-label="Música ambiente da mesa">
        <button
          type="button"
          className={listOpen ? 'music-bar-list active' : 'music-bar-list'}
          aria-expanded={listOpen}
          aria-label="Abrir a lista de músicas"
          title="Lista de músicas"
          onClick={() => setListOpen((value) => !value)}
        >
          <Icon name="list" size={14} />
        </button>

        <span className="music-bar-now" title={track?.name ?? ''}>
          <Icon name="music" size={13} />
          <span className="music-bar-title">{track ? track.name : 'Nenhuma faixa tocando'}</span>
        </span>

        <span className="music-bar-time">{formatTime(shown)}</span>

        <input
          className="music-bar-progress music-range"
          style={progressFill}
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(Math.round(shown), max)}
          disabled={!track}
          aria-label="Progresso da música"
          onChange={(event) => setSeekDraft(Number(event.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
        />

        <span className="music-bar-time">{formatTime(duration)}</span>

        <div className="music-bar-controls">
          <button
            type="button"
            disabled={music.tracks.length === 0}
            title="Faixa anterior"
            aria-label="Faixa anterior"
            onClick={music.prev}
          >
            <Icon name="skip-back" size={14} />
          </button>

          <button
            type="button"
            className="music-bar-play"
            disabled={music.tracks.length === 0}
            title={playing ? 'Pausar' : 'Tocar'}
            aria-label={playing ? 'Pausar' : 'Tocar'}
            onClick={music.toggle}
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>

          <button
            type="button"
            disabled={music.tracks.length === 0}
            title="Próxima faixa"
            aria-label="Próxima faixa"
            onClick={music.next}
          >
            <Icon name="skip-forward" size={14} />
          </button>

          <button
            type="button"
            className={repeat ? 'music-bar-repeat active' : 'music-bar-repeat'}
            disabled={!track}
            aria-pressed={repeat}
            title="Repetir a música em andamento"
            aria-label="Repetir a música em andamento"
            onClick={music.toggleRepeat}
          >
            <Icon name="repeat" size={14} />
          </button>
        </div>

        {/* Volume da MESA: vai para todos, e é por isso que o mudo também. */}
        <div className="music-bar-controls music-bar-volume">
          <button
            type="button"
            className={muted ? 'music-bar-mute active' : 'music-bar-mute'}
            aria-pressed={muted}
            title={muted ? 'Reativar o som da mesa' : 'Silenciar a mesa'}
            aria-label={muted ? 'Reativar o som da mesa' : 'Silenciar a mesa'}
            onClick={music.toggleMute}
          >
            <Icon name={muted ? 'mute' : 'volume'} size={14} />
          </button>

          <input
            className="music-bar-volume-range music-range"
            style={volumeFill}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            aria-label="Volume da mesa"
            title={`Volume ${Math.round(volume * 100)}%`}
            onChange={(event) => setVolumeDraft(Number(event.target.value) / 100)}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            onBlur={commitVolume}
          />
        </div>

        {music.error ? (
          <button
            type="button"
            className="music-bar-error"
            title="Fechar o aviso"
            onClick={music.clearError}
          >
            {music.error}
          </button>
        ) : null}
      </div>
    </div>
  );
}
