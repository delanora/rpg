import { mechanicalStateOf, deriveConditionEffects, effectiveMaxHp, effectiveSpeed, reconcileMovement } from '../shared/conditions.js';
import {
  deathBlocksActions,
  deathStateOf,
  HP_ZERO_PRONE_LABEL,
  HP_ZERO_SOURCE,
  type DeathState,
} from '../shared/death.js';
import type { Character, CombatStatus, CombatantKind, Creature, Role } from '@prisma/client';
import { z } from 'zod';
import { economyOf, type TurnEconomy } from '../shared/action-economy.js';
import { characterArmorClass } from '../characters/armor-class.js';
import { npcAttacks, npcEffectiveArmorClass } from '../creatures/npc-sheet.js';
import type { ArmorProficiencyState } from '../shared/armor-class.js';
import { characterDerivedAttacks, characterMaxHp } from '../characters/characters.dto.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { parseJson } from '../shared/json.js';

/** Formato do combate enviado a jogadores e mestre. */
export interface CombatDto {
  version: number;
  /**
   * Eventos estruturais do combate. `private` marca o que só o Mestre pode ler
   * (ex.: override de Teste contra a Morte ou estabilização de criatura/NPC):
   * a linha continua existindo no banco e na visão do Mestre, mas o DTO do
   * jogador a descarta — privacidade no SERVIDOR, nunca só no CSS.
   */
  economyLog: { id: string; actorName: string; message: string; at: string; action?: string; private?: boolean }[];
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
  turnEconomy: TurnEconomy;
  mechanicalState: ReturnType<typeof mechanicalStateOf>;
  conditionEffects: ReturnType<typeof deriveConditionEffects>;
  mechanicalVersion: number;
  /**
   * Ciclo de MORTE da instância (Fase 6.3). Fica `null` para criaturas/NPCs
   * quando quem vê é um JOGADOR: os Testes contra a Morte de NPC são privados
   * do Mestre (resultado, contador e até a existência da rolagem).
   */
  deathState: DeathState | null;
  /** Verdadeiro quando o estado de morte impede Ação/Ação Bônus/Reação/Movimento. */
  deathBlocksActions: boolean;
  effectiveSpeed: number;
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
  version: number;
  economyLog: unknown;
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
  turnEconomy: unknown;
  mechanicalState: unknown;
  /** Ciclo de morte da INSTÂNCIA (criaturas); personagens usam o da ficha. */
  deathState: unknown;
  mechanicalVersion: number;
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
  /** Trava do Ataque Furtivo: "uma vez por turno" (zerada em `nextTurn`). */
  sneakAttackUsedThisTurn: boolean;
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
    // NPC: ataques PRÓPRIOS + armas equipadas no inventário persistente. O
    // template de criatura continua só com o statblock.
    return npcAttacks(combatant.creature);
  }
  return [];
}

export function combatantMechanicalState(combatant: CombatantSourced) {
  return combatant.character?.mechanicalState ?? combatant.mechanicalState;
}

/**
 * Ciclo de morte do combatente: personagens usam o estado da FICHA (canônico);
 * criaturas usam o estado PRÓPRIO da instância (Goblin 1 ≠ Goblin 2), nunca o
 * template do bestiário.
 */
export function combatantDeathState(combatant: CombatantSourced): DeathState {
  return combatant.character ? deathStateOf(combatant.character.deathState) : deathStateOf(combatant.deathState);
}

function toCombatantDto(combatant: CombatantSourced): CombatantDto {
  const source = combatant.character ?? combatant.creature;

  // Criaturas usam o snapshot do combatente (permite várias cópias iguais,
  // cada uma com a própria vida). Personagens leem ao vivo da ficha.
  const hpCurrent = combatant.hpCurrent ?? source?.hpCurrent ?? 0;
  // Personagens: o PV máximo é DERIVADO (gravado + `hpBonus` de features/talentos
  // — Resiliência Dracônica, Vigoroso). Criaturas: o snapshot do combatente.
  const hpMax =
    combatant.character ? characterMaxHp(combatant.character) : effectiveMaxHp(combatant.hpMax ?? source?.hpMax ?? 0, combatant.mechanicalState);
  // A CA de personagem é CALCULADA (atributos + equipamento), nunca lida de
  // uma coluna — a ficha só guarda o override manual do mestre. O MESMO detalhe
  // traz o estado de proficiência (armadura/escudo), para o combate enxergar o
  // que a ficha já mostra — sem uma segunda conta.
  const armorClassDetail =
    combatant.character !== null ? characterArmorClass(combatant.character) : null;
  const armorClass =
    armorClassDetail?.value ??
    // NPC: CA DERIVADA do equipamento (armadura/escudo/bônus), nunca a cópia
    // congelada do snapshot. Criatura-template: o snapshot, como antes.
    (combatant.creature?.kind === 'NPC'
      ? npcEffectiveArmorClass(combatant.creature)
      : (combatant.armorClass ?? combatant.creature?.armorClass ?? 0));

  const deathState = combatantDeathState(combatant);
  return {
    turnEconomy: reconcileMovement(economyOf(combatant.turnEconomy), source?.speed ?? 0, effectiveSpeed(source?.speed ?? 0, combatantMechanicalState(combatant))),
    mechanicalState: mechanicalStateOf(combatantMechanicalState(combatant)),
    deathState,
    deathBlocksActions: deathBlocksActions(deathState),
    conditionEffects: deriveConditionEffects(combatantMechanicalState(combatant)),
    mechanicalVersion: combatant.character?.version ?? combatant.mechanicalVersion,
    effectiveSpeed: effectiveSpeed(source?.speed ?? 0, combatantMechanicalState(combatant)),
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
    version: combat.version,
    economyLog: z
      .array(
        z.object({
          id: z.string(),
          actorName: z.string(),
          message: z.string(),
          at: z.string(),
          action: z.string().optional(),
          private: z.boolean().optional(),
        }),
      )
      .parse(combat.economyLog),
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

  return viewer === 'MASTER' ? dto : hideMasterPrivateState(dto);
}

/** Criaturas e NPCs são controlados pelo Mestre e têm estado de vida privado. */
export function isMasterOnlyCombatant(kind: CombatantKind): boolean {
  return kind !== 'CHARACTER';
}

/**
 * VISÃO DO JOGADOR — o servidor remove o que pertence ao Mestre.
 *
 * Para criaturas e NPCs (nunca para personagens de jogador):
 * • vida, CA e `deathState` somem (MORTO, INCONSCIENTE, ESTABILIZADO, Death
 *   Saves, decisão pendente) — a entrada PERMANECE na iniciativa, para não
 *   denunciar que a criatura saiu da cena;
 * • as Conditions que denunciam o lifecycle de 0 PV (Inconsciente e a Queda
 *   derivada dela) são filtradas e os EFEITOS são recalculados do estado
 *   filtrado — não adianta esconder a etiqueta e entregar `canAct: false`;
 * • entradas PRIVADAS do Registro (override/estabilização de NPC) somem.
 *
 * Condições normais (Envenenado, Caído por outra fonte, etc.) continuam
 * públicas: o foco é o lifecycle de 0 PV/morte.
 */
export function hideMasterPrivateState(dto: CombatDto): CombatDto {
  return {
    ...dto,
    economyLog: dto.economyLog.filter((entry) => entry.private !== true),
    combatants: dto.combatants.map((combatant) =>
      isMasterOnlyCombatant(combatant.kind)
        ? hideCombatantPrivateState(combatant)
        : combatant,
    ),
  };
}

function hideCombatantPrivateState(combatant: CombatantDto): CombatantDto {
  // A 0 PV o lifecycle aplica Inconsciente (fonte `hp-zero`) e a Queda
  // derivada. Acima de 0 PV nada é filtrado: Caído por um empurrão, por
  // exemplo, continua sendo informação pública.
  const atZeroHp = (combatant.hpCurrent ?? 0) <= 0;
  const state = combatant.mechanicalState;
  const conditions = atZeroHp
    ? state.conditions.filter(
        (instance) =>
          !(instance.condition === 'unconscious' && instance.sourceType === HP_ZERO_SOURCE) &&
          !(instance.condition === 'prone' && instance.sourceLabel === HP_ZERO_PRONE_LABEL),
      )
    : state.conditions;
  // CONCENTRAÇÃO de criatura/NPC: privada por padrão; quando o Mestre a marca
  // como pública, os jogadores veem a etiqueta e o nome do efeito. Os TESTES
  // pendentes são do Mestre (CD, dano, evento) — nunca vão para o jogador.
  const concentration =
    state.concentration && state.concentration.visibility === 'public' ? state.concentration : null;
  const privateState = {
    ...state,
    conditions,
    concentration,
    pendingConcentrationSaves: [],
  };

  return {
    ...combatant,
    hpCurrent: null,
    hpMax: null,
    armorClass: null,
    // Esquiva/Preparar de NPC/criatura são estado operacional do Mestre: o
    // jogador não recebe os flags (sem badge e sem inferir a tática secreta).
    turnEconomy: { ...combatant.turnEconomy, dodging: false, ready: null },
    // Death Saves de NPC/criatura são PRIVADOS do Mestre: o servidor não envia
    // contador, resultado nem a existência da rolagem.
    deathState: null,
    deathBlocksActions: false,
    statsHidden: true,
    mechanicalState: privateState,
    conditionEffects: deriveConditionEffects(privateState),
  };
}
