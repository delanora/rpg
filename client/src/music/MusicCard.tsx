import { useRef } from 'react';
import { Icon } from '../components/Icon';
import { MusicTrackList } from './MusicTrackList';
import type { MusicController } from './useMusic';

/**
 * Card de música do salão do mestre: envia arquivos, mostra o catálogo e
 * escolhe a faixa. A reprodução em si é comandada pela barra fixa — aqui o
 * mestre organiza a playlist e escolhe o que tocar.
 */
export function MusicCard({ music }: { music: MusicController }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const track = music.state?.track ?? null;
  const playing = music.state?.playing ?? false;

  function handleFiles(files: FileList | null): void {
    if (!files) return;
    for (const file of Array.from(files)) void music.upload(file);
    // Permite reenviar o mesmo arquivo logo em seguida.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <section className="home-section music-card">
      <h3 className="home-section-title">
        <Icon name="music" size={16} /> Músicas
      </h3>

      <div className="music-card-toolbar">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={music.busy}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="plus" size={14} /> {music.busy ? 'enviando...' : 'enviar faixa'}
        </button>
        <input
          ref={inputRef}
          className="music-card-file"
          type="file"
          accept="audio/*"
          multiple
          onChange={(event) => handleFiles(event.target.files)}
        />
        <span className="music-card-hint">
          MP3, OGG, WAV, M4A ou WEBM · até 24 MB por faixa
        </span>
      </div>

      {music.error ? <p className="form-error">{music.error}</p> : null}

      <MusicTrackList
        tracks={music.tracks}
        currentTrackId={track?.id ?? null}
        playing={playing}
        busy={music.busy}
        onSelect={music.select}
        onRemove={(trackId) => void music.remove(trackId)}
        search
        empty="Nenhuma faixa enviada ainda — envie um arquivo para começar."
      />
    </section>
  );
}
