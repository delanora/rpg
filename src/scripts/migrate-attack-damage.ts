import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { DAMAGE_TYPES, type Damage, type DamageType } from '../modules/shared/attacks.js';
import { parseDiceExpression } from '../modules/shared/dice.js';

/**
 * Migra os ataques gravados no formato antigo (dano em TEXTO, ex.: "2d6+3")
 * para o dano ESTRUTURADO ({ count, sides, bonus, type }).
 *
 *   npm run migrate:attack-damage
 *
 * - A expressão é interpretada pelo mesmo parser das rolagens
 *   (`parseDiceExpression`); o tipo sai do antigo `damageType` quando ele é um
 *   dos 13 canônicos (senão fica `null`, "sem tipo").
 * - O que não puder ser convertido com segurança é mantido como está: o texto
 *   original vai para `damageText`, o ataque é marcado com `legacy: true` e o
 *   nome entra no resumo final para o mestre revisar. Nada é perdido.
 * - Roda sobre fichas (`Character.attacks`) e criaturas (`Creature.attacks`) e
 *   é idempotente: ataques já estruturados são apenas normalizados.
 */
async function main(): Promise<void> {
  const legacy: string[] = [];
  let converted = 0;

  const characters = await prisma.character.findMany({
    select: { id: true, name: true, attacks: true },
  });
  for (const character of characters) {
      const { changed, next, convertedCount } = migrateList(
      character.attacks,
      legacy,
      `ficha ${character.name}`,
    );
    if (changed) {
      await prisma.character.update({
        where: { id: character.id },
        data: { attacks: next as unknown as Prisma.InputJsonValue },
      });
    }
    converted += convertedCount;
  }

  const creatures = await prisma.creature.findMany({
    select: { id: true, name: true, attacks: true },
  });
  for (const creature of creatures) {
    const { changed, next, convertedCount } = migrateList(
      creature.attacks,
      legacy,
      `criatura ${creature.name}`,
    );
    if (changed) {
      await prisma.creature.update({
        where: { id: creature.id },
        data: { attacks: next as unknown as Prisma.InputJsonValue },
      });
    }
    converted += convertedCount;
  }

  console.log(
    `✔ Migração de ataques: ${converted} convertido(s) em ${characters.length} ficha(s) e ${creatures.length} criatura(s).`,
  );
  if (legacy.length > 0) {
    console.log(`⚠ ${legacy.length} ataque(s) NÃO convertidos (mantidos como estavam e marcados como legado):`);
    for (const name of legacy) console.log(`   • ${name}`);
  } else {
    console.log('Nenhum ataque ficou como legado.');
  }
}

interface MigrateResult {
  changed: boolean;
  next: unknown[];
  convertedCount: number;
}

function migrateList(
  rawList: unknown,
  legacyNames: string[],
  owner: string,
): MigrateResult {
  const list = Array.isArray(rawList) ? rawList : [];
  let changed = false;
  let convertedCount = 0;

  const next = list.map((raw) => {
    const { attack, converted } = migrateAttack(raw, legacyNames, owner);
    if (converted) {
      changed = true;
      convertedCount += 1;
    }
    return attack;
  });

  return { changed, next, convertedCount };
}

function canonicalType(value: unknown): DamageType | null {
  return typeof value === 'string' && (DAMAGE_TYPES as readonly string[]).includes(value)
    ? (value as DamageType)
    : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function migrateAttack(
  raw: unknown,
  legacyNames: string[],
  owner: string,
): { attack: unknown; converted: boolean; isLegacy: boolean } {
  if (raw === null || typeof raw !== 'object') return { attack: raw, converted: false, isLegacy: false };
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : String(record.id ?? '?');
  const label = `${name} (${owner})`;

  // Já estruturado: normaliza os campos, descarta o `damageType` antigo e
  // PRESERVA a marca de legado (para o script poder rodar mais de uma vez sem
  // apagar o aviso ao mestre).
  if (record.damage !== null && typeof record.damage === 'object') {
    const current = record.damage as Record<string, unknown>;
    const type = canonicalType(current.type) ?? canonicalType(record.damageType);
    const damage: Damage = {
      count: clampInt(current.count, 0, 50, 0),
      sides: clampInt(current.sides, 0, 1000, 0),
      bonus: clampInt(current.bonus, -9999, 9999, 0),
      type,
    };
    const isLegacy = record.legacy === true;
    const { damageType: _drop, ...rest } = record;
    const attack: Record<string, unknown> = { ...rest, damage, legacy: isLegacy };
    if (isLegacy) attack.damageText = typeof record.damageText === 'string' ? record.damageText : '';
    else delete attack.damageText;
    if (isLegacy) legacyNames.push(label);
    return { attack, converted: true, isLegacy };
  }

  const text = typeof record.damage === 'string' ? record.damage.trim() : '';
  const type = canonicalType(record.damageType);
  const spec = text ? parseDiceExpression(text) : null;

  const { damageType: _drop, ...rest } = record;

  if (!spec) {
    // Não conversível: preserva o texto original e marca como legado.
    legacyNames.push(label);
    return {
      attack: { ...rest, damage: { count: 0, sides: 0, bonus: 0, type }, damageText: text, legacy: true },
      converted: true,
      isLegacy: true,
    };
  }

  const damage: Damage = { count: spec.count, sides: spec.sides, bonus: spec.modifier, type };
  return { attack: { ...rest, damage, legacy: false }, converted: true, isLegacy: false };
}

main()
  .catch((error) => {
    console.error('❌ Falha na migração de ataques:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
