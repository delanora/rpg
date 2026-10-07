import { useRef } from 'react';
import { Icon } from '../components/Icon';
import { MusicTrackList } from './MusicTrackList';
import type { MusicController } from './useMusic';

/**
 * "Soundpad" — a aba da música ambiente, no mesmo lugar das outras abas.
 *
 * Reúne o que o mestre precisa para montar a playlist e escolher o que toca:
 * enviar arquivos, buscar pelo nome e selecionar qualquer faixa, que começa na
 * hora para a mesa inteira. Os controles de tocar, pausar, passar e o volume
 * ficam na barra do rodapé, disponível em qualquer aba.
 */
export function SoundpadTab({ music }: { music: MusicController }) {
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
    <div className="config-shell">
      <section className="config-card">
        <header className="config-card-head">
          <h2>
            <Icon name="music" size={18} /> Soundpad
          </h2>
          <p>
            Música ambiente da mesa: envie as faixas, escolha o que toca e ajuste o volume. Todos os
            jogadores ouvem a mesma música, no mesmo ponto — e não precisam abrir nada para isso.
          </p>
        </header>

        <div className="music-upload-toolbar">
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
            className="music-upload-file"
            type="file"
            accept="audio/*"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
          />
          <span className="music-upload-hint">
            MP3, OGG, WAV, M4A ou WEBM · até 24 MB por faixa
          </span>
        </div>

        {music.error ? <p className="config-empty config-empty-error">{music.error}</p> : null}

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

        <p className="config-note soundpad-now">
          <Icon name="info" size={14} />{' '}
          {track
            ? `Tocando agora: ${track.name}. Os controles e o volume ficam na barra do rodapé.`
            : 'Nenhuma faixa tocando. Escolha uma da lista para começar.'}
        </p>
      </section>
    </div>
  );
}
