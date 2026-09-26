import { useLightbox } from './Lightbox';
import { Icon, type IconName } from './Icon';

interface PortraitProps {
  /** URL da imagem (`/uploads/...`). Vazio mostra o placeholder. */
  src: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Ícone do placeholder quando ainda não há imagem. */
  icon?: IconName;
  className?: string;
  /** Desliga a ampliação ao clicar (ex.: dentro de outro botão de ação). */
  zoomable?: boolean;
}

const ICON_SIZE = { sm: 14, md: 20, lg: 26 } as const;

/**
 * Moldura temática (pergaminho) para ícones de itens, criaturas, NPCs e
 * avatares de personagem. Sem imagem, exibe o ícone genérico do tema.
 *
 * Com imagem, clicar amplia no lightbox do app — e o mestre ainda pode mandar
 * a imagem para a tela de todos os jogadores por ali.
 */
export function Portrait({
  src,
  alt = '',
  size = 'md',
  icon = 'scroll',
  className,
  zoomable = true,
}: PortraitProps) {
  const { open } = useLightbox();
  const base = `portrait portrait-${size}`;

  if (!src) {
    return (
      <span className={className ? `${base} ${className}` : base}>
        <Icon name={icon} size={ICON_SIZE[size]} />
      </span>
    );
  }

  if (!zoomable) {
    return (
      <span className={className ? `${base} ${className}` : base}>
        <img src={src} alt={alt} loading="lazy" />
      </span>
    );
  }

  const zoom = (event: { stopPropagation: () => void }): void => {
    // O ícone costuma ficar dentro de um botão/cartão: o clique amplia a
    // imagem em vez de acionar a ação do cartão.
    event.stopPropagation();
    open(src, alt);
  };

  return (
    <span
      className={className ? `${base} portrait-zoom ${className}` : `${base} portrait-zoom`}
      role="button"
      tabIndex={0}
      title="Ampliar imagem"
      aria-label={alt ? `Ampliar imagem: ${alt}` : 'Ampliar imagem'}
      onClick={zoom}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          zoom(event);
        }
      }}
    >
      <img src={src} alt="" loading="lazy" />
    </span>
  );
}
