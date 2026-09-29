import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { sanitizeItemDetails, type ItemDetails } from '../modules/shared/item-details.js';

/**
 * Migra os itens já cadastrados para os campos de ARMA do PHB.
 *
 *   npm run migrate:item-weapons
 *
 * - Toda **Arma** sem tipo recebe `weaponType: 'melee'` e
 *   `weaponCategory: 'simple'` (padrões seguros).
 * - Um **Cajado** que já tenha dano cadastrado é tratado como arma corpo a corpo
 *   simples **versátil** (d6 com uma mão / d8 com as duas, contundente); os
 *   demais Cajados não são alterados.
 * - Itens cujo NOME sugere arma à distância (arco, besta, funda, dardo...) são
 *   listados no resumo para o mestre corrigir o tipo e o alcance na mão.
 * - Idempotente: só grava quando o resultado é diferente do que já está salvo.
 */
const RANGED_HINT = /(arco|besta|funda|dardo|azagaia|zarabatana|arremess|atiradeira|pistola|mosquete)/i;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

async function main(): Promise<void> {
  const items = await prisma.item.findMany({
    select: { id: true, name: true, category: true, details: true },
  });

  const rangedSuspects: string[] = [];
  let weapons = 0;
  let staffs = 0;
  let updated = 0;

  for (const item of items) {
    const current = (item.details ?? {}) as ItemDetails;

    if (item.category === 'Arma') {
      weapons += 1;
      if (RANGED_HINT.test(item.name)) rangedSuspects.push(item.name);

      const next: ItemDetails = {
        ...current,
        weaponType: current.weaponType ?? 'melee',
        weaponCategory: current.weaponCategory ?? 'simple',
        properties: current.properties ?? [],
      };
      updated += await save(item, 'Arma', current, next);
      continue;
    }

    if (item.category === 'Cajado') {
      const hasDamage =
        current.damageCount !== undefined ||
        current.damageDie !== undefined ||
        current.damageType !== undefined;
      if (!hasDamage) continue;
      staffs += 1;

      const properties = new Set(current.properties ?? []);
      // Versátil e Duas mãos não coexistem; só adiciona Versátil se não houver.
      if (!properties.has('two-handed')) properties.add('versatile');

      const next: ItemDetails = {
        ...current,
        weaponType: current.weaponType ?? 'melee',
        weaponCategory: current.weaponCategory ?? 'simple',
        properties: [...properties],
        versatileDie: current.versatileDie ?? 8,
        damageDie: current.damageDie ?? 6,
        damageType: current.damageType ?? 'Concussão',
      };
      updated += await save(item, 'Cajado', current, next);
    }
  }

  console.log(
    `✔ Migração de armas: ${updated} item(ns) atualizado(s) — ${weapons} arma(s) e ${staffs} Cajado(s) com dano.`,
  );
  if (rangedSuspects.length > 0) {
    console.log(
      `⚠ ${rangedSuspects.length} arma(s) provavelmente À DISTÂNCIA (revise o tipo e o alcance na mão):`,
    );
    for (const name of rangedSuspects) console.log(`   • ${name}`);
  } else {
    console.log('Nenhuma arma parece ser à distância pelo nome.');
  }
}

/** Sanitiza e grava só quando algo mudou. Devolve 1 quando gravou, senão 0. */
async function save(
  item: { id: string },
  category: 'Arma' | 'Cajado',
  current: ItemDetails,
  next: ItemDetails,
): Promise<number> {
  const clean = sanitizeItemDetails(category, next);
  if (Object.keys(clean).length === 0) return 0;
  if (stableStringify(clean) === stableStringify(current)) return 0;
  await prisma.item.update({
    where: { id: item.id },
    data: { details: clean as unknown as Prisma.InputJsonValue },
  });
  return 1;
}

main()
  .catch((error) => {
    console.error('❌ Falha na migração de armas:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
