import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { MusicTrackList } from './MusicTrackList';
import type { MusicController } from './useMusic';

/**
 * Painel de músicas da mesa — abre pelo card "Músicas" do salão.
 *
 * Reúne o que o mestre precisa para montar a playlist e escolher o que toca:
 * enviar arquivos, buscar pelo nome e selecionar qualquer faixa, que começa na
 * hora para a mesa inteira. A reprodução em si é comandada pela barra fixa do
 * rodapé; aqui ele organiza o catálogo e escolhe a música.
 */
export function MusicPanel({ music, onClose }: { music: MusicController; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const track = music.state?.track ?? null;
  const playing = music.state?.playing ?? false;

  // Esc fecha, como nos demais diálogos do painel do mestre.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleFiles(files: FileList | null): void {
    if (!files) return;
    for (const file of Array.from(files)) void music.upload(file);
    // Permite reenviar o mesmo arquivo logo em seguida.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Músicas da mesa">
      <div className="modal music-modal">
        <h2>
          <Icon name="music" size={20} /> Músicas da mesa
        </h2>

        <p className="section-note">
          As faixas ficam guardadas na mesa e tocam para todos ao mesmo tempo. Escolha uma para
          começar — os controles de tocar, pausar e passar ficam na barra do rodapé.
        </p>

        <div className="music-upload-toolbar">
          <button
            type="button"
            className="btn btn-primary"
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

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            fechar
          </button>
        </div>
      </div>
    </div>
  );
}
