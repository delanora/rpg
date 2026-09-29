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
import { clearActiveRollFrom, forgetRollsFrom } from '../dice/dice.service.js';
import { getGameConfig } from '../game-config/game-config.service.js';
import { toCharacterDto, type CharacterDto, type InventoryItemDto } from './characters.dto.js';
import {
  catalogItemIds,
  loadCatalogLookup,
  type CatalogSnapshot,
} from './inventory-sync.js';
import { inventoryListSchema } from './characters.schema.js';
import type {
  CreateCharacterInput,
  LevelUpInput,
  MoveInventoryItemInput,
  UpdateCharacterInput,
} from './characters.schema.js';
import { parseJson } from '../shared/json.js';
import { spellsStateSchema, type SpellsStateInput } from './characters.schema.js';
import {
  applySaveProficiencies,
  averageHitDie,
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
  type ProficienciesState,
} from '../shared/classes.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import {
  LEVEL_MAX,
  SKILL_KEYS,
  SKILL_LABELS,
  abilityModifier,
  normalizeSaves,
  normalizeSkills,
} from '../shared/dnd5e.js';

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
  attacks: 'ataques',
  features: 'características',
  inventory: 'inventário',
};

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

    // A subclasse pode conceder proficiências (Colégio da Bravura: armaduras
    // médias, escudos e armas marciais): entram SOMADAS às da classe.
    const subclassGrant = subclassProficiencyGrant(definition, subclass);
    if (subclassGrant.armor.length + subclassGrant.weapons.length + subclassGrant.tools.length > 0) {
      data.proficiencies = mergeProficiencies(
        normalizeProficiencies(data.proficiencies ?? character.proficiencies),
        subclassGrant,
      );
    }
  }

  // --- Aumento de Atributo ou Talento (só nos níveis de ASI da classe) ------
  // --- Escolhas de característica liberadas por ESTE nível ------------------
  // Estilo de Luta do guerreiro (1º), do paladino e do patrulheiro (2º),
  // Inimigo Favorito e Explorador Nato do patrulheiro (1º e melhorias). O
  // serviço valida quantidade, opções e o nível em que cada escolha é feita.
  const classState = normalizeClassState(character.classState);
  const nextChoices = resolveFeatureChoices(
    definition,
    newClassLevel,
    input.choices,
    classState.choices,
    subclass,
  );
  if (!sameFeatureChoices(nextChoices, classState.choices)) {
    data.classState = { ...classState, choices: nextChoices };
  }

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
    data.proficiencies = mergeProficiencies(
      normalizeProficiencies(character.proficiencies),
      grant,
    );
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
  }

  if (isAsiLevel(definition.key, newClassLevel)) {
    if (input.feat) {
      features.push({
        id: `feat-${randomUUID()}`,
        name: input.feat.name,
        source: 'feat',
        description: input.feat.description,
      });
      data.features = features;
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

  const result = await tx.character.updateMany({
    where: {
      userId: actor.userId,
      // Condição de corrida: só grava se a liberação ainda não foi usada.
      lastLevelUpRelease: character.lastLevelUpRelease,
    },
    data: {
      ...(data as Prisma.CharacterUpdateManyMutationInput),
      classes: nextEntries as unknown as Prisma.InputJsonValue,
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
  if (patch.armorClassOverride !== undefined) {
    throw new HttpError(
      'A Classe de Armadura é calculada automaticamente; só o mestre pode definir um valor manual.',
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

  // --- Salvaguardas fixas das classes --------------------------------------
  const currentSaves = normalizeSaves(existing.saves);
  const lockedSaves = lockedSavesOf(classes);
  const lockedSavesMissing = lockedSaves.some((ability) => !currentSaves[ability]);

  if (patch.saves !== undefined || classesChanged || lockedSavesMissing) {
    const base = normalizeSaves(patch.saves ?? existing.saves);
    data.saves = applySaveProficiencies(base, lockedSaves);
  }

  if (patch.skills !== undefined) data.skills = normalizeSkills(patch.skills);
  // Proficiências de armadura/arma/ferramenta: construção — com a criação
  // finalizada só o mestre edita (ver PLAYER_STATE_KEYS acima).
  if (patch.proficiencies !== undefined) {
    data.proficiencies = normalizeProficiencies(patch.proficiencies) as ProficienciesState;
  }
  if (patch.inventory !== undefined) data.inventory = patch.inventory;
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
    data.classState = normalizeClassState(patch.classState);
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
