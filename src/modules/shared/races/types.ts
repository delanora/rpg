import type { AbilityKey } from '../dnd5e.js';
import type { ClassFeatureEffect } from '../classes/types.js';

/**
 * Catálogo ESTRUTURADO de raças (fundação).
 *
 * Substitui, a partir do Prompt 2.10, o `RACE_CATALOG` de `shared/creation.ts`
 * (que hoje alimenta o assistente de criação e o compêndio e **permanece
 * intocado** até lá). Enquanto o catálogo novo não estiver preenchido, os dois
 * coexistem: nada em produção lê `shared/races/` ainda.
 *
 * Segue o mesmo padrão de `shared/classes/`: um arquivo por raça (`dwarf.ts`,
 * `elf.ts`…), agregados em `index.ts`. Nenhuma raça foi cadastrada ainda.
 *
 * Alguns campos existem só como PREPARAÇÃO e NÃO têm efeito mecânico hoje
 * (ver os comentários de cada um).
 */

/** Tamanho da criatura (PHB). Ainda sem efeito: nada consome tamanho hoje. */
export type RaceSize = 'Small' | 'Medium';

/** Um incremento de atributo concedido pela raça ou sub-raça. */
export interface AbilityScoreIncrease {
  /** Atributo afetado — reaproveita o `AbilityKey` (strength/dexterity/…). */
  ability: AbilityKey;
  /** Quanto o atributo aumenta (ex.: +2, +1). */
  amount: number;
}

/**
 * Uma característica racial.
 *
 * O efeito mecânico é OPCIONAL e reaproveita o MESMO `ClassFeatureEffect` das
 * classes (nada de vocabulário paralelo). Hoje nenhum traço tem efeito
 * processado: a integração com o `derived` entra quando a primeira raça com
 * efeito mecânico for cadastrada (ver `index.ts`). Traços sem efeito ficam só
 * descritivos.
 */
export interface RaceTrait {
  /** Identificador estável (ex.: 'darkvision'). */
  id: string;
  name: string;
  description: string;
  /**
   * Efeito mecânico vinculado, quando houver. Reaproveita o union das classes;
   * tipos novos que nenhuma classe usa hoje serão ACRESCENTADOS ao mesmo union
   * (nunca um vocabulário paralelo).
   */
  mechanicalEffect?: ClassFeatureEffect;
}

/**
 * Uma sub-raça/linhagem (ex.: Anão da Colina, Elfo da Floresta).
 *
 * Os incrementos de atributo são SEPARADOS dos da raça base — quem monta a
 * ficha (ou o assistente) soma os dois. `speed`/`darkvision` só aparecem aqui
 * quando a sub-raça SOBRESCREVE o valor da raça base.
 */
export interface Subrace {
  /** Identificador estável (ex.: 'hill' para Anão da Colina). */
  id: string;
  namePt: string;
  abilityScoreIncrease: AbilityScoreIncrease[];
  /** Sobrescreve o deslocamento da raça base, em METROS (ex.: Elfo da Floresta). */
  speed?: number;
  /** Sobrescreve a visão no escuro da raça base, em METROS (ex.: Drow). */
  darkvision?: number;
  traits: RaceTrait[];
}

/** Uma opção que a raça oferece ao jogador (ex.: a ancestralidade do Draconato). */
export interface RaceChoiceDefinition {
  /** Identificador estável; é a chave em que a escolha fica gravada. */
  id: string;
  /** Rótulo exibido (ex.: 'Ancestralidade dracônica'). */
  label: string;
  /**
   * Opções da escolha. `damageType` é o tipo de dano associado à opção, quando
   * houver (ex.: a cor do Draconato) — pelos 13 tipos canônicos de
   * `shared/attacks.ts`. É o que um efeito `resistanceFromChoice` resolve.
   */
  options: { id: string; label: string; damageType?: string }[];
}

/**
 * Uma raça do catálogo estruturado.
 *
 * `speed` está em METROS (o sistema já converteu tudo para métrico; 9 = 30
 * pés, 7.5 = 25 pés). `size` e `darkvision` são só PREPARAÇÃO: nada os consome
 * hoje (não há sistema de iluminação/visão, e o tamanho não pesa na capacidade
 * de carga — ver A8 da revisão). Os idiomas também são preparação: NÃO existe
 * campo de idioma na ficha; por ora os idiomas de uma raça ficam escritos na
 * `description` do traço correspondente (texto informativo), e os campos
 * `languages`/`bonusLanguageChoices` guardam a intenção para quando houver
 * onde exibi-los.
 */
export interface Race {
  /** Identificador estável (ex.: 'dwarf'). */
  id: string;
  /** Nome em português (ex.: 'Anão'). */
  namePt: string;
  /** Nome em inglês (ex.: 'Dwarf'), para referência/compatibilidade. */
  nameEn: string;
  abilityScoreIncrease: AbilityScoreIncrease[];
  /** Deslocamento em METROS (padrão do sistema: 9 = 30 pés). */
  speed: number;
  /** Preparação: nada consome tamanho hoje. */
  size?: RaceSize;
  /** Visão no escuro em METROS; ausente = sem visão no escuro. Sem efeito hoje. */
  darkvision?: number;
  /**
   * Tipos de dano resistidos, pelos 13 tipos canônicos de `shared/attacks.ts`
   * (ex.: 'Veneno'). Mesmo formato `string[]` usado por `Creature.resistances`.
   */
  damageResistances?: string[];
  /** Idiomas conhecidos (texto informativo; não há campo de idioma na ficha). */
  languages: string[];
  /** Quantos idiomas à escolha a raça concede. Sem campo de idioma na ficha. */
  bonusLanguageChoices?: number;
  traits: RaceTrait[];
  subraces?: Subrace[];
  /** Escolhas que a raça exige (ex.: ancestralidade dracônica). */
  hasChoices?: RaceChoiceDefinition[];
}
