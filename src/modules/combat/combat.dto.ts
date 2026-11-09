import type { CombatDuelDto } from '../shared/duels.js';
import type { HostilityPromptDto } from '../shared/hostility.js';
import { creatureAbilitiesOf, creatureAbilityUsesOf, type CreatureAbility } from '../shared/creature-abilities.js';
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
import {
  effectArmorClassBonuses,
  emptyEffectModifierSet,
  type EffectModifierSet,
} from '../effects/effect-modifiers.js';
import { npcAttacks, npcEffectiveArmorClass } from '../creatures/npc-sheet.js';
import type { ArmorProficiencyState } from '../shared/armor-class.js';
import { characterDerivedAttacks, characterMaxHp } from '../characters/characters.dto.js';
import { attackSchema, type Attack, type CombatAttack } from '../shared/attacks.js';
import { parseJson } from '../shared/json.js';
import { occupiedSpaceOf, parseStoredPosition } from './spatial/occupied-space.js';
import { effectiveSizeOf } from './spatial/spatial-size.js';
import { spatialVisibilityOf, type SpatialVisibility } from './spatial/spatial-visibility.js';
import {
  effectiveSceneConfigOf,
  type OccupiedSpace,
  type SpatialPosition2D,
  type SpatialSceneConfig,
  type SpatialSize,
} from './spatial/spatial.types.js';
import {
  obstacleDtoOf,
  type SpatialObstacleDto,
  type SpatialObstacleSource,
} from './spatial/spatial-obstacle.js';

/**
 * Dados espaciais de UM combatente para o futuro Grid (6.6M.1).
 *
 * `tokenImageRef` reutiliza a imagem JÁ existente (retrato da ficha / imagem do
 * NPC/criatura); `null` significa "sem imagem" e a UI desenha o fallback `?`.
 * `occupiedSpace` é DERIVADO da posição + tamanho efetivo, nunca enviado pelo
 * cliente. `spatial` é `null` quando o combatente é privado do Mestre.
 */
export interface CombatantSpatialDto {
  tokenImageRef: string | null;
  baseSize: SpatialSize;
  effectiveSize: SpatialSize;
  position: SpatialPosition2D | null;
  occupiedSpace: OccupiedSpace | null;
}

/** Formato do combate enviado a jogadores e mestre. */
export interface CombatDto {
  duels?: CombatDuelDto[];
  hostilityPrompts?: HostilityPromptDto[];
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
  /**
   * CENA ESPACIAL usada pelo combate (6.6L.4.1.1). `null` em combates legados,
   * que continuam valendo pela configuração própria.
   */
  sceneId: string | null;
  sceneName: string | null;
  /**
   * IMAGEM DE FUNDO da cena usada neste combate (6.6M.4.1.1).
   *
   * É APRESENTAÇÃO e por isso fica FORA de `spatial`: nenhuma regra pode ler
   * pixels (distância, movimento, alcance, cobertura continuam em PÉS). `null`
   * em combate legado (sem cena) e em cena sem arte própria — nunca há fallback
   * para a galeria da localidade, porque a CENA é a dona do fundo espacial.
   */
  sceneBackgroundImageUrl: string | null;
  /**
   * CONFIGURAÇÃO ESPACIAL EFETIVA (Fase 6.6L.1 + 6.6L.4.1.1): vem de
   * `Scene.spatialConfig` quando o combate tem `sceneId`; combate legado (sem
   * cena) usa `Combat.spatialConfig`. Existe UMA fonte estrutural por combate.
   * Combates antigos sempre recebem `assisted` com a cena padrão — nada muda
   * para quem não usa grid.
   */
  spatial: SpatialSceneConfig;
  /**
   * PAREDES da cena (6.6L.4.1 / 6.6L.4.1.1), no MESMO read model (e no mesmo
   * `combat:updated`) — não existe endpoint paralelo de cena no combate.
   *
   * Vêm da CENA referenciada; combate legado (sem `sceneId`) entrega lista
   * VAZIA, exatamente como antes das cenas existirem.
   *
   * Fica FORA de `spatial` de propósito: `spatial` é a CONFIGURAÇÃO validada
   * por `spatialSceneConfigSchema` (`.strict()`), que recusa campos extras.
   * Misturar conteúdo de cena ali quebraria `spatialSceneOf(dto.spatial)`.
   * Nesta fase toda parede é normal/visível: nada a filtrar por papel.
   */
  obstacles: SpatialObstacleDto[];
  combatants: CombatantDto[];
  createdAt: string;
  endedAt: string | null;
}

export interface CombatantDto {
  hostileToIds?: string[];
  /** Sinal visual público; não expõe PV, morte ou contadores privados. */
  tokenDimmed?: boolean;
  tokenNumber?: number | null;
  turnEconomy: TurnEconomy;
  abilities?: CreatureAbility[];
  abilityUses?: Record<string, number>;
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
  /**
   * VISIBILIDADE ESPACIAL da INSTÂNCIA (6.6L.3.2) — política de PROJEÇÃO, não
   * de mecânica. `public`: token/imagem/posição/tamanho vão para o jogador (o
   * estado mecânico continua privado para criatura/NPC). `master-only`: a
   * presença espacial some do DTO do jogador.
   */
  spatialVisibility: SpatialVisibility;
  /**
   * Dados espaciais (posição/tamanho/imagem do token). `null` quando a
   * presença espacial é `master-only`: o servidor NÃO envia posição, tamanho,
   * imagem nem espaço ocupado a jogadores.
   */
  spatial: CombatantSpatialDto | null;
  /**
   * LADO do ENCONTRO (6.6L.3), definido pelo Mestre. `null` no DTO do jogador:
   * a UI não precisa dele hoje e o servidor não amplia superfície à toa.
   */
  sideKey: string | null;
  /** Relação visual com o grupo; não expõe a identidade interna dos times. */
  relation: 'allied' | 'hostile' | 'neutral' | 'unknown';
  /** Verdadeiro quando a ficha/criatura de origem foi removida. */
  missing: boolean;
  rolled: boolean;
}

/**
 * Forma estrutural do combate carregado com suas relações.
 * Evita depender dos genéricos do Prisma em toda a aplicação.
 */
export interface CombatSourced {
  duels?: { id: string; requesterId: string; challengedId: string; status: string }[];
  hostilityPrompts?: HostilityPromptDto[];
  version: number;
  economyLog: unknown;
  id: string;
  status: CombatStatus;
  round: number;
  currentIndex: number;
  createdAt: Date;
  endedAt: Date | null;
  locality: { id: string; name: string } | null;
  /** Config espacial LEGADA (JSONB); só vale para combate SEM `scene`. */
  spatialConfig?: unknown;
  /**
   * CENA da localidade (6.6L.4.1.1). Quando presente, `spatialConfig` e
   * `obstacles` DELA são a fonte estrutural autoritativa do combate.
   */
  scene?: {
    id: string;
    name: string;
    spatialConfig?: unknown;
    /** Arte da cena (opcional): só apresentação, projetada fora de `spatial`. */
    backgroundImageUrl?: string | null;
    obstacles?: SpatialObstacleSource[];
  } | null;
  combatants: CombatantSourced[];
}

export interface CombatantSourced {
  /** Derivado dos duelos ativos; nunca gravado em hostileToIds. */
  duelOpponentIds?: string[];
  hostileToIds?: string[];
  tokenImageUrl?: string | null;
  tokenNumber?: number | null;
  turnEconomy: unknown;
  abilityUses?: unknown;
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
  /**
   * Posição 2D em PÉS desta INSTÂNCIA (`null` = unplaced) e tamanho BASE
   * derivado da raça/cadastro por `withSpatial`. Nunca vêm do cliente.
   */
  spatialPosition?: unknown;
  baseSize?: SpatialSize;
  /** Lado do ENCONTRO (`null` = relação desconhecida, nunca inferida). */
  sideKey?: string | null;
  /**
   * Visibilidade ESPACIAL da instância (`public` | `master-only`). Ausente em
   * combates gravados antes da 6.6L.3.2 → `public` (nunca oculto por omissão).
   */
  spatialVisibility?: string | null;
  character: (Character & { user: { username: string } }) | null;
  creature: Creature | null;
  /**
   * EFEITOS ativos do combatente, já resolvidos em lote por `loadCombatById`
   * (Fase 6.5B). Ausente = sem efeitos (CA/deslocamento sem modificadores).
   */
  effectModifiers?: EffectModifierSet;
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
/** A mesma elegibilidade serve a previews e à resolução real da Reação. */
export function combatantCanReact(combatant: CombatantSourced): boolean {
  const hp = combatant.character?.hpCurrent ?? combatant.hpCurrent ?? combatant.creature?.hpCurrent ?? 0;
  return hp > 0 && !deathBlocksActions(combatantDeathState(combatant)) && deriveConditionEffects(combatantMechanicalState(combatant)).canReact;
}

export function combatantDeathState(combatant: CombatantSourced): DeathState {
  return combatant.character ? deathStateOf(combatant.character.deathState) : deathStateOf(combatant.deathState);
}

/** Mesma fonte de velocidade para DTO, ações, Disparada e movimento espacial. */
export function combatantEffectiveSpeed(combatant: CombatantSourced): number {
  return effectiveSpeed(
    combatant.character?.speed ?? combatant.creature?.speed ?? 0,
    combatantMechanicalState(combatant),
    combatant.effectModifiers?.speedBonus ?? 0,
  );
}

/** Orçamento nominal persistido → economia efetiva para validar/mostrar. */
export function combatantMovementEconomy(combatant: CombatantSourced): TurnEconomy {
  return reconcileMovement(
    economyOf(combatant.turnEconomy),
    combatant.character?.speed ?? combatant.creature?.speed ?? 0,
    combatantEffectiveSpeed(combatant),
  );
}

function toCombatantDto(combatant: CombatantSourced): CombatantDto {
  const source = combatant.character ?? combatant.creature;
  const relationSide = combatant.sideKey?.trim().toLowerCase() ?? null;
  // Modificadores de EFEITOS ativos: CRU do resumo em lote, sem segunda conta.
  const effectModifiers = combatant.effectModifiers ?? emptyEffectModifierSet();
  const effectArmorBonuses = effectArmorClassBonuses(effectModifiers);

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
    combatant.character !== null
      ? characterArmorClass(combatant.character, effectArmorBonuses)
      : null;
  const armorClass =
    armorClassDetail?.value ??
    // NPC: CA DERIVADA do equipamento (armadura/escudo/bônus), nunca a cópia
    // congelada do snapshot. Criatura-template: o snapshot + efeitos, como antes.
    (combatant.creature?.kind === 'NPC'
      ? npcEffectiveArmorClass(combatant.creature, effectArmorBonuses)
      : (combatant.armorClass ?? combatant.creature?.armorClass ?? 0) +
        effectArmorBonuses.reduce((sum, piece) => sum + piece.value, 0));

  const deathState = combatantDeathState(combatant);
  // ESPAÇO: tamanho efetivo (hoje = base) e posição persistida. `null` é
  // UNPLACED — nunca convertido em 0,0.
  const baseSize = combatant.baseSize ?? 'medium';
  const effectiveSize = effectiveSizeOf(baseSize);
  const spatialPosition = parseStoredPosition(combatant.spatialPosition);
  const spatialVisibility = spatialVisibilityOf(combatant.spatialVisibility);
  return {
    hostileToIds: [...new Set([...(combatant.hostileToIds ?? []), ...(combatant.duelOpponentIds ?? [])])],
    abilities: creatureAbilitiesOf(combatant.creature?.abilities),
    abilityUses: creatureAbilityUsesOf(combatant.abilityUses),
    tokenDimmed: deathState.dead || hpCurrent <= 0 || deriveConditionEffects(combatantMechanicalState(combatant)).active.includes('unconscious'),
    tokenNumber: combatant.kind === 'CREATURE' ? (combatant.tokenNumber ?? (Number(combatant.name.match(/ (\d+)$/)?.[1]) || null)) : null,
    turnEconomy: combatantMovementEconomy(combatant),
    mechanicalState: mechanicalStateOf(combatantMechanicalState(combatant)),
    deathState,
    deathBlocksActions: deathBlocksActions(deathState),
    conditionEffects: deriveConditionEffects(combatantMechanicalState(combatant)),
    mechanicalVersion: combatant.character?.version ?? combatant.mechanicalVersion,
    effectiveSpeed: combatantEffectiveSpeed(combatant),
    id: combatant.id,
    kind: combatant.kind,
    characterId: combatant.characterId,
    creatureId: combatant.creatureId,
    name: combatant.name,
    ownerUserId: combatant.ownerUserId,
    ownerUsername: combatant.character?.user.username ?? null,
    imageUrl: combatant.character?.avatarUrl || combatant.tokenImageUrl || combatant.creature?.imageUrl || null,
    dexterityMod: combatant.dexterityMod,
    initiative: combatant.initiative,
    initiativeRoll: combatant.initiativeRoll,
    hpCurrent,
    hpMax,
    armorClass,
    armorNonProficiency: armorClassDetail?.armorNonProficiency ?? null,
    spatialVisibility,
    spatial: {
      tokenImageRef: combatant.character?.avatarUrl || combatant.tokenImageUrl || combatant.creature?.imageUrl || null,
      baseSize,
      effectiveSize,
      position: spatialPosition,
      occupiedSpace: occupiedSpaceOf(spatialPosition, effectiveSize),
    },
    sideKey: combatant.sideKey ?? null,
    relation: combatant.kind === 'CHARACTER' ? 'allied' : !relationSide ? 'unknown' : relationSide === 'neutral' ? 'neutral' : relationSide === 'players' ? 'allied' : 'hostile',
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

  const liveIds = new Set(combatants.filter(unit => !unit.missing).map(unit => unit.id));
  const dto: CombatDto = {
    duels: (combat.duels ?? []).filter(duel => liveIds.has(duel.requesterId) && liveIds.has(duel.challengedId)).map(duel => ({ id: duel.id, requesterId: duel.requesterId, challengedId: duel.challengedId, status: duel.status === 'active' ? 'active' : 'pending' })),
    hostilityPrompts: (combat.hostilityPrompts ?? []).filter(prompt => liveIds.has(prompt.npcId) && liveIds.has(prompt.attackerId) && liveIds.has(prompt.targetId)).map(({ id, attackerId, targetId, npcId, attackName }) => ({ id, attackerId, targetId, npcId, attackName })),
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
    sceneId: combat.scene?.id ?? null,
    sceneName: combat.scene?.name ?? null,
    // A imagem segue a MESMA fonte estrutural (a cena viva): sem cena ou sem
    // arte, `null`. Nada de snapshot em `Combat` nesta fase.
    sceneBackgroundImageUrl: combat.scene?.backgroundImageUrl ?? null,
    // FONTE ESTRUTURAL ÚNICA: cena quando há `sceneId`, senão o legado.
    spatial: effectiveSceneConfigOf(combat),
    obstacles: (combat.scene?.obstacles ?? []).map(obstacleDtoOf),
    combatants,
    createdAt: combat.createdAt.toISOString(),
    endedAt: combat.endedAt ? combat.endedAt.toISOString() : null,
  };

  return viewer === 'MASTER' ? dto : hideMasterPrivateState(dto);
}

/**
 * Criaturas e NPCs são controlados pelo Mestre e têm ESTADO MECÂNICO privado
 * (PV, CA, morte, economia). NÃO diz nada sobre presença espacial: um NPC é
 * público no grid por padrão e só sai da projeção do jogador quando o Mestre
 * marca `spatialVisibility = 'master-only'` (6.6L.3.2).
 */
export function hasPrivateMechanicalState(kind: CombatantKind): boolean {
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
  const hidden = dto.combatants.filter(c=>c.kind !== 'CHARACTER' && c.spatialVisibility === 'master-only');
  const hiddenIds = new Set(hidden.map(c=>c.id));
  return {
    ...dto,
    duels: (dto.duels ?? []).filter(duel => duel.status === 'active'),
    hostilityPrompts: [],
    currentCombatantId: dto.currentCombatantId && !hiddenIds.has(dto.currentCombatantId) ? dto.currentCombatantId : null,
    economyLog: dto.economyLog.filter((entry) => entry.private !== true && !hidden.some(c=>entry.actorName===c.name || entry.message.includes(c.name))),
    combatants: dto.combatants.filter(c=>!hiddenIds.has(c.id)).map((combatant) => {
      // DUAS políticas INDEPENDENTES (6.6L.3.2): estado mecânico (por tipo: NPC
      // tem stats privados) e PRESENÇA ESPACIAL (por instância: `master-only`).
      // Um NPC público aparece no grid com a imagem real e SEM HP/CA.
      const visible = hasPrivateMechanicalState(combatant.kind)
        ? hideCombatantMechanicalState(combatant)
        : combatant;
      const projected = projectCombatantSpatialState(visible);
      // Lado é estado do ENCONTRO administrado pelo Mestre: o jogador não
      // recebe o mapa de times. Hostilidades particulares só citam participantes visíveis.
      return { ...projected, sideKey: null, relation: projected.spatial ? projected.relation : 'unknown', hostileToIds: (projected.hostileToIds ?? []).filter(id => !hiddenIds.has(id) && dto.combatants.some(unit => unit.id === id)), tokenDimmed: projected.spatial ? projected.tokenDimmed : false, tokenNumber: projected.spatial ? projected.tokenNumber : null };
    }),
  };
}

/**
 * PRESENÇA ESPACIAL (6.6L.3.2) — `master-only` não projeta token, imagem nem
 * geometria ao jogador. É a ÚNICA porta que esconde espaço: nada aqui consulta
 * `kind`, então NPC público continua visível e um personagem oculto some.
 */
export function projectCombatantSpatialState(combatant: CombatantDto): CombatantDto {
  if (combatant.spatialVisibility !== 'master-only') return combatant;
  return {
    ...combatant,
    // Imagem/token também é presença: a ausência do retrato nunca pode
    // denunciar que existe (ou deixou de existir) algo oculto na cena.
    imageUrl: null,
    spatial: null,
  };
}

/**
 * ESTADO MECÂNICO privado de criatura/NPC. Depois da 6.6L.3.2 NÃO toca mais em
 * `spatial`/`imageUrl`: essas são responsabilidade de
 * `projectCombatantSpatialState`, aplicada a TODOS os combatentes.
 */
export function hideCombatantMechanicalState(combatant: CombatantDto): CombatantDto {
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
    abilities: [],
    abilityUses: {},
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
