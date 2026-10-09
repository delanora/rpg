import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  spellSlotsUsedFrom,
  withSpellSlotsUsed,
} from '../modules/characters/characters.schema.js';
import {
  normalizeClassEntries,
  spellSlotMaxByLevel,
  spellSlotsForClasses,
} from '../modules/shared/classes.js';

/**
 * Migra o estado de MAGIAS gravado no formato ANTIGO para o ATUAL.
 *
 *   npm run migrate:spell-slots
 *
 * Antes:
 *   spells.slots["1"] = { max: 4, used: 2 }   // capacidade PERSISTIDA
 *
 * Depois:
 *   spells.slotsUsed["1"] = 2                // só o CONSUMO é persistido
 *
 * A capacidade máxima de um espaço de magia é REGRA DERIVADA do nível das
 * classes: o `max` gravado é DESCARTADO (nunca reescrito) e o total passa a vir
 * de `derived.spellSlots`. O `used` é SANEADO contra o derivado ATUAL
 * (`min(max(0, used), max)`) e o uso zerado é omitido — ausência de chave
 * significa 0 usados.
 *
 * Regras:
 *  • usa os MESMOS helpers do servidor (`spellSlotsForClasses`), nunca uma
 *    tabela de slots reimplementada aqui;
 *  • preserva `list`, `pactMagic` e qualquer campo adicional do JSON;
 *  • descarta o shape legado `slots` por inteiro (nem o `max`, nem o `used`);
 *  • é IDEMPOTENTE: rodar duas vezes produz o mesmo resultado e nunca recria
 *    `slots` nem duplica uso.
 */
async function main(): Promise<void> {
  const characters = await prisma.character.findMany({
    select: { id: true, name: true, classes: true, spells: true },
  });

  let migrated = 0;
  let sanitized = 0;
  let untouched = 0;

  for (const character of characters) {
    const stored = character.spells;
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      untouched += 1;
      continue;
    }

    const raw = stored as Record<string, unknown>;
    const maxByLevel = spellSlotMaxByLevel(
      spellSlotsForClasses(normalizeClassEntries(character.classes)),
    );
    const slotsUsed = spellSlotsUsedFrom(raw, maxByLevel);
    const next = withSpellSlotsUsed(raw, slotsUsed);

    // Sem mudança real (já migrado e saneado): não toca na ficha.
    if (JSON.stringify(raw) === JSON.stringify(next)) {
      untouched += 1;
      continue;
    }

    const hadLegacy = 'slots' in raw;
    await prisma.character.update({
      where: { id: character.id },
      data: { spells: next as Prisma.InputJsonValue },
    });
    if (hadLegacy) migrated += 1;
    else sanitized += 1;
  }

  console.log(
    `✔ Migração de espaços de magia: ${migrated} ficha(s) com shape legado convertida(s)` +
      `${sanitized > 0 ? `, ${sanitized} saneada(s)` : ''}` +
      `, ${untouched} sem mudança (de ${characters.length}).`,
  );
  if (migrated === 0) console.log('Nenhuma ficha tinha o shape legado `slots`.');
}

main()
  .catch((error) => {
    console.error('❌ Falha na migração dos espaços de magia:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
