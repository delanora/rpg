import type { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { rollDie } from '../shared/dice.js';
import { economyOf } from '../shared/action-economy.js';
import { characterArmorClass } from '../characters/armor-class.js';
import { npcEffectiveArmorClass } from '../creatures/npc-sheet.js';
import { effectiveSpeed, type MechanicalEntity } from '../shared/conditions.js';
import type { LoadedEntity } from '../mechanical/mechanical.service.js';

/**
 * FASE 6.6I.4 — SHARED ATTACK ROLL RESOLVER.
 *
 * Ataques de ARMA e ataques MÁGICOS compartilham este módulo: rolagem de d20,
 * vantagem/desvantagem, 1/20 natural, crítico e expansão dos dados de dano. O
 * serviço de combate e a execução de magia chamam as MESMAS funções — não
 * existe segunda implementação de "d20 vs CA" no projeto.
 *
 * Invariantes:
 *  • o resolver é PURO e não conhece nome de magia/arma nem o banco (exceto os
 *    helpers de CONSULTA `targetArmorClassOf`/`targetDefenseContextOf`, que só
 *    leem estado ATUAL do alvo);
 *  • o bônus de ataque chega JÁ DERIVADO pela camada chamadora (arma pela ficha,
 *    magia pelo snapshot do `SpellCast`) — nunca recalculado aqui;
 *  • `roll` é injetável para testes DETERMINÍSTICOS; nenhum caminho HTTP aceita
 *    um d20 vindo do cliente;
 *  • crítico dobra os DADOS do ataque (todos os componentes), nunca o bônus fixo.
 */

/** Contexto do ataque. A magia usa isto para Caído/Esquiva; não decide alcance. */
export type AttackKind = 'melee' | 'ranged';

export type AttackRollMode = 'normal' | 'advantage' | 'disadvantage';

/** Fonte de aleatoriedade. Padrão: o dado justo do servidor (`crypto.randomInt`). */
export type AttackRollSource = (sides: number) => number;

export interface AttackRollSelection {
  /** Os d20 efetivamente rolados (1 ou 2), na ordem em que saíram. */
  rolls: number[];
  /** O d20 MANTIDO pelo modo — é ele que decide 1/20 natural e crítico. */
  naturalRoll: number;
  advantage: boolean;
  disadvantage: boolean;
  mode: AttackRollMode;
}

/**
 * Rola o d20 de UM ataque.
 *
 * Vantagem e desvantagem seguem a engine existente (`conditionAttackMode`):
 * qualquer quantidade de fontes vira uma fonte e os dois lados se CANCELAM. A
 * rolagem lê apenas o modo já resolvido — nada de stacks numéricos.
 */
export function selectAttackRoll(input: {
  advantage: boolean;
  disadvantage: boolean;
  roll?: AttackRollSource;
}): AttackRollSelection {
  const roll = input.roll ?? ((sides: number) => rollDie(sides));
  const { advantage, disadvantage } = input;
  const first = roll(20);
  if (!advantage && !disadvantage) {
    return { rolls: [first], naturalRoll: first, advantage, disadvantage, mode: 'normal' };
  }
  const second = roll(20);
  const naturalRoll = advantage ? Math.max(first, second) : Math.min(first, second);
  const mode: AttackRollMode = advantage && !disadvantage
    ? 'advantage'
    : disadvantage && !advantage
      ? 'disadvantage'
      : 'normal';
  return { rolls: [first, second], naturalRoll, advantage, disadvantage, mode };
}

export interface AttackOutcome {
  hit: boolean;
  critical: boolean;
  /** 1 natural: sempre erra, mesmo com bônus altíssimo (PHB 2014). */
  autoMiss: boolean;
  /** 20 natural: sempre acerta e é crítico, mesmo contra CA inalcançável. */
  autoHit: boolean;
}

/**
 * Decide acerto/crítico a partir do d20 MANTIDO e do total.
 *
 * `critThreshold` existe porque o Campeão (Crítico Aprimorado/Superior) crita em
 * 19/18 em ATAQUES DE ARMA — magias usam 20, sempre. O 20 natural continua
 * acertando mesmo que o limiar configurado seja maior.
 */
export function resolveAttackOutcome(input: {
  naturalRoll: number;
  total: number;
  targetAc: number;
  critThreshold?: number;
}): AttackOutcome {
  const critThreshold = input.critThreshold ?? 20;
  const autoMiss = input.naturalRoll === 1;
  const autoHit = input.naturalRoll === 20;
  const critical = input.naturalRoll >= critThreshold;
  return {
    hit: autoMiss ? false : autoHit || critical || input.total >= input.targetAc,
    critical,
    autoMiss,
    autoHit,
  };
}

/** Componente de dano de um ataque (arma, magia, dano extra). */
export interface AttackDamageComponentDefinition {
  /** Tipo canônico do projeto (`Cortante`, `Força`...) ou `null` = sem tipo. */
  type: string | null;
  /** Dados do componente. Ausente = componente só com bônus fixo. */
  dice?: { count: number; sides: number };
  /** Bônus fixo: NUNCA é dobrado no crítico. */
  bonus?: number;
}

export interface RolledAttackDamageComponent {
  type: string | null;
  /** Quantidade de dados efetivamente rolada (dobrada no crítico). */
  count: number;
  sides: number;
  rolls: number[];
  diceTotal: number;
  bonus: number;
  /** Dano cru do componente (`dados + bônus`, nunca negativo). */
  rawAmount: number;
}

/**
 * Rola os dados de dano do ataque.
 *
 * PHB 2014: no crítico, TODOS os dados de dano do ataque são rolados duas vezes.
 * Cada componente dobra os PRÓPRIOS dados e o bônus fixo entra UMA vez — nunca
 * `2d10 + 6` para `1d10 + 3`. Isso vale para componentes múltiplos
 * (`1d10 Força` + `1d6 Radiante` → `2d10` + `2d6`).
 */
export function rollAttackDamageComponents(
  components: readonly AttackDamageComponentDefinition[],
  critical: boolean,
  roll: AttackRollSource = rollDie,
): RolledAttackDamageComponent[] {
  return components.map((component) => {
    const sides = component.dice?.sides ?? 0;
    const count = component.dice ? component.dice.count * (critical ? 2 : 1) : 0;
    const rolls = sides > 0 && count > 0
      ? Array.from({ length: count }, () => roll(sides))
      : [];
    const diceTotal = rolls.reduce((sum, value) => sum + value, 0);
    const bonus = component.bonus ?? 0;
    return {
      type: component.type,
      count,
      sides,
      rolls,
      diceTotal,
      bonus,
      rawAmount: Math.max(0, diceTotal + bonus),
    };
  });
}

/**
 * CA ATUAL do alvo, pela MESMA conta da ficha/combate.
 *
 * Nada é congelado no `SpellCast`: escudo, armadura, override do Mestre e
 * Effects de CA entram no momento da RESOLUÇÃO (é o que torna Shield/reações de
 * CA possíveis no futuro). Combatente de personagem é canonicalizado pela ficha.
 */
export async function targetArmorClassOf(
  db: Prisma.TransactionClient,
  entity: MechanicalEntity,
  effectBonuses: readonly { label: string | null; value: number }[] = [],
): Promise<number> {
  const flat = effectBonuses.reduce((sum, piece) => sum + piece.value, 0);
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return characterArmorClass(row, effectBonuses).value;
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return row.kind === 'NPC'
      ? npcEffectiveArmorClass(row, effectBonuses)
      : (row.armorClass ?? 10) + flat;
  }
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    include: { creature: true },
  });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) {
    const character = await db.character.findUnique({ where: { id: row.characterId } });
    if (character) return characterArmorClass(character, effectBonuses).value;
  }
  if (row.creature?.kind === 'NPC') return npcEffectiveArmorClass(row.creature, effectBonuses);
  return (row.armorClass ?? row.creature?.armorClass ?? 10) + flat;
}

/**
 * Contexto de DEFESA do alvo (Esquiva + deslocamento efetivo).
 *
 * A Esquiva é do combatente (economia de turno); personagem fora de combate não
 * esquiva. O deslocamento é o EFETIVO — Effects `speed-flat` e Conditions
 * entram pela mesma derivação da ficha (6.5B.1).
 */
export async function targetDefenseContextOf(
  db: Prisma.TransactionClient,
  target: LoadedEntity,
  speedBonus = 0,
): Promise<{ targetDodging: boolean; targetSpeed: number }> {
  const entity = target.entity;
  const economy = entity.kind === 'combatant'
    ? economyOf(
        (
          await db.combatant.findUnique({
            where: { id: entity.id },
            select: { turnEconomy: true },
          })
        )?.turnEconomy ?? {},
      )
    : entity.kind === 'character'
      ? economyOf(
          (
            await db.combatant.findFirst({
              where: { characterId: entity.id, combat: { status: 'ACTIVE' } },
              select: { turnEconomy: true },
            })
          )?.turnEconomy ?? {},
        )
      : economyOf({});
  return {
    targetDodging: economy.dodging,
    targetSpeed: effectiveSpeed(target.baseSpeed, target.state, speedBonus),
  };
}
