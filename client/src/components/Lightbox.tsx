import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth';
import { presentImage } from '../presentationApi';
import { Icon } from './Icon';

interface LightboxContextValue {
  /** Abre uma imagem ampliada no centro da tela (ignora `src` vazio). */
  open: (src: string, alt?: string) => void;
}

const LightboxContext = createContext<LightboxContextValue>({ open: () => {} });

/** Acesso ao lightbox de qualquer componente (usado pelo `Portrait`). */
export function useLightbox(): LightboxContextValue {
  return useContext(LightboxContext);
}

interface OpenImage {
  src: string;
  alt: string;
}

/**
 * Lightbox único do app: clicar em um ícone/retrato abre a imagem no centro da
 * tela, com o fundo escurecido e uma moldura no tema da página.
 *
 * Quando quem abre é o mestre, aparece o botão "mostrar aos jogadores", que
 * coloca a mesma imagem na tela de todos até ele mandar fechar.
 */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [image, setImage] = useState<OpenImage | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((src: string, alt = '') => {
    if (!src) return;
    setError(null);
    setImage({ src, alt });
  }, []);

  const close = useCallback(() => setImage(null), []);

  // Fecha com Esc e trava a rolagem do fundo enquanto a imagem está aberta.
  useEffect(() => {
    if (!image) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setImage(null);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [image]);

  const value = useMemo(() => ({ open }), [open]);

  const showToPlayers = useCallback(async () => {
    if (!image) return;
    setPresenting(true);
    setError(null);

    try {
      await presentImage(image.src, image.alt);
      setImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível mostrar a imagem.');
    } finally {
      setPresenting(false);
    }
  }, [image]);

  return (
    <LightboxContext.Provider value={value}>
      {children}

      {image
        ? createPortal(
            <div className="lightbox" role="dialog" aria-modal="true" onClick={close}>
              <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="lightbox-close"
                  title="Fechar imagem"
                  aria-label="Fechar imagem"
                  onClick={close}
                >
                  <Icon name="x" size={16} />
                </button>

                <img className="lightbox-image" src={image.src} alt={image.alt} />

                {image.alt ? <p className="lightbox-caption">{image.alt}</p> : null}

                {error ? <p className="form-error">{error}</p> : null}

                {user?.role === 'MASTER' ? (
                  <div className="lightbox-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => void showToPlayers()}
                      disabled={presenting}
                    >
                      <Icon name="eye" size={16} />
                      {presenting ? 'mostrando...' : 'mostrar aos jogadores'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </LightboxContext.Provider>
  );
}
