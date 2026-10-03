import { toolsByCategory, getTool } from '../tools/index.js';
import { acolyte } from './acolyte.js';
import { charlatan } from './charlatan.js';
import { criminal } from './criminal.js';
import { entertainer } from './entertainer.js';
import { folkHero } from './folk-hero.js';
import { guildArtisan } from './guild-artisan.js';
import { hermit } from './hermit.js';
import { noble } from './noble.js';
import { outlander } from './outlander.js';
import { sage } from './sage.js';
import { sailor } from './sailor.js';
import { soldier } from './soldier.js';
import { urchin } from './urchin.js';
import type { Background, BackgroundToolChoice } from './types.js';

export * from './types.js';

/**
 * Catálogo estruturado dos 13 antecedentes do Livro do Jogador (2014).
 *
 * A lista é fechada e a ordem é a do livro; o id é estável (o valor gravado em
 * `characters.background` continua sendo o NOME em português, por compatibilidade
 * com o que já estava salvo).
 */
export const BACKGROUNDS: readonly Background[] = [
  acolyte,
  charlatan,
  criminal,
  entertainer,
  folkHero,
  guildArtisan,
  hermit,
  noble,
  outlander,
  sage,
  sailor,
  soldier,
  urchin,
];

const BACKGROUND_BY_ID: ReadonlyMap<string, Background> = new Map(
  BACKGROUNDS.map((background) => [background.id, background]),
);

/** Todos os antecedentes, na ordem do catálogo (cópia — não muta o registro). */
export function allBackgrounds(): Background[] {
  return [...BACKGROUNDS];
}

/** Busca um antecedente pelo id estável (ex.: "sage"). */
export function getBackground(id: string): Background | undefined {
  return BACKGROUND_BY_ID.get(id.trim());
}

/**
 * Opções de uma escolha de ferramenta por categoria, resolvidas do catálogo
 * único de ferramentas (`toolsByCategory`). É o que o passo 4 mostra e valida —
 * nada de listas de instrumentos/jogos hardcoded nos antecedentes.
 */
export function backgroundToolChoiceOptions(
  category: BackgroundToolChoice['category'],
): { id: string; label: string }[] {
  return toolsByCategory(category).map((tool) => ({ id: tool.id, label: tool.namePt }));
}

/** Nome em português de uma ferramenta pelo id (para exibição). */
export function toolLabel(id: string): string {
  return getTool(id)?.namePt ?? id;
}
