import type { Prisma } from '@prisma/client';
import {
  deriveConditionEffects,
  effectiveMaxHp,
} from '../shared/conditions.js';
import {
  computeMulticlassAdjustments,
  normalizeClassEntries,
  normalizeClassState,
  type ClassAdjustments,
} from '../shared/classes.js';
import type { AbilityKey } from '../shared/dnd5e.js';
import type { DamageComponentPayload } from '../../realtime/events.js';

/**
 * FASE 6.6I.1 — SHARED DAMAGE & HEALING RESOLUTION CORE.
 *
 * Este módulo é a ÚNICA implementação de:
 *  • defesa do alvo por tipo (`damageDefensesOf`);
 *  • aplicação de resistência/imunidade/vulnerabilidade (`applyDamageDefense`);
 *  • mutação de HP no banco (`applyHpMutation`).
 *
 * Ataques físicos, uso de consumível e o ajuste manual do Mestre JÁ passam por
 * aqui. Spells de dano/cura futuras (Sacred Flame, Healing Word) chamarão as
 * MESMAS funções, sempre dentro da transação do chamador.
 *
 * O núcleo NÃO abre transação própria, NÃO publica socket, NÃO escreve no
 * Combat Log e NÃO conhece nome de magia/feature. Quem chama compõe o ciclo de
 * morte/Concentração e publica depois do commit — preservando a arquitetura
 * server-authoritative do projeto.
 */

/** De onde o dano/cura nasceu. `spell` já é aceito para as próximas fases. */
export type ResolutionSource =
  | { kind: 'weapon-attack'; label?: string }
  | { kind: 'spell'; spellCastId?: string; label?: string }
  | { kind: 'effect'; effectInstanceId?: string; label?: string }
  | { kind: 'feature'; label?: string }
  | { kind: 'manual'; label?: string };

/**
 * Parcela de dano já ROLADA. `rawAmount` é o dano antes das defesas; o núcleo
 * nunca rola dados (a rolagem continua onde já pertence: ataque, magia, etc.).
 */
export interface DamageResolutionComponent {
  /** Tipo canônico do projeto (`Cortante`, `Radiante`...) ou `null` = sem tipo. */
  type: string | null;
  rawAmount: number;
  /** Contexto opcional devolvido ao chamador (expressão/rolagem original). */
  expression?: string;
}

export interface ResolvedDamageComponent extends DamageResolutionComponent {
  applied: number;
  modifier: DamageComponentPayload['modifier'];
}

/** Defesas do alvo, sempre por tipo canônico. */
export interface DamageDefenses {
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  allResistance?: boolean;
}

/** Resultado estruturado: cru, final, parcelas e HP antes/depois. */
export interface DamageResolutionResult {
  eventId: string;
  source: ResolutionSource;
  rawDamage: number;
  finalDamage: number;
  components: ResolvedDamageComponent[];
  hpBefore: number | null;
  hpAfter: number | null;
  hpMax: number | null;
  hpTempBefore: number;
}

export interface HealingResolutionResult {
  eventId: string;
  source: ResolutionSource;
  requestedHealing: number;
  finalHealing: number;
  hpBefore: number;
  hpAfter: number;
  hpMax: number;
  hpTempBefore: number;
}

/**
 * Forma mínima aceita pelo núcleo: um combatente carregado (ficha ou criatura).
 * Personagem é SEMPRE a ficha; criatura/NPC é a instância do combate.
 */
export interface DamageResolutionTarget {
  kind: 'CHARACTER' | 'CREATURE' | 'NPC';
  id: string;
  character?: {
    id: string;
    classes: unknown;
    classState: unknown;
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
    raceResistances?: string[] | null;
    mechanicalState?: unknown;
  } | null;
  creature?: {
    resistances?: unknown;
    immunities?: unknown;
    vulnerabilities?: unknown;
    mechanicalState?: unknown;
    hpMax?: number | null;
  } | null;
  mechanicalState?: unknown;
  hpMax?: number | null;
}

/** Ajustes de features (Fúria, resistências, PV por talento) do personagem. */
function classAdjustmentsOf(character: NonNullable<DamageResolutionTarget['character']>): ClassAdjustments {
  const entries = normalizeClassEntries(character.classes);
  const abilities: Record<AbilityKey, number> = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
  return computeMulticlassAdjustments(entries, normalizeClassState(character.classState), abilities);
}

/** Coage um JSONB de defesa de criatura para lista de tipos (strings). */
function damageTypeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Estado mecânico da entidade — MESMA precedência de `combatantMechanicalState`:
 * personagem usa a FICHA (canônica); criatura/NPC usa o estado da INSTÂNCIA do
 * combate (o template do bestiário não carrega condições ativas). Ler o
 * `creature.mechanicalState` aqui faria Petrified/Poisoned da instância
 * desaparecerem das defesas.
 */
function mechanicalStateOfTarget(target: DamageResolutionTarget): unknown {
  return target.character?.mechanicalState ?? target.mechanicalState ?? null;
}

/**
 * Listas de defesa do alvo contra dano, por tipo canônico.
 *
 * Personagem: resistências de CLASSE (Fúria, ...) e de RAÇA (`raceResistances`).
 * Criatura: `resistances` / `immunities` / `vulnerabilities` do statblock.
 * Petroficado/Effects entram por `deriveConditionEffects` (imunidade a Veneno
 * e resistência a todo dano), exatamente como antes da extração.
 */
export function damageDefensesOf(target: DamageResolutionTarget): DamageDefenses {
  const effects = deriveConditionEffects(mechanicalStateOfTarget(target) as never);
  if (target.kind === 'CHARACTER' && target.character) {
    const adjustments = classAdjustmentsOf(target.character);
    return {
      resistances: new Set([
        ...adjustments.resistances,
        ...(target.character.raceResistances ?? []),
      ]),
      allResistance: effects.allDamageResistance,
      immunities: new Set(effects.poisonImmune ? ['Veneno'] : []),
      vulnerabilities: new Set(),
    };
  }

  const creature = target.creature;
  return {
    allResistance: effects.allDamageResistance,
    resistances: new Set(damageTypeList(creature?.resistances)),
    immunities: new Set([
      ...damageTypeList(creature?.immunities),
      ...(effects.poisonImmune ? ['Veneno'] : []),
    ]),
    vulnerabilities: new Set(damageTypeList(creature?.vulnerabilities)),
  };
}

/**
 * Aplica a defesa do alvo a UMA parcela de dano, por tipo.
 *
 * Imunidade zera a parcela; vulnerabilidade dobra; resistência reduz pela
 * metade (arredondando para baixo); sem defesa, a parcela passa inteira. Dano
 * SEM tipo (`null`) nunca aciona defesa. Resistência é aplicada ANTES da
 * vulnerabilidade (PHB 2014) — comportamento preservado da implementação
 * original, sem nenhuma regra nova.
 */
export function applyDamageDefense(
  damageType: string | null,
  total: number,
  defenses: DamageDefenses,
): { applied: number; modifier: DamageComponentPayload['modifier'] } {
  if (damageType && defenses.immunities.has(damageType)) return { applied: 0, modifier: 'immunity' };
  const resistance = defenses.allResistance || Boolean(damageType && defenses.resistances.has(damageType));
  const vulnerability = Boolean(damageType && defenses.vulnerabilities.has(damageType));
  const resisted = resistance ? Math.floor(total / 2) : total;
  return {
    applied: vulnerability ? resisted * 2 : resisted,
    modifier: resistance && vulnerability
      ? 'resistance-vulnerability'
      : resistance
        ? 'resistance'
        : vulnerability
          ? 'vulnerability'
          : null,
  };
}

export interface HpMutationResult {
  hpCurrent: number;
  hpMax: number;
  hpBefore: number;
  hpTempBefore: number;
}

/**
 * MUTAÇÃO CANÔNICA de HP (dano = delta negativo; cura = delta positivo).
 *
 * A escrita continua ATÔMICA no banco (`UPDATE ... SET hpCurrent = ...`): o
 * valor novo parte do que está GRAVADO, não do snapshot do início do ataque.
 * Regras preservadas:
 *  • dano consome primeiro os PV temporários; cura não os move;
 *  • PV atuais nunca ficam abaixo de 0 nem acima do máximo efetivo;
 *  • o teto é derivado (hpBonus de features + multiplicador de Exaustão);
 *  • PV ANTES da escrita são devolvidos (morte instantânea depende deles).
 *
 * Devolve `null` quando a origem não existe mais (deletada no meio do combate).
 * NÃO publica nada: o chamador registra o id em `publications` e publica depois
 * do commit.
 */
export async function applyHpMutation(
  db: Prisma.TransactionClient,
  target: DamageResolutionTarget,
  delta: number,
  publications?: Set<string>,
): Promise<HpMutationResult | null> {
  if (target.kind === 'CHARACTER' && target.character) {
    const character = target.character;
    const before = await db.character.findUnique({
      where: { id: character.id },
      select: { hpCurrent: true, hpTemp: true },
    });
    if (!before) return null;
    const hpBonus = classAdjustmentsOf(character).hpBonus;
    const hpMaxMultiplier = deriveConditionEffects(character.mechanicalState as never).hpMaxMultiplier;

    const affected = await db.$executeRaw`
      UPDATE "characters"
      SET "hpTemp" = GREATEST(0, "hpTemp" - GREATEST(0, -${delta})),
          "hpCurrent" = GREATEST(
            0,
            LEAST(
              GREATEST(FLOOR(("hpMax" + ${hpBonus}) * ${hpMaxMultiplier}), 0),
              "hpCurrent" + ${delta} + LEAST("hpTemp", GREATEST(0, -${delta}))
            )
          ),
          "version" = "version" + 1
      WHERE "id" = ${character.id}
    `;
    if (affected === 0) return null;

    const stored = await db.character.findUniqueOrThrow({ where: { id: character.id } });
    if (publications) publications.add(stored.id);
    return {
      hpCurrent: stored.hpCurrent,
      hpMax: effectiveMaxHp(stored.hpMax + hpBonus, stored.mechanicalState),
      hpBefore: before.hpCurrent,
      hpTempBefore: before.hpTemp,
    };
  }

  // Criatura/NPC: o HP é o snapshot da instância do combate (cópias independentes).
  const hpMax = target.hpMax ?? target.creature?.hpMax ?? 0;
  const ceiling = effectiveMaxHp(hpMax, target.mechanicalState as never);
  const before = await db.combatant.findUnique({
    where: { id: target.id },
    select: { hpCurrent: true },
  });
  if (!before) return null;

  const affected = await db.$executeRaw`
    UPDATE "combatants"
    SET "hpCurrent" = GREATEST(0, LEAST(${ceiling}, COALESCE("hpCurrent", 0) + ${delta}))
    WHERE "id" = ${target.id}
  `;
  if (affected === 0) return null;

  const stored = await db.combatant.findUniqueOrThrow({ where: { id: target.id } });
  return {
    hpCurrent: stored.hpCurrent ?? 0,
    hpMax: ceiling,
    hpBefore: before.hpCurrent ?? 0,
    hpTempBefore: 0,
  };
}

export interface DamageResolutionInput {
  /** Identidade do EVENTO de dano (não é `operationId`, mas pode ser). */
  eventId: string;
  source: ResolutionSource;
  target: DamageResolutionTarget;
  components: DamageResolutionComponent[];
  publications?: Set<string>;
}

/**
 * Resolve UM evento de dano: defesas por parcela → dano FINAL → mutação de HP.
 *
 * O dano de todos os componentes soma em UM evento: um único `finalDamage`,
 * usado pelo chamador para UM teste de Concentração e UM ciclo de morte. Dano
 * final 0 não escreve no HP (preserva "tudo imune não mexe em PV").
 */
export async function resolveDamage(
  db: Prisma.TransactionClient,
  input: DamageResolutionInput,
): Promise<DamageResolutionResult> {
  const defenses = damageDefensesOf(input.target);
  let rawDamage = 0;
  let finalDamage = 0;
  const components: ResolvedDamageComponent[] = input.components.map((component) => {
    const rawAmount = Math.max(0, Math.trunc(component.rawAmount));
    const { applied, modifier } = applyDamageDefense(component.type, rawAmount, defenses);
    rawDamage += rawAmount;
    finalDamage += applied;
    return { ...component, rawAmount, applied, modifier };
  });

  const hp = finalDamage > 0
    ? await applyHpMutation(db, input.target, -finalDamage, input.publications)
    : null;

  return {
    eventId: input.eventId,
    source: input.source,
    rawDamage,
    finalDamage,
    components,
    hpBefore: hp?.hpBefore ?? null,
    hpAfter: hp?.hpCurrent ?? null,
    hpMax: hp?.hpMax ?? null,
    hpTempBefore: hp?.hpTempBefore ?? 0,
  };
}

export interface HealingResolutionInput {
  eventId: string;
  source: ResolutionSource;
  target: DamageResolutionTarget;
  /** Cura já rolada pelo servidor. Nunca negativa. */
  amount: number;
  publications?: Set<string>;
}

/**
 * Resolve UM evento de cura: HP sobe até o máximo e nunca fica negativo.
 *
 * O núcleo NÃO decide ressurreição nem limpa Testes contra a Morte: quem chama
 * compõe com `applyHealConsequences` (mesmo fluxo de hoje). Assim a regra de
 * morte continua em UM só lugar e o card de Teste contra a Morte deixa de ser
 * derivável apenas porque o HP real mudou.
 */
export async function resolveHealing(
  db: Prisma.TransactionClient,
  input: HealingResolutionInput,
): Promise<HealingResolutionResult | null> {
  const requested = Math.max(0, Math.trunc(input.amount));
  const hp = await applyHpMutation(db, input.target, requested, input.publications);
  if (!hp) return null;
  return {
    eventId: input.eventId,
    source: input.source,
    requestedHealing: requested,
    finalHealing: Math.max(0, hp.hpCurrent - hp.hpBefore),
    hpBefore: hp.hpBefore,
    hpAfter: hp.hpCurrent,
    hpMax: hp.hpMax,
    hpTempBefore: hp.hpTempBefore,
  };
}
