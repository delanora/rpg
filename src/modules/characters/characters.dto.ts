import type { Character } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { deriveWeaponAttacks, foldWeaponName, isProficientWithWeapon } from '../shared/weapon-attacks.js';
import { getWeapon } from '../shared/weapons/index.js';
import {
  classSpellcastingLimits,
  thirdCasterSpellcastingLimits,
} from '../shared/spells/class-tables.js';
import { oathSpellsAtLevel, resolveOathSpells } from '../shared/spells/oath-spells.js';
import { SPELL_CLASS_KEYS, type SpellClassKey } from '../shared/spells/types.js';
import {
  normalizeLevelHistory,
  type LevelHistoryRecord,
} from '../shared/level-history.js';
import {
  applySaveProficiencies,
  asiLevelsFor,
  classEntriesLabel,
  classOptionsFor,
  computeFeatAdjustments,
  computeMulticlassAdjustments,
  mergeAdjustments,
  effectiveSpellcasting,
  expertiseOptionsFor,
  expertiseSlots,
  featureChoiceInfo,
  isToolExpertiseKey,
  featureEffectsOf,
  findSubclass,
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
import type { ItemDetails, ItemRarity } from '../shared/item-details.js';
import { normalizeCreationDraft, type CreationDraft } from '../shared/creation.js';
import { getTool, TOOL_CATEGORY_LABELS, type ToolCategory } from '../shared/tools/index.js';
import { applicableUnarmoredDefenses, effectiveAbilitiesOf } from './armor-class.js';
import {
  armorPiecesFrom,
  isArmorTypeProficient,
  isShieldProficient,
} from '../shared/armor-class.js';
import { syncInventory, type CatalogSnapshot } from './inventory-sync.js';
import {
  featureSchema,
  inventoryListSchema,
  raceChoicesSchema,
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
  /** Raridade do item no catálogo (`null` = sem raridade classificada). */
  rarity: ItemRarity | null;
  /** O item exige sintonização (propriedade manual do mestre). */
  requiresAttunement: boolean;
  /** Atributos da categoria (dano, CA, rolagem de efeito...). */
  details: ItemDetails;
  /**
   * Estado de proficiência do personagem com ESTE item, quando a categoria tem
   * regra (Arma/Cajado, Armadura, Escudo). `null` nas demais — é o que o popup
   * de detalhes mostra. DERIVADO na leitura: não é gravado no inventário.
   */
  proficiency?: ItemProficiency | null;
}

/** Proficiência do personagem com um item do inventário (o que o popup exibe). */
export interface ItemProficiency {
  proficient: boolean;
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
    /** Truques conhecidos (0 quando não há truques). */
    cantripsKnown: number;
    /** Magias conhecidas; `null` para quem prepara (Clérigo/Druida/Paladino/Mago). */
    spellsKnown: number | null;
    /** Nível máximo de magia conjurável nesta classe (0 = ainda não conjura). */
    maxSpellLevel: number;
    /** Tamanho do grimório (só Mago); `null` nas demais. */
    grimoireSize: number | null;
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

/** Atributo sugerido do catálogo (abreviação PT) → chave de atributo. */
const ABILITY_BY_TOOL_CODE: Record<string, AbilityKey> = {
  FOR: 'strength',
  DES: 'dexterity',
  CON: 'constitution',
  INT: 'intelligence',
  SAB: 'wisdom',
  CAR: 'charisma',
};

/**
 * Uma proficiência em ferramenta JÁ RESOLVIDA pelo catálogo, para a ficha
 * mostrar o nome e a categoria sem precisar de um espelho no cliente.
 */
export interface CharacterToolDto {
  /** Id estável do catálogo (ex.: "thieves-tools"). */
  id: string;
  name: string;
  category: ToolCategory;
  categoryLabel: string;
  /** Atributo sugerido pelo catálogo (`dexterity`…); `null` quando não há. */
  defaultAbility: AbilityKey | null;
}

/** Resolve os ids de `toolProficiencies` pelo catálogo, ignorando ids órfãos. */
function resolveTools(ids: readonly string[]): CharacterToolDto[] {
  const tools: CharacterToolDto[] = [];
  for (const id of ids) {
    const tool = getTool(id);
    if (!tool) continue;
    tools.push({
      id: tool.id,
      name: tool.namePt,
      category: tool.category,
      categoryLabel: TOOL_CATEGORY_LABELS[tool.category],
      defaultAbility: tool.defaultAbility
        ? (ABILITY_BY_TOOL_CODE[tool.defaultAbility] ?? null)
        : null,
    });
  }
  return tools;
}

/** Formato enviado ao frontend. Inclui os valores derivados, nunca gravados. */
export interface CharacterDto {
  id: string;
  userId: string;
  ownerUsername?: string;

  // Identidade
  name: string;
  /** Raça em texto livre (o `name` do catálogo de criação). */
  race: string;
  /** Raça do catálogo estruturado (`shared/races`), pelo id; `null` por ora. */
  raceId: string | null;
  /** Sub-raça do catálogo estruturado, pelo id; `null` quando não há. */
  subraceId: string | null;
  /** Escolhas da raça: `{ [id da escolha]: id da opção }`. */
  raceChoices: Record<string, string>;
  /** Raça personalizada do mestre (id de CustomRace); `null` quando não é. */
  customRaceId: string | null;
  /** Idiomas conhecidos (texto), concedidos pela raça e pelo antecedente. */
  languages: string[];
  /** Visão no escuro em metros (0 = sem). */
  darkvision: number;
  /** Tipos de dano resistidos concedidos pela RAÇA (13 canônicos). */
  raceResistances: string[];
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
   * Lista de proficiências de ARMA pronta para exibição: os ids canônicos
   * gravados pela raça viram o nome em português e as repetidas somem. Fica à
   * parte de `proficiencies.weapons`, que guarda o formato ORIGINAL (a ficha
   * só mostra esta; a checagem de proficiência continua sobre o valor cru).
   */
  weaponProficienciesDisplay: string[];
  /**
   * Proficiências SIMPLES em ferramenta, pelos ids do catálogo do PHB 2014
   * (ex.: "thieves-tools"). Nasce vazio: nada concede ferramenta automaticamente
   * nesta etapa. A Expertise tem campo próprio (`expertiseSkills`).
   */
  toolProficiencies: string[];
  /** As mesmas ferramentas RESOLVIDAS pelo catálogo (nome, categoria, atributo). */
  tools: CharacterToolDto[];
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

/**
 * Proficiência do personagem com um item do inventário, pelas MESMAS regras da
 * ficha: arma/cajado por `isProficientWithWeapon`, armadura por TIPO e escudo
 * por `isShieldProficient` (ver shared/weapon-attacks e shared/armor-class).
 *
 * `null` quando a categoria não tem regra de proficiência (poção, anel...) ou
 * quando a armadura ainda não tem `armorType` cadastrado — não há o que afirmar.
 */
function itemProficiencyOf(
  item: InventoryItemDto,
  weaponProficiencies: readonly string[],
  armorProficiencies: readonly string[],
): ItemProficiency | null {
  if (item.category === 'Arma' || item.category === 'Cajado') {
    return {
      proficient: isProficientWithWeapon(
        weaponProficiencies,
        item.details.weaponCategory ?? 'simple',
        item.name,
        item.details.canonicalWeaponId,
      ),
    };
  }

  if (item.category === 'Armadura') {
    const type = item.details.armorType;
    return type === undefined ? null : { proficient: isArmorTypeProficient(armorProficiencies, type) };
  }

  if (item.category === 'Escudo') {
    return { proficient: isShieldProficient(armorProficiencies) };
  }

  return null;
}

/**
 * Lista de proficiências de ARMA pronta para EXIBIÇÃO.
 *
 * A mesma arma chega por duas fontes com formatos diferentes: a CLASSE grava o
 * texto em português ("Rapieiras") e a RAÇA grava o id canônico ("rapier"), e
 * as duas somam em `proficiencies.weapons`. Aqui cada entrada que casa com um
 * id de `shared/weapons` é traduzida para o `namePt`; o que não casa com id
 * nenhum (a categoria "Armas marciais", um texto livre) passa direto. Depois a
 * lista é deduplicada por `foldWeaponName` — "Rapieiras" e "Rapieira" viram
 * uma só entrada, mantendo a versão em PORTUGUÊS (texto livre) quando houver
 * conflito com uma traduzida de id, seja qual for a ordem.
 *
 * É só APRESENTAÇÃO: `proficiencies.weapons` segue guardando o formato original
 * (a checagem de proficiência é feita sobre o valor cru).
 */
function displayWeaponProficiencies(raw: readonly string[]): string[] {
  const entries: { value: string; translated: boolean }[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of raw) {
    const weapon = getWeapon(item);
    const value = weapon ? weapon.namePt : item;
    const key = foldWeaponName(value);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, entries.length);
      entries.push({ value, translated: weapon !== undefined });
      continue;
    }
    // Conflito: a entrada em português (texto livre) tem prioridade sobre a
    // traduzida de um id canônico, independentemente da ordem na lista.
    if (entries[existing].translated && !weapon) {
      entries[existing] = { value, translated: false };
    }
  }

  return entries.map((entry) => entry.value);
}

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
  // Subclasse de paladino (juramento): as magias de juramento são DERIVADAS do
  // nível de PALADINO + juramento (Prompt 6.3) — ver `oath-spells.ts`.
  const paladinEntry = classEntries.find((entry) => entry.classKey === 'paladin') ?? null;
  const paladinDefinition = paladinEntry ? getClassDefinition('paladin') : null;
  const paladinSubclass =
    paladinEntry && paladinDefinition
      ? findSubclass(paladinDefinition, paladinEntry.subclass)
      : null;
  // Moedas: as cinco denominações sempre gravadas; o peso entra no derived.
  const coins = normalizeCoins(character.coins);

  // Cada classe é avaliada no PRÓPRIO nível: um Bárbaro 3/Ladino 2 tem as
  // features de bárbaro até o 3 e as de ladino até o 2, ao mesmo tempo.
  const activeFeatures = getMulticlassFeatures(classEntries);
  // As features GRAVADAS na ficha (JSONB) incluem os talentos escolhidos no
  // Level Up (`source: 'feat'`), que o pipeline das classes não vê.
  const features = parseJson<FeatureDto[]>(featureListSchema, character.features, []);
  // Ajustes das classes MAIS os dos talentos (mesmo pipeline e mesmo merge) —
  // a MESMA conta que `characterClassAdjustments` faz para os leitores diretos
  // (combate etc.), garantindo que a ficha e o combate nunca divirjam.
  const classAdjustments = characterClassAdjustments(character);

  // Salvaguardas fixas: as da PRIMEIRA classe (multiclasse nunca concede
  // salvaguardas — PHB p.164), as das features (ex.: Mente Escorregadia) e as dos
  // TALENTOS (o `save` do Resiliente, resolvido por `computeFeatAdjustments`).
  // Aparecem sempre proficientes, mesmo se o valor gravado estiver desatualizado.
  const lockedSaves = [
    ...(classEntries[0]
      ? (getClassDefinition(classEntries[0].classKey)?.savingThrows ?? [])
      : []),
    ...activeFeatures.flatMap((feature) =>
      featureEffectsOf(feature).flatMap((effect) =>
        effect.type === 'save' && effect.ability ? [effect.ability] : [],
      ),
    ),
    ...classAdjustments.saveProficiencies,
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
  // Magias de juramento do Paladino: entram SÓ no DTO (origem 'oath'), sempre
  // preparadas e fora do limite. Se a magia já estiver na lista do jogador por
  // outra via, não duplicamos.
  const storedSpellIds = new Set(spells.list.map((spell) => spell.id));
  const oathSpellList: SpellsStateDto['list'] = resolveOathSpells(
    paladinSubclass?.oathSpells,
    paladinEntry?.level ?? 0,
  )
    .filter((spell) => !storedSpellIds.has(spell.key))
    .map((spell) => ({
      id: spell.key,
      name: spell.name,
      level: spell.level,
      school: spell.school,
      prepared: true,
      description: spell.description,
      classKey: 'paladin',
      oath: true,
    }));
  const spellsForDisplay: SpellsStateDto = {
    ...spells,
    list: [...spells.list, ...oathSpellList],
  };
  const attacks = parseJson<AttackDto[]>(attackListSchema, character.attacks, []);
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

  // Proficiências de arma = as GRAVADAS na ficha. A raça escreve os ids
  // canônicos direto em `proficiencies.weapons` (o serviço aplica/reverte na
  // troca de raça) — o DTO só lê, a ficha é a fonte única.
  const weaponProficiencies = proficiencies.weapons;
  // Versão exibida: class (texto em PT) e raça (id canônico) somam na mesma
  // lista, então a tela mostra os ids traduzidos e sem as repetidas — o campo
  // gravado acima NÃO é tocado (a checagem de proficiência segue sobre o cru).
  const weaponProficienciesDisplay = displayWeaponProficiencies(weaponProficiencies);

  // Proficiência do personagem com cada item do inventário (o popup de detalhes
  // mostra "Proficiente" / "Sem proficiência"). Mesmas regras da ficha.
  const inventoryWithProficiency: InventoryItemDto[] = inventory.map((item) => ({
    ...item,
    proficiency: itemProficiencyOf(item, weaponProficiencies, proficiencies.armor),
  }));

  // Ataques derivados das armas EQUIPADAS (habilidade, proficiência, versátil,
  // duas mãos, mão secundária, arremesso e golpe desarmado).
  const derivedAttacks = deriveWeaponAttacks({
    abilities: effectiveAbilities,
    level,
    weaponProficiencies,
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

    // Limites por classe: o terço-conjurador usa a tabela da SUBCLASSE (o nível
    // é o da classe pai); as demais, a tabela da própria classe.
    const definition = getClassDefinition(entry.classKey);
    const subclassDefinition = definition ? findSubclass(definition, entry.subclass) : null;
    const limits =
      config.type === 'third' && subclassDefinition
        ? thirdCasterSpellcastingLimits(subclassDefinition.id, entry.level)
        : (SPELL_CLASS_KEYS as readonly string[]).includes(entry.classKey)
          ? classSpellcastingLimits(entry.classKey as SpellClassKey, entry.level)
          : null;

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
      cantripsKnown: limits?.cantripsKnown ?? 0,
      spellsKnown: limits?.spellsKnown ?? null,
      maxSpellLevel: limits?.maxSpellLevel ?? 0,
      grimoireSize: limits?.grimoireSize ?? null,
    };
  }

  // As características "Magias de Juramento" mostram os NOMES das magias daquela
  // faixa, traduzidos do catálogo (fonte única: os IDs da subclasse).
  const activeFeaturesWithOathNames = activeFeatures.map((feature) => {
    if (feature.id !== 'oath-spells' && !feature.id.startsWith('oath-spells-')) return feature;
    const names = oathSpellsAtLevel(paladinSubclass?.oathSpells, feature.level).map(
      (spell) => spell.name,
    );
    if (names.length === 0) return feature;
    return { ...feature, description: `${feature.description} ${names.join(', ')}.` };
  });

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
      // As escolhas são feitas no PRÓXIMO nível (o Level Up usa esta lista):
      // o nível vai +1 para as opções com pré-requisito de nível aparecerem já
      // no nível em que passam a valer (Invocações Místicas exigem 5º/12º...).
      featureChoices: definition
        ? featureChoiceInfo(
            definition,
            classState.choices,
            entry.subclass,
            expertiseOptionsOverride,
            entry.level + 1,
          )
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
    // Proficiências de armadura — resolvem o estado de proficiência do
    // equipamento (não mudam a CA).
    armorProficiencies: proficiencies.armor,
    // PV máximo efetivo: o gravado + o bônus de features/talentos.
    hpMax: character.hpMax,
    hpBonus: classAdjustments.hpBonus,
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
    raceId: character.raceId,
    subraceId: character.subraceId,
    raceChoices: parseJson<Record<string, string>>(raceChoicesSchema, character.raceChoices, {}),
    customRaceId: character.customRaceId,
    languages: [...character.languages],
    darkvision: character.darkvision,
    raceResistances: [...character.raceResistances],
    className,
    classes: classEntryDtos,
    classOptions: classOptionsFor(abilities, classEntries),
    activeFeatures: activeFeaturesWithOathNames,
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
    weaponProficienciesDisplay,
    toolProficiencies: character.toolProficiencies ?? [],
    tools: resolveTools(character.toolProficiencies ?? []),
    inventory: inventoryWithProficiency,
    spells: spellsForDisplay,
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
 * Ajustes de classe + TALENTOS de uma ficha lida DIRETO do banco (sem passar
 * pelo DTO): a MESMA conta do `toCharacterDto` (multiclasse + features de
 * talento pelo mesmo `computeFeatAdjustments`/`mergeAdjustments`). O combate e
 * os demais leitores usam isto para os valores DERIVADOS (ex.: `hpBonus`) nunca
 * divergirem da ficha.
 */
export function characterClassAdjustments(character: Character): ClassAdjustments {
  const classEntries = normalizeClassEntries(character.classes);
  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
  const features = parseJson<FeatureDto[]>(featureListSchema, character.features, []);

  return mergeAdjustments(
    computeMulticlassAdjustments(classEntries, normalizeClassState(character.classState), abilities),
    computeFeatAdjustments(
      features
        .filter((feature) => feature.source === 'feat')
        .map((feature) => ({
          featId: feature.featId,
          name: feature.name,
          featAbility: feature.featAbility,
        })),
      totalCharacterLevel(classEntries),
      abilities,
    ),
  );
}

/**
 * PV máximo EFETIVO de uma ficha lida direto do banco = gravado + `hpBonus` de
 * features/talentos (Resiliência Dracônica, Vigoroso). O gravado segue a base
 * editável — o bônus nunca é escrito na ficha.
 */
export function characterMaxHp(character: Character): number {
  return Math.max(0, character.hpMax + characterClassAdjustments(character).hpBonus);
}

/**
 * Ataques derivados de uma ficha lida DIRETO do banco (sem passar pelo DTO).
 * O combate resolve por aqui os ataques de arma equipada — a mesma conta que a
 * ficha mostra, para os ids (`weapon:<item>`, `thrown:<item>`, `offhand:<item>`
 * e `unarmed`) baterem.
 */
export function characterDerivedAttacks(character: Character): CombatAttack[] {
  const classEntries = normalizeClassEntries(character.classes);
  const classAdjustments = characterClassAdjustments(character);
  const inventory = parseJson<InventoryItemDto[]>(inventoryListSchema, character.inventory, []);

  return deriveWeaponAttacks({
    abilities: effectiveAbilitiesOf(character, classAdjustments),
    level: totalCharacterLevel(classEntries),
    weaponProficiencies: normalizeProficiencies(character.proficiencies).weapons,
    inventory,
  });
}
