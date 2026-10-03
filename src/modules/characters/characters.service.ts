import { randomInt, randomUUID } from 'node:crypto';
import type { Character, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { deleteUploadedImage } from '../../lib/uploads.js';
import {
  ServerEvents,
  type CharacterDeletedPayload,
  type SheetUpdatedPayload,
} from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import {
  clearActiveRollFrom,
  forgetRollsFrom,
  recordHealingRoll,
  rollItemEffect,
} from '../dice/dice.service.js';
import type { DiceRollDto } from '../dice/dice.dto.js';
import { getGameConfig } from '../game-config/game-config.service.js';
import { toCharacterDto, type CharacterDto, type InventoryItemDto } from './characters.dto.js';
import {
  catalogItemIds,
  loadCatalogLookup,
  syncInventory,
  type CatalogSnapshot,
} from './inventory-sync.js';
import { inventoryListSchema } from './characters.schema.js';
import type {
  CreateCharacterInput,
  LevelDownInput,
  LevelUpInput,
  MoveInventoryItemInput,
  UpdateCharacterInput,
  UseInventoryItemInput,
} from './characters.schema.js';
import { isConsumableItem } from '../shared/item-details.js';
import { rollHealingDice } from '../shared/dice.js';
import { parseJson } from '../shared/json.js';
import { spellsStateSchema, type SpellsStateInput } from './characters.schema.js';
import {
  applySaveProficiencies,
  averageHitDie,
  emptyProficiencies,
  expertiseOptionsFor,
  expertiseSkillsState,
  findSubclass,
  firstClassProficiencies,
  getClassDefinition,
  isAsiLevel,
  mergeProficiencies,
  multiclassPrerequisiteLabel,
  multiclassProficiencyGrant,
  multiclassSkillChoiceFor,
  featureChoiceLevel,
  featuresWithSubclass,
  normalizeClassEntries,
  normalizeClassState,
  normalizeProficiencies,
  resolveFeatureChoices,
  sameFeatureChoices,
  subclassProficiencyGrant,
  totalCharacterLevel,
  type ClassEntry,
  type ClassFeatureDefinition,
  type ProficienciesState,
} from '../shared/classes.js';
import { raceHpBonusDelta } from '../shared/races/index.js';
import {
  classEntryProficiencyGrant,
  classProficiencyGrant,
  classStateIdsFor,
  normalizeLevelHistory,
  subtractProficiencies,
  type LevelHistoryRecord,
} from '../shared/level-history.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import {
  LEVEL_MAX,
  SKILL_KEYS,
  SKILL_LABELS,
  abilityModifier,
  normalizeSaves,
  normalizeSkills,
} from '../shared/dnd5e.js';
import {
  COIN_KEYS,
  COIN_LABELS,
  addDelta,
  exchangeIsExact,
  exchangeResult,
  fillCoins,
  formatCoins,
  hasCoinsFor,
  normalizeCoins,
  subtractCoins,
  type CoinAmount,
  type CoinDelta,
  type CoinPurse,
  type ExchangeCoinsInput,
} from '../shared/coins.js';

/** Quem está alterando a ficha (vem do token, nunca do corpo da requisição). */
export interface Actor {
  userId: string;
  username: string;
  /** Nome de exibição — é ele que aparece para o jogador quando o mestre edita. */
  displayName: string;
}

/** Dono da ficha: recebe o evento e assina o DTO entregue à mesa. */
interface SheetOwner {
  userId: string;
  username: string;
}

/** Campos escalares copiados diretamente do PATCH para o banco. */
const SCALAR_KEYS = [
  'name',
  'race',
  'raceId',
  'subraceId',
  'customRaceId',
  'languages',
  'darkvision',
  'raceResistances',
  'background',
  'alignment',
  'experience',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'hpCurrent',
  'hpMax',
  'hpTemp',
  'initiativeBonus',
  'speed',
  'avatarUrl',
  'notes',
] as const;

/**
 * Campos que o jogador ainda pode alterar com a criação finalizada — o ESTADO
 * DE JOGO. Todo o resto (identidade, atributos, proficiências, classes, PV
 * máximo, CA, magias conhecidas, ataques, características e inventário) é
 * construção: só muda pelo Level Up ou pelas mãos do mestre.
 */
const PLAYER_STATE_KEYS = [
  'hpCurrent',
  'hpTemp',
  'notes',
  'avatarUrl',
  'classState',
  'spells',
] as const;

/** Nome de cada campo de construção, para a mensagem de 403 ficar legível. */
const CREATION_FIELD_LABELS: Record<string, string> = {
  name: 'nome',
  race: 'raça',
  raceId: 'raça (catálogo)',
  subraceId: 'sub-raça (catálogo)',
  customRaceId: 'raça personalizada',
  raceChoices: 'escolhas da raça',
  languages: 'idiomas',
  darkvision: 'visão no escuro',
  raceResistances: 'resistências da raça',
  background: 'antecedente',
  alignment: 'alinhamento',
  experience: 'experiência',
  classes: 'classes',
  level: 'nível',
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
  hpMax: 'PV máximo',
  armorClassOverride: 'CA',
  initiativeBonus: 'iniciativa',
  speed: 'deslocamento',
  skills: 'perícias',
  saves: 'salvaguardas',
  proficiencies: 'proficiências de armadura, arma e ferramenta',
  toolProficiencies: 'proficiências de ferramenta',
  coins: 'Moedas',
  attacks: 'ataques',
  features: 'características',
  inventory: 'Inventário',
};

/**
 * Features de Expertise (Ladino/Bardo) de UMA classe — só elas interessam ao
 * recálculo de `skills[].expertise`.
 */
function expertiseFeaturesOf(classKey: string, subclassName: string): ClassFeatureDefinition[] {
  const definition = getClassDefinition(classKey);
  if (!definition) return [];
  return featuresWithSubclass(definition, subclassName).filter(
    (feature) => feature.choice?.apply === 'expertise',
  );
}

/**
 * Perícias com Expertise na ficha a partir das escolhas gravadas em
 * `classState.choices` (as ferramentas não vivem em `skills`). Mantém o bônus
 * dobrado de `deriveStats` igual à lista de espaços concedidos.
 */
function withExpertiseSkills(
  entries: ClassEntry[],
  extra: { classKey: string; subclass: string },
  choices: Record<string, string[]>,
  skills: Record<string, { proficient: boolean; expertise: boolean }>,
): Record<string, { proficient: boolean; expertise: boolean }> {
  const features = [
    ...entries.flatMap((entry) => expertiseFeaturesOf(entry.classKey, entry.subclass)),
    ...expertiseFeaturesOf(extra.classKey, extra.subclass),
  ];
  return expertiseSkillsState(features, choices, skills);
}

function emptySpells(): Prisma.InputJsonValue {
  return { list: [], slots: {} };
}

/**
 * PV de nível 1: o máximo do Dado de Vida da classe + modificador de
 * Constituição (mínimo 1, mesmo com Constituição negativa).
 */
function firstLevelHpMax(hitDie: number, constitution: number): number {
  return Math.max(1, hitDie + abilityModifier(constitution));
}

/**
 * Recálculo retroativo de Constituição (regra do PHB): quando o modificador de
 * CON muda, o PV passa a valer como se o novo modificador existisse desde o
 * nível 1. O delta cobre todos os níveis já obtidos — `(novo mod − mod antigo)
 * × nível total` — e entra tanto no máximo quanto no atual. Um valor negativo
 * (CON diminuída) reduz os dois na mesma medida.
 */
function constitutionHpDelta(previous: number, next: number, totalLevel: number): number {
  return (abilityModifier(next) - abilityModifier(previous)) * totalLevel;
}

/** Atributos do personagem no formato usado pelas regras de classe. */
function abilitiesOf(character: Character): Record<AbilityKey, number> {
  return {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
}

/**
 * Salvaguardas fixas do personagem.
 *
 * Só a PRIMEIRA classe concede salvaguardas: multiclasse nunca as concede
 * (PHB 2014, p.164), mesmo que a classe nova tenha salvaguardas próprias.
 */
function lockedSavesOf(entries: ClassEntry[]): AbilityKey[] {
  const first = entries[0];
  if (!first) return [];
  return [...(getClassDefinition(first.classKey)?.savingThrows ?? [])];
}

/**
 * Resolve a lista de classes de um PATCH.
 *
 * O **nível** de cada classe só muda pelo fluxo de Level Up, então aqui:
 *
 *  - Ficha sem classe: aceita exatamente uma classe (entra no nível 1) e exige
 *    o pré-requisito de atributo da classe.
 *  - Ficha com classes: a lista só pode trocar a SUBCLASSE de classes que já
 *    existem (respeitando o nível de escolha daquela classe). Adicionar,
 *    remover ou mudar nível é recusado com uma mensagem clara.
 *
 * Retorna `null` quando o patch não mexeu em classes.
 */
function resolveClassPatch(
  existing: ClassEntry[],
  incoming: { classKey: string; subclass: string }[] | undefined,
  abilities: Record<AbilityKey, number>,
  options: { allowReplace?: boolean; skipPrerequisite?: boolean } = {},
): ClassEntry[] | null {
  if (incoming === undefined) return null;

  if (existing.length === 0 || canReplaceSingleClass(existing, options)) {
    if (incoming.length === 0) return [];
    if (incoming.length > 1) {
      throw new HttpError('A ficha começa com uma classe só; as demais entram pelo Level Up.', 400);
    }

    const chosen = incoming[0];
    const definition = getClassDefinition(chosen.classKey);
    if (!definition) throw new HttpError('Classe desconhecida.', 400);

    // O assistente de criação escolhe a classe ANTES dos atributos: nesse
    // momento o pré-requisito ainda não pode ser conferido (o passo seguinte é
    // quem faz isso, já com os valores finais).
    // A ficha ainda não tem classes: só o pré-requisito da classe nova importa.
    const missing = options.skipPrerequisite
      ? ''
      : multiclassPrerequisiteLabel(definition.key, abilities, existing);
    if (missing) {
      throw new HttpError(`${missing}.`, 400);
    }

    // Subclasse do NÍVEL 1 (Clérigo, Feiticeiro e Bruxo): o livro já exige a
    // subclasse junto da primeira classe, então o passo da classe pode (e deve)
    // trazê-la. Nas demais classes ela só entra no nível que a libera.
    const requestedSubclass = chosen.subclass.trim();
    const keepsExistingSubclass =
      existing.length === 1 && existing[0].classKey === definition.key;
    let subclass = '';

    if (requestedSubclass !== '') {
      if (definition.subclassLevel > 1) {
        throw new HttpError(
          `A subclasse de ${definition.name} é escolhida a partir do nível ${definition.subclassLevel} dela.`,
          400,
        );
      }
      const found = findSubclass(definition, requestedSubclass);
      if (!found) throw new HttpError('Subclasse desconhecida.', 400);
      subclass = found.name;
    } else if (keepsExistingSubclass) {
      // Voltou ao passo sem mexer na classe: a subclasse já escolhida fica.
      subclass = existing[0].subclass;
    }

    // A obrigatoriedade vale para o ASSISTENTE (que mostra a escolha): o seletor
    // antigo de "primeira classe" da ficha não tem onde pedir a subclasse, então
    // lá ela continua podendo ser preenchida depois, no campo da classe.
    if (subclass === '' && definition.subclassLevel <= 1 && options.allowReplace) {
      throw new HttpError(`Escolha a subclasse de ${definition.name}.`, 400);
    }

    return [{ classKey: definition.key, subclass, level: 1 }];
  }

  const known = new Set(existing.map((entry) => entry.classKey));
  for (const entry of incoming) {
    if (!known.has(entry.classKey)) {
      throw new HttpError(
        'Para adicionar uma classe nova use o Level Up (multiclasse).',
        400,
      );
    }
  }

  let changed = false;
  const next = existing.map((entry) => {
    const patch = incoming.find((item) => item.classKey === entry.classKey);
    if (!patch || patch.subclass === entry.subclass) return entry;

    const definition = getClassDefinition(entry.classKey);

    if (patch.subclass !== '' && definition && entry.level < definition.subclassLevel) {
      throw new HttpError(
        `A subclasse de ${definition.name} é escolhida a partir do nível ${definition.subclassLevel} dela.`,
        400,
      );
    }

    changed = true;
    return { ...entry, subclass: patch.subclass };
  });

  return changed ? next : null;
}

/**
 * Verdadeiro quando a lista pode ser substituída por inteiro.
 *
 * Só o assistente de criação usa isso (`fromWizard`), para o jogador poder
 * voltar ao passo da classe e escolher outra antes de finalizar. Depois disso a
 * classe inicial já está em jogo e a lista só muda pelo Level Up.
 */
function canReplaceSingleClass(
  existing: ClassEntry[],
  options: { allowReplace?: boolean },
): boolean {
  return options.allowReplace === true && existing.length === 1 && existing[0].level === 1;
}

/**
 * Publica a alteração para o mestre (que enxerga tudo) e para as demais
 * sessões do dono da ficha — inclusive quando quem editou foi o mestre, para
 * o jogador ver a mudança na tela na hora.
 *
 * `editedBy` só é preenchido quando o editor não é o dono. Falha de tempo real
 * nunca deve derrubar a requisição HTTP que já foi persistida.
 */
async function publishChange(
  owner: SheetOwner,
  character: Character,
  changes: Record<string, unknown>,
  editedBy?: string,
): Promise<void> {
  try {
    const payload: SheetUpdatedPayload = {
      userId: owner.userId,
      username: owner.username,
      characterId: character.id,
      version: character.version,
      changes,
      character: await toSheetDto(character, owner.username),
      editedBy,
      at: new Date().toISOString(),
    };

    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.SHEET_UPDATED, payload);
    broadcaster.toUser(owner.userId, ServerEvents.SHEET_UPDATED, payload);
  } catch (error) {
    console.error('[characters] falha ao publicar alteração em tempo real:', error);
  }
}

/** Cria a ficha do usuário autenticado (uma por usuário). */
export async function createCharacter(
  actor: Actor,
  input: CreateCharacterInput,
): Promise<CharacterDto> {
  const existing = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (existing) {
    throw new HttpError('Você já possui uma ficha.', 409);
  }

  const character = await prisma.character.create({
    data: {
      userId: actor.userId,
      name: input.name ?? 'Novo Personagem',
      race: input.race ?? '',
      // A ficha nasce sem classe: o jogador escolhe a primeira na ficha, onde
      // o pré-requisito de atributo pode ser conferido com os valores reais.
      // O PV inicial (dado de vida + Constituição) é calculado nessa escolha.
      // Ver applyCharacterPatch.
      classes: [] as unknown as Prisma.InputJsonValue,
      skills: normalizeSkills({}) as unknown as Prisma.InputJsonValue,
      saves: normalizeSaves({}) as unknown as Prisma.InputJsonValue,
      inventory: [] as Prisma.InputJsonValue,
      spells: emptySpells(),
      attacks: [] as Prisma.InputJsonValue,
      features: [] as Prisma.InputJsonValue,
    },
  });

  await publishChange(actor, character, { created: true });
  return toSheetDto(character, actor.username);
}

/**
 * Sobe um nível seguindo o assistente de Level Up.
 *
 * Só é permitido quando o jogador ainda não usou a liberação atual
 * (`lastLevelUpRelease < GameConfig.levelUpRelease`). Não existe mais estado
 * "bloqueado": o mestre libera e o jogador upa; liberar de novo re-arma para o
 * próximo nível. Aplica de
 * uma vez: o nível da classe (nova ou existente), o PV ganho (dado rolado no
 * servidor ou a média do PHB, sempre mínimo 1), a subclasse quando o nível a
 * libera e o Aumento de Atributo/Talento quando é um nível de ASI da classe.
 */
export async function levelUpCharacter(actor: Actor, input: LevelUpInput): Promise<CharacterDto> {
  const config = await getGameConfig();

  // Leitura, checagem e gravação na MESMA transação: o `where` com o
  // `lastLevelUpRelease` antigo (ver applyLevelUp) impede que dois cliques
  // simultâneos apliquem dois níveis na mesma liberação.
  const { updated, levelUp } = await prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { userId: actor.userId } });
    if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

    if (character.lastLevelUpRelease >= config.levelUpRelease) {
      throw new HttpError('Você já usou esta liberação de Level Up.', 409);
    }

    return applyLevelUp(tx, actor, input, config, character, { consumeRelease: true });
  });

  await publishChange(actor, updated, { levelUp });

  return toSheetDto(updated, actor.username);
}

/**
 * Sobe um nível SEM depender da liberação do mestre — é o que o assistente de
 * criação usa no passo 8 ("nível inicial da mesa") para aplicar os níveis 2..N
 * de uma vez, na mesma lógica do Level Up normal.
 *
 * A liberação da mesa NÃO é consumida: o jogador continua com o Level Up dele
 * disponível quando o mestre liberar, como qualquer outro.
 */
export async function levelUpDraft(
  actor: Actor,
  input: LevelUpInput,
  maxLevel: number,
): Promise<CharacterDto> {
  const config = await getGameConfig();

  const { updated, levelUp } = await prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { userId: actor.userId } });
    if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);
    if (character.creationFinalized) {
      throw new HttpError(
        'A criação deste personagem já foi finalizada — o nível agora sobe pelo Level Up.',
        409,
      );
    }

    const level = totalCharacterLevel(normalizeClassEntries(character.classes));
    if (level >= maxLevel) {
      throw new HttpError(
        `O nível inicial desta mesa é ${maxLevel} — não há mais níveis para aplicar na criação.`,
        400,
      );
    }

    return applyLevelUp(tx, actor, input, config, character, { consumeRelease: false });
  });

  await publishChange(actor, updated, { levelUp });

  return toSheetDto(updated, actor.username);
}

/**
 * Núcleo do Level Up: valida contra a classe e grava dentro da transação.
 *
 * A gravação é um `updateMany` cujo `where` inclui o `lastLevelUpRelease` lido:
 * se outra requisição já aplicou o level up, nenhuma linha casa e devolvemos 409.
 */
async function applyLevelUp(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: LevelUpInput,
  config: Awaited<ReturnType<typeof getGameConfig>>,
  character: Character,
  /**
   * `consumeRelease` marca a liberação da mesa como usada por este personagem.
   * O assistente de criação passa `false` (o nível inicial não gasta o Level Up
   * que o mestre liberou).
   */
  options: { consumeRelease: boolean },
): Promise<{
  updated: Character;
  levelUp: { classKey: string; classLevel: number; hpGained: number; hpRolled: boolean };
}> {
  const entries = normalizeClassEntries(character.classes);
  const abilities = abilitiesOf(character);

  if (totalCharacterLevel(entries) >= LEVEL_MAX) {
    throw new HttpError('O personagem já está no nível máximo (20).', 400);
  }

  const definition = getClassDefinition(input.classKey);
  if (!definition) throw new HttpError('Classe desconhecida.', 400);

  const existing = entries.find((entry) => entry.classKey === definition.key);
  if (existing && existing.level >= LEVEL_MAX) {
    throw new HttpError(`${definition.name} já está no nível máximo.`, 400);
  }

  // Classe nova (multiclasse) precisa do pré-requisito de atributo: 13 nos
  // atributos exigidos por ela E por todas as classes que o personagem já tem
  // (PHB 2014, cap. 6).
  if (!existing) {
    const missing = multiclassPrerequisiteLabel(definition.key, abilities, entries);
    if (missing) throw new HttpError(`${missing}.`, 400);
  }

  const newClassLevel = existing ? existing.level + 1 : 1;

  // --- Dado de vida: rolado ou média (d6=4, d8=5, d10=6, d12=7) -----------
  // O modificador de Constituição entra depois: o Aumento de Atributo deste
  // mesmo nível (se houver) já vale para o PV ganho agora.
  const dieRoll =
    input.hp === 'roll'
      ? randomInt(1, definition.hitDie + 1)
      : averageHitDie(definition.hitDie);

  const data: Record<string, unknown> = {};
  const features: unknown[] = Array.isArray(character.features) ? [...character.features] : [];

  // --- O que ESTE nível concede, para o histórico --------------------------
  // Cada item daqui é o que o downgrade do mestre precisa desfazer (ver
  // `levelDownCharacter` e shared/level-history.ts). Aumento de Atributo e a
  // rolagem de PV não ficam em nenhum outro lugar da ficha: sem este registro
  // não haveria como revertê-los.
  let grantedProficiencies: ProficienciesState | null = null;
  let grantedSubclass = '';
  let grantedFeat: { id: string; name: string } | null = null;
  const grantedAbilities: { ability: AbilityKey; amount: number }[] = [];
  const grantedSkills: string[] = [];

  // --- Subclasse: exigida quando o nível da classe libera a escolha ---------
  let subclass = existing?.subclass ?? '';
  if (!subclass && newClassLevel >= definition.subclassLevel) {
    const chosen = input.subclass.trim();
    if (!chosen) {
      throw new HttpError(`Escolha a subclasse de ${definition.name}.`, 400);
    }
    const found = findSubclass(definition, chosen);
    if (!found) throw new HttpError('Subclasse desconhecida.', 400);
    subclass = found.name;
    grantedSubclass = found.name;

    // A subclasse pode conceder proficiências (Colégio da Bravura: armaduras
    // médias, escudos e armas marciais): entram SOMADAS às da classe.
    const subclassGrant = subclassProficiencyGrant(definition, subclass);
    if (subclassGrant.armor.length + subclassGrant.weapons.length + subclassGrant.tools.length > 0) {
      data.proficiencies = mergeProficiencies(
        normalizeProficiencies(data.proficiencies ?? character.proficiencies),
        subclassGrant,
      );
      grantedProficiencies = subclassGrant;
    }
  }

  // --- Aumento de Atributo ou Talento (só nos níveis de ASI da classe) ------
  // --- Escolhas de característica liberadas por ESTE nível ------------------
  // Estilo de Luta do guerreiro (1º), do paladino e do patrulheiro (2º),
  // Inimigo Favorito e Explorador Nato do patrulheiro (1º e melhorias). O
  // serviço valida quantidade, opções e o nível em que cada escolha é feita.
  const classState = normalizeClassState(character.classState);
  const skillsNow = normalizeSkills(data.skills ?? character.skills);
  // A Expertise só aceita o que o personagem JÁ domina: as opções da escolha
  // saem das perícias marcadas na ficha e das ferramentas dela — o servidor
  // recusa qualquer coisa fora dessa lista.
  const nextChoices = resolveFeatureChoices(
    definition,
    newClassLevel,
    input.choices,
    classState.choices,
    subclass,
    {
      expertise: expertiseOptionsFor(
        Object.entries(skillsNow)
          .filter(([, entry]) => entry.proficient)
          .map(([key]) => key),
        normalizeProficiencies(data.proficiencies ?? character.proficiencies).tools,
      ),
    },
  );
  if (!sameFeatureChoices(nextChoices, classState.choices)) {
    data.classState = { ...classState, choices: nextChoices };
  }
  // A ficha segue as escolhas: a perícia escolhida para Expertise passa a dobrar
  // o bônus de proficiência e a que saiu da lista volta ao normal.
  data.skills = withExpertiseSkills(
    entries,
    { classKey: definition.key, subclass },
    nextChoices,
    skillsNow,
  );

  /**
   * Entrada numa classe NOVA (multiclasse de verdade): só aí valem a tabela
   * reduzida de proficiências e a perícia extra do livro. A primeira classe da
   * ficha usa as proficiências iniciais completas.
   */
  const isMulticlassEntry = !existing && entries.length > 0;

  // --- Proficiências de armadura, arma e ferramenta -------------------------
  // Entrar numa classe concede somente o que a tabela de multiclasse dá (PHB
  // p.164) — nunca salvaguardas.
  if (!existing) {
    const grant = isMulticlassEntry
      ? multiclassProficiencyGrant(definition.key)
      : firstClassProficiencies(definition.key);
    // A subclasse escolhida NO MESMO nível (Clérigo do Domínio da Guerra, no
    // 1º) já somou as dela acima: aqui elas não podem ser perdidas.
    data.proficiencies = mergeProficiencies(
      normalizeProficiencies(data.proficiencies ?? character.proficiencies),
      grant,
    );
    grantedProficiencies = grantedProficiencies
      ? mergeProficiencies(grantedProficiencies, grant)
      : grant;
  }

  // --- Perícia da entrada por multiclasse ----------------------------------
  // Bardo (qualquer perícia), Patrulheiro e Ladino (da lista da classe) dão uma
  // perícia ao entrar; ela precisa ser uma perícia que o personagem não tenha.
  if (isMulticlassEntry) {
    const skillChoice = multiclassSkillChoiceFor(definition.key);
    const chosenSkill = input.skillChoice.trim();

    if (skillChoice) {
      if (chosenSkill === '') {
        throw new HttpError(`Escolha a perícia concedida por ${definition.name}.`, 400);
      }
      const withinList = skillChoice.from.length === 0 || skillChoice.from.includes(chosenSkill);
      if (!SKILL_KEYS.includes(chosenSkill) || !withinList) {
        throw new HttpError(`Perícia inválida para ${definition.name}.`, 400);
      }

      const currentSkills = normalizeSkills(character.skills);
      if (currentSkills[chosenSkill]?.proficient) {
        throw new HttpError(
          `Você já tem proficiência em ${SKILL_LABELS[chosenSkill] ?? chosenSkill}.`,
          400,
        );
      }

      data.skills = {
        ...currentSkills,
        [chosenSkill]: {
          proficient: true,
          expertise: currentSkills[chosenSkill]?.expertise ?? false,
        },
      };
      grantedSkills.push(chosenSkill);
    } else if (chosenSkill !== '') {
      throw new HttpError(
        `${definition.name} não concede perícia ao entrar por multiclasse.`,
        400,
      );
    }
  } else if (input.skillChoice.trim() !== '') {
    throw new HttpError(
      'A perícia de multiclasse só entra ao escolher uma classe nova.',
      400,
    );
  }

  // --- Escolhas que APLICAM algo na ficha -----------------------------------
  // Colégio do Conhecimento: as 3 perícias escolhidas viram proficiência (a
  // escolha também fica gravada em `classState.choices`).
  const skillGainChoices = featuresWithSubclass(definition, subclass).filter(
    (feature) =>
      feature.choice?.apply === 'skill' && featureChoiceLevel(feature) === newClassLevel,
  );
  const gainedSkills = [
    ...new Set(skillGainChoices.flatMap((feature) => nextChoices[feature.id] ?? [])),
  ].filter((key) => SKILL_KEYS.includes(key));

  if (gainedSkills.length > 0) {
    const currentSkills = normalizeSkills(data.skills ?? character.skills);
    const nextSkills = { ...currentSkills };
    for (const key of gainedSkills) {
      nextSkills[key] = { proficient: true, expertise: currentSkills[key]?.expertise ?? false };
    }
    data.skills = nextSkills;
    grantedSkills.push(...gainedSkills);
  }

  if (isAsiLevel(definition.key, newClassLevel)) {
    if (input.feat) {
      const featId = `feat-${randomUUID()}`;
      features.push({
        id: featId,
        name: input.feat.name,
        source: 'feat',
        description: input.feat.description,
      });
      data.features = features;
      grantedFeat = { id: featId, name: input.feat.name };
    } else {
      const increases = new Map<AbilityKey, number>();
      for (const item of input.abilityIncreases) {
        const ability = item.ability as AbilityKey;
        increases.set(ability, (increases.get(ability) ?? 0) + item.amount);
      }
      const points = [...increases.values()].reduce((sum, value) => sum + value, 0);
      if (points !== 2) {
        throw new HttpError(
          'Distribua as 2 melhorias: +2 em um atributo ou +1 em dois diferentes.',
          400,
        );
      }

      for (const [ability, amount] of increases) {
        if (character[ability] + amount > 20) {
          throw new HttpError('Nenhum atributo pode passar de 20.', 400);
        }
        data[ability] = character[ability] + amount;
        grantedAbilities.push({ ability, amount });
      }
    }
  } else if (input.feat || input.abilityIncreases.length > 0) {
    throw new HttpError(
      'Este nível não concede Aumento de Atributo nem Talento.',
      400,
    );
  }

  // --- Grava de uma vez ----------------------------------------------------
  const nextEntries: ClassEntry[] = existing
    ? entries.map((entry) =>
        entry.classKey === definition.key ? { ...entry, level: newClassLevel, subclass } : entry,
      )
    : [...entries, { classKey: definition.key, subclass, level: 1 }];

  // --- Pontos de vida do nível que está sendo ganho ------------------------
  // O PV ganho usa o modificador de Constituição já atualizado pelo Aumento de
  // Atributo (se houve); mínimo de 1 PV por nível, mesmo com CON negativa.
  const nextConstitution =
    typeof data.constitution === 'number' ? data.constitution : character.constitution;
  const hpGained = Math.max(1, dieRoll + abilityModifier(nextConstitution));

  // --- Recálculo retroativo de Constituição --------------------------------
  // Se a Constituição subiu, os níveis JÁ obtidos (antes deste) também ganham
  // o ajuste: (novo mod − mod antigo) × nível total anterior.
  const conDelta = constitutionHpDelta(
    character.constitution,
    nextConstitution,
    totalCharacterLevel(entries),
  );

  // --- Histórico do nível que está sendo ganho -----------------------------
  // É o que o mestre precisa para REVERTER este nível depois: a rolagem de PV, o
  // Aumento de Atributo/Talento e as escolhas não existem em nenhum outro lugar
  // da ficha. Ver shared/level-history.ts.
  const addedChoices: Record<string, string[]> = {};
  for (const [featureId, keys] of Object.entries(nextChoices)) {
    const previous = classState.choices[featureId] ?? [];
    const same =
      previous.length === keys.length && previous.every((value, index) => value === keys[index]);
    if (!same) addedChoices[featureId] = keys;
  }

  const historyRecord: LevelHistoryRecord = {
    classKey: definition.key,
    classLevel: newClassLevel,
    totalLevel: totalCharacterLevel(nextEntries),
    hp: {
      rolled: input.hp === 'roll',
      die: dieRoll,
      gained: hpGained,
      conDelta,
      total: hpGained + conDelta,
    },
    abilityIncreases: grantedAbilities,
    feat: grantedFeat,
    choices: addedChoices,
    subclass: grantedSubclass,
    skills: [...new Set(grantedSkills)],
    proficiencies: grantedProficiencies,
    at: new Date().toISOString(),
  };

  const result = await tx.character.updateMany({
    where: {
      userId: actor.userId,
      // Condição de corrida: só grava se a liberação ainda não foi usada.
      lastLevelUpRelease: character.lastLevelUpRelease,
    },
    data: {
      ...(data as Prisma.CharacterUpdateManyMutationInput),
      classes: nextEntries as unknown as Prisma.InputJsonValue,
      levelHistory: [
        ...normalizeLevelHistory(character.levelHistory),
        historyRecord,
      ] as unknown as Prisma.InputJsonValue,
      // O PV ganho vale tanto para o máximo quanto para o PV atual.
      hpMax: character.hpMax + hpGained + conDelta,
      hpCurrent: Math.max(0, character.hpCurrent + hpGained + conDelta),
      lastLevelUpRelease: options.consumeRelease
        ? config.levelUpRelease
        : character.lastLevelUpRelease,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new HttpError('Você já usou esta liberação de Level Up.', 409);
  }

  // Relê a ficha dentro da transação para devolver o estado já gravado.
  const updated = await tx.character.findUniqueOrThrow({ where: { userId: actor.userId } });

  return {
    updated,
    levelUp: {
      classKey: definition.key,
      classLevel: newClassLevel,
      hpGained,
      hpRolled: input.hp === 'roll',
    },
  };
}

/** Resumo do que um downgrade desfez — vai na resposta e no aviso da mesa. */
export interface LevelDownSummary {
  classKey: string;
  className: string;
  /** Nível da classe ANTES da redução. */
  previousClassLevel: number;
  /** Nível da classe depois (0 = a classe saiu da ficha). */
  classLevel: number;
  /** Nível total do personagem depois da redução. */
  totalLevel: number;
  classRemoved: boolean;
  hpLost: number;
  /** O que foi revertido na ficha. */
  reverted: {
    abilities: { ability: AbilityKey; amount: number }[];
    feats: string[];
    choices: string[];
    subclass: string;
    skills: string[];
    proficiencies: ProficienciesState;
  };
  /** O que não deu para reverter com certeza (nível anterior ao histórico). */
  warnings: string[];
}

/**
 * O MESTRE reduz um nível de um personagem.
 *
 * Tira UM nível da classe indicada e reverte o que aquele nível concedeu — é o
 * inverso do `applyLevelUp`. O histórico gravado no Level Up é a fonte da
 * verdade: sem ele não se sabe quanto de PV aquele nível deu (a rolagem se
 * perde) nem que atributo o jogador subiu.
 *
 * Nível 1 caindo para 0 tira a classe inteira da ficha: subclasse, escolhas,
 * perícia de multiclasse e proficiências de entrada vão junto (só as que as
 * classes restantes não concedem). A última classe do personagem não pode sair —
 * a ficha ficaria sem classe para definir PV base e salvaguardas.
 *
 * Níveis anteriores ao histórico caem no caminho estimado (média do dado de vida
 * + Constituição) e devolvem avisos; o mestre pode corrigir pelo corpo da
 * requisição (`hpLost`, `abilityDecreases`, `removeFeatId`).
 */
export async function levelDownCharacter(
  characterId: string,
  master: Actor,
  input: LevelDownInput,
): Promise<{ character: CharacterDto; levelDown: LevelDownSummary }> {
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });

  if (!target) throw new HttpError('Ficha não encontrada.', 404);

  const entries = normalizeClassEntries(target.classes);
  const index = entries.findIndex((item) => item.classKey === input.classKey);
  if (index === -1) {
    throw new HttpError('O personagem não tem essa classe.', 400);
  }

  const entry = entries[index];
  const definition = getClassDefinition(entry.classKey);
  const className = definition?.name ?? entry.classKey;
  const warnings: string[] = [];

  // A ficha não pode ficar sem classe: a primeira define o PV base, as
  // salvaguardas e as proficiências iniciais. Para desmontar a última classe, o
  // mestre reabre a criação.
  if (entry.level <= 1 && entries.length === 1) {
    throw new HttpError(
      `Reduzir ${className} deixaria o personagem sem classe — reabra a criação para refazer a ficha.`,
      400,
    );
  }

  // O ÚLTIMO registro daquela classe é o nível que está sendo perdido.
  const history = normalizeLevelHistory(target.levelHistory);
  const recordIndex = history.reduce(
    (last, item, at) => (item.classKey === entry.classKey ? at : last),
    -1,
  );
  const record =
    recordIndex >= 0 && history[recordIndex].classLevel === entry.level
      ? history[recordIndex]
      : null;

  const classRemoved = entry.level <= 1;
  // A subclasse escolhida NAQUELE nível vai junto com ele.
  const revertedSubclass = record?.subclass ?? '';
  const keptSubclass = revertedSubclass === '' ? entry.subclass : '';
  const nextEntries: ClassEntry[] = classRemoved
    ? entries.filter((item) => item.classKey !== entry.classKey)
    : entries.map((item) =>
        item.classKey === entry.classKey
          ? { ...item, level: item.level - 1, subclass: keptSubclass }
          : item,
      );

  // --- PV ------------------------------------------------------------------
  // O histórico manda: é o que foi somado naquele nível (dado + CON + ajuste
  // retroativo de CON). Sem ele, a média do dado de vida é a estimativa do PHB.
  const hitDie = definition?.hitDie ?? 8;
  let hpLost: number;
  if (input.hpLost !== undefined) {
    hpLost = input.hpLost;
  } else if (record) {
    hpLost = record.hp.total;
  } else {
    hpLost = Math.max(1, averageHitDie(hitDie) + abilityModifier(target.constitution));
    warnings.push(
      `O ${entry.level}º nível de ${className} é anterior ao histórico da ficha: o PV perdido foi ` +
        `estimado pela média do dado de vida (${hpLost}) e o que esse nível concedeu não pôde ser revertido sozinho.`,
    );
    if (isAsiLevel(entry.classKey, entry.level)) {
      warnings.push(
        `O ${entry.level}º nível de ${className} concede Aumento de Atributo/Talento — informe ` +
          '`abilityDecreases` (ou `removeFeatId`) para desfazê-lo.',
      );
    }
  }

  // --- Aumento de Atributo/Talento -----------------------------------------
  const decreases = new Map<AbilityKey, number>();
  for (const item of [...(record?.abilityIncreases ?? []), ...input.abilityDecreases]) {
    const ability = item.ability as AbilityKey;
    decreases.set(ability, (decreases.get(ability) ?? 0) + item.amount);
  }

  const abilityData: Record<string, number> = {};
  const revertedAbilities: { ability: AbilityKey; amount: number }[] = [];
  for (const [ability, amount] of decreases) {
    const next = Math.max(1, target[ability] - amount);
    if (next === target[ability]) continue;
    abilityData[ability] = next;
    revertedAbilities.push({ ability, amount: target[ability] - next });
  }

  const featIds = new Set<string>();
  if (record?.feat) featIds.add(record.feat.id);
  if (input.removeFeatId) featIds.add(input.removeFeatId);

  const storedFeatures = Array.isArray(target.features) ? [...target.features] : [];
  const removedFeats: string[] = [];
  const keptFeatures = storedFeatures.filter((item) => {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && featIds.has(id)) {
      removedFeats.push(id);
      return false;
    }
    return true;
  });

  // --- Escolhas de característica, perícia e proficiências ------------------
  const classState = normalizeClassState(target.classState);
  const choices = { ...classState.choices };
  const revertedChoices = Object.keys(record?.choices ?? {}).filter(
    (featureId) => featureId in choices,
  );
  for (const featureId of revertedChoices) delete choices[featureId];

  const skills = normalizeSkills(target.skills);
  const revertedSkills = [...new Set(record?.skills ?? [])].filter(
    (key) => SKILL_KEYS.includes(key) && skills[key]?.proficient === true,
  );
  for (const key of revertedSkills) skills[key] = { proficient: false, expertise: false };

  // O que aquele nível somou: o registro manda; num nível de ENTRADA sem
  // histórico, a concessão da classe é reconstruída (primeira classe vs.
  // multiclasse).
  const removedGrant: ProficienciesState = record
    ? (record.proficiencies ?? emptyProficiencies())
    : entry.level === 1
      ? classEntryProficiencyGrant(entry, index === 0)
      : emptyProficiencies();

  const currentProficiencies = normalizeProficiencies(target.proficiencies);
  const proficiencies = subtractProficiencies(
    currentProficiencies,
    removedGrant,
    classProficiencyGrant(nextEntries),
  );
  const dropped = (before: string[], after: string[]): string[] =>
    before.filter((item) => !after.includes(item));

  // --- Salvaguardas: quem concede é a PRIMEIRA classe ----------------------
  // Sair a classe inicial passa a chave para a próxima: as salvaguardas dela
  // entram e as antigas voltam a ser escolha do mestre.
  const oldLocked = lockedSavesOf(entries);
  const newLocked = lockedSavesOf(nextEntries);
  const savesBase = { ...normalizeSaves(target.saves) };
  for (const ability of oldLocked) {
    if (!newLocked.includes(ability)) savesBase[ability] = false;
  }
  const saves = applySaveProficiencies(savesBase, newLocked);

  // --- Estado de runtime: a classe que sai leva os recursos dela -----------
  const removedIds = classRemoved ? classStateIdsFor(entry) : new Set<string>();
  const nextClassState = {
    active: classState.active.filter((id) => !removedIds.has(id)),
    used: Object.fromEntries(
      Object.entries(classState.used).filter(([id]) => !removedIds.has(id)),
    ),
    choices,
  };

  // A Expertise daquele nível sai junto das escolhas revertidas: as perícias
  // voltam ao bônus normal (as ferramentas não vivem em `skills`).
  Object.assign(
    skills,
    expertiseSkillsState(
      nextEntries.flatMap((item) => expertiseFeaturesOf(item.classKey, item.subclass)),
      choices,
      skills,
    ),
  );

  const nextHpMax = Math.max(1, target.hpMax - hpLost);

  const data: Record<string, unknown> = {
    classes: nextEntries,
    // O registro do nível perdido sai do histórico (o próximo downgrade já
    // enxerga o nível anterior).
    levelHistory: record ? history.filter((_, at) => at !== recordIndex) : history,
    hpMax: nextHpMax,
    hpCurrent: Math.min(nextHpMax, Math.max(0, target.hpCurrent - hpLost)),
    saves,
    skills,
    proficiencies,
    classState: nextClassState,
    ...abilityData,
    version: { increment: 1 },
  };
  if (removedFeats.length > 0) data.features = keptFeatures;

  // `version` no WHERE: dois cliques seguidos não tiram dois níveis.
  const result = await prisma.character.updateMany({
    where: { id: characterId, version: target.version },
    data: { ...(data as Prisma.CharacterUpdateManyMutationInput) },
  });

  if (result.count === 0) {
    throw new HttpError(
      'A ficha mudou enquanto o nível era reduzido — recarregue e tente de novo.',
      409,
    );
  }

  const updated = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });

  const levelDown: LevelDownSummary = {
    classKey: entry.classKey,
    className,
    previousClassLevel: entry.level,
    classLevel: classRemoved ? 0 : entry.level - 1,
    totalLevel: totalCharacterLevel(nextEntries),
    classRemoved,
    hpLost,
    reverted: {
      abilities: revertedAbilities,
      feats: removedFeats,
      choices: revertedChoices,
      subclass: revertedSubclass,
      skills: revertedSkills,
      proficiencies: {
        armor: dropped(currentProficiencies.armor, proficiencies.armor),
        weapons: dropped(currentProficiencies.weapons, proficiencies.weapons),
        tools: dropped(currentProficiencies.tools, proficiencies.tools),
      },
    },
    warnings,
  };

  await publishChange(
    { userId: target.userId, username: target.user.username },
    updated,
    { levelDown },
    master.displayName,
  );

  return { character: await toSheetDto(updated, target.user.username), levelDown };
}

export function getCharacterByUserId(userId: string): Promise<Character | null> {
  return prisma.character.findUnique({ where: { userId } });
}

/**
 * Monta o DTO da ficha já com o inventário espelhando o catálogo do mestre
 * (nome, peso, descrição, sprite e atributos sempre como estão no catálogo).
 */
export async function toSheetDto(
  character: Character,
  ownerUsername?: string,
): Promise<CharacterDto> {
  const catalog = await loadCatalogLookup([character.inventory]);
  return toCharacterDto(character, ownerUsername, catalog);
}

/** Ficha do usuário autenticado, no formato entregue ao frontend. */
export async function getSheetByUserId(userId: string): Promise<CharacterDto | null> {
  const character = await getCharacterByUserId(userId);
  return character ? toSheetDto(character) : null;
}

/**
 * Move um item do inventário: equipa em um slot ou reposiciona na mochila.
 *
 * O destino padrão é a mochila (`slot` nulo). Se o destino já estiver ocupado,
 * o item que estava lá assume a posição antiga do item movido (troca), o que
 * mantém a regra de um item por slot. Nenhuma categoria é validada: qualquer
 * item pode ir a qualquer slot ou célula.
 */
export async function moveInventoryItem(
  actor: Actor,
  input: MoveInventoryItemInput,
): Promise<CharacterDto> {
  const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

  const inventory = parseJson<InventoryItemDto[]>(
    inventoryListSchema,
    character.inventory,
    [],
  );
  const item = inventory.find((entry) => entry.id === input.itemInventoryId);
  if (!item) throw new HttpError('Item não encontrado no inventário.', 404);

  const targetX = input.targetBackpackX ?? null;
  const targetY = input.targetBackpackY ?? null;
  // Slot definido e não nulo equipa; caso contrário, vai para a grade da mochila.
  const equipToSlot = input.targetSlot !== undefined && input.targetSlot !== null;

  // Item que já ocupa o destino (nunca o próprio item sendo movido).
  const occupant = equipToSlot
    ? inventory.find((entry) => entry.id !== item.id && entry.slot === input.targetSlot)
    : targetX !== null && targetY !== null
      ? inventory.find(
          (entry) =>
            entry.id !== item.id &&
            entry.slot === null &&
            entry.backpackX === targetX &&
            entry.backpackY === targetY,
        )
      : undefined;

  // Posição antiga do item movido; na troca, é para onde o ocupante vai.
  const previousSlot = item.slot;
  const previousX = item.backpackX;
  const previousY = item.backpackY;

  if (equipToSlot) {
    item.slot = input.targetSlot ?? null;
    item.backpackX = null;
    item.backpackY = null;
  } else {
    item.slot = null;
    item.backpackX = targetX;
    item.backpackY = targetY;
  }

  if (occupant) {
    occupant.slot = previousSlot;
    occupant.backpackX = previousX;
    occupant.backpackY = previousY;
  }

  const updated = await prisma.character.update({
    where: { userId: actor.userId },
    data: {
      inventory: inventory as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  await publishChange(actor, updated, { inventory });
  return toSheetDto(updated, actor.username);
}

// ---------------------------------------------------------------------------
// Uso de item consumível
// ---------------------------------------------------------------------------

/** Tentativas de reescrita quando duas requisições disputam o inventário. */
const INVENTORY_WRITE_ATTEMPTS = 6;

/**
 * Usa (consome) UMA unidade de um item do inventário do próprio jogador.
 *
 * Só vale para Poção e para itens marcados com `details.consumable`; outros
 * itens são recusados (400). A unidade é descontada com a escrita condicionada
 * à `version` (duas requisições simultâneas não consomem a mesma unidade) e a
 * entrada SAI do inventário quando a quantidade chega a zero.
 *
 * Poção de Cura com `healingDice` (cura estruturada) aplica a cura na ficha:
 * o HP novo entra na MESMA escrita que desconta a unidade. As demais poções (e
 * as de cura sem `healingDice`, caso legado) só rolam `effectRoll` e voltam na
 * resposta — nenhum efeito automático.
 */
export async function useInventoryItem(
  actor: Actor,
  input: UseInventoryItemInput,
): Promise<{ character: CharacterDto; roll: DiceRollDto | null }> {
  for (let attempt = 0; attempt < INVENTORY_WRITE_ATTEMPTS; attempt += 1) {
    const character = await prisma.character.findUnique({ where: { userId: actor.userId } });
    if (!character) throw new HttpError('Esta ficha ainda não foi criada.', 404);

    const inventory = parseJson<InventoryItemDto[]>(
      inventoryListSchema,
      character.inventory,
      [],
    );

    // Os atributos EXIBIDOS na ficha vêm do catálogo (espelho no DTO). O uso
    // lê da mesma fonte para que uma correção do mestre (ex.: a cura) valha na
    // hora, sem precisar reenviar o item.
    const catalog = await loadCatalogLookup([inventory]);
    const item = syncInventory(inventory, catalog).find(
      (entry) => entry.id === input.itemInventoryId,
    );
    if (!item) throw new HttpError('Item não encontrado no inventário.', 404);

    if (!isConsumableItem(item.category, item.details)) {
      throw new HttpError(`O item ${item.name} não é consumível.`, 400);
    }
    if (item.quantity <= 0) {
      throw new HttpError(`Não há mais unidades de ${item.name}.`, 400);
    }

    // Poção de Cura com `healingDice`: rola a cura agora (dado justo) para que
    // o total entre na MESMA escrita que desconta a unidade.
    const healing =
      item.category === 'Poção' &&
      item.details.potionCategory === 'healing' &&
      item.details.healingDice
        ? rollHealingDice(item.details.healingDice)
        : null;

    // TODO (Fase 5 — motor de ações): consumir 1 Ação do turno ao usar poção de
    // cura durante o combate; bloquear se a Ação já foi gasta naquele turno.
    const nextHp =
      healing === null ? null : Math.min(character.hpMax, character.hpCurrent + healing.total);

    // A entrada some quando a última unidade é usada.
    const next = inventory
      .map((entry) => (entry.id === item.id ? { ...entry, quantity: entry.quantity - 1 } : entry))
      .filter((entry) => entry.quantity > 0);

    const written = await prisma.character.updateMany({
      where: { id: character.id, version: character.version },
      data: {
        inventory: next as unknown as Prisma.InputJsonValue,
        ...(nextHp === null ? {} : { hpCurrent: nextHp }),
        version: { increment: 1 },
      },
    });
    if (written.count === 0) continue;

    const updated = await prisma.character.findUnique({ where: { id: character.id } });
    if (!updated) throw new HttpError('Esta ficha ainda não foi criada.', 404);

    const actorName = updated.name || actor.displayName;
    const roll =
      healing !== null
        ? recordHealingRoll(actor, actorName, item.name, healing)
        : item.details.effectRoll
          ? rollItemEffect(actor, actorName, item.name, item.details.effectRoll)
          : null;

    await publishChange(actor, updated, {
      inventory: next,
      ...(nextHp === null ? {} : { hpCurrent: nextHp }),
    });
    return { character: await toSheetDto(updated, actor.username), roll };
  }

  throw new HttpError('O inventário mudou durante a operação; tente novamente.', 409);
}

// ---------------------------------------------------------------------------
// Moedas
// ---------------------------------------------------------------------------

/** Tentativas de reescrita quando duas requisições disputam o mesmo saldo. */
const COIN_WRITE_ATTEMPTS = 6;

/** A escrita conflitou com outra requisição (`version` mudou) — tentar de novo. */
class CoinConflictError extends Error {}

/**
 * Grava a carteira nova CONDICIONADA à `version` lida. Sem isso, duas
 * requisições simultâneas poderiam gastar o mesmo saldo duas vezes: a segunda
 * a chegar não acha mais a versão e não escreve.
 */
async function writeCoins(
  client: Prisma.TransactionClient | typeof prisma,
  id: string,
  version: number,
  coins: CoinPurse,
): Promise<boolean> {
  const result = await client.character.updateMany({
    where: { id, version },
    data: { coins: coins as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  return result.count > 0;
}

/**
 * Aplica uma mudança na carteira de UMA ficha de forma segura contra duas
 * requisições simultâneas: se a `version` mudou entre a leitura e a escrita, a
 * operação é refeita sobre o saldo novo (mesmo cuidado do Level Up).
 */
async function mutateCoins(
  where: Prisma.CharacterWhereUniqueInput,
  notFound: string,
  mutate: (character: Character, coins: CoinPurse) => CoinPurse,
): Promise<{ character: Character; owner: SheetOwner }> {
  const include = { user: { select: { username: true } } } as const;

  for (let attempt = 0; attempt < COIN_WRITE_ATTEMPTS; attempt += 1) {
    const current = await prisma.character.findUnique({ where, include });
    if (!current) throw new HttpError(notFound, 404);

    const coins = mutate(current, normalizeCoins(current.coins));
    if (!(await writeCoins(prisma, current.id, current.version, coins))) continue;

    const updated = await prisma.character.findUnique({ where: { id: current.id }, include });
    if (!updated) throw new HttpError(notFound, 404);
    return {
      character: updated,
      owner: { userId: updated.userId, username: updated.user.username },
    };
  }

  throw new HttpError('O saldo mudou durante a operação; tente novamente.', 409);
}

/** Saldo insuficiente: 400 dizendo o que falta, denominação por denominação. */
function assertSufficient(purse: CoinPurse, amount: CoinPurse): void {
  const missing = COIN_KEYS.filter((key) => purse[key] < amount[key]);
  if (missing.length === 0) return;

  const detail = missing.map((key) => `${amount[key] - purse[key]} ${COIN_LABELS[key]}`).join(', ');
  throw new HttpError(`Saldo insuficiente: faltam ${detail}.`, 400);
}

/**
 * O mestre dá ou retira moedas de uma ficha (`POST /api/characters/:id/coins`).
 *
 * Deltas positivos dão e negativos retiram; retirar mais do que existe é 400.
 */
export async function giveCoins(
  characterId: string,
  master: Actor,
  delta: CoinDelta,
): Promise<CharacterDto> {
  const amount = fillCoins(delta);

  const { character, owner } = await mutateCoins({ id: characterId }, 'Ficha não encontrada.', (_character, coins) => {
    const next = addDelta(coins, amount);
    const negative = COIN_KEYS.filter((key) => next[key] < 0);
    if (negative.length > 0) {
      const detail = negative.map((key) => COIN_LABELS[key]).join(', ');
      throw new HttpError(
        `Retirada maior que o saldo em ${detail} (atual: ${formatCoins(coins)}).`,
        400,
      );
    }
    return next;
  });

  await publishChange(owner, character, { coins: normalizeCoins(character.coins) }, master.displayName);
  return toSheetDto(character, owner.username);
}

/** O jogador gasta exatamente as moedas informadas (sem troco automático). */
export async function spendCoins(actor: Actor, amount: CoinAmount): Promise<CharacterDto> {
  const paid = fillCoins(amount);

  const { character, owner } = await mutateCoins(
    { userId: actor.userId },
    'Esta ficha ainda não foi criada.',
    (_character, coins) => {
      assertSufficient(coins, paid);
      return subtractCoins(coins, paid);
    },
  );

  await publishChange(owner, character, { coins: normalizeCoins(character.coins) });
  return toSheetDto(character, owner.username);
}

/**
 * Troca entre denominações pelas conversões do PHB, preservando o valor total.
 * Trocas que exigiriam fração (ex.: 1 cp para gp) são recusadas.
 */
export async function exchangeCoins(
  actor: Actor,
  input: ExchangeCoinsInput,
): Promise<CharacterDto> {
  const { from, to, amount } = input;

  if (from === to) {
    throw new HttpError('A troca precisa ser entre denominações diferentes.', 400);
  }
  if (!exchangeIsExact(amount, from, to)) {
    throw new HttpError(
      `Essa troca não é exata: ${amount} ${COIN_LABELS[from]} não vira um número inteiro de ` +
        `${COIN_LABELS[to]}.`,
      400,
    );
  }

  const received = exchangeResult(amount, from, to);

  const { character, owner } = await mutateCoins(
    { userId: actor.userId },
    'Esta ficha ainda não foi criada.',
    (_character, coins) => {
      if (coins[from] < amount) {
        throw new HttpError(
          `Saldo insuficiente: você tem ${coins[from]} ${COIN_LABELS[from]}.`,
          400,
        );
      }

      const next: CoinPurse = { ...coins };
      next[from] = next[from] - amount;
      next[to] = next[to] + received;
      return next;
    },
  );

  await publishChange(owner, character, { coins: normalizeCoins(character.coins) });
  return toSheetDto(character, owner.username);
}

/**
 * Transfere moedas para OUTRO personagem de jogador (nunca para si mesmo e
 * nunca para o mestre). As duas fichas mudam na MESMA transação e as duas
 * recebem `sheet:updated`.
 */
export async function transferCoins(
  actor: Actor,
  targetCharacterId: string,
  amount: CoinAmount,
): Promise<CharacterDto> {
  const paid = fillCoins(amount);

  const source = await prisma.character.findUnique({ where: { userId: actor.userId } });
  if (!source) throw new HttpError('Esta ficha ainda não foi criada.', 404);
  if (source.id === targetCharacterId) {
    throw new HttpError('Você não pode transferir moedas para si mesmo.', 400);
  }

  const target = await prisma.character.findUnique({
    where: { id: targetCharacterId },
    include: { user: { select: { role: true } } },
  });
  if (!target) throw new HttpError('Personagem de destino não encontrado.', 404);
  if (target.user.role === 'MASTER') {
    throw new HttpError('Não é possível transferir moedas para o mestre.', 400);
  }

  let transferred = false;
  for (let attempt = 0; attempt < COIN_WRITE_ATTEMPTS && !transferred; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const from = await tx.character.findUnique({ where: { id: source.id } });
        const to = await tx.character.findUnique({ where: { id: target.id } });
        if (!from || !to) throw new HttpError('Personagem de destino não encontrado.', 404);

        const current = normalizeCoins(from.coins);
        assertSufficient(current, paid);

        if (!(await writeCoins(tx, from.id, from.version, subtractCoins(current, paid)))) {
          throw new CoinConflictError();
        }
        if (!(await writeCoins(tx, to.id, to.version, addDelta(normalizeCoins(to.coins), paid)))) {
          throw new CoinConflictError();
        }
      });
      transferred = true;
    } catch (error) {
      if (error instanceof CoinConflictError) continue;
      throw error;
    }
  }

  if (!transferred) {
    throw new HttpError('O saldo mudou durante a operação; tente novamente.', 409);
  }

  const include = { user: { select: { username: true } } } as const;
  const updatedSource = await prisma.character.findUnique({ where: { id: source.id }, include });
  const updatedTarget = await prisma.character.findUnique({ where: { id: target.id }, include });
  if (!updatedSource || !updatedTarget) {
    throw new HttpError('Personagem de destino não encontrado.', 404);
  }

  await publishChange(
    { userId: updatedSource.userId, username: updatedSource.user.username },
    updatedSource,
    { coins: normalizeCoins(updatedSource.coins) },
  );
  await publishChange(
    { userId: updatedTarget.userId, username: updatedTarget.user.username },
    updatedTarget,
    { coins: normalizeCoins(updatedTarget.coins) },
  );

  return toSheetDto(updatedSource, updatedSource.user.username);
}

/**
 * Personagens de OUTROS jogadores — os destinos possíveis de uma transferência
 * (o próprio personagem e as fichas do mestre ficam de fora).
 */
export async function listTransferTargets(
  actor: Actor,
): Promise<{ id: string; name: string; ownerUsername: string }[]> {
  const characters = await prisma.character.findMany({
    where: { userId: { not: actor.userId }, user: { role: 'PLAYER' } },
    include: { user: { select: { username: true } } },
    orderBy: { name: 'asc' },
  });

  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    ownerUsername: character.user.username,
  }));
}

/**
 * Republica as fichas que têm um item do catálogo no inventário.
 *
 * É o que faz o jogador ver na hora a correção feita pelo mestre na aba de
 * itens: o inventário espelha o catálogo, então basta reenviar a ficha.
 */
export async function republishSheetsWithCatalogItem(itemId: string): Promise<void> {
  const characters = await prisma.character.findMany({
    include: { user: { select: { username: true } } },
  });

  const affected = characters.filter((character) =>
    catalogItemIds([character.inventory]).includes(itemId),
  );

  for (const character of affected) {
    await publishChange(
      { userId: character.userId, username: character.user.username },
      character,
      { itemSynced: itemId },
    );
  }
}

/**
 * Espaços de magia de uma ficha já finalizada: o jogador só gasta e recupera
 * usos. A lista de magias conhecidas e o TOTAL de cada nível vêm da classe e
 * do Level Up, então continuam como estavam.
 */
function mergeSpellUsage(storedRaw: unknown, incoming: SpellsStateInput): Prisma.InputJsonValue {
  const stored = parseJson<SpellsStateInput>(spellsStateSchema, storedRaw, { list: [], slots: {} });
  const slots: SpellsStateInput['slots'] = {};

  for (const [level, slot] of Object.entries(stored.slots)) {
    const used = incoming.slots[level]?.used ?? slot.used;
    slots[level] = { max: slot.max, used: Math.max(0, Math.min(used, slot.max)) };
  }

  return { list: stored.list, slots } as unknown as Prisma.InputJsonValue;
}

/**
 * Travas do jogador (não valem para o mestre).
 *
 * - A CA manual é privilégio do mestre em qualquer momento — a CA do jogador é
 *   sempre a calculada.
 * - Com a criação finalizada, só o estado de jogo continua editável.
 */
function assertPlayerCanPatch(character: Character, patch: UpdateCharacterInput): void {
  // As moedas NUNCA entram pelo PATCH do jogador — nem antes de finalizar a
  // criação. Elas só mudam pelas mãos do mestre (PATCH ou /coins) e pelas
  // ações de gastar, trocar e transferir.
  if (patch.coins !== undefined) {
    throw new HttpError(
      `O campo ${CREATION_FIELD_LABELS.coins} é controlado pelo mestre: use as ações de gastar, ` +
        'trocar e transferir para movimentar as suas moedas.',
      403,
    );
  }

  if (patch.armorClassOverride !== undefined) {
    throw new HttpError(
      'A Classe de Armadura é calculada automaticamente; só o mestre pode definir um valor manual.',
      403,
    );
  }

  // O INVENTÁRIO do jogador nunca entra pelo PATCH — em fase NENHUMA (nem
  // durante a criação). Ele só muda por: movimentar/equipar
  // (`POST /me/inventory/move`, que nunca toca a quantidade), usar um item
  // consumível (`POST /me/inventory/use`) e itens que o mestre envia.
  if (patch.inventory !== undefined) {
    throw new HttpError(
      `O ${CREATION_FIELD_LABELS.inventory} só muda pelo mestre: use os itens que ele envia, ` +
        'mova/equipe pelo inventário e consuma os itens usáveis.',
      403,
    );
  }

  if (!character.creationFinalized) return;

  // As ESCOLHAS de característica são construção (só o Level Up e o mestre as
  // mudam): o jogador continua podendo ligar toggles e gastar/recuperar usos.
  if (patch.classState !== undefined) {
    const stored = normalizeClassState(character.classState);
    const incoming = normalizeClassState(patch.classState);
    // A comparação ignora a ORDEM das características (o JSONB do Postgres
    // reordena as chaves e o cliente devolve a mesma lista, em outra ordem).
    if (!sameFeatureChoices(incoming.choices, stored.choices)) {
      throw new HttpError(
        'A criação deste personagem foi finalizada: as escolhas de característica ' +
          '(Estilo de Luta, Inimigo Favorito...) só mudam no Level Up ou pelo mestre.',
        403,
      );
    }
  }

  const blocked = Object.keys(patch).filter(
    (key) => !(PLAYER_STATE_KEYS as readonly string[]).includes(key),
  );
  if (blocked.length === 0) return;

  const names = blocked.map((key) => CREATION_FIELD_LABELS[key] ?? key).join(', ');
  throw new HttpError(
    `A criação deste personagem foi finalizada: só o Level Up e o mestre podem alterar ${names}. ` +
      'Você continua podendo mexer no PV atual, no PV temporário, nos usos de recursos e espaços de magia, nas anotações, no avatar e na movimentação de itens.',
    403,
  );
}

/**
 * Núcleo da edição: valida o patch contra a classe, grava e publica.
 * Serve tanto ao dono da ficha quanto ao mestre que a está editando.
 */
async function applyCharacterPatch(
  owner: SheetOwner,
  patch: UpdateCharacterInput,
  options: {
    editedBy?: string;
    fromPlayer?: boolean;
    /** Chamado pelo assistente de criação (permite trocar a classe inicial). */
    fromWizard?: boolean;
    /**
     * Pula o pré-requisito de atributo da classe inicial. Só o assistente usa:
     * lá a classe é escolhida ANTES dos atributos e o passo dos atributos é
     * quem confere o pré-requisito.
     */
    skipClassPrerequisite?: boolean;
    /** Rascunho do assistente, gravado na mesma escrita (ver shared/creation.ts). */
    creationDraft?: Prisma.InputJsonValue;
  } = {},
): Promise<CharacterDto> {
  const {
    editedBy,
    fromPlayer = false,
    fromWizard = false,
    skipClassPrerequisite = false,
    creationDraft,
  } = options;
  const existing = await prisma.character.findUnique({ where: { userId: owner.userId } });
  if (!existing) {
    throw new HttpError('Esta ficha ainda não foi criada.', 404);
  }

  if (fromPlayer) assertPlayerCanPatch(existing, patch);

  const data: Record<string, unknown> = { version: { increment: 1 } };

  // O rascunho do assistente de criação vai na mesma escrita da ficha.
  if (creationDraft !== undefined) data.creationDraft = creationDraft;

  for (const key of SCALAR_KEYS) {
    const value = patch[key];
    if (value !== undefined) data[key] = value;
  }

  // Escolhas da raça (`{ [id da escolha]: id da opção }`): JSONB — copiado à
  // parte porque o SCALAR_KEYS só cobre colunas simples/arrays.
  if (patch.raceChoices !== undefined) {
    data.raceChoices = patch.raceChoices as Prisma.InputJsonValue;
  }

  // --- Nível e classes -----------------------------------------------------
  // O nível do personagem é a soma dos níveis das classes: quem sobe é o
  // fluxo de Level Up (liberado pelo mestre), nunca o PATCH da ficha.
  if (patch.level !== undefined) {
    throw new HttpError('O nível do personagem só muda pelo Level Up.', 400);
  }

  const currentClasses = normalizeClassEntries(existing.classes);
  const nextClasses = resolveClassPatch(
    currentClasses,
    patch.classes,
    abilitiesOf(existing),
    { allowReplace: fromWizard, skipPrerequisite: fromWizard && skipClassPrerequisite },
  );
  const classes = nextClasses ?? currentClasses;
  const classesChanged = nextClasses !== null;

  if (classesChanged) {
    data.classes = classes as unknown as Prisma.InputJsonValue;
    // Sem classe, nada de estado de classe pendurado.
    if (classes.length === 0) data.classState = { active: [], used: {}, choices: {} };

    // Primeira classe escolhida (ou troca dela pelo assistente, ainda no nível
    // 1): define o PV inicial pelo dado de vida máximo + modificador de
    // Constituição, salvo se o patch já mandou PV explícito.
    const rebuildFirstLevelHp =
      classes.length > 0 &&
      (currentClasses.length === 0 ||
        (fromWizard && totalCharacterLevel(classes) === 1));

    if (rebuildFirstLevelHp && patch.hpMax === undefined) {
      const chosen = getClassDefinition(classes[0].classKey);
      if (chosen) {
        const constitution = patch.constitution ?? existing.constitution;
        const hpMax = firstLevelHpMax(chosen.hitDie, constitution);
        data.hpMax = hpMax;
        if (patch.hpCurrent === undefined) data.hpCurrent = hpMax;
      }
    }

    // A PRIMEIRA classe define as proficiências iniciais (armaduras, armas e
    // ferramentas). Um valor mandado no mesmo patch tem prioridade.
    if (rebuildFirstLevelHp && patch.proficiencies === undefined) {
      const chosen = getClassDefinition(classes[0].classKey);
      if (chosen) data.proficiencies = firstClassProficiencies(chosen.key);
    }

    // Trocou a classe inicial pelo assistente? As escolhas da classe antiga
    // (Estilo de Luta do Guerreiro) não valem para a nova — só ficam as que
    // ainda existem na classe escolhida. Escolhas enviadas no mesmo patch já
    // passaram pelo assistente e têm prioridade.
    if (fromWizard && rebuildFirstLevelHp && patch.classState === undefined) {
      const chosen = getClassDefinition(classes[0].classKey);
      const stored = normalizeClassState(existing.classState);
      const valid = new Set((chosen?.features ?? []).map((feature) => feature.id));
      const kept: Record<string, string[]> = {};
      for (const [id, keys] of Object.entries(stored.choices)) {
        if (valid.has(id)) kept[id] = keys;
      }
      data.classState = { ...stored, choices: kept };
    }
  }

  // --- Recálculo retroativo de Constituição --------------------------------
  // Mudar o modificador de CON (na ficha ou pelo Level Up) recalcula o PV como
  // se o novo valor valesse desde o nível 1. O delta cobre os níveis já
  // obtidos e entra no máximo e no atual; ao diminuir, o atual nunca fica
  // negativo — cai junto com o máximo.
  const nextConstitution = patch.constitution ?? existing.constitution;
  const conDelta = constitutionHpDelta(
    existing.constitution,
    nextConstitution,
    totalCharacterLevel(currentClasses),
  );

  if (conDelta !== 0) {
    const baseHpMax = (data.hpMax as number | undefined) ?? existing.hpMax;
    const baseHpCurrent = (data.hpCurrent as number | undefined) ?? existing.hpCurrent;
    data.hpMax = Math.max(0, baseHpMax + conDelta);
    data.hpCurrent = Math.max(0, baseHpCurrent + conDelta);
  }

  // --- Robustez racial (+PV por nível) -------------------------------------
  // Trocar a raça/sub-raça (ex.: virar Anão da Colina) liga ou desliga o bônus
  // de PV por nível TOTAL do personagem. O delta APLICA (+1×nível) ou REVERTE
  // (−1×nível) no máximo e no atual, como o recálculo retroativo de CON.
  const nextRaceId = patch.raceId !== undefined ? patch.raceId : existing.raceId;
  const nextSubraceId = patch.subraceId !== undefined ? patch.subraceId : existing.subraceId;
  const raceHpDelta = raceHpBonusDelta(
    { raceId: existing.raceId, subraceId: existing.subraceId },
    { raceId: nextRaceId, subraceId: nextSubraceId },
    totalCharacterLevel(classes),
  );

  if (raceHpDelta !== 0) {
    const baseHpMax = (data.hpMax as number | undefined) ?? existing.hpMax;
    const baseHpCurrent = (data.hpCurrent as number | undefined) ?? existing.hpCurrent;
    data.hpMax = Math.max(0, baseHpMax + raceHpDelta);
    data.hpCurrent = Math.max(0, baseHpCurrent + raceHpDelta);
  }

  // --- Salvaguardas fixas das classes --------------------------------------
  const currentSaves = normalizeSaves(existing.saves);
  const lockedSaves = lockedSavesOf(classes);
  const lockedSavesMissing = lockedSaves.some((ability) => !currentSaves[ability]);

  if (patch.saves !== undefined || classesChanged || lockedSavesMissing) {
    const base = normalizeSaves(patch.saves ?? existing.saves);
    data.saves = applySaveProficiencies(base, lockedSaves);
  }

  if (patch.skills !== undefined) {
    const nextSkills = normalizeSkills(patch.skills);
    const storedSkills = normalizeSkills(existing.skills);
    // Perícias em Expertise: o que está gravado na ficha E o que as escolhas de
    // classe concedem. A proficiência delas é pré-requisito da Expertise, então
    // não pode ser desmarcada enquanto a perícia estiver dobrando o bônus.
    const expertised = new Set(
      Object.entries(storedSkills)
        .filter(([, entry]) => entry.expertise)
        .map(([key]) => key),
    );
    for (const feature of classes.flatMap((item) =>
      expertiseFeaturesOf(item.classKey, item.subclass),
    )) {
      for (const key of normalizeClassState(existing.classState).choices[feature.id] ?? []) {
        if (SKILL_KEYS.includes(key)) expertised.add(key);
      }
    }
    const unchecking = [...expertised].filter(
      (key) => nextSkills[key] !== undefined && !nextSkills[key].proficient,
    );
    if (unchecking.length > 0) {
      throw new HttpError(
        `${unchecking.map((key) => SKILL_LABELS[key] ?? key).join(', ')} está em Expertise: remova a Expertise antes de tirar a proficiência.`,
        400,
      );
    }
    data.skills = nextSkills;
  }
  // Proficiências de armadura/arma/ferramenta: construção — com a criação
  // finalizada só o mestre edita (ver PLAYER_STATE_KEYS acima).
  if (patch.proficiencies !== undefined) {
    data.proficiencies = normalizeProficiencies(patch.proficiencies) as ProficienciesState;
  }
  // Proficiências simples em ferramenta (ids do catálogo): só o mestre grava, e
  // o valor enviado substitui o anterior por inteiro. Sem repetição.
  if (patch.toolProficiencies !== undefined) {
    data.toolProficiencies = [...new Set(patch.toolProficiencies)];
  }
  if (patch.inventory !== undefined) data.inventory = patch.inventory;
  // Moedas: só o MESTRE chega aqui (o jogador é barrado em assertPlayerCanPatch).
  if (patch.coins !== undefined) {
    data.coins = normalizeCoins(patch.coins) as unknown as Prisma.InputJsonValue;
  }
  if (patch.spells !== undefined) {
    data.spells =
      fromPlayer && existing.creationFinalized
        ? mergeSpellUsage(existing.spells, patch.spells)
        : patch.spells;
  }

  // A CA manual é o override do mestre (`null` limpa e volta ao automático).
  if (patch.armorClassOverride !== undefined) {
    data.armorClass = patch.armorClassOverride ?? 0;
  }
  if (patch.attacks !== undefined) data.attacks = patch.attacks;
  if (patch.features !== undefined) data.features = patch.features;
  if (patch.classState !== undefined) {
    const nextClassState = normalizeClassState(patch.classState);
    data.classState = nextClassState;
    // As escolhas de Expertise mandam na ficha: ligar/desligar a perícia dobrada
    // não pode depender de um segundo campo.
    data.skills = expertiseSkillsState(
      classes.flatMap((item) => expertiseFeaturesOf(item.classKey, item.subclass)),
      nextClassState.choices,
      normalizeSkills(data.skills ?? existing.skills),
    );
  }

  const character = await prisma.character.update({
    where: { userId: owner.userId },
    data: data as Prisma.CharacterUpdateInput,
  });

  await publishChange(owner, character, patch as Record<string, unknown>, editedBy);
  return toSheetDto(character, owner.username);
}

/**
 * Aplica uma atualização parcial na ficha do próprio autor.
 * As coleções enviadas substituem integralmente o valor anterior.
 */
export function updateCharacter(actor: Actor, patch: UpdateCharacterInput): Promise<CharacterDto> {
  return applyCharacterPatch({ userId: actor.userId, username: actor.username }, patch, {
    fromPlayer: true,
  });
}

/**
 * Um passo do assistente de criação: grava os campos da ficha que aquele passo
 * resolve e o rascunho (`creationDraft`) na MESMA escrita.
 *
 * Vale como edição do próprio jogador (as travas dele continuam valendo) e
 * permite trocar a classe inicial enquanto a criação estiver aberta.
 */
export function updateDraftSheet(
  owner: SheetOwner,
  patch: UpdateCharacterInput,
  creationDraft: Prisma.InputJsonValue,
  options: { skipClassPrerequisite?: boolean } = {},
): Promise<CharacterDto> {
  return applyCharacterPatch(owner, patch, {
    fromPlayer: true,
    fromWizard: true,
    skipClassPrerequisite: options.skipClassPrerequisite,
    creationDraft,
  });
}

/**
 * Grava a flag de criação (finalizada/reaberta) do personagem de um jogador.
 *
 * Finalizar é o último passo do assistente (ver creation.service.ts, que antes
 * confere se não falta nada); reabrir é uma ação exclusiva do mestre, que devolve
 * o personagem ao assistente e o jogador reencontra o wizard no próximo acesso.
 * `extra` leva, na mesma escrita, o rascunho do assistente.
 */
export async function setCreationFinalized(
  owner: SheetOwner,
  actor: Actor,
  finalized: boolean,
  extra: Record<string, unknown> = {},
): Promise<CharacterDto> {
  const existing = await prisma.character.findUnique({ where: { userId: owner.userId } });
  if (!existing) {
    throw new HttpError('Esta ficha ainda não foi criada.', 404);
  }

  // Idempotente: chamar de novo devolve a ficha como está.
  if (existing.creationFinalized === finalized && Object.keys(extra).length === 0) {
    return toSheetDto(existing, owner.username);
  }

  const character = await prisma.character.update({
    where: { userId: owner.userId },
    data: { creationFinalized: finalized, ...extra, version: { increment: 1 } },
  });

  // Quem editou só vai marcado quando NÃO é o dono (o mestre reabrindo a
  // criação) — o jogador finalizando a própria ficha não recebe o aviso.
  await publishChange(
    owner,
    character,
    { creationFinalized: finalized, ...extra },
    actor.userId === owner.userId ? undefined : actor.displayName,
  );
  return toSheetDto(character, owner.username);
}

/**
 * O mestre edita a ficha de um jogador (PATCH /api/characters/:id).
 *
 * O dono continua sendo o jogador: o evento vai para as sessões dele e o DTO
 * segue assinado com o nome do dono, mas com `editedBy` marcando quem mexeu.
 * Só o mestre chega aqui — a rota exige o papel MASTER.
 */
export async function updateCharacterAsMaster(
  characterId: string,
  master: Actor,
  patch: UpdateCharacterInput,
): Promise<CharacterDto> {
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: { select: { username: true } } },
  });

  if (!target) {
    throw new HttpError('Ficha não encontrada.', 404);
  }

  // O mestre não tem travas: edita qualquer campo, em qualquer momento,
  // inclusive com a criação já finalizada (`armorClassOverride` inclusive).
  return applyCharacterPatch(
    { userId: target.userId, username: target.user.username },
    patch,
    { editedBy: master.displayName },
  );
}

/**
 * Quantas conexões do usuário excluído esperamos o aviso chegar antes de
 * derrubá-las (`disconnectUser`). Sem essa folga o evento pode se perder no
 * fechamento do socket.
 */
const DISCONNECT_GRACE_MS = 250;

/**
 * Exclui um personagem **e a conta do jogador** que o interpreta.
 *
 * Ação exclusiva do mestre e irreversível: apaga o usuário (a ficha sai em
 * cascata, pela relação `Character.userId`), tira o personagem de qualquer
 * combate — um combatente órfão continuaria aparecendo na ordem de iniciativa
 * —, apaga o avatar do disco e limpa o estado efêmero da sessão (faixa da
 * janela de dados e log de rolagens).
 *
 * O dono recebe o aviso em tempo real e é desconectado; dali em diante o token
 * dele não vale mais (`authenticate` confere se a conta ainda existe).
 */
export async function deleteCharacter(
  characterId: string,
  master: Actor,
): Promise<CharacterDeletedPayload> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      userId: true,
      user: { select: { username: true, role: true } },
    },
  });

  if (!character) {
    throw new HttpError('Ficha não encontrada.', 404);
  }

  // A conta do mestre é a chave da mesa: excluí-la por engano deixaria todo
  // mundo sem painel de controle (e não há como recriar a mesma conta).
  if (character.user.role === 'MASTER') {
    throw new HttpError(
      'A conta de um mestre não pode ser excluída por aqui — o mestre não tem ficha de jogador.',
      403,
    );
  }

  const { userId } = character;
  const { username } = character.user;
  const name = character.name;

  await prisma.$transaction(async (tx) => {
    // Fora do combate antes de sumir: o combatente guarda só identidade, mas
    // sem o personagem ele vira uma linha fantasma na ordem de turnos.
    await tx.combatant.deleteMany({
      where: { OR: [{ ownerUserId: userId }, { characterId }] },
    });

    // A ficha sai junto (onDelete: Cascade na relação User -> Character).
    await tx.user.delete({ where: { id: userId } });
  });

  if (character.avatarUrl) await deleteUploadedImage(character.avatarUrl);

  // Estado que só existe na memória do servidor e apontava para ele.
  clearActiveRollFrom(userId);
  forgetRollsFrom(userId);

  console.log(`[characters] "${name}" (${username}) excluído por ${master.displayName}`);

  const payload: CharacterDeletedPayload = { characterId, userId, name, username };

  try {
    const broadcaster = getBroadcaster();
    broadcaster.toMasters(ServerEvents.CHARACTER_DELETED, payload);
    // O dono precisa saber por que a tela dele vai voltar ao login.
    broadcaster.toUser(userId, ServerEvents.CHARACTER_DELETED, payload);

    const timer = setTimeout(() => {
      try {
        getBroadcaster().disconnectUser(userId);
      } catch (error) {
        console.error('[characters] falha ao derrubar a sessão do usuário excluído:', error);
      }
    }, DISCONNECT_GRACE_MS);

    // Não segura o processo vivo por causa do aviso.
    timer.unref?.();
  } catch (error) {
    console.error('[characters] falha ao publicar a exclusão em tempo real:', error);
  }

  return payload;
}

/** Lista todas as fichas da mesa (uso exclusivo do mestre). */
export async function listCharacters(): Promise<CharacterDto[]> {
  const characters = await prisma.character.findMany({
    include: { user: { select: { username: true } } },
    orderBy: { name: 'asc' },
  });

  // Uma única consulta ao catálogo para todas as fichas da mesa.
  const catalog: Map<string, CatalogSnapshot> = await loadCatalogLookup(
    characters.map((character) => character.inventory),
  );

  return characters.map((character) =>
    toCharacterDto(character, character.user.username, catalog),
  );
}
