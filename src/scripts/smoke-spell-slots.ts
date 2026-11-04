import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { grantCastingComponents } from './spell-slot-fixtures.js';
import { seedSpellRepertoire } from './spell-slot-fixtures.js';
import { signToken } from '../lib/jwt.js';
import {
  multiclassCasterLevel,
  pactMagicSlots,
  spellSlotsForClasses,
  type ClassEntry,
} from '../modules/shared/classes.js';
import {
  castingResourcesForPools,
  eligibleCastingResources,
  selectCastingResource,
  type CastingResource,
} from '../modules/spells/execution/casting-resource.js';
import {
  pickCastingResource,
  resetCastingSlots,
  withSpatialEvidence,
} from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const entries = (list: ClassEntry[]): ClassEntry[] => list;

function maxAt(slots: { level: number; max: number }[], level: number): number {
  return slots.find((slot) => slot.level === level)?.max ?? 0;
}

/**
 * FASE 6.6C — SPELL SLOTS & CASTING RESOURCES.
 *
 * Cobre as TABELAS (PHB 2014), a escolha do espaço, o GASTO no commit, retry e
 * concorrência do último espaço, restauração por descanso e isolamento de NPC.
 * O espaço NUNCA é calculado no cliente: o máximo sai das classes/statblock e o
 * uso vive na ficha (ou na instância do NPC).
 */
export async function smokeSpellSlots(baseUrl: string, check: Check): Promise<void> {
  console.log('\n76.5) Fase 6.6C — Espaços de magia e recursos de conjuração');

  // =====================================================================
  // A — tabelas puras
  // =====================================================================
  const wizard1 = spellSlotsForClasses(entries([{ classKey: 'wizard', subclass: '', level: 1 }]));
  const wizard5 = spellSlotsForClasses(entries([{ classKey: 'wizard', subclass: '', level: 5 }]));
  const wizard20 = spellSlotsForClasses(entries([{ classKey: 'wizard', subclass: '', level: 20 }]));
  check(
    '76.5.A) tabela de conjurador completo (Mago 1/5/20) bate com o PHB',
    maxAt(wizard1, 1) === 2 &&
      maxAt(wizard5, 1) === 4 && maxAt(wizard5, 2) === 3 && maxAt(wizard5, 3) === 2 &&
      maxAt(wizard20, 1) === 4 && maxAt(wizard20, 5) === 3 && maxAt(wizard20, 9) === 1,
    JSON.stringify({ wizard1, wizard5, wizard20 }),
  );

  const paladin2 = spellSlotsForClasses(entries([{ classKey: 'paladin', subclass: '', level: 2 }]));
  const paladin5 = spellSlotsForClasses(entries([{ classKey: 'paladin', subclass: '', level: 5 }]));
  const ranger5 = spellSlotsForClasses(entries([{ classKey: 'ranger', subclass: '', level: 5 }]));
  const fighter3 = spellSlotsForClasses(entries([{ classKey: 'fighter', subclass: '', level: 3 }]));
  check(
    '76.5.B) meio-conjurador usa a PRÓPRIA tabela (Paladino 2 = 2; Paladino 5 = 4+2) e Guerreiro sem subclasse não conjura',
    maxAt(paladin2, 1) === 2 &&
      maxAt(paladin5, 1) === 4 && maxAt(paladin5, 2) === 2 &&
      maxAt(ranger5, 1) === 4 && maxAt(ranger5, 2) === 2 &&
      fighter3.length === 0,
    JSON.stringify({ paladin2, paladin5, ranger5, fighter3 }),
  );

  const warlock1 = pactMagicSlots(entries([{ classKey: 'warlock', subclass: '', level: 1 }]));
  const warlock11 = pactMagicSlots(entries([{ classKey: 'warlock', subclass: '', level: 11 }]));
  const warlock20 = pactMagicSlots(entries([{ classKey: 'warlock', subclass: '', level: 20 }]));
  check(
    '76.5.C) Magia de Pacto: 1 espaço de 1º no nível 1; 3 de 5º no 11; 4 de 5º no 20',
    warlock1?.max === 1 && warlock1.slotLevel === 1 &&
      warlock11?.max === 3 && warlock11.slotLevel === 5 &&
      warlock20?.max === 4 && warlock20.slotLevel === 5,
    JSON.stringify({ warlock1, warlock11, warlock20 }),
  );

  const wizardCleric = entries([
    { classKey: 'wizard', subclass: '', level: 3 },
    { classKey: 'cleric', subclass: '', level: 2 },
  ]);
  const combined = spellSlotsForClasses(wizardCleric);
  const rounding = spellSlotsForClasses(
    entries([
      { classKey: 'paladin', subclass: '', level: 5 },
      { classKey: 'wizard', subclass: '', level: 1 },
    ]),
  );
  const withWarlock = entries([
    { classKey: 'wizard', subclass: '', level: 2 },
    { classKey: 'warlock', subclass: '', level: 5 },
  ]);
  check(
    '76.5.D) multiclasse: pool ÚNICO (Mago 3/Clérigo 2 = conjurador 5); meio arredonda para BAIXO; Bruxo fica fora do total',
    multiclassCasterLevel(wizardCleric) === 5 &&
      maxAt(combined, 1) === 4 && maxAt(combined, 2) === 3 && maxAt(combined, 3) === 2 &&
      multiclassCasterLevel(entries([{ classKey: 'paladin', subclass: '', level: 5 }, { classKey: 'wizard', subclass: '', level: 1 }])) === 3 &&
      maxAt(rounding, 1) === 4 && maxAt(rounding, 2) === 2 &&
      multiclassCasterLevel(withWarlock) === 2 &&
      maxAt(spellSlotsForClasses(withWarlock), 1) === 3,
    JSON.stringify({ combined, rounding, withWarlock: multiclassCasterLevel(withWarlock) }),
  );

  // =====================================================================
  // B — escolha do recurso (puro)
  // =====================================================================
  const pool: CastingResource[] = castingResourcesForPools({
    spellSlots: [
      { level: 1, max: 4 },
      { level: 2, max: 3 },
      { level: 3, max: 2 },
    ],
    pactSlots: { max: 2, slotLevel: 2 },
    slotsUsed: { '1': 4, '2': 1 },
    pactUsed: 1,
  });
  const eligible = eligibleCastingResources(pool, 2);
  const explicit = selectCastingResource(pool, 2, { kind: 'spell-slot', level: 3 });
  const pactPick = selectCastingResource(pool, 2, { kind: 'pact-slot', level: 2 });
  const failureOf = (action: () => unknown): string => {
    try {
      action();
      return '';
    } catch (error) {
      return (error as Error).name;
    }
  };
  // 3 opções compatíveis: o servidor NUNCA escolhe sozinho; e o espaço abaixo do
  // nível da magia é inválido.
  const ambiguous = failureOf(() => selectCastingResource(pool, 2, undefined));
  const allEmpty = failureOf(() =>
    selectCastingResource(
      pool.map((item) => ({ ...item, remaining: 0 })),
      1,
      undefined,
    ),
  );
  const tooLow = failureOf(() =>
    selectCastingResource(pool, 2, { kind: 'spell-slot', level: 1 }),
  );
  const cantrip = selectCastingResource(pool, 0, undefined);
  check(
    '76.5.E) espaço abaixo do nível é inválido, vazio não é oferecido, truque não gasta e a escolha é por kind+level',
    eligible.map((item) => `${item.kind}:${item.level}`).join(',') === 'spell-slot:2,spell-slot:3,pact-slot:2' &&
      ambiguous === 'SPELLCASTING_RESOURCE_REQUIRED' &&
      allEmpty === 'SPELLCASTING_RESOURCE_NOT_AVAILABLE' &&
      tooLow === 'SPELLCASTING_RESOURCE_INVALID' &&
      explicit?.level === 3 &&
      pactPick?.kind === 'pact-slot' &&
      cantrip === null &&
      pool.every((item) => item.remaining >= 0 && item.remaining <= item.max),
    JSON.stringify({ eligible, ambiguous, allEmpty, tooLow, explicit, pactPick }),
  );

  // =====================================================================
  // HTTP — fixtures
  // =====================================================================
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const spellCastIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `sl_m_${suffix}`, displayName: 'Mestre Slots', passwordHash: 'fixture', role: 'MASTER' },
    });
    const casterUser = await prisma.user.create({
      data: { username: `sl_c_${suffix}`, displayName: 'Caster Slots', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `sl_t_${suffix}`, displayName: 'Alvo Slots', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, casterUser.id, targetUser.id);
    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });
    const casterToken = signToken({
      sub: casterUser.id, username: casterUser.username, displayName: casterUser.displayName, role: casterUser.role,
    });

    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Caster Slots',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        wisdom: 10,
        // 6.6F: Bless/Hold Person só existem pelas fontes que as LISTAM — a
        // progressão de espaços do Clérigo é a mesma do Mago, então as contas de
        // slot do smoke continuam idênticas.
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      },
    });
    const lastSlotCaster = await prisma.character.create({
      data: {
        userId: (await prisma.user.create({
          data: { username: `sl_l_${suffix}`, displayName: 'Último Slot', passwordHash: 'fixture', role: 'PLAYER' },
        })).id,
        name: 'Último Slot',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        intelligence: 16,
        classes: [{ classKey: 'cleric', subclass: '', level: 1 }],
      },
    });
    userIds.push((await prisma.character.findUniqueOrThrow({ where: { id: lastSlotCaster.id } })).userId);
    const target = await prisma.character.create({
      data: { userId: targetUser.id, name: 'Alvo Slots', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    characterIds.push(caster.id, lastSlotCaster.id, target.id);
    for (const id of [caster.id, lastSlotCaster.id]) {
      await seedSpellRepertoire({
        characterId: id,
        classKey: 'cleric',
        spellIds: ['bless', 'hold-person'],
      });
    }

    const shaman = await prisma.creature.create({
      data: {
        name: 'Xamã Slots',
        kind: 'NPC',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
        // 6.6F: o NPC só conjura o que o STATBLOCK declara no repertório.
        spellRepertoire: { spellIds: ['bless'] },
        spellcastingResources: { spellSlots: [{ level: 1, max: 2 }], pactSlot: null },
      },
    });
    const twin = await prisma.creature.create({
      data: {
        name: 'Xamã Slots Gêmeo',
        kind: 'NPC',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
        // 6.6F: o NPC só conjura o que o STATBLOCK declara no repertório.
        spellRepertoire: { spellIds: ['bless'] },
        spellcastingResources: { spellSlots: [{ level: 1, max: 2 }], pactSlot: null },
      },
    });
    const beast = await prisma.creature.create({
      data: { name: 'Besta Slots', kind: 'CREATURE', type: 'Besta', hpCurrent: 20, hpMax: 20, speed: 12 },
    });
    creatureIds.push(shaman.id, twin.id, beast.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds, creatures: creatureIds });

    const casterEntity = { kind: 'character' as const, id: caster.id };
    const targetEntity = { kind: 'character' as const, id: target.id };
    const shamanEntity = { kind: 'creature' as const, id: shaman.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(withSpatialEvidence(path, body)) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function resourcesOf(entity: { kind: string; id: string }) {
      const res = await request(`/spells/resources/${entity.kind}/${entity.id}`);
      return (res.data.resources ?? []) as { kind: string; level: number; max: number; remaining: number }[];
    }

    // =====================================================================
    // C — leitura MASTER-only e projeção derivada
    // =====================================================================
    const heroResources = await resourcesOf(casterEntity);
    const playerRead = await request(`/spells/resources/${casterEntity.kind}/${casterEntity.id}`, undefined, casterToken);
    check(
      '76.5.F) espaços derivados na leitura (Mago 5 = 4/3/2) e rota de recursos é MASTER-only',
      heroResources.length === 3 &&
        heroResources.every((item) => item.remaining === item.max) &&
        playerRead.status === 403,
      JSON.stringify({ heroResources, playerRead: playerRead.status }),
    );

    // =====================================================================
    // D — Hold Person gasta o espaço no COMMIT e o snapshot fica no cast
    // =====================================================================
    await resetCastingSlots(target.id);
    const slot2 = await pickCastingResource(baseUrl, masterToken, casterEntity, 2);
    const opD = randomUUID();
    const hold = await request('/effects/hold-person', {
      operationId: opD,
      caster: casterEntity,
      target: targetEntity,
      ...(slot2 ? { castingResource: slot2 } : {}),
    });
    if (hold.data?.cast?.id) spellCastIds.push(hold.data.cast.id);
    const afterHold = await resourcesOf(casterEntity);
    const holdRow = await prisma.spellCast.findUnique({ where: { operationId: opD } });
    const remainingOf = (level: number) => afterHold.find((item) => item.level === level)?.remaining;
    check(
      '76.5.G) Hold Person usa o espaço escolhido (nível >= 2), desconta UMA vez e grava o snapshot do recurso',
      hold.status === 201 &&
        slot2 !== null &&
        remainingOf(slot2!.level) ===
          (heroResources.find((item) => item.level === slot2!.level)?.remaining ?? 0) - 1 &&
        holdRow?.spellLevel === 2 &&
        holdRow?.castAtLevel === slot2!.level &&
        holdRow?.castingResourceKind === 'spell-slot' &&
        holdRow?.castingResourceLevel === slot2!.level &&
        holdRow?.resourceSpentAt !== null,
      JSON.stringify({ status: hold.status, slot2, afterHold, cast: holdRow }),
    );

    // =====================================================================
    // E — retry não gasta de novo (mesmo depois do cancelamento do pending)
    // =====================================================================
    await request(`/effects/pending/${hold.data.pending.id}/cancel`, {});
    const beforeRetry = await resourcesOf(casterEntity);
    const retry = await request('/effects/hold-person', {
      operationId: opD,
      caster: casterEntity,
      target: targetEntity,
      ...(slot2 ? { castingResource: slot2 } : {}),
    });
    const afterRetry = await resourcesOf(casterEntity);
    check(
      '76.5.H) retry com o mesmo operationId devolve o MESMO cast e NÃO gasta outro espaço; cancelar não devolve o gasto',
      retry.status === 200 &&
        retry.data.replayed === true &&
        retry.data.pending?.id === hold.data.pending.id &&
        retry.data.pending?.spellCastId === holdRow?.id &&
        JSON.stringify(beforeRetry) === JSON.stringify(afterRetry),
      JSON.stringify({ retry: retry.data.replayed, beforeRetry, afterRetry }),
    );

    // =====================================================================
    // F — payload malicioso / espaço inexistente / alvo inválido não gastam
    // =====================================================================
    const beforeMalicious = await resourcesOf(casterEntity);
    const malicious = await request('/effects/hold-person', {
      operationId: randomUUID(),
      caster: casterEntity,
      target: targetEntity,
      dc: 30,
      proficiencyBonus: 10,
      spellcastingAbility: 'charisma',
      castingResource: { kind: 'pact-slot', level: 9 },
    });
    const beastCast = await request('/effects/hold-person', {
      operationId: randomUUID(),
      caster: casterEntity,
      target: { kind: 'creature', id: beast.id },
      ...(slot2 ? { castingResource: slot2 } : {}),
    });
    const afterInvalid = await resourcesOf(casterEntity);
    check(
      '76.5.I) espaço de outro pool / CD inventada / alvo não humanoide são rejeitados antes do COMMIT e não gastam',
      malicious.status === 400 &&
        malicious.data.error === 'SPELLCASTING_RESOURCE_INVALID' &&
        beastCast.status === 409 &&
        beastCast.data.error === 'SPELL_TARGET_TYPE_INVALID' &&
        JSON.stringify(beforeMalicious) === JSON.stringify(afterInvalid) &&
        (await prisma.spellCast.count({ where: { casterEntityId: caster.id, status: 'resolving' } })) === 0,
      JSON.stringify({ malicious: malicious.data, beast: beastCast.data, beforeMalicious, afterInvalid }),
    );

    // =====================================================================
    // G — corrida do ÚLTIMO espaço (dois casts simultâneos, um vence)
    // =====================================================================
    const lastEntity = { kind: 'character' as const, id: lastSlotCaster.id };
    const firstSlot = await pickCastingResource(baseUrl, masterToken, lastEntity, 1);
    const firstSpend = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: lastEntity,
      targets: [targetEntity],
      ...(firstSlot ? { castingResource: firstSlot } : {}),
    });
    const lastRemaining = (await resourcesOf(lastEntity))[0]?.remaining ?? 0;
    const both = await Promise.all([
      request('/effects/bless', {
        operationId: randomUUID(),
        caster: lastEntity,
        targets: [targetEntity],
        ...(firstSlot ? { castingResource: firstSlot } : {}),
      }),
      request('/effects/bless', {
        operationId: randomUUID(),
        caster: lastEntity,
        targets: [targetEntity],
        ...(firstSlot ? { castingResource: firstSlot } : {}),
      }),
    ]);
    const statuses = both.map((item) => item.status).sort();
    const lastRow = await prisma.character.findUniqueOrThrow({ where: { id: lastSlotCaster.id } });
    const lastSpells = lastRow.spells as { slotsUsed?: Record<string, number> };
    check(
      '76.5.J) dois casts disputando o último espaço: um vence, o outro recebe 409, nunca há remaining negativo',
      firstSpend.status === 201 &&
        lastRemaining === 1 &&
        statuses.join(',') === '201,409' &&
        (both[0].status === 409 || both[1].status === 409) &&
        (await resourcesOf(lastEntity))[0]?.remaining === 0 &&
        (lastSpells.slotsUsed?.['1'] ?? 0) === 2,
      JSON.stringify({ firstSpend: firstSpend.status, lastRemaining, statuses, lastSpells }),
    );

    // =====================================================================
    // H — NPC: uso é da entidade (gêmeo do mesmo statblock fica intocado)
    // =====================================================================
    const npcSlot = await pickCastingResource(baseUrl, masterToken, shamanEntity, 1);
    const npcCast = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: shamanEntity,
      targets: [targetEntity],
      ...(npcSlot ? { castingResource: npcSlot } : {}),
    });
    const shamanRow = await prisma.creature.findUniqueOrThrow({ where: { id: shaman.id } });
    const twinRow = await prisma.creature.findUniqueOrThrow({ where: { id: twin.id } });
    check(
      '76.5.K) NPC conjura com o espaço DECLARADO no statblock e o gêmeo do mesmo statblock permanece com os seus',
      npcCast.status === 201 &&
        npcSlot?.level === 1 &&
        (shamanRow.spellcastingUsed as { spellSlotsUsed?: Record<string, number> }).spellSlotsUsed?.['1'] === 1 &&
        JSON.stringify(twinRow.spellcastingUsed) === '{}' &&
        (await resourcesOf({ kind: 'creature', id: twin.id }))[0]?.remaining === 2,
      JSON.stringify({ npcCast: npcCast.status, shaman: shamanRow.spellcastingUsed, twin: twinRow.spellcastingUsed }),
    );

    // =====================================================================
    // I — Histórico imutável depois do descanso
    // =====================================================================
    await resetCastingSlots(caster.id);
    const afterRest = await resourcesOf(casterEntity);
    const historical = await prisma.spellCast.findUniqueOrThrow({ where: { operationId: opD } });
    check(
      '76.5.L) descanso restaura os espaços, mas o cast histórico continua apontando o espaço ORIGINALMENTE gasto',
      afterRest.every((item) => item.remaining === item.max) &&
        historical.castingResourceLevel === slot2!.level &&
        historical.castAtLevel === slot2!.level,
      JSON.stringify({ afterRest, historical: { level: historical.castingResourceLevel } }),
    );

    // =====================================================================
    // J — PLAYER continua sem conjurar
    // =====================================================================
    const playerCast = await request('/effects/bless', {
      operationId: randomUUID(),
      caster: casterEntity,
      targets: [target],
    }, casterToken);
    check(
      '76.5.M) PLAYER continua 403 para conjurar, mesmo com espaços visíveis na ficha',
      playerCast.status === 403,
      String(playerCast.status),
    );
  } finally {
    const ids = [...characterIds, ...creatureIds];
    await prisma.effectInstance.deleteMany({
      where: { OR: [{ targetEntityId: { in: ids } }, { sourceEntityId: { in: ids } }] },
    });
    await prisma.pendingEffectSave.deleteMany({ where: { targetEntityId: { in: ids } } });
    await prisma.spellCast.deleteMany({ where: { casterEntityId: { in: ids } } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
