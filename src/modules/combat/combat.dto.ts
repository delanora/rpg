import type { Character, CombatStatus, CombatantKind, Creature, Role } from '@prisma/client';
import { z } from 'zod';
import { characterArmorClass } from '../characters/armor-class.js';
import type { ArmorProficiencyState } from '../shared/armor-class.js';
import { characterDerivedAttacks } from '../characters/characters.dto.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { parseJson } from '../shared/json.js';

/** Formato do combate enviado a jogadores e mestre. */
export interface CombatDto {
  id: string;
  status: CombatStatus;
  round: number;
  currentIndex: number;
  /** Combatente do turno atual (apenas quando o combate está ativo). */
  currentCombatantId: string | null;
  /** Localidade onde o combate acontece (informada na preparação). */
  localityId: string | null;
  localityName: string | null;
  combatants: CombatantDto[];
  createdAt: string;
  endedAt: string | null;
}

export interface CombatantDto {
  id: string;
  kind: CombatantKind;
  /** Ids de origem, para o cliente localizar a ficha/criatura correspondente. */
  characterId: string | null;
  creatureId: string | null;
  name: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  /** Avatar do personagem ou ícone da criatura (null = sem imagem). */
  imageUrl: string | null;
  dexterityMod: number;
  initiative: number | null;
  initiativeRoll: number | null;
  /**
   * Lidos ao vivo da ficha/criatura — nunca duplicados no combatente.
   * Ficam `null` quando ocultos do jogador (vida/CA de criaturas).
   */
  hpCurrent: number | null;
  hpMax: number | null;
  armorClass: number | null;
  /**
   * Não proficiência ATIVA com a armadura/escudo equipados (personagem).
   * É a MESMA resolução da ficha (`characterArmorClass`); `null` em criaturas.
   * A penalidade mecânica será consumida na Fase 8.
   */
  armorNonProficiency: ArmorProficiencyState | null;
  /** Verdadeiro quando a vida/CA existem, mas estão ocultas para quem vê. */
  statsHidden: boolean;
  /** Verdadeiro quando a ficha/criatura de origem foi removida. */
  missing: boolean;
  rolled: boolean;
}

/**
 * Forma estrutural do combate carregado com suas relações.
 * Evita depender dos genéricos do Prisma em toda a aplicação.
 */
export interface CombatSourced {
  id: string;
  status: CombatStatus;
  round: number;
  currentIndex: number;
  createdAt: Date;
  endedAt: Date | null;
  locality: { id: string; name: string } | null;
  combatants: CombatantSourced[];
}

export interface CombatantSourced {
  id: string;
  kind: CombatantKind;
  characterId: string | null;
  creatureId: string | null;
  name: string;
  ownerUserId: string | null;
  dexterityMod: number;
  initiative: number | null;
  initiativeRoll: number | null;
  /** SNAPSHOT de vitais das criaturas (cada cópia tem a própria vida). */
  hpCurrent: number | null;
  hpMax: number | null;
  armorClass: number | null;
  character: (Character & { user: { username: string } }) | null;
  creature: Creature | null;
}

const attackListSchema = z.array(attackSchema);

/** Ordem dos turnos: iniciativa desc, desempate por Destreza e depois nome. */
export function orderCombatants(combatants: CombatantSourced[]): CombatantSourced[] {
  return [...combatants].sort((a, b) => {
    const initiativeA = a.initiative ?? Number.NEGATIVE_INFINITY;
    const initiativeB = b.initiative ?? Number.NEGATIVE_INFINITY;

    if (initiativeB !== initiativeA) return initiativeB - initiativeA;
    if (b.dexterityMod !== a.dexterityMod) return b.dexterityMod - a.dexterityMod;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Ataques do combatente, venham da ficha ou da criatura. Os personagens ainda
 * ganham os ataques DERIVADOS das armas equipadas (e o golpe desarmado), com os
 * mesmos ids que a ficha exibe — sem isso o ataque da arma não resolveria.
 */
export function combatantAttacks(combatant: CombatantSourced): CombatAttack[] {
  if (combatant.character) {
    return [
      ...parseJson<Attack[]>(attackListSchema, combatant.character.attacks, []),
      ...characterDerivedAttacks(combatant.character),
    ];
  }
  if (combatant.creature) {
    return parseJson<Attack[]>(attackListSchema, combatant.creature.attacks, []);
  }
  return [];
}

function toCombatantDto(combatant: CombatantSourced): CombatantDto {
  const source = combatant.character ?? combatant.creature;

  // Criaturas usam o snapshot do combatente (permite várias cópias iguais,
  // cada uma com a própria vida). Personagens leem ao vivo da ficha.
  const hpCurrent = combatant.hpCurrent ?? source?.hpCurrent ?? 0;
  const hpMax = combatant.hpMax ?? source?.hpMax ?? 0;
  // A CA de personagem é CALCULADA (atributos + equipamento), nunca lida de
  // uma coluna — a ficha só guarda o override manual do mestre. O MESMO detalhe
  // traz o estado de proficiência (armadura/escudo), para o combate enxergar o
  // que a ficha já mostra — sem uma segunda conta.
  const armorClassDetail =
    combatant.character !== null ? characterArmorClass(combatant.character) : null;
  const armorClass =
    armorClassDetail?.value ??
    combatant.armorClass ??
    combatant.creature?.armorClass ??
    0;

  return {
    id: combatant.id,
    kind: combatant.kind,
    characterId: combatant.characterId,
    creatureId: combatant.creatureId,
    name: combatant.name,
    ownerUserId: combatant.ownerUserId,
    ownerUsername: combatant.character?.user.username ?? null,
    imageUrl: combatant.character?.avatarUrl || combatant.creature?.imageUrl || null,
    dexterityMod: combatant.dexterityMod,
    initiative: combatant.initiative,
    initiativeRoll: combatant.initiativeRoll,
    hpCurrent,
    hpMax,
    armorClass,
    armorNonProficiency: armorClassDetail?.armorNonProficiency ?? null,
    statsHidden: false,
    missing: source === null,
    rolled: combatant.initiative !== null,
  };
}

/**
 * Monta o combate para quem está vendo. O mestre recebe tudo; o jogador não
 * enxerga a vida nem a CA das criaturas (as dos personagens continuam visíveis).
 */
export function toCombatDto(combat: CombatSourced, viewer: Role): CombatDto {
  // A ordem só faz sentido depois que todos rolaram; antes disso a lista fica
  // em ordem alfabética para a tela de espera não "pular".
  const ordered =
    combat.status === 'ACTIVE' ? orderCombatants(combat.combatants) : [...combat.combatants];

  const combatants = ordered.map(toCombatantDto);
  const current =
    combat.status === 'ACTIVE' ? (combatants[combat.currentIndex] ?? null) : null;

  const dto: CombatDto = {
    id: combat.id,
    status: combat.status,
    round: combat.round,
    currentIndex: combat.currentIndex,
    currentCombatantId: current?.id ?? null,
    localityId: combat.locality?.id ?? null,
    localityName: combat.locality?.name ?? null,
    combatants,
    createdAt: combat.createdAt.toISOString(),
    endedAt: combat.endedAt ? combat.endedAt.toISOString() : null,
  };

  return viewer === 'MASTER' ? dto : hideCreatureStats(dto);
}

/**
 * Esconde vida e CA das criaturas de um DTO já montado. Só as criaturas somem:
 * a vida dos personagens continua visível para a mesa.
 */
export function hideCreatureStats(dto: CombatDto): CombatDto {
  return {
    ...dto,
    combatants: dto.combatants.map((combatant) =>
      combatant.kind === 'CREATURE'
        ? { ...combatant, hpCurrent: null, hpMax: null, armorClass: null, statsHidden: true }
        : combatant,
    ),
  };
}
