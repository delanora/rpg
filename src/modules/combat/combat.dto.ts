import type { Character, CombatStatus, CombatantKind, Creature } from '@prisma/client';
import { z } from 'zod';
import { attackSchema, type Attack } from '../shared/attacks.js';
import { parseJson } from '../shared/json.js';

/** Formato do combate enviado a jogadores e mestre. */
export interface CombatDto {
  id: string;
  status: CombatStatus;
  round: number;
  currentIndex: number;
  /** Combatente do turno atual (apenas quando o combate está ativo). */
  currentCombatantId: string | null;
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
  dexterityMod: number;
  initiative: number | null;
  initiativeRoll: number | null;
  /** Lidos ao vivo da ficha/criatura — nunca duplicados no combatente. */
  hpCurrent: number;
  hpMax: number;
  armorClass: number;
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

/** Ataques do combatente, venham da ficha ou da criatura. */
export function combatantAttacks(combatant: CombatantSourced): Attack[] {
  if (combatant.character) {
    return parseJson<Attack[]>(attackListSchema, combatant.character.attacks, []);
  }
  if (combatant.creature) {
    return parseJson<Attack[]>(attackListSchema, combatant.creature.attacks, []);
  }
  return [];
}

function toCombatantDto(combatant: CombatantSourced): CombatantDto {
  const source = combatant.character ?? combatant.creature;

  return {
    id: combatant.id,
    kind: combatant.kind,
    characterId: combatant.characterId,
    creatureId: combatant.creatureId,
    name: combatant.name,
    ownerUserId: combatant.ownerUserId,
    ownerUsername: combatant.character?.user.username ?? null,
    dexterityMod: combatant.dexterityMod,
    initiative: combatant.initiative,
    initiativeRoll: combatant.initiativeRoll,
    hpCurrent: source?.hpCurrent ?? 0,
    hpMax: source?.hpMax ?? 0,
    armorClass: source?.armorClass ?? 0,
    missing: source === null,
    rolled: combatant.initiative !== null,
  };
}

export function toCombatDto(combat: CombatSourced): CombatDto {
  // A ordem só faz sentido depois que todos rolaram; antes disso a lista fica
  // em ordem alfabética para a tela de espera não "pular".
  const ordered =
    combat.status === 'ACTIVE' ? orderCombatants(combat.combatants) : [...combat.combatants];

  const combatants = ordered.map(toCombatantDto);
  const current =
    combat.status === 'ACTIVE' ? (combatants[combat.currentIndex] ?? null) : null;

  return {
    id: combat.id,
    status: combat.status,
    round: combat.round,
    currentIndex: combat.currentIndex,
    currentCombatantId: current?.id ?? null,
    combatants,
    createdAt: combat.createdAt.toISOString(),
    endedAt: combat.endedAt ? combat.endedAt.toISOString() : null,
  };
}
