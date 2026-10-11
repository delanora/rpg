import type { CSSProperties, ReactNode } from 'react';

/**
 * Ícones temáticos desenhados à mão em SVG (traço de tinta), no lugar de
 * ícones flat genéricos. Todos usam `currentColor`, então herdam a cor do
 * contexto — dourado, vinho, couro etc. — e escalam sem perder nitidez.
 */
export type IconName =
  | 'sword'
  | 'shield'
  | 'heart'
  | 'flask'
  | 'scroll'
  | 'star'
  | 'book'
  | 'quill'
  | 'die'
  | 'crown'
  | 'sun'
  | 'moon'
  | 'bed'
  | 'volume'
  | 'mute'
  | 'users'
  | 'eye'
  | 'bolt'
  | 'wind'
  | 'weight'
  | 'plus'
  | 'minus'
  | 'x'
  | 'sparkle'
  | 'flame'
  | 'dragon'
  | 'bag'
  | 'helmet'
  | 'necklace'
  | 'armor'
  | 'ring'
  | 'legs'
  | 'boots'
  | 'ammo'
  | 'trash'
  | 'info'
  | 'gear'
  | 'search'
  | 'home'
  | 'table'
  | 'coin'
  | 'music'
  | 'list'
  | 'play'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'repeat';

const ICONS: Record<IconName, ReactNode> = {
  sword: (
    <>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
    </>
  ),
  shield: <path d="M12 22c5.5-2.7 9-6.6 9-11V5l-9-3-9 3v6c0 4.4 3.5 8.3 9 11Z" />,
  heart: (
    <path d="M12 20.5C6.5 17 3 13.4 3 9.6 3 6.7 5.3 4.5 8 4.5c1.6 0 3.1.8 4 2 .9-1.2 2.4-2 4-2 2.7 0 5 2.2 5 5.1 0 3.8-3.5 7.4-9 10.9Z" />
  ),
  flask: (
    <>
      <path d="M9.5 3h5" />
      <path d="M10 3v6l-4.3 7.6A2.5 2.5 0 0 0 7.9 20.5h8.2a2.5 2.5 0 0 0 2.2-3.9L14 9V3" />
      <path d="M7 14h10" />
    </>
  ),
  scroll: (
    <>
      <path d="M5 5a2 2 0 0 1 2-2h9l3 3v13a2 2 0 0 0 2-2" />
      <path d="M19 17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  star: (
    <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.6l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z" />
  ),
  book: (
    <>
      <path d="M12 6.2C10.2 4.7 7 4 4 4v15c3 0 6.2.7 8 2.2 1.8-1.5 5-2.2 8-2.2V4c-3 0-6.2.7-8 2.2Z" />
      <path d="M12 6.2v15" />
    </>
  ),
  quill: (
    <>
      <path d="M20 3.5c-6 1-11 5.5-13 12L5.5 20.5 9 19c6.5-2 11-7 11-15.5Z" />
      <path d="M5.5 20.5 12 11" />
    </>
  ),
  die: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  crown: (
    <>
      <path d="M3 18 5 7l5 4.5L12 5l2 6.5L19 7l2 11Z" />
      <path d="M3 18h18" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />,
  /* Cama: travesseiro/estrado e o colchão visto de lado (descanso longo). */
  bed: (
    <>
      <path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
      <path d="M5 10V6a1.8 1.8 0 0 1 1.8-1.8h10.4A1.8 1.8 0 0 1 19 6v4" />
      <path d="M3 17.5h18" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9h3l4-3.5v13L7 15H4Z" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9h3l4-3.5v13L7 15H4Z" />
      <path d="M16 10l5 5M21 10l-5 5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.5 14.6A5.5 5.5 0 0 1 20.5 20" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12C4.5 6.8 8 5 12 5s7.5 1.8 10 7c-2.5 5.2-6 7-10 7s-7.5-1.8-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
  wind: (
    <>
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 12h15a3 3 0 1 1-3 3" />
      <path d="M3 16h8" />
    </>
  ),
  weight: (
    <>
      <path d="M8 8a4 4 0 0 1 8 0" />
      <path d="M6.5 8h11l2 13h-15Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  sparkle: <path d="M12 3l1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7Z" />,
  flame: (
    <path d="M12 2c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-1.5.5-2.8 1.5-4 .5 1.2 1.3 2 2.5 2.3C11 8.5 12 5 12 2Z" />
  ),
  bag: (
    <>
      <path d="M7 9V7a5 5 0 0 1 10 0v2" />
      <path d="M4.5 9h15l-1.2 11.5H5.7Z" />
      <path d="M9.5 12.5v2.5M14.5 12.5v2.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.3A1.3 1.3 0 0 1 10.8 4h2.4a1.3 1.3 0 0 1 1.3 1.3V7" />
      <path d="M6.4 7l1 12.2a1.3 1.3 0 0 0 1.3 1.3h6.6a1.3 1.3 0 0 0 1.3-1.3L18 7" />
      <path d="M10 11v5.6M14 11v5.6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5" />
      <circle cx="12" cy="7.9" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.4" />
      <path d="M15.3 15.3 21 21" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M6.4 9.6V20h11.2V9.6" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  /* Mesa redonda vista de cima: tampo elíptico sobre um pé central. */
  table: (
    <>
      <ellipse cx="12" cy="7.8" rx="8.6" ry="3.2" />
      <path d="M12 11v9.5" />
      <path d="M8.4 20.5h7.2" />
    </>
  ),
  helmet: (
    <>
      <path d="M5 12a7 7 0 0 1 14 0v5.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5Z" />
      <path d="M5 13h3.6l1-2 1.5 2h1.8l1.5-2 1 2H19" />
      <path d="M10 19v-3M14 19v-3" />
    </>
  ),
  necklace: (
    <>
      <path d="M5 4c0 5.2 2.6 8.7 7 9.7" />
      <path d="M19 4c0 5.2-2.6 8.7-7 9.7" />
      <path d="M12 13.5l1.9 2.4L12 20.5l-1.9-4.6Z" />
    </>
  ),
  armor: (
    <>
      <path d="M8 3.5 5 5.5V12c0 4.2 2.8 7.3 7 8.8 4.2-1.5 7-4.6 7-8.8V5.5l-3-2-2 2H10Z" />
      <path d="M10 5.5h4" />
      <path d="M12 9.5v6" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="14.8" r="5" />
      <path d="M9.7 9.8 12 4.2l2.3 5.6" />
      <path d="M10.6 7h2.8" />
    </>
  ),
  legs: (
    <>
      <path d="M7 3h10l-.8 18h-3.1L12 11l-1.1 10H7.8Z" />
      <path d="M7.2 7h9.6" />
    </>
  ),
  boots: (
    <>
      <path d="M7.5 3h4.2v9.4c0 1.1.6 2 1.6 2.5l3.1 1.5c1.6.8 2.6 2.4 2.6 4.1H7.5Z" />
      <path d="M7.5 20.5h11.5" />
      <path d="M7.5 7h4.2" />
    </>
  ),
  ammo: (
    <>
      <path d="M9 3.5v6M12 3.5v6M15 3.5v6" />
      <path d="M7 10h10l-1 11H8Z" />
      <path d="M9 6 9.6 4M12 6l.6-2M15 6l.6-2" />
    </>
  ),
  dragon: (
    <>
      {/* Chifres recurvados para trás */}
      <path d="M9.4 8.2C7.8 6.4 6.4 5 4.4 4.2c1.6 2 2.4 3.2 3.6 5" />
      <path d="M14.6 8.2c1.6-1.8 3-3.2 5-4-1.6 2-2.4 3.2-3.6 5" />
      {/* Cabeça (focinho afilado) */}
      <path d="M12 6.8C10.5 6.8 9.2 7.4 8.6 9c-.6 1.6-.8 3.2 0 4.8.8 1.6 2.2 3.2 3.4 4.8 1.2-1.6 2.6-3.2 3.4-4.8.8-1.6.6-3.2 0-4.8C14.8 7.4 13.5 6.8 12 6.8Z" />
      {/* Sobrancelha */}
      <path d="M9 9.5c1.4-.8 4.6-.8 6 0" />
      {/* Olhos */}
      <path d="M9 11.2l2.2.5-2 1.1Z" fill="currentColor" stroke="none" />
      <path d="M15 11.2l-2.2.5 2 1.1Z" fill="currentColor" stroke="none" />
      {/* Narinas */}
      <circle cx="11" cy="13.3" r=".55" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13.3" r=".55" fill="currentColor" stroke="none" />
      {/* Boca e presas */}
      <path d="M9.7 14.6c1.2 1 3.4 1 4.6 0" />
      <path d="M10.2 15.4l.7.2-.5 1.1Z" fill="currentColor" stroke="none" />
      <path d="M13.8 15.4l-.7.2.5 1.1Z" fill="currentColor" stroke="none" />
    </>
  ),
  /* Nota com haste dupla: a marca da música ambiente da mesa. */
  music: (
    <>
      <path d="M9 17.5V5.5l11-2.2v12" />
      <circle cx="6" cy="17.8" r="3.1" />
      <circle cx="17" cy="15.3" r="3.1" />
    </>
  ),
  /* Lista: as três linhas com marcadores (abre a playlist do mestre). */
  list: (
    <>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <circle cx="4.4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  'skip-back': (
    <>
      <path d="M19 5.5v13L9.5 12Z" fill="currentColor" stroke="none" />
      <path d="M6 5.5v13" />
    </>
  ),
  'skip-forward': (
    <>
      <path d="M5 5.5v13L14.5 12Z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" />
    </>
  ),
  /* Loop: a seta que volta — "repetir a música em andamento". */
  repeat: (
    <>
      <path d="M4.5 10a5.5 5.5 0 0 1 5.5-5.5H19" />
      <path d="M15.8 1.6 19.6 4.5l-3.8 2.9" />
      <path d="M19.5 14a5.5 5.5 0 0 1-5.5 5.5H5" />
      <path d="M8.2 22.4 4.4 19.5l3.8-2.9" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 7.5v-1.2M12 17.7v-1.2M16.5 12h1.2M4.3 12h1.2" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/** Ícone temático. Sem `title`, é decorativo e fica oculto para leitores de tela. */
export function Icon({ name, size = 20, className, title, style }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
