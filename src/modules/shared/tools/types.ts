/**
 * Catálogo das ferramentas do Livro do Jogador (PHB 2014).
 *
 * Esta é a fonte única de verdade sobre ferramentas: o id estável (slug em
 * inglês, kebab-case) é o que fica gravado na ficha — em `toolProficiencies`
 * (proficiência simples) e, quando houver, em `expertiseSkills` (com o prefixo
 * `tool:`). Os nomes e a descrição são só o TEXTO exibido; nada aqui concede
 * proficiência automaticamente por classe, raça ou antecedente.
 *
 * Ver src/modules/shared/tools/catalog.ts para a lista fechada.
 */

/** Categorias do PHB 2014 (Ferramentas de Artesão, Kits, Instrumentos...). */
export type ToolCategory =
  | 'artisan'
  | 'kit'
  | 'gamingSet'
  | 'musicalInstrument'
  | 'navigator'
  | 'thieves'
  | 'vehicle';

/** Uma ferramenta do catálogo. */
export interface Tool {
  /** Slug em inglês, kebab-case e estável (ex.: "thieves-tools"). */
  id: string;
  /** Nome em português, como aparece na ficha. */
  namePt: string;
  /** Nome em inglês — só referência do livro. */
  nameEn: string;
  /** Grupo ao qual a ferramenta pertence. */
  category: ToolCategory;
  /**
   * Atributo mais comum de uso (ex.: "DES"). Só sugestivo, para o texto da
   * ficha — nem toda ferramenta tem um, e pode variar conforme a tarefa.
   */
  defaultAbility?: string;
  /** Resumo curto do que a ferramenta permite fazer (texto próprio). */
  description: string;
}
