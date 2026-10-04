import type { AbilityKey } from '../dnd5e.js';
import type { ClassFeatureEffect } from '../classes/types.js';

/**
 * Catálogo ESTRUTURADO de talentos do Livro do Jogador (PHB 2014).
 *
 * Segue o mesmo padrão de `shared/races/` e `shared/backgrounds/`: dados
 * declarativos agregados em `index.ts`. O efeito mecânico REAPROVEITA o MESMO
 * `ClassFeatureEffect` das classes (nada de vocabulário paralelo) e entra no
 * `derived` pelo mesmo pipeline (`computeFeatAdjustments`).
 *
 * Os talentos são divididos em três categorias de complexidade (ver os arquivos
 * `category-a.ts`/`category-b.ts`/`category-c.ts`):
 *  • A — efeito numérico simples, aplicado agora (`effects`/`abilityChoice`);
 *  • B — depende do motor de ação/ação bônus/reação (Fase 5): só `other` + TODO;
 *  • C — depende de um sistema próprio ainda inexistente: só `other` + TODO.
 */

/**
 * Bônus de atributo à ESCOLHA de um talento "meio-talentos"/half-feat: o
 * jogador escolhe UM atributo dentro de `options` e ganha `amount` nele (ex.:
 * Atlético permite Força OU Destreza). O atributo escolhido fica gravado na
 * própria característica (`featAbility`) e entra no `derived` como `abilityBonus`.
 */
export interface FeatAbilityChoice {
  /** Atributos elegíveis (a sub-escolha do Level Up fica restrita a esta lista). */
  options: AbilityKey[];
  /** Quanto o atributo escolhido aumenta (hoje sempre 1). */
  amount: number;
}

/** Um talento do Livro do Jogador (2014). */
export interface Feat {
  /** Identificador estável (ex.: 'athlete'). É o valor gravado em `featId`. */
  id: string;
  /** Nome em português (ex.: 'Atleta'). */
  name: string;
  /** Texto completo do talento (a descrição do livro, em PT). */
  description: string;
  /**
   * Pré-requisito, em TEXTO livre (ex.: 'Proficiência com armadura pesada').
   * NÃO há validação automática nesta etapa — é só informativo.
   */
  prerequisite?: string;
  /**
   * Efeitos mecânicos processados no `derived` (Categoria A). Vazio/ausente nos
   * talentos de Categoria B/C, que ficam só com `description` + `other` + TODO.
   */
  effects?: ClassFeatureEffect[];
  /** Bônus de atributo à escolha (half-feats). Ver `FeatAbilityChoice`. */
  abilityChoice?: FeatAbilityChoice;
  /**
   * Concede proficiência na SALVAGUARDA do atributo escolhido em `abilityChoice`
   * (Resiliente: "+1 em um atributo à escolha e proficiência nas salvaguardas
   * desse atributo"). Sem efeito se não houver `abilityChoice`.
   */
  saveProficiency?: boolean;
}
