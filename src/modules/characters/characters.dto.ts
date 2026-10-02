import type { Character } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { deriveWeaponAttacks } from '../shared/weapon-attacks.js';
import {
  normalizeLevelHistory,
  type LevelHistoryRecord,
} from '../shared/level-history.js';
import {
  applySaveProficiencies,
  asiLevelsFor,
  classEntriesLabel,
  classOptionsFor,
  computeMulticlassAdjustments,
  effectiveSpellcasting,
  expertiseOptionsFor,
  expertiseSlots,
  featureChoiceInfo,
  isToolExpertiseKey,
  featureEffectsOf,
  getClassDefinition,
  getMulticlassFeatures,
  multiclassSneakAttack,
  normalizeClassEntries,
  normalizeClassState,
  normalizeProficiencies,
  pactMagicSlots,
  preparedSpellCountFor,
  spellSlotsForClasses,
  totalCharacterLevel,
  type ActiveClassFeature,
  type ClassAdjustments,
  type ClassEntry,
  type ClassOption,
  type ClassState,
  type FeatureChoiceInfo,
  type FeatureChoiceOptionsOverride,
  type ProficienciesState,
  type SpellcastingType,
  type SpellLearning,
} from '../shared/classes.js';
import {
  type AbilityKey,
  type DerivedStats,
  type SkillsState,
  abilityModifier,
  deriveStats,
  normalizeSaves,
  normalizeSkills,
  spellAttackBonus,
  spellSaveDc,
} from '../shared/dnd5e.js';
import { parseJson } from '../shared/json.js';
import { coinsWeight, normalizeCoins, type CoinPurse } from '../shared/coins.js';
import type { ItemDetails } from '../shared/item-details.js';
import { normalizeCreationDraft, type CreationDraft } from '../shared/creation.js';
import { applicableUnarmoredDefenses, effectiveAbilitiesOf } from './armor-class.js';
import { armorPiecesFrom } from '../shared/armor-class.js';
import { syncInventory, type CatalogSnapshot } from './inventory-sync.js';
import {
  featureSchema,
  inventoryListSchema,
  spellSchema,
  spellSlotSchema,
  spellsStateSchema,
  type InventorySlot,
} from './characters.schema.js';

export interface InventoryItemDto {
  id: string;
  name: string;
  description: string;
  quantity: number;
  weight: number;
  /** Slot em que o item está equipado (`null` = mochila). */
  slot: InventorySlot | null;
  /** Posição na grade da mochila (`null` = equipado ou sem posição). */
  backpackX: number | null;
  backpackY: number | null;
  /** Sprite do item (`/uploads/items/...`); vazio quando é avulso. */
  imageUrl: string;
  /** Id do item no catálogo do mestre ('' quando é avulso). */
  itemId: string;
  /** Categoria do item no catálogo ('' quando avulso). */
  category: string;
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: ItemDetails;
}

/**
 * Uma classe do personagem no DTO, com o que o frontend precisa para exibir e
 * editar aquela classe (o nível dela é somente leitura: sobe pelo Level Up).
 */
export interface ClassEntryDto {
  classKey: string;
  /** Nome da classe (ex.: "Ladino"). */
  className: string;
  /** Subclasse escolhida ('' = nenhuma). */
  subclass: string;
  /** Nível NAQUELA classe. */
  level: number;
  hitDie: number;
  /** Nível daquela classe em que a subclasse é escolhida. */
  subclassLevel: number;
  /** Verdadeiro quando o nível dela já libera a escolha de subclasse. */
  subclassEligible: boolean;
  /** Nomes das subclasses disponíveis. */
  subclassNames: string[];
  /** Níveis de Aumento de Atributo/Talento desta classe. */
  asiLevels: number[];
  /**
   * Conjuração DESTA classe: a CD e o ataque usam o nível total do personagem
   * (bônus de proficiência) e as magias preparadas são calculadas POR CLASSE,
   * com o atributo e o nível dela (`preparedSpellCountFor`). `preparedCount` é
   * `null` nas classes de magias conhecidas e `0` no Paladino de nível 1, que
   * ainda não conjura.
   */
  spellcasting: {
    type: SpellcastingType;
    ability: AbilityKey | null;
    learning: SpellLearning;
    saveDC: number | null;
    attackBonus: number | null;
    preparedCount: number | null;
  } | null;
  /**
   * Escolhas de característica DESTA classe (Estilo de Luta, Inimigo Favorito
   * e as melhorias), com o nível de cada escolha e o que já está gravado — é o
   * que o assistente de Level Up usa para pedir a escolha do nível novo.
   */
  featureChoices: FeatureChoiceInfo[];
}

export type SpellDto = z.infer<typeof spellSchema>;
export type SpellSlotDto = z.infer<typeof spellSlotSchema>;
export interface SpellsStateDto {
  list: SpellDto[];
  slots: Record<string, SpellSlotDto>;
}

export type AttackDto = Attack;
export type FeatureDto = z.infer<typeof featureSchema>;

/** Formato enviado ao frontend. Inclui os valores derivados, nunca gravados. */
export interface CharacterDto {
  id: string;
  userId: string;
  ownerUsername?: string;

  // Identidade
  name: string;
  race: string;
  /** Nome composto das classes, com os níveis (ex.: "Bárbaro 3 / Ladino 2"). */
  className: string;
  /** Classes do personagem (multiclasse), em ordem de entrada. */
  classes: ClassEntryDto[];
  /**
   * Catálogo das 12 classes com a elegibilidade do personagem já calculada
   * (pré-requisito de atributo atendido ou o motivo do bloqueio).
   */
  classOptions: ClassOption[];
  /** Features de TODAS as classes já liberadas nos níveis delas. */
  activeFeatures: ActiveClassFeature[];
  /** Estado de runtime da classe (toggles ativos e usos gastos). */
  classState: ClassState;
  /**
   * O que CADA nível concedeu (PV, Aumento de Atributo/Talento, escolhas,
   * subclasse, perícia e proficiências). É o que o painel do mestre usa para
   * mostrar o que o downgrade vai desfazer. Ver shared/level-history.ts.
   */
  levelHistory: LevelHistoryRecord[];
  /** Ajustes mecânicos somados das classes (Fúria, resistências, etc.). */
  classAdjustments: ClassAdjustments;
  /**
   * Criação encerrada: com `true`, o jogador só mexe no estado de jogo (PV
   * atual/temporário, usos de recursos, anotações, avatar e itens). O mestre
   * continua editando tudo.
   */
  creationFinalized: boolean;
  /**
   * Rascunho do assistente de criação (ver shared/creation.ts): modo escolhido,
   * passo alcançado, rolagens de 4d6 e valores-base dos atributos. Só vale
   * enquanto `creationFinalized` for falso — é o que permite retomar a criação
   * de onde parou.
   */
  creationDraft: CreationDraft;
  /** Nível total do personagem (soma dos níveis das classes). */
  level: number;
  /**
   * Última liberação de Level Up que ESTE personagem já usou. O cliente compara
   * com `GameConfig.levelUpRelease` para habilitar o botão uma vez por liberação.
   */
  lastLevelUpRelease: number;
  background: string;
  alignment: string;
  experience: number;
  /** URL pública do avatar do personagem ('' = sem avatar). */
  avatarUrl: string;

  // Atributos
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;

  // Vida e defesa (nomes espelham o payload do PATCH, facilitando a edição inline)
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  /** CA efetiva: o override do mestre quando existe, senão a calculada. */
  armorClass: number;
  /** Override manual da CA definido pelo mestre (`null` = automático). */
  armorClassOverride: number | null;
  initiativeBonus: number;
  speed: number;

  // Coleções
  skills: SkillsState;
  saves: Record<AbilityKey, boolean>;
  /**
   * O que está em Expertise: chaves de perícia e/ou `tool:<rótulo>` de
   * ferramenta (só o Ladino e o Bardo têm). É a lista que a ficha usa para o
   * selo de louros e para travar a proficiência da perícia.
   */
  expertiseSkills: string[];
  /** Proficiências de armadura, arma e ferramenta (texto; só o mestre edita). */
  proficiencies: ProficienciesState;
  /**
   * Proficiências SIMPLES em ferramenta, pelos ids do catálogo do PHB 2014
   * (ex.: "thieves-tools"). Nasce vazio: nada concede ferramenta automaticamente
   * nesta etapa. A Expertise tem campo próprio (`expertiseSkills`).
   */
  toolProficiencies: string[];
  inventory: InventoryItemDto[];
  spells: SpellsStateDto;
  attacks: AttackDto[];
  /**
   * Ataques CALCULADOS das armas equipadas (mais o golpe desarmado). Como a CA,
   * não são gravados na ficha: o servidor os deriva a cada leitura. Entram com
   * `derived: true` e, quando a arma não pode ser empunhada, com `blocked`.
   */
  derivedAttacks: CombatAttack[];
  features: FeatureDto[];
  /**
   * Carteira de moedas { pp, gp, ep, sp, cp }, sempre com as cinco
   * denominações. A exibição de PL/PE depende de `GameConfig.extraCoins`.
   */
  coins: CoinPurse;

  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  derived: DerivedStats;
}

const attackListSchema = z.array(attackSchema);
const featureListSchema = z.array(featureSchema);

export function toCharacterDto(
  character: Character,
  ownerUsername?: string,
  /** Itens do catálogo, para o inventário espelhar os dados atuais do mestre. */
  catalog?: Map<string, CatalogSnapshot>,
): CharacterDto {
  const skills = normalizeSkills(character.skills);

  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };

  // Multiclasse: as classes vêm da lista e o nível total é a soma delas.
  const classEntries = normalizeClassEntries(character.classes);
  const level = totalCharacterLevel(classEntries);
  const className = classEntriesLabel(classEntries);
  const classState = normalizeClassState(character.classState);
  // Moedas: as cinco denominações sempre gravadas; o peso entra no derived.
  const coins = normalizeCoins(character.coins);

  // Cada classe é avaliada no PRÓPRIO nível: um Bárbaro 3/Ladino 2 tem as
  // features de bárbaro até o 3 e as de ladino até o 2, ao mesmo tempo.
  const activeFeatures = getMulticlassFeatures(classEntries);
  const classAdjustments = computeMulticlassAdjustments(classEntries, classState, abilities);

  // Salvaguardas fixas: as da PRIMEIRA classe (multiclasse nunca concede
  // salvaguardas — PHB p.164) e as concedidas por features (ex.: Mente
  // Escorregadia). Aparecem sempre proficientes, mesmo se o valor gravado
  // estiver desatualizado.
  const lockedSaves = [
    ...(classEntries[0]
      ? (getClassDefinition(classEntries[0].classKey)?.savingThrows ?? [])
      : []),
    ...activeFeatures.flatMap((feature) =>
      featureEffectsOf(feature).flatMap((effect) =>
        effect.type === 'save' && effect.ability ? [effect.ability] : [],
      ),
    ),
  ];
  const saves = applySaveProficiencies(normalizeSaves(character.saves), lockedSaves);

  const hasSneakAttack = activeFeatures.some((feature) =>
    featureEffectsOf(feature).some((effect) => effect.type === 'sneakAttack'),
  );
  const sneakDice = hasSneakAttack ? multiclassSneakAttack(classEntries) : 0;

  // Espaços de magia: com UMA classe conjuradora vale a tabela dela; com duas
  // ou mais, a tabela combinada do cap. 6. O bruxo fica de fora das duas e usa
  // a Magia de Pacto, calculada à parte. Ver `spellSlotsForClasses`.
  const spellSlots = spellSlotsForClasses(classEntries);
  const pactSlots = pactMagicSlots(classEntries);
  const inventory = syncInventory(
    parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []),
    catalog ?? new Map(),
  );
  const spells = parseJson<SpellsStateDto>(spellsStateSchema, character.spells, {
    list: [],
    slots: {},
  });
  const attacks = parseJson<AttackDto[]>(attackListSchema, character.attacks, []);
  const features = parseJson<FeatureDto[]>(featureListSchema, character.features, []);
  const proficiencies = normalizeProficiencies(character.proficiencies);

  // Expertise (Ladino/Bardo): as opções saem SÓ do que o personagem já domina —
  // as perícias marcadas na ficha e as ferramentas dela. A definição da classe
  // declara a lista completa (perícias + ferramentas), usada quando não há
  // personagem em mãos (ex.: o catálogo de classes do seletor).
  const expertiseOptionsOverride: FeatureChoiceOptionsOverride = {
    expertise: expertiseOptionsFor(
      Object.entries(skills)
        .filter(([, entry]) => entry.proficient)
        .map(([key]) => key),
      proficiencies.tools,
    ),
  };

  // O que está em Expertise: as perícias com `expertise` na ficha (a fonte do
  // bônus dobrado) mais as FERRAMENTAS escolhidas no Level Up, que não vivem em
  // `skills` (ficam gravadas em `classState.choices`).
  const expertiseSkills = [
    ...new Set([
      ...Object.entries(skills)
        .filter(([, entry]) => entry.expertise)
        .map(([key]) => key),
      ...activeFeatures
        .filter((feature) => feature.choice?.apply === 'expertise')
        .flatMap((feature) => classState.choices[feature.id] ?? [])
        .filter(isToolExpertiseKey),
    ]),
  ];

  // Bônus de atributo de features (ex.: Campeão Primitivo) entram nos valores
  // efetivos usados por todos os cálculos derivados; a pontuação gravada segue
  // sendo a base.
  const effectiveAbilities = effectiveAbilitiesOf(character, classAdjustments);

  // Ataques derivados das armas EQUIPADAS (habilidade, proficiência, versátil,
  // duas mãos, mão secundária, arremesso e golpe desarmado).
  const derivedAttacks = deriveWeaponAttacks({
    abilities: effectiveAbilities,
    level,
    weaponProficiencies: proficiencies.weapons,
    inventory,
  });

  // CA: armadura/escudo/bônus vêm do equipamento (já sincronizado com o
  // catálogo) e as defesas sem armadura das classes; o valor gravado é apenas
  // o override do mestre.
  const armorPieces = armorPiecesFrom(inventory);
  const unarmoredDefenses = applicableUnarmoredDefenses(
    classAdjustments,
    armorPieces.shieldBonus > 0,
  );

  /**
   * Conjuração de uma classe: a subclasse pode trocar a configuração (ex.:
   * Trapaceiro Arcano é um terço-conjurador). A CD/ataque usa o nível TOTAL do
   * personagem (bônus de proficiência) e as preparadas usam o nível DELA —
   * cada classe com o próprio atributo (ver `preparedSpellCountFor`).
   */
  function spellcastingOf(entry: ClassEntry): ClassEntryDto['spellcasting'] {
    const config = effectiveSpellcasting(entry);
    if (!config) return null;

    const ability = config.ability;
    const score = ability ? effectiveAbilities[ability] : null;

    return {
      type: config.type,
      ability,
      learning: config.learning,
      saveDC: ability !== null && score !== null ? spellSaveDc(level, score) : null,
      attackBonus: ability !== null && score !== null ? spellAttackBonus(level, score) : null,
      preparedCount:
        ability !== null && score !== null
          ? preparedSpellCountFor(entry, abilityModifier(score))
          : null,
    };
  }

  const classEntryDtos: ClassEntryDto[] = classEntries.map((entry) => {
    const definition = getClassDefinition(entry.classKey);

    return {
      classKey: entry.classKey,
      className: definition?.name ?? entry.classKey,
      subclass: entry.subclass,
      level: entry.level,
      hitDie: definition?.hitDie ?? 8,
      subclassLevel: definition?.subclassLevel ?? 1,
      subclassEligible: definition !== null && entry.level >= definition.subclassLevel,
      subclassNames: definition?.subclasses.map((item) => item.name) ?? [],
      asiLevels: [...asiLevelsFor(entry.classKey)],
      spellcasting: spellcastingOf(entry),
      featureChoices: definition
        ? featureChoiceInfo(definition, classState.choices, entry.subclass, expertiseOptionsOverride)
        : [],
    };
  });

  // Primeiro conjurador do personagem — mantém o `derived.spellcasting` que a
  // ficha já usa (CD/ataque) para fichas de uma classe só.
  const primaryCasting = classEntryDtos.find(
    (entry) => entry.spellcasting !== null && entry.spellcasting.ability !== null,
  )?.spellcasting;

  const derived = deriveStats({
    level,
    abilities: effectiveAbilities,
    skills,
    saves,
    initiativeBonus: character.initiativeBonus,
    className,
    inventory,
    coinWeight: coinsWeight(coins),
    hitDie: classEntryDtos[0]?.hitDie ?? null,
    spellcastingAbility: primaryCasting?.ability ?? undefined,
    lockedSaves,
    sneakAttack: sneakDice > 0 ? { dice: sneakDice, expression: `${sneakDice}d6` } : null,
    expertiseSlots: expertiseSlots(activeFeatures),
    unarmoredDefenses,
    armorPieces,
    armorClassOverride: character.armorClass,
    spellSlots,
    pactSlots,
    // Aura de Proteção (todas as salvaguardas), Pau para Toda Obra (metade da
    // proficiência em testes sem proficiência) e Estilo de Luta Defesa (+1 CA).
    saveBonus: classAdjustments.saveBonus,
    halfProficiency: classAdjustments.halfProficiency,
    critThreshold: classAdjustments.critThreshold,
    classArmorBonuses:
      classAdjustments.armorClassBonus > 0
        ? [
            {
              label: classAdjustments.armorClassBonusLabel,
              value: classAdjustments.armorClassBonus,
              requiresArmor: classAdjustments.armorClassBonusRequiresArmor,
            },
          ]
        : [],
  });

  return {
    id: character.id,
    userId: character.userId,
    ...(ownerUsername === undefined ? {} : { ownerUsername }),
    name: character.name,
    race: character.race,
    className,
    classes: classEntryDtos,
    classOptions: classOptionsFor(abilities, classEntries),
    activeFeatures,
    classState,
    levelHistory: normalizeLevelHistory(character.levelHistory),
    classAdjustments,
    creationFinalized: character.creationFinalized,
    creationDraft: normalizeCreationDraft(character.creationDraft),
    level,
    lastLevelUpRelease: character.lastLevelUpRelease,
    background: character.background,
    alignment: character.alignment,
    experience: character.experience,
    avatarUrl: character.avatarUrl,
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
    hpCurrent: character.hpCurrent,
    hpMax: character.hpMax,
    hpTemp: character.hpTemp,
    armorClass: derived.armorClass.value,
    armorClassOverride: derived.armorClass.override,
    initiativeBonus: character.initiativeBonus,
    speed: character.speed,
    skills,
    expertiseSkills,
    saves,
    proficiencies,
    toolProficiencies: character.toolProficiencies ?? [],
    inventory,
    spells,
    attacks,
    derivedAttacks,
    features,
    coins,
    notes: character.notes,
    version: character.version,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
    derived,
  };
}

/**
 * Ataques derivados de uma ficha lida DIRETO do banco (sem passar pelo DTO).
 * O combate resolve por aqui os ataques de arma equipada — a mesma conta que a
 * ficha mostra, para os ids (`weapon:<item>`, `thrown:<item>`, `offhand:<item>`
 * e `unarmed`) baterem.
 */
export function characterDerivedAttacks(character: Character): CombatAttack[] {
  const classEntries = normalizeClassEntries(character.classes);
  const classAdjustments = computeMulticlassAdjustments(
    classEntries,
    normalizeClassState(character.classState),
  );
  const inventory = parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);

  return deriveWeaponAttacks({
    abilities: effectiveAbilitiesOf(character, classAdjustments),
    level: totalCharacterLevel(classEntries),
    weaponProficiencies: normalizeProficiencies(character.proficiencies).weapons,
    inventory,
  });
}
