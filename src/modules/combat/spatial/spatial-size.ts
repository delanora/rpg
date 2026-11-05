import {
  CREATURE_SIZE_LABELS,
  SPATIAL_SIZES,
  type CreatureSizeLabel,
  type SpatialSize,
} from './spatial.types.js';

/**
 * Tamanho mecânico × footprint (PHB 2014, p. 191-192).
 *
 * Baseline do espaço ocupado:
 *   Tiny 2,5 × 2,5 · Small/Medium 5 × 5 · Large 10 × 10 · Huge 15 × 15 ·
 *   Gargantuan 20 × 20 (mínimo — um footprint maior específico é futuro).
 *
 * Small e Medium ocupam o MESMO quadrado, mas continuam tamanhos DISTINTOS: o
 * domínio nunca normaliza um no outro. Tiny também não vira 5×5.
 */
export const SIZE_FOOTPRINT_FEET: Readonly<
  Record<SpatialSize, { widthFeet: number; heightFeet: number }>
> = {
  tiny: { widthFeet: 2.5, heightFeet: 2.5 },
  small: { widthFeet: 5, heightFeet: 5 },
  medium: { widthFeet: 5, heightFeet: 5 },
  large: { widthFeet: 10, heightFeet: 10 },
  huge: { widthFeet: 15, heightFeet: 15 },
  gargantuan: { widthFeet: 20, heightFeet: 20 },
};

/** Rótulo de exibição/cadastro → tamanho canônico; inválido cai em `medium`. */
export function spatialSizeOfLabel(label: string | null | undefined): SpatialSize {
  if (!label) return 'medium';
  const normalized = label.trim().toLowerCase();
  return (SPATIAL_SIZES as readonly string[]).includes(normalized)
    ? (normalized as SpatialSize)
    : 'medium';
}

/** Tamanho canônico → rótulo persistido (cadastro de NPC/criatura). */
export function creatureSizeLabelOf(size: SpatialSize): CreatureSizeLabel {
  const index = SPATIAL_SIZES.indexOf(size);
  return CREATURE_SIZE_LABELS[index] ?? 'Medium';
}

/**
 * Tamanho BASE vindo da RAÇA, como dado ESTRUTURADO — nunca por nome.
 *
 * `Race.size`/`CustomRace.size` usam 'Small'/'Medium' (PHB 2014 não tem raça
 * Tiny/Large jogável no catálogo). Raça ausente/legada (texto livre antigo) cai
 * em `medium`, de forma EXPLÍCITA e documentada: nada é inferido do nome.
 */
export function baseSizeOfRaceSize(raceSize: string | null | undefined): SpatialSize {
  if (!raceSize) return 'medium';
  const normalized = raceSize.trim().toLowerCase();
  if (normalized === 'tiny') return 'tiny';
  if (normalized === 'small') return 'small';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'large') return 'large';
  if (normalized === 'huge') return 'huge';
  if (normalized === 'gargantuan') return 'gargantuan';
  return 'medium';
}

/**
 * Tamanho EFETIVO. Hoje é identidade (`=== baseSize`), mas o contrato é
 * separado de propósito: Enlarge/Reduce, Polymorph e Wild Shape (futuros) vão
 * alterar o efetivo sem tocar na raça/statblock. O espaço ocupado deriva
 * SEMPRE do efetivo.
 */
export function effectiveSizeOf(baseSize: SpatialSize): SpatialSize {
  return baseSize;
}

/** Footprint do tamanho (largura/altura em pés). */
export function footprintOf(size: SpatialSize): { widthFeet: number; heightFeet: number } {
  return SIZE_FOOTPRINT_FEET[size];
}
