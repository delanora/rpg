import { Icon, type IconName } from './Icon';

interface PortraitProps {
  /** URL da imagem (`/uploads/...`). Vazio mostra o placeholder. */
  src: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Ícone do placeholder quando ainda não há imagem. */
  icon?: IconName;
  className?: string;
}

const ICON_SIZE = { sm: 14, md: 20, lg: 26 } as const;

/**
 * Moldura temática (pergaminho) para ícones de itens, criaturas, NPCs e
 * avatares de personagem. Sem imagem, exibe o ícone genérico do tema.
 */
export function Portrait({ src, alt = '', size = 'md', icon = 'scroll', className }: PortraitProps) {
  return (
    <span className={className ? `portrait portrait-${size} ${className}` : `portrait portrait-${size}`}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" />
      ) : (
        <Icon name={icon} size={ICON_SIZE[size]} />
      )}
    </span>
  );
}
