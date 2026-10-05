import type { AbilityKey } from '../shared/dnd5e.js';
import type { SpellLearning, SpellcastingType } from '../shared/classes/types.js';
import type { CanonicalWeapon } from '../shared/weapons/index.js';

/**
 * Compêndio da mesa: as listas de referência que o mestre consulta na aba
 * "Configurações da mesa" — classes, raças, antecedentes e magias.
 *
 * Hoje tudo é SOMENTE LEITURA e sai dos catálogos estáticos do servidor
 * (`shared/classes` e `shared/creation.ts`). O formato já é o de uma coleção
 * vinda de uma fonte única (`getCompendium`), então, quando o mestre passar a
 * criar/editar raças e antecedentes, só a fonte muda — o contrato com o cliente
 * continua o mesmo.
 */

/** Característica de uma classe ou subclasse no compêndio. */
export interface CompendiumFeatureDto {
  id: string;
  name: string;
  /** Nível em que a característica é obtida. */
  level: number;
  description: string;
}

/** Uma subclasse (ex.: Caminho Primal do Bárbaro). */
export interface CompendiumSubclassDto {
  id: string;
  name: string;
  description: string;
  features: CompendiumFeatureDto[];
}

/** Uma das 12 classes, com os atributos que definem a classe. */
export interface CompendiumClassDto {
  key: string;
  name: string;
  /** O que a classe é, em uma frase (mostrado na ficha ao passar o mouse). */
  description: string;
  /** Dado de vida: 6, 8, 10 ou 12. */
  hitDie: number;
  /** As duas salvaguardas com proficiência. */
  savingThrows: AbilityKey[];
  /** Nível em que a subclasse é escolhida. */
  subclassLevel: number;
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
  };
  features: CompendiumFeatureDto[];
  subclasses: CompendiumSubclassDto[];
}

/** Uma linhagem de raça (ex.: "Anão (Anão da Colina)"). */
export interface CompendiumRaceDto {
  key: string;
  name: string;
  /** Raça "mãe", para agrupar as linhagens (as três de elfo, as duas de anão...). */
  baseRace: string | null;
  /** História/descrição da linhagem. */
  description: string | null;
  /** Bônus racial FIXO somado aos atributos. */
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  /** Quantos atributos à escolha ganham +1 (Meio-Elfo: 2; 0 = nenhum). */
  abilityChoice: number;
}

/** Um dos 13 antecedentes do Livro do Jogador. */
export interface CompendiumBackgroundDto {
  key: string;
  name: string;
  description: string | null;
  /** Perícias concedidas (chaves de `SKILLS`). */
  skills: string[];
}

/**
 * Magia do compêndio.
 *
 * Vem do catálogo único de magias (`shared/spells`, PHB 2014). Os campos
 * resumem nível, escola, conjuração, alcance, componentes, duração e a
 * mecânica estruturada (dano/cura) em texto pronto para exibição.
 */
export interface CompendiumSpellDto {
  key: string;
  name: string;
  /** Nome em inglês (referência do livro). */
  nameEn: string;
  /** 0 = truque; 1..9 = nível da magia. */
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  /** Resumo do dano estruturado (ex.: "8d6 de fogo"); nulo quando não há dano. */
  damageSummary: string | null;
  /** Resumo da cura estruturada (ex.: "1d8"). Nulo quando não há cura. */
  healingSummary: string | null;
  /** Chaves das classes que têm a magia na lista (vazio até o Prompt 6.2). */
  classes: string[];
}

/** O compêndio completo entregue ao painel do mestre. */
export interface CompendiumDto {
  classes: CompendiumClassDto[];
  races: CompendiumRaceDto[];
  backgrounds: CompendiumBackgroundDto[];
  spells: CompendiumSpellDto[];
  /**
   * Armas canônicas do PHB (`shared/weapons`). Lista fechada e estática; serve
   * ao seletor "Arma do PHB" do editor de item do mestre.
   */
  weapons: CanonicalWeapon[];
}
