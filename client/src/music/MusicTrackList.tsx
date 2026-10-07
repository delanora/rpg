import { useState } from 'react';
import { Icon } from '../components/Icon';
import { SearchField } from '../components/master/SearchField';
import { matchesSearch } from '../components/master/search';
import type { MusicTrackDto } from '../types';
import { formatSize, formatTime } from './format';

interface MusicTrackListProps {
  tracks: MusicTrackDto[];
  currentTrackId: string | null;
  playing: boolean;
  busy: boolean;
  onSelect: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  /** Mostra o campo de busca acima da lista (a playlist do mestre). */
  search?: boolean;
  /** Texto do estado vazio. */
  empty: string;
}

/**
 * Lista de faixas com busca — a mesma no card do salão e no painel que abre
 * pela barra de reprodução, para a escolha da música ser sempre igual.
 */
export function MusicTrackList({
  tracks,
  currentTrackId,
  playing,
  busy,
  onSelect,
  onRemove,
  search = false,
  empty,
}: MusicTrackListProps) {
  const [query, setQuery] = useState('');
  const visible = tracks.filter((track) => matchesSearch(query, track.name));

  return (
    <div className="music-list-wrap">
      {search ? (
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar faixa por nome"
          label="Buscar faixa"
        />
      ) : null}

      {tracks.length === 0 ? (
        <p className="empty-hint">{empty}</p>
      ) : visible.length === 0 ? (
        <p className="empty-hint">Nenhuma faixa corresponde à busca.</p>
      ) : (
        <ul className="music-tracks">
          {visible.map((track) => {
            const current = track.id === currentTrackId;
            return (
              <li key={track.id}>
                <div className={current ? 'music-track active' : 'music-track'}>
                  <button
                    type="button"
                    className="music-track-play"
                    disabled={busy}
                    title={current && playing ? 'Tocando agora' : `Tocar ${track.name}`}
                    aria-label={`Tocar ${track.name}`}
                    onClick={() => onSelect(track.id)}
                  >
                    <Icon name={current && playing ? 'music' : 'play'} size={14} />
                  </button>

                  <span className="music-track-info">
                    <span className="music-track-name">{track.name}</span>
                    <span className="music-track-meta">
                      {formatTime(track.duration)}
                      {track.size ? ` · ${formatSize(track.size)}` : ''}
                    </span>
                  </span>

                  <button
                    type="button"
                    className="music-track-remove"
                    disabled={busy}
                    title="Remover a faixa"
                    aria-label={`Remover ${track.name}`}
                    onClick={() => onRemove(track.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
