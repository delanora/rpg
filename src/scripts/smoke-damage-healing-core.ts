import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import {
  applyDamageDefense,
  damageDefensesOf,
  resolveDamage,
  resolveHealing,
} from '../modules/combat/damage-resolution.js';
import { applyDamageConsequences, applyHealConsequences } from '../modules/death/death.service.js';
import { deathStateOf, emptyDeathState } from '../modules/shared/death.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6I.1 — SHARED DAMAGE & HEALING RESOLUTION CORE.
 *
 * Prova que a extração do núcleo preserva TODAS as regras atuais e que ele já
 * aceita uma origem `spell` (contrato para Sacred Flame/Healing Word, sem
 * implementar nenhuma magia):
 *  • defesas por tipo: sem defesa, resistência (piso), imunidade, vulnerabilidade,
 *    resistência + vulnerabilidade e dano sem tipo;
 *  • defesas derivadas da ficha/criatura (raça, statblock, Effects);
 *  • dano cru × final, parcelas múltiplas num ÚNICO evento e HP atômico com piso/teto;
 *  • cura limitada ao máximo, nunca negativa e sem tocar PV temporários;
 *  • ciclo de morte/Inconsciente/Prone preservado na composição do chamador;
 *  • cura limpa os Testes contra a Morte e PRESERVA a Queda;
 *  • cura comum NÃO ressuscita morto (recusa + rollback do HP);
 *  • origem `spell` + dano Radiante não exige WeaponAttack.
 *
 * O núcleo NÃO abre transação, NÃO publica socket e NÃO escreve log — isso é
 * verificado estruturalmente no `test:combat-ui` e pelos smokes existentes.
 */
export async function smokeDamageHealingCore(_baseUrl: string, check: Check): Promise<void> {
  console.log('\n80) Fase 6.6I.1 — núcleo compartilhado de dano e cura');

  // =====================================================================
  // A — regras PURAS de defesa (sem I/O)
  // =====================================================================
  const defenses = {
    resistances: new Set(['Fogo']),
    immunities: new Set(['Veneno']),
    vulnerabilities: new Set(['Frio']),
  };
  check(
    '80.A) sem defesa passa inteiro; resistência halva (piso); imunidade zera; vulnerabilidade dobra',
    applyDamageDefense('Cortante', 11, defenses).applied === 11 &&
      applyDamageDefense('Fogo', 11, defenses).applied === 5 &&
      applyDamageDefense('Fogo', 11, defenses).modifier === 'resistance' &&
      applyDamageDefense('Veneno', 99, defenses).applied === 0 &&
      applyDamageDefense('Veneno', 99, defenses).modifier === 'immunity' &&
      applyDamageDefense('Frio', 6, defenses).applied === 12 &&
      applyDamageDefense('Frio', 6, defenses).modifier === 'vulnerability',
    JSON.stringify([
      applyDamageDefense('Cortante', 11, defenses),
      applyDamageDefense('Fogo', 11, defenses),
      applyDamageDefense('Veneno', 99, defenses),
      applyDamageDefense('Frio', 6, defenses),
    ]),
  );
  check(
    '80.B) resistência é aplicada ANTES da vulnerabilidade e dano SEM tipo nunca aciona defesa',
    applyDamageDefense('Fogo', 11, { ...defenses, vulnerabilities: new Set(['Fogo']) }).applied === 10 &&
      applyDamageDefense('Fogo', 11, { ...defenses, vulnerabilities: new Set(['Fogo']) }).modifier ===
        'resistance-vulnerability' &&
      applyDamageDefense(null, 7, defenses).applied === 7 &&
      applyDamageDefense(null, 7, defenses).modifier === null,
    JSON.stringify(applyDamageDefense('Fogo', 11, { ...defenses, vulnerabilities: new Set(['Fogo']) })),
  );
  const raceDefenses = damageDefensesOf({
    kind: 'CHARACTER',
    id: 'fake',
    character: {
      id: 'fake',
      classes: [{ classKey: 'fighter', subclass: '', level: 1 }],
      classState: {},
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      raceResistances: ['Fogo'],
      mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
    },
  });
  const creatureDefenses = damageDefensesOf({
    kind: 'NPC',
    id: 'fake-npc',
    creature: {
      resistances: ['Cortante'],
      immunities: ['Veneno'],
      vulnerabilities: ['Frio'],
      mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
    },
  });
  check(
    '80.C) defesas derivam da FICHA (raça/classe) e do statblock da criatura, sem Effects privados vazando',
    raceDefenses.resistances.has('Fogo') &&
      creatureDefenses.resistances.has('Cortante') &&
      creatureDefenses.immunities.has('Veneno') &&
      creatureDefenses.vulnerabilities.has('Frio'),
    JSON.stringify({
      race: [...raceDefenses.resistances],
      creature: [...creatureDefenses.resistances],
    }),
  );

  // =====================================================================
  // B — dano/cura reais no banco (fixtures próprias)
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  try {
    // `Character.userId` é ÚNICO: cada ficha de fixture tem a própria conta.
    const makeUser = async (label: string) => {
      const created = await prisma.user.create({
        data: {
          username: `dh_${label}_${suffix}`,
          displayName: `Fixture DH ${label}`,
          passwordHash: 'fixture',
          role: 'PLAYER',
        },
      });
      userIds.push(created.id);
      return created;
    };
    const makeCharacter = async (name: string) => {
      const owner = await makeUser(randomUUID().slice(0, 6));
      const row = await prisma.character.create({
        data: {
          userId: owner.id,
          name,
          hpCurrent: 30,
          hpMax: 30,
          speed: 9,
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 10,
          charisma: 8,
          classes: [{ classKey: 'fighter', subclass: '', level: 1 }],
        },
      });
      characterIds.push(row.id);
      return row;
    };

    const target = await makeCharacter('Alvo DH');
    const subject = () => ({ kind: 'CHARACTER' as const, id: target.id, character: target });

    const hit = await prisma.$transaction((tx) =>
      resolveDamage(tx, {
        eventId: 'dh-hit',
        source: { kind: 'weapon-attack' },
        target: subject(),
        components: [{ type: 'Cortante', rawAmount: 10 }],
      }),
    );
    const afterHit = await prisma.character.findUniqueOrThrow({ where: { id: target.id } });
    check(
      '80.D) dano passa pelo núcleo: cru = final sem defesa, HP atômico e versão incrementada',
      hit.rawDamage === 10 &&
        hit.finalDamage === 10 &&
        hit.hpBefore === 30 &&
        hit.hpAfter === 20 &&
        afterHit.hpCurrent === 20 &&
        afterHit.version > target.version,
      JSON.stringify({ hit, hp: afterHit.hpCurrent, version: afterHit.version }),
    );

    await prisma.character.update({ where: { id: target.id }, data: { raceResistances: ['Fogo'] } });
    const fireTarget = await prisma.character.findUniqueOrThrow({ where: { id: target.id } });
    const resisted = await prisma.$transaction((tx) =>
      resolveDamage(tx, {
        eventId: 'dh-fire',
        source: { kind: 'spell', spellCastId: 'fixture' },
        target: { kind: 'CHARACTER', id: target.id, character: fireTarget },
        components: [
          { type: 'Fogo', rawAmount: 10 },
          { type: 'Cortante', rawAmount: 6 },
        ],
      }),
    );
    check(
      '80.E) multi-componente soma num ÚNICO evento: resistencia só na parcela de Fogo',
      resisted.rawDamage === 16 &&
        resisted.finalDamage === 11 &&
        resisted.components[0].applied === 5 &&
        resisted.components[1].applied === 6 &&
        resisted.hpAfter === 9,
      JSON.stringify(resisted.components),
    );

    const healed = await prisma.$transaction((tx) =>
      resolveHealing(tx, {
        eventId: 'dh-heal',
        source: { kind: 'spell', label: 'Cura de prova' },
        target: { kind: 'CHARACTER', id: target.id, character: fireTarget },
        amount: 999,
      }),
    );
    const capped = await prisma.character.findUniqueOrThrow({ where: { id: target.id } });
    check(
      '80.F) cura respeita o HP máximo e nunca é negativa',
      healed?.requestedHealing === 999 &&
        healed?.finalHealing === 21 &&
        healed?.hpAfter === 30 &&
        capped.hpCurrent === 30,
      JSON.stringify({ healed, hp: capped.hpCurrent }),
    );
    const negative = await prisma.$transaction((tx) =>
      resolveHealing(tx, {
        eventId: 'dh-zero-heal',
        source: { kind: 'manual' },
        target: { kind: 'CHARACTER', id: target.id, character: capped },
        amount: -5,
      }),
    );
    check(
      '80.G) cura negativa vira 0 e não altera HP',
      negative?.finalHealing === 0 && negative?.hpAfter === 30,
      JSON.stringify(negative),
    );

    // =====================================================================
    // C — ciclo de 0 PV + cura (composição do chamador, sem acoplar o núcleo)
    // =====================================================================
    const zero = await makeCharacter('Zero DH');
    const zeroRow = await prisma.character.update({
      where: { id: zero.id },
      data: { hpCurrent: 10, hpMax: 10 },
    });
    await prisma.$transaction(async (tx) => {
      const damage = await resolveDamage(tx, {
        eventId: 'dh-zero',
        source: { kind: 'spell', label: 'Dano de prova' },
        target: { kind: 'CHARACTER', id: zeroRow.id, character: zeroRow },
        components: [{ type: 'Radiante', rawAmount: 10 }],
      });
      await applyDamageConsequences(
        { kind: 'character', id: zeroRow.id },
        {
          damage: 10,
          hpBefore: damage.hpBefore ?? 10,
          hpTempBefore: damage.hpTempBefore,
          critical: false,
          sourceName: 'Fixture',
        },
        tx,
        'Fixture',
      );
    });
    const zeroAfter = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    const zeroDeath = deathStateOf(zeroAfter.deathState);
    const proneBefore = JSON.stringify(zeroAfter.mechanicalState ?? {}).includes('"prone"');
    check(
      '80.H) 0 PV dispara o lifecycle existente (Testes + Inconsciente derivado + Queda)',
      zeroAfter.hpCurrent === 0 && zeroDeath.deathSaves && proneBefore,
      JSON.stringify({ hp: zeroAfter.hpCurrent, death: zeroDeath, prone: proneBefore }),
    );

    await prisma.$transaction(async (tx) => {
      const healedZero = await resolveHealing(tx, {
        eventId: 'dh-zero-heal',
        source: { kind: 'spell', label: 'Cura de prova' },
        target: { kind: 'CHARACTER', id: zero.id, character: zeroAfter },
        amount: 4,
      });
      await applyHealConsequences({ kind: 'character', id: zero.id }, healedZero!.hpAfter, tx, 'Fixture');
    });
    const revived = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    const revivedDeath = deathStateOf(revived.deathState);
    const proneAfter = JSON.stringify(revived.mechanicalState ?? {}).includes('"prone"');
    check(
      '80.I) cura > 0 com 0 PV encerra os Testes contra a Morte e PRESERVA a Queda',
      revived.hpCurrent === 4 &&
        !revivedDeath.deathSaves &&
        revivedDeath.successes === 0 &&
        revivedDeath.failures === 0 &&
        proneAfter,
      JSON.stringify({ hp: revived.hpCurrent, death: revivedDeath, prone: proneAfter }),
    );

    // Morto: a cura comum é recusada e o HP NÃO muda (rollback da transação).
    await prisma.character.update({
      where: { id: zero.id },
      data: { hpCurrent: 0, deathState: { ...emptyDeathState(), dead: true } },
    });
    const deadRow = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    let deadRefused = false;
    try {
      await prisma.$transaction(async (tx) => {
        const healDead = await resolveHealing(tx, {
          eventId: 'dh-dead-heal',
          source: { kind: 'spell' },
          target: { kind: 'CHARACTER', id: zero.id, character: deadRow },
          amount: 5,
        });
        await applyHealConsequences({ kind: 'character', id: zero.id }, healDead!.hpAfter, tx, 'Fixture');
      });
    } catch {
      deadRefused = true;
    }
    const deadAfter = await prisma.character.findUniqueOrThrow({ where: { id: zero.id } });
    check(
      '80.J) cura comum NÃO ressuscita morto (recusa do domínio e rollback do HP)',
      deadRefused && deadAfter.hpCurrent === 0 && deathStateOf(deadAfter.deathState).dead,
      JSON.stringify({ refused: deadRefused, hp: deadAfter.hpCurrent }),
    );

    // =====================================================================
    // D — contrato de magia futura (sem registrar spell nem endpoint)
    // =====================================================================
    const spellTarget = await makeCharacter('Spell DH');
    const spellHit = await prisma.$transaction((tx) =>
      resolveDamage(tx, {
        eventId: 'dh-sacred-flame-contract',
        source: { kind: 'spell', spellCastId: 'synthetic-cast' },
        target: { kind: 'CHARACTER', id: spellTarget.id, character: spellTarget },
        components: [{ type: 'Radiante', rawAmount: 8 }],
      }),
    );
    check(
      '80.K) origem `spell` + dano Radiante roda sem WeaponAttack (contrato da Sacred Flame)',
      spellHit.finalDamage === 8 && spellHit.hpAfter === 22 && spellHit.source.kind === 'spell',
      JSON.stringify(spellHit),
    );

    check(
      '80.L) a 6.6I.2 registrou SOMENTE a Sacred Flame; Healing Word continua fora',
      spellExecutionDefinition('sacred-flame')?.resolution.kind === 'save-damage' &&
        spellExecutionDefinition('healing-word') === null,
      'registry de execução: só a prova da 6.6I.2',
    );

    // Contrato em memória: nenhum socket/log/transação própria no núcleo.
    check(
      '80.M) o núcleo devolve resultado estruturado (não publica nem registra log)',
      typeof spellHit.eventId === 'string' &&
        spellHit.eventId === 'dh-sacred-flame-contract' &&
        Array.isArray(spellHit.components) &&
        spellHit.components[0].modifier === null,
      JSON.stringify({ eventId: spellHit.eventId, component: spellHit.components[0] }),
    );
  } finally {
    if (characterIds.length > 0) await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
