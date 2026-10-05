import type { AbilityKey } from '../dnd5e.js';
import type { Damage } from '../attacks.js';

/**
 * Catálogo de magias do Livro do Jogador (PHB 2014).
 *
 * Esta é a fonte única de verdade sobre magias: o id estável (slug em inglês,
 * kebab-case) é a chave de referência em TODO o sistema. Nada aqui conjura,
 * gasta espaço ou rola dado — só descreve a magia e a sua mecânica ESTRUTURADA,
 * para que o motor de conjuração (fases seguintes) possa usar os mesmos dados.
 *
 * O dano e a cura reaproveitam o formato de `shared/attacks.ts` (`Damage` =
 * `{ count, sides, bonus, type }`), com um dos 13 tipos canônicos — nunca
 * texto livre. A expressão textual ("3d6") é derivada na exibição.
 *
 * O campo `classes` é DERIVADO das listas do PHB em `class-lists.ts` (fonte
 * única do vínculo magia ↔ classe): não é escrito à mão em cada magia.
 *
 * Ver `catalog/` (um arquivo por nível) para a lista fechada.
 */

/**
 * As 8 classes conjuradoras "base" do PHB 2014 (chaves canônicas, iguais às de
 * `shared/classes`). Cavaleiro Arcano e Trapaceiro Arcano NÃO entram aqui: usam
 * a lista do mago com a restrição de escola da subclasse (ver `class-lists.ts`).
 */
export const SPELL_CLASS_KEYS = [
  'bard',
  'cleric',
  'druid',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
  'wizard',
] as const;

export type SpellClassKey = (typeof SPELL_CLASS_KEYS)[number];

/** As 8 escolas do PHB 2014. */
export type SpellSchool =
  | 'abjuration'
  | 'divination'
  | 'conjuration'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

/** Como a magia é conjurada. */
export type SpellCastingTimeKind =
  | 'action'
  | 'bonusAction'
  | 'reaction'
  | 'minute'
  | 'hour'
  | 'special';

/** Alcance da magia. */
export type SpellRangeKind = 'self' | 'touch' | 'sight' | 'special' | 'ranged';

/** Forma da área (quando a magia tem uma). */
export type SpellAreaShape =
  | 'sphere'
  | 'cone'
  | 'cube'
  | 'cylinder'
  | 'line'
  | 'emanation'
  | 'special';

/** Área da magia: forma + tamanho em metros (padrão métrico do projeto). */
export interface SpellArea {
  shape: SpellAreaShape;
  /** Tamanho em metros — lado/raio/comprimento conforme a forma. */
  sizeMeters: number;
  /** Detalhe livre opcional (ex.: "hemisfério", "origem em você"). */
  note?: string;
}

/** Componente material: texto do material, custo em PO e se é consumido. */
export interface SpellMaterial {
  text: string;
  /** Custo em PO, quando a magia exige um material com valor. */
  costGp?: number;
  /** Verdadeiro quando o material é consumido pela magia. */
  consumed?: boolean;
}

/** Escalonamento de TRUQUE por nível de PERSONAGEM (5/11/17). */
export interface SpellCantripScaling {
  atLevel: 5 | 11 | 17;
  /** Dados adicionais somados ao dano base nesse nível. */
  extraDice: number;
}

/** Escalonamento de MAGIA por nível do espaço usado acima do nível base. */
export interface SpellUpcast {
  /** Dados de dano/cura adicionais por nível de espaço acima do base. */
  extraDicePerSlot?: number;
  /** Alvos/raios/projéteis adicionais por nível de espaço. */
  extraTargetsPerSlot?: number;
  /** Casos que não cabem em dado/alvo (ex.: Mísseis Mágicos). */
  note?: string;
}

/** Uma magia do catálogo. */
export interface Spell {
  /** Slug em inglês, kebab-case e ESTÁVEL (ex.: "fireball"). Nunca renomear. */
  id: string;
  /** Nome em português, como aparece na ficha. */
  namePt: string;
  /** Nome em inglês — só referência do livro. */
  nameEn: string;
  /** 0 = truque; 1..9 = nível da magia. */
  level: number;
  school: SpellSchool;

  // --- Conjuração -----------------------------------------------------------
  /** Texto exibido (ex.: "1 ação", "1 ação bônus", "1 reação*", "10 minutos"). */
  castingTime: string;
  castingTimeKind: SpellCastingTimeKind;
  /** Gatilho da reação (só quando `castingTimeKind` = 'reaction'). */
  reactionTrigger?: string;
  /** Texto exibido do alcance (ex.: "Pessoal", "Toque", "18 m", "Visão"). */
  range: string;
  rangeKind: SpellRangeKind;
  /** Alcance em metros (só quando `rangeKind` = 'ranged'). */
  rangeMeters?: number;
  /** Área, quando a magia afeta uma região. */
  area?: SpellArea;
  /** Componentes exigidos. */
  components: { verbal: boolean; somatic: boolean; material: boolean };
  /** Material exigido (só quando `components.material`). */
  material?: SpellMaterial;
  /** Componentes prontos para exibição (ex.: "V, S, M (um pedaço de ferro)"). */
  componentsText: string;
  /** Texto da duração (ex.: "Instantânea", "Concentração, até 1 hora"). */
  duration: string;
  /** A magia exige concentração. */
  concentration: boolean;
  /** A magia pode ser conjurada como ritual. */
  ritual: boolean;

  // --- Texto próprio em português (NÃO transcreve o livro) ------------------
  description: string;
  /** O que muda quando conjurada com um espaço de nível superior. */
  atHigherLevels?: string;

  // --- Mecânica estruturada -------------------------------------------------
  /** Ataque de magia (corpo a corpo/à distância); ausente = sem ataque. */
  attack?: 'melee' | 'ranged';
  /** Atributo da salvaguarda; ausente = a magia não pede salvaguarda. */
  save?: AbilityKey;
  /** Dano estruturado (um ou mais tipos; `bonus` fica 0 nesta etapa). */
  damage?: Damage[];
  /** Cura estruturada (mesmo formato; `type` normalmente null). */
  healing?: Damage;
  /** Escalonamento de truque por nível de personagem. */
  cantripScaling?: SpellCantripScaling[];
  /** Escalonamento por nível do espaço. */
  upcast?: SpellUpcast;

  /**
   * Classes que têm a magia na lista (PHB 2014). Preenchido em `index.ts` a
   * partir de `class-lists.ts` (fonte única das Spell Lists); o literal do
   * catálogo fica vazio e é sobrescrito ao montar `SPELLS`.
   */
  classes: SpellClassKey[];
}
