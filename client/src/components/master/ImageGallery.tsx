import type { LocalityImage } from '../../types';
import { Icon } from '../Icon';
import { useLightbox } from '../Lightbox';

interface ImageGalleryProps {
  images: LocalityImage[];
  /** Rótulo do botão de envio (ex.: "+ adicionar imagens"). */
  addLabel: string;
  uploading: boolean;
  error: string | null;
  onAdd: (files: FileList | null) => void;
  onRemove: (url: string) => void;
  /** Texto alternativo quando a imagem não tem nome próprio. */
  altFallback: string;
}

/**
 * Galeria de imagens do mestre (região ou localidade): envio múltiplo, remoção
 * e clique para ampliar — de onde ele também pode mostrar a imagem aos
 * jogadores pelo lightbox.
 */
export function ImageGallery({
  images,
  addLabel,
  uploading,
  error,
  onAdd,
  onRemove,
  altFallback,
}: ImageGalleryProps) {
  const { open } = useLightbox();

  return (
    <>
      <div className="toolbar">
        <label className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}>
          {uploading ? 'enviando...' : addLabel}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
            onChange={(event) => {
              onAdd(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {images.length === 0 ? (
        <p className="empty-hint">Nenhuma imagem adicionada ainda.</p>
      ) : (
        <ul className="image-grid">
          {images.map((image) => (
            <li key={image.url} className="image-card">
              <button
                type="button"
                className="image-zoom"
                title="Ampliar imagem"
                aria-label={`Ampliar imagem${image.name ? `: ${image.name}` : ''}`}
                onClick={() => open(image.url, image.name || altFallback)}
              >
                <img src={image.url} alt="" loading="lazy" />
              </button>
              <button
                type="button"
                className="image-remove"
                title="Remover imagem"
                aria-label="Remover imagem"
                onClick={() => onRemove(image.url)}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
