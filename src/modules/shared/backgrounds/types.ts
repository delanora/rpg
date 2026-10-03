import type { ToolCategory } from '../tools/types.js';

/**
 * Catálogo ESTRUTURADO de antecedentes (PHB 2014) — fundação do sistema de
 * antecedentes, no mesmo padrão de `shared/races/`: um arquivo por antecedente,
 * agregados em `index.ts`.
 *
 * O que cada antecedente concede entra na ficha pelo assistente (passo 4):
 * as duas perícias, as ferramentas (fixas e/ou escolhidas por categoria),
 * os idiomas à escolha e a característica narrativa. O EQUIPAMENTO INICIAL é
 * só texto informativo (`suggestedEquipment`) — nada é adicionado ao inventário
 * automaticamente.
 */

/** A característica narrativa do antecedente (aparece na aba Características). */
export interface BackgroundFeature {
  name: string;
  description: string;
}

/**
 * Uma escolha de ferramenta dentro de uma CATEGORIA do catálogo
 * (`shared/tools`): ex.: "1 Instrumento Musical à escolha". As opções NÃO
 * ficam fixas aqui — quem monta a interface e valida resolve a lista com
 * `toolsByCategory(category)`, para reaproveitar a fonte única de ferramentas.
 */
export interface BackgroundToolChoice {
  /** Identificador estável; é a chave em que a escolha fica gravada. */
  id: string;
  /** Rótulo exibido (ex.: 'Instrumento musical'). */
  label: string;
  /** Categoria do catálogo de ferramentas de onde saem as opções. */
  category: ToolCategory;
}

/** Um antecedente do Livro do Jogador (2014). */
export interface Background {
  /** Identificador estável (ex.: 'sage'). */
  id: string;
  /** Nome em português (ex.: 'Sábio'). */
  namePt: string;
  /** Nome em inglês — só referência do livro. */
  nameEn: string;
  /** Texto de apresentação (compêndio). */
  description?: string;
  /** Exatamente DUAS perícias com proficiência, por chave de `SKILLS`. */
  skillProficiencies: [string, string];
  /** Ferramentas FIXAS concedidas, por id do catálogo (`thieves-tools`…). */
  toolProficiencies?: string[];
  /** Ferramentas à escolha por categoria (cada uma concede 1). */
  toolChoices?: BackgroundToolChoice[];
  /** Quantos idiomas à escolha o antecedente concede (0 = nenhum). */
  languageChoices?: number;
  /** Característica narrativa (sem efeito mecânico). */
  feature: BackgroundFeature;
  /**
   * Equipamento inicial sugerido — TEXTO informativo, visível só ao mestre.
   * NUNCA é adicionado ao inventário automaticamente.
   */
  suggestedEquipment?: string;
}
