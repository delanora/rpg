import type { ReactNode } from 'react';
import type { RaceOption } from '../types';

/**
 * Silhuetas de ROSTO das raças e sub-raças, no mesmo traço de "tinta"
 * desenhado à mão dos ícones de `Icon.tsx` (viewBox 24×24, `currentColor`,
 * pontas arredondadas). Substituem a inicial estilizada nos cards do passo 3 do
 * assistente de criação.
 *
 * Todas partem do MESMO rosto humanoide genérico (contorno, olhos, nariz e
 * boca) e ganham os traços que caracterizam cada raça. As sub-raças reusam o
 * rosto da raça base e acrescentam um pequeno adereço que combina com o nome:
 * a do Anão da Colina ganha colinas, a do Anão da Montanha um pico, a do Alto
 * Elfo uma estrela, a do Elfo da Floresta uma folha, a do Drow uma lua, etc.
 *
 * Raças personalizadas (sem id do catálogo) caem no rosto genérico.
 */

// --- Peças compartilhadas ---------------------------------------------------

/** Contorno do rosto (oval) com olhos, nariz e boca. */
const FACE = (
  <>
    <ellipse cx="12" cy="9.7" rx="4.5" ry="5.3" />
    <circle cx="10.15" cy="9.2" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="13.85" cy="9.2" r="0.55" fill="currentColor" stroke="none" />
    <path d="M12 10.4v1.7" />
    <path d="M10.6 13.6c0.9 0.7 2.1 0.7 3 0" />
  </>
);

/** Orelhas arredondadas (humano, anão, gnomo, halfling, meio-orco, tiefling). */
const ROUND_EARS = (
  <>
    <path d="M7.7 9.1c-0.85-0.35-1.45 0.15-1.45 0.85s0.6 1.2 1.45 1" />
    <path d="M16.3 9.1c0.85-0.35 1.45 0.15 1.45 0.85s-0.6 1.2-1.45 1" />
  </>
);

/** Orelhas longas e pontudas do elfo. */
const ELF_EARS = (
  <>
    <path d="M7.6 8.6 4.7 6.3c1.4-0.3 2.7 0.1 3.4 1.1" />
    <path d="M16.4 8.6l2.9-2.3c-1.4-0.3-2.7 0.1-3.4 1.1" />
  </>
);

// --- Rostos das raças base --------------------------------------------------

const HUMAN_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    <path d="M7.7 7.1c0.7-1.9 2.4-3.1 4.3-3.1s3.6 1.2 4.3 3.1" />
  </>
);

const ELF_FACE: ReactNode = (
  <>
    {FACE}
    {ELF_EARS}
  </>
);

const HALF_ELF_FACE: ReactNode = (
  <>
    {FACE}
    <path d="M7.8 8.9 5.8 7.4c1-0.25 2 0.05 2.6 0.8" />
    <path d="M16.2 8.9l2-1.5c-1-0.25-2 0.05-2.6 0.8" />
    <path d="M8.2 7.2c0.7-1.7 2.2-2.7 3.8-2.7s3.1 1 3.8 2.7" />
  </>
);

const DWARF_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    {/* Barba larga cobrindo o queixo. */}
    <path d="M7.4 10.7c0 3.9 2 6.3 4.6 6.3s4.6-2.4 4.6-6.3c-1.2 1-2.7 1.6-4.6 1.6s-3.4-0.6-4.6-1.6Z" />
  </>
);

const GNOME_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    {/* Gorro pontudo. */}
    <path d="M7.6 6.8C8.2 4.7 9.9 3.5 12 3.5s3.8 1.2 4.4 3.3" />
    <path d="M12 3.5c0.1-1.1 0.7-1.9 1.7-2.4-0.2 1.1-0.3 2.2-0.2 3.1" />
  </>
);

const HALFLING_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    {/* Cabelo cacheado. */}
    <path d="M7.9 7.2c-0.4-1.9 0.8-3.6 2.6-4" />
    <path d="M16.1 7.2c0.4-1.9-0.8-3.6-2.6-4" />
    <path d="M7.9 7.2c1.2-0.8 2.6-1.2 4.1-1.2s2.9 0.4 4.1 1.2" />
  </>
);

const HALF_ORC_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    {/* Sobrancelha pesada e presas. */}
    <path d="M7.9 7.9 11.3 8.7M16.1 7.9 12.7 8.7" />
    <path d="M9.7 14.1l-0.5 1.7M14.3 14.1l0.5 1.7" />
  </>
);

const TIEFLING_FACE: ReactNode = (
  <>
    {FACE}
    {ROUND_EARS}
    {/* Chifres recurvados e cavanhaque pontudo. */}
    <path d="M8.3 5.6C7 4.2 5.8 3.8 4.6 4.1c0.8 1.1 1.2 2.3 1.3 3.5" />
    <path d="M15.7 5.6c1.3-1.4 2.5-1.8 3.7-1.5-0.8 1.1-1.2 2.3-1.3 3.5" />
    <path d="M12 15v2.4M11.2 16l0.8 1.4 0.8-1.4" />
  </>
);

const DRAGONBORN_FACE: ReactNode = (
  <>
    <ellipse cx="12" cy="10" rx="4.6" ry="4.9" />
    <circle cx="10.2" cy="9.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="13.8" cy="9.5" r="0.55" fill="currentColor" stroke="none" />
    {/* Focinho e narinas. */}
    <path d="M9.7 12.4h4.6" />
    <path d="M10.2 13.7h3.6" />
    <path d="M10.8 12.4v-0.5M13.2 12.4v-0.5" />
    {/* Sobrancelhas e chifres. */}
    <path d="M8.7 8.3c1.3-0.7 2.4-0.7 3.4 0M12 8.3c1-0.7 2.1-0.7 3.4 0" />
    <path d="M8.9 6.2 7.2 3.6c1.3 0.2 2.4 0.9 3.2 1.8" />
    <path d="M15.1 6.2l1.7-2.6c-1.3 0.2-2.4 0.9-3.2 1.8" />
    {/* Presas. */}
    <path d="M10.4 14.7l0.4 1M13.6 14.7l-0.4 1" />
  </>
);

// --- Adereços das sub-raças -------------------------------------------------

/** Colinas suaves (Anão da Colina). */
const HILLS: ReactNode = (
  <>
    <path d="M15.6 19.6c0.5-1.3 1.1-1.9 1.7-1.9s1.2 0.6 1.7 1.9" />
    <path d="M18.6 19.6c0.4-0.9 0.9-1.3 1.4-1.3s1 0.4 1.4 1.3" />
    <path d="M14.8 19.6h7" />
  </>
);

/** Pico de montanha com neve (Anão da Montanha). */
const PEAK: ReactNode = (
  <>
    <path d="M16.2 19.6 18.6 15.2l2.4 4.4Z" />
    <path d="M17.4 17.1h2.4" />
  </>
);

/** Estrela de quatro pontas (Alto Elfo). */
const STAR: ReactNode = (
  <path
    d="M19.3 14.7l0.62 2 2.08 0.62-2.08 0.62-0.62 2-0.62-2-2.08-0.62 2.08-0.62Z"
    fill="currentColor"
    stroke="none"
  />
);

/** Folha (Elfo da Floresta e Gnomo da Floresta). */
const LEAF: ReactNode = (
  <g transform="rotate(-35 19 17.3)">
    <ellipse cx="19" cy="17.3" rx="1.4" ry="3" />
    <path d="M19 14.6v5.4" />
  </g>
);

/** Lua crescente (Drow). */
const MOON: ReactNode = (
  <path d="M17.8 14.8a3.3 3.3 0 0 0 4.4 4.2 3.9 3.9 0 1 1-4.4-4.2Z" />
);

/** Gema lapidada (Gnomo da Rocha). */
const GEM: ReactNode = (
  <>
    <path d="M18.4 14.6 21.4 16.4 20.4 19.6h-4L15.4 16.4Z" />
    <path d="M15.4 16.4h6M18.4 14.6 16.9 16.4l1.5 3.2 1.5-3.2Z" />
  </>
);

/** Pena leve (Halfling Pé-Leve). */
const FEATHER: ReactNode = (
  <>
    <path d="M21.2 14.2c0.3 1.9-0.9 3.7-2.8 4.3-1.2 0.4-2.4 0.2-3.4-0.4 0.4-1.9 1.7-3.4 3.6-4 0.9-0.3 1.7-0.3 2.6 0.1Z" />
    <path d="M15 18.1 18.2 15" />
  </>
);

/** Pedra robusta (Halfling Robusto). */
const BOULDER: ReactNode = (
  <>
    <path d="M18.6 14.6c1.7-0.5 3.4 0.5 3.9 2.1 0.5 1.6-0.5 3.3-2.1 3.8-1.6 0.5-3.3-0.5-3.8-2.1-0.5-1.6 0.4-3.3 2-3.8Z" />
    <path d="M17.2 16.6c0.9-0.6 2-0.8 3-0.5" />
  </>
);

// --- Catálogo por id --------------------------------------------------------

/** Rosto de cada raça/sub-raça, pelo id do catálogo (`raceId`/`subraceId`). */
const FACES: Record<string, ReactNode> = {
  // Raças base.
  human: HUMAN_FACE,
  elf: ELF_FACE,
  'half-elf': HALF_ELF_FACE,
  dwarf: DWARF_FACE,
  gnome: GNOME_FACE,
  halfling: HALFLING_FACE,
  'half-orc': HALF_ORC_FACE,
  tiefling: TIEFLING_FACE,
  dragonborn: DRAGONBORN_FACE,

  // Sub-raças (rosto da raça base + adereço).
  'hill-dwarf': (
    <>
      {DWARF_FACE}
      {HILLS}
    </>
  ),
  'mountain-dwarf': (
    <>
      {DWARF_FACE}
      {PEAK}
    </>
  ),
  'high-elf': (
    <>
      {ELF_FACE}
      {STAR}
    </>
  ),
  'wood-elf': (
    <>
      {ELF_FACE}
      {LEAF}
    </>
  ),
  'drow-elf': (
    <>
      {ELF_FACE}
      {MOON}
    </>
  ),
  'forest-gnome': (
    <>
      {GNOME_FACE}
      {LEAF}
    </>
  ),
  'rock-gnome': (
    <>
      {GNOME_FACE}
      {GEM}
    </>
  ),
  'lightfoot-halfling': (
    <>
      {HALFLING_FACE}
      {FEATHER}
    </>
  ),
  'stout-halfling': (
    <>
      {HALFLING_FACE}
      {BOULDER}
    </>
  ),
};

/** Rosto genérico (raças personalizadas ou id desconhecido). */
const GENERIC_FACE: ReactNode = FACE;

interface RaceFaceIconProps {
  /** Opção da raça/sub-raça (só os ids importam). */
  option: Pick<RaceOption, 'raceId' | 'subraceId'>;
  size?: number;
  className?: string;
}

/** Silhueta de rosto da raça/sub-raça, no traço de tinta dos ícones do sistema. */
export function RaceFaceIcon({ option, size = 30, className }: RaceFaceIconProps) {
  // A sub-raça tem prioridade; sem id conhecido, cai no rosto genérico.
  const node = FACES[option.subraceId ?? option.raceId] ?? GENERIC_FACE;
  return (
    <svg
      className={className ? `race-face ${className}` : 'race-face'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {node}
    </svg>
  );
}
