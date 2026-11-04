import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { seedSpellRepertoire } from './spell-slot-fixtures.js';
import { signToken } from '../lib/jwt.js';
import {
  pickCastingResource,
  resetCastingSlots,
  withSpatialEvidence,
} from './spell-slot-fixtures.js';
import {
  characterLevelOf,
  characterSpellcastingProfile,
  creatureSpellcastingProfile,
  spellAttackBonusFrom,
  spellSaveDcFrom,
  spellcastingSourcesForCharacter,
  spellcastingStartsAtLevel,
} from '../modules/spells/execution/spellcasting-source.js';
import type { PendingEffectSaveDto } from '../modules/effects/pending-effect-saves.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6B — SPELLCASTING ABILITY, SPELL SAVE DC & SPELL ATTACK BONUS.
 *
 * Prova que a matemática de conjuração é SERVER-SIDE e depende da FONTE:
 *  • personagem DERIVA 8 + proficiência (nível TOTAL) + atributo da fonte;
 *  • multiclasse usa INT no Mago e SAB no Clérigo com o MESMO bônus de proficiência;
 *  • Fighter/Rogue comuns não são fonte; Cavaleiro Arcano/Trapaceiro Arcano são
 *    (INT, a partir do nível 3); Paladino/Patrulheiro só do nível 2 em diante;
 *  • criatura usa os valores EXPLÍCITOS do statblock, sem recálculo;
 *  • o cliente não envia CD/atributo/proficiência e o snapshot do cast é imutável.
 *
 * Não testa (por escopo): slots, Ação, preparação, alcance, componentes, duração,
 * spell attack real e conjuração de PLAYER.
 */
export async function smokeSpellcastingProfile(baseUrl: string, check: Check): Promise<void> {
  console.log('\n76) Fase 6.6B — Perfil de conjuração (CD e ataque mágico server-side)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const operationIds: string[] = [];
  const castIds: string[] = [];
  const groupIds: string[] = [];
  let combatId: string | undefined;

  try {
    // =====================================================================
    // A — matemática PURA (PHB 2014)
    // =====================================================================
    check(
      '76.A) fórmulas puras: 8 + PB + mod e PB + mod (incluindo modificador NEGATIVO, sem clamp)',
      spellSaveDcFrom(3, 4) === 15 &&
        spellAttackBonusFrom(3, 4) === 7 &&
        spellSaveDcFrom(2, -1) === 9 &&
        spellAttackBonusFrom(2, -1) === 1 &&
        spellSaveDcFrom(2, 10) === 20,
      JSON.stringify({
        dc: spellSaveDcFrom(3, 4),
        attack: spellAttackBonusFrom(3, 4),
        negativeDc: spellSaveDcFrom(2, -1),
        negativeAttack: spellAttackBonusFrom(2, -1),
      }),
    );

    // =====================================================================
    // B — FONTES por classe/subclasse (registry canônico, sem `if className`)
    // =====================================================================
    const classesOf = (classKey: string, level: number, subclass = '') => [
      { classKey, subclass, level },
    ];
    const abilityOf = (classKey: string, level = 1, subclass = '') =>
      spellcastingSourcesForCharacter({ classes: classesOf(classKey, level, subclass) })[0]?.ability ??
      null;
    const wizardSources = spellcastingSourcesForCharacter({ classes: classesOf('wizard', 1) });
    const clericSources = spellcastingSourcesForCharacter({ classes: classesOf('cleric', 1) });
    const paladinOne = spellcastingSourcesForCharacter({ classes: classesOf('paladin', 1) });
    const paladinTwo = spellcastingSourcesForCharacter({ classes: classesOf('paladin', 2) });
    const rangerOne = spellcastingSourcesForCharacter({ classes: classesOf('ranger', 1) });
    const rangerTwo = spellcastingSourcesForCharacter({ classes: classesOf('ranger', 2) });
    const fighter = spellcastingSourcesForCharacter({ classes: classesOf('fighter', 5) });
    const knightTwo = spellcastingSourcesForCharacter({ classes: classesOf('fighter', 2, 'eldritch-knight') });
    const knightThree = spellcastingSourcesForCharacter({
      classes: classesOf('fighter', 3, 'eldritch-knight'),
    });
    check(
      '76.B) classe declara o atributo (INT/SAB/CAR); Fighter/Rogue comuns NÃO são fonte',
      abilityOf('wizard') === 'intelligence' &&
        abilityOf('cleric') === 'wisdom' &&
        abilityOf('druid') === 'wisdom' &&
        abilityOf('bard') === 'charisma' &&
        abilityOf('sorcerer') === 'charisma' &&
        abilityOf('warlock') === 'charisma' &&
        abilityOf('paladin', 2) === 'charisma' &&
        abilityOf('ranger', 2) === 'wisdom' &&
        wizardSources.length === 1 &&
        wizardSources[0].id === 'wizard' &&
        clericSources[0].id === 'cleric' &&
        fighter.length === 0,
      JSON.stringify({ wizardSources, clericSources, fighter }),
    );
    check(
      '76.C) nível de início da conjuração por TIPO: Paladino/Patrulheiro no 2º, terço-conjurador no 3º',
      paladinOne.length === 0 &&
        paladinTwo.length === 1 &&
        rangerOne.length === 0 &&
        rangerTwo.length === 1 &&
        knightTwo.length === 0 &&
        knightThree.length === 1 &&
        knightThree[0].kind === 'subclass' &&
        knightThree[0].ability === 'intelligence' &&
        spellcastingStartsAtLevel('full') === 1 &&
        spellcastingStartsAtLevel('half') === 2 &&
        spellcastingStartsAtLevel('third') === 3,
      JSON.stringify({ paladinOne, paladinTwo, knightTwo, knightThree }),
    );

    // =====================================================================
    // D — MULTICLASSE: mesma ficha, fontes e matemáticas diferentes
    // =====================================================================
    const multiclass = {
      classes: [
        { classKey: 'wizard', subclass: '', level: 3 },
        { classKey: 'cleric', subclass: '', level: 2 },
      ],
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 16,
      wisdom: 14,
      charisma: 8,
    };
    const multiclassSources = spellcastingSourcesForCharacter(multiclass);
    const wizardProfile = characterSpellcastingProfile(multiclass, multiclassSources[0]);
    const clericProfile = characterSpellcastingProfile(multiclass, multiclassSources[1]);
    check(
      '76.D) Wizard 3 / Cleric 2: PB do nível TOTAL (+3) para as duas fontes, com INT e SAB diferentes',
      characterLevelOf(multiclass.classes) === 5 &&
        multiclassSources.length === 2 &&
        wizardProfile.spellSaveDc === 14 &&
        wizardProfile.spellAttackBonus === 6 &&
        clericProfile.spellSaveDc === 13 &&
        clericProfile.spellAttackBonus === 5 &&
        wizardProfile.proficiencyBonus === 3 &&
        clericProfile.proficiencyBonus === 3 &&
        wizardProfile.ability === 'intelligence' &&
        clericProfile.ability === 'wisdom',
      JSON.stringify({ wizardProfile, clericProfile }),
    );
    const weakProfile = characterSpellcastingProfile(
      { ...multiclass, classes: classesOf('wizard', 1), intelligence: 8 },
      spellcastingSourcesForCharacter({ classes: classesOf('wizard', 1) })[0],
    );
    check(
      '76.D.1) atributo baixo NÃO é clampado (INT 8, nível 1 → CD 9 / ataque +1)',
      weakProfile.spellSaveDc === 9 && weakProfile.spellAttackBonus === 1,
      JSON.stringify(weakProfile),
    );

    // =====================================================================
    // E — perfil EXPLÍCITO de criatura (statblock é a autoridade)
    // =====================================================================
    const explicitProfile = creatureSpellcastingProfile({
      spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
    });
    const missingProfile = creatureSpellcastingProfile({ spellcastingProfile: {} });
    check(
      '76.E) statblock explícito é a autoridade (CD 15 / ataque +7); sem CD não há fonte',
      explicitProfile?.mode === 'explicit' &&
        explicitProfile.spellSaveDc === 15 &&
        explicitProfile.spellAttackBonus === 7 &&
        explicitProfile.ability === 'charisma' &&
        missingProfile === null,
      JSON.stringify({ explicitProfile, missingProfile }),
    );

    // =====================================================================
    // HTTP — fixtures
    // =====================================================================
    const master = await prisma.user.create({
      data: { username: `sp_m_${suffix}`, displayName: 'Mestre Perfil', passwordHash: 'fixture', role: 'MASTER' },
    });
    const multiUser = await prisma.user.create({
      data: { username: `sp_c_${suffix}`, displayName: 'Multiclasse', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `sp_t_${suffix}`, displayName: 'Alvo Perfil', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const noCasterUser = await prisma.user.create({
      data: { username: `sp_f_${suffix}`, displayName: 'Sem Conjuração', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, multiUser.id, targetUser.id, noCasterUser.id);

    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });
    const multiToken = signToken({
      sub: multiUser.id, username: multiUser.username, displayName: multiUser.displayName, role: multiUser.role,
    });

    const multiCaster = await prisma.character.create({
      data: {
        userId: multiUser.id,
        name: 'Multiclasse Perfil',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        wisdom: 14,
        charisma: 8,
        // 6.6F: Clérigo 3 dá acesso a magias de nível 2 (Hold Person), permitindo
        // a MESMA magia preparada em DUAS fontes. PB/CD continuam iguais.
        classes: [
          { classKey: 'wizard', subclass: '', level: 3 },
          { classKey: 'cleric', subclass: '', level: 3 },
        ],
      },
    });
    const fighterCaster = await prisma.character.create({
      data: {
        userId: noCasterUser.id,
        name: 'Guerreiro Perfil',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        classes: [{ classKey: 'fighter', subclass: '', level: 3 }],
      },
    });
    const target = await prisma.character.create({
      data: { userId: targetUser.id, name: 'Alvo Perfil', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    characterIds.push(multiCaster.id, fighterCaster.id, target.id);
    // 6.6F: a MESMA magia preparada em DUAS fontes — cada uma com seu atributo.
    await seedSpellRepertoire({
      characterId: multiCaster.id,
      classKey: 'wizard',
      spellIds: ['hold-person'],
    });
    await seedSpellRepertoire({
      characterId: multiCaster.id,
      classKey: 'cleric',
      spellIds: ['bless', 'hold-person'],
    });

    const casterCreature = await prisma.creature.create({
      data: {
        name: 'Xamã Perfil',
        kind: 'NPC',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
        // 6.6F: repertório explícito do statblock (a CD continua vindo do perfil).
        spellRepertoire: { spellIds: ['hold-person'] },
        // 6.6C: sem espaços declarados o NPC não conjura (nem "de graça").
        spellcastingResources: { spellSlots: [{ level: 1, max: 4 }, { level: 2, max: 4 }], pactSlot: null },
      },
    });
    const muteCreature = await prisma.creature.create({
      data: { name: 'Besta Muda', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 20, hpMax: 20, speed: 9 },
    });
    creatureIds.push(casterCreature.id, muteCreature.id);

    const multiEntity = { kind: 'character' as const, id: multiCaster.id };
    const fighterEntity = { kind: 'character' as const, id: fighterCaster.id };
    const targetEntity = { kind: 'character' as const, id: target.id };
    const shamanEntity = { kind: 'creature' as const, id: casterCreature.id };
    const muteEntity = { kind: 'creature' as const, id: muteCreature.id };

    async function request(
      path: string,
      body?: unknown,
      token = masterToken,
      method?: 'GET' | 'POST' | 'DELETE',
    ) {
      const verb = method ?? (body === undefined ? 'GET' : 'POST');
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: verb,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(withSpatialEvidence(path, body)) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    function newOperation(): string {
      const id = randomUUID();
      operationIds.push(id);
      return id;
    }

    async function sourcesOf(entity: { kind: string; id: string }, token = masterToken) {
      return request(`/spells/sources/${entity.kind}/${entity.id}`, undefined, token);
    }

    async function holdPerson(
      caster: { kind: string; id: string },
      spellcastingSource?: { kind: string; id: string },
      extra: Record<string, unknown> = {},
      operationId = newOperation(),
    ) {
      // 6.6C: Hold Person exige espaço real de nível >= 2. Este smoke é sobre
      // PERFIL, então o uso é zerado antes de cada conjuração (equivalente a um
      // descanso longo); a capacidade continua DERIVADA das classes.
      if (caster.kind === 'character') await resetCastingSlots(caster.id);
      const castingResource = await pickCastingResource(baseUrl, masterToken, caster, 2);
      const result = await request('/effects/hold-person', {
        operationId,
        caster,
        target: targetEntity,
        ...(spellcastingSource ? { spellcastingSource } : {}),
        ...(castingResource ? { castingResource } : {}),
        ...extra,
      });
      if (result.data?.cast?.id) castIds.push(result.data.cast.id);
      return { ...result, operationId };
    }

    async function cancelPending(pending: PendingEffectSaveDto | undefined) {
      if (!pending) return;
      await request(`/effects/pending/${pending.id}/cancel`, {}, masterToken);
    }

    async function castRow(operationId: string) {
      return prisma.spellCast.findUnique({ where: { operationId } });
    }

    // =====================================================================
    // F — endpoint de fontes: MASTER-only, com CD/ataque derivados
    // =====================================================================
    const multiSources = await sourcesOf(multiEntity);
    const playerSources = await sourcesOf(multiEntity, multiToken);
    const fighterSources = await sourcesOf(fighterEntity);
    const shamanSources = await sourcesOf(shamanEntity);
    const muteSources = await sourcesOf(muteEntity);
    check(
      '76.F) GET de fontes é MASTER-only e devolve a CD/ataque DERIVADOS por fonte',
      multiSources.status === 200 &&
        multiSources.data.sources.length === 2 &&
        multiSources.data.sources[0].spellSaveDc === 14 &&
        multiSources.data.sources[0].spellAttackBonus === 6 &&
        multiSources.data.sources[1].spellSaveDc === 13 &&
        multiSources.data.sources[1].spellAttackBonus === 5 &&
        playerSources.status === 403 &&
        fighterSources.data.sources.length === 0 &&
        shamanSources.data.sources.length === 1 &&
        shamanSources.data.sources[0].spellSaveDc === 15 &&
        muteSources.data.sources.length === 0,
      JSON.stringify({ multi: multiSources.data, player: playerSources.status, shaman: shamanSources.data }),
    );

    // =====================================================================
    // G — multiclasse SEM escolha → exige fonte; fonte de outra classe → inválida
    // =====================================================================
    const missingSource = await holdPerson(multiEntity);
    const invalidSource = await holdPerson(multiEntity, { kind: 'class', id: 'bard' });
    const fighterCast = await holdPerson(fighterEntity);
    check(
      '76.G) multiclasse sem escolha → SPELLCASTING_SOURCE_REQUIRED; fonte inexistente → INVALID; sem fonte → NOT_AVAILABLE (nada commitado)',
      missingSource.status === 400 &&
        missingSource.data.error === 'SPELLCASTING_SOURCE_REQUIRED' &&
        invalidSource.status === 400 &&
        invalidSource.data.error === 'SPELLCASTING_SOURCE_INVALID' &&
        fighterCast.status === 409 &&
        fighterCast.data.error === 'SPELLCASTING_SOURCE_NOT_AVAILABLE' &&
        (await castRow(missingSource.operationId)) === null &&
        (await castRow(invalidSource.operationId)) === null &&
        (await castRow(fighterCast.operationId)) === null,
      JSON.stringify({ missing: missingSource.data, invalid: invalidSource.data, fighter: fighterCast.data }),
    );

    // =====================================================================
    // H — Bless: a FONTE precisa autorizar (Mago não lista Bless) e o snapshot
    //     grava a matemática da fonte que realmente conjurou
    // =====================================================================
    const opBlessWizard = newOperation();
    await resetCastingSlots(multiCaster.id);
    const wizardBlessSlot = await pickCastingResource(baseUrl, masterToken, multiEntity, 1);
    const wizardBless = await request('/effects/bless', {
      operationId: opBlessWizard,
      caster: multiEntity,
      targets: [targetEntity],
      spellcastingSource: { kind: 'class', id: 'wizard' },
      ...(wizardBlessSlot ? { castingResource: wizardBlessSlot } : {}),
    });
    const opBless = newOperation();
    const blessSlot = await pickCastingResource(baseUrl, masterToken, multiEntity, 1);
    const blessCast = await request('/effects/bless', {
      operationId: opBless,
      caster: multiEntity,
      targets: [targetEntity],
      spellcastingSource: { kind: 'class', id: 'cleric' },
      ...(blessSlot ? { castingResource: blessSlot } : {}),
    });
    const blessRow = await prisma.spellCast.findUnique({ where: { operationId: opBless } });
    if (blessCast.data?.groupId) groupIds.push(blessCast.data.groupId);
    check(
      '76.H) Bless por Mago é RECUSADA (executável ≠ disponível) e a fonte Clérigo grava SAB 14 (+2), PB +3, CD 13, ataque +5',
      wizardBless.status === 409 &&
        wizardBless.data.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE' &&
        (await castRow(opBlessWizard)) === null &&
        blessCast.status === 201 &&
        blessRow?.spellcastingSourceKind === 'class' &&
        blessRow?.spellcastingSourceId === 'cleric' &&
        blessRow?.spellcastingMode === 'derived' &&
        blessRow?.spellcastingAbility === 'wisdom' &&
        blessRow?.spellcastingAbilityScore === 14 &&
        blessRow?.spellcastingAbilityModifier === 2 &&
        blessRow?.spellcastingProficiencyBonus === 3 &&
        blessRow?.saveDc === 13 &&
        blessRow?.spellSaveDc === 13 &&
        blessRow?.spellAttackBonus === 5,
      JSON.stringify({ wizard: wizardBless.data, status: blessCast.status, cast: blessRow }),
    );

    // =====================================================================
    // I — fonte inválida NÃO encerra a Concentração anterior
    // =====================================================================
    const concentrationBefore = await prisma.character.findUniqueOrThrow({ where: { id: multiCaster.id } });
    const concentrationState = concentrationBefore.mechanicalState as {
      concentration?: { sourceId?: string } | null;
    };
    const invalidWhileConcentrating = await holdPerson(multiEntity, { kind: 'class', id: 'bard' });
    const concentrationAfter = await prisma.character.findUniqueOrThrow({ where: { id: multiCaster.id } });
    const concentrationStateAfter = concentrationAfter.mechanicalState as {
      concentration?: { sourceId?: string } | null;
    };
    check(
      '76.I) cast INVÁLIDO não commita e mantém a concentração anterior intacta',
      blessCast.status === 201 &&
        concentrationState.concentration?.sourceId === blessCast.data.groupId &&
        invalidWhileConcentrating.status === 400 &&
        concentrationStateAfter.concentration?.sourceId === blessCast.data.groupId,
      JSON.stringify({ before: concentrationState.concentration, after: concentrationStateAfter.concentration }),
    );

    // =====================================================================
    // J — a pendência usa a CD da FONTE escolhida (Mago 14 / Clérigo 13)
    // =====================================================================
    const wizardApply = await holdPerson(multiEntity, { kind: 'class', id: 'wizard' });
    const wizardDc = wizardApply.data.pending?.dc as number | undefined;
    const clericApply = await holdPerson(multiEntity, { kind: 'subclass', id: 'cleric' });
    check(
      '76.J) Hold Person usa a CD do PERFIL (Mago 14); fonte fora da ficha → inválida (nunca "a primeira")',
      wizardApply.status === 201 &&
        wizardDc === 14 &&
        clericApply.status === 400 &&
        clericApply.data.error === 'SPELLCASTING_SOURCE_INVALID' &&
        wizardApply.data.pending.ability === 'wisdom',
      JSON.stringify({ wizard: wizardApply.data.pending, cleric: clericApply.data }),
    );
    await cancelPending(wizardApply.data.pending);

    // =====================================================================
    // K — a pendência do CLÉRIGO usa SAB (CD 13) na MESMA ficha
    // =====================================================================
    const clericApply2 = await holdPerson(multiEntity, { kind: 'class', id: 'cleric' });
    check(
      '76.K) mesma ficha, fonte Clérigo → CD 13 (SAB 14 +2), não a matemática do Mago',
      clericApply2.status === 201 && clericApply2.data.pending.dc === 13,
      JSON.stringify(clericApply2.data.pending),
    );
    await cancelPending(clericApply2.data.pending);

    // =====================================================================
    // L — snapshot NÃO é recalculado: mudar atributo/retry
    // =====================================================================
    const opSnapshot = newOperation();
    const snapshotApply = await holdPerson(
      multiEntity,
      { kind: 'class', id: 'wizard' },
      {},
      opSnapshot,
    );
    const snapshotCast = await castRow(opSnapshot);
    await prisma.character.update({ where: { id: multiCaster.id }, data: { intelligence: 18 } });
    const snapshotPending = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: snapshotApply.data.pending.id },
    });
    // Cancela para liberar o lock de UM cast resolving por caster; o retry do
    // mesmo operationId continua devolvendo o snapshot ORIGINAL.
    await cancelPending(snapshotApply.data.pending);
    // O espaço faz parte do fingerprint (6.6C): o retry reenvia o MESMO recurso
    // gravado no cast original.
    const snapshotSlot = snapshotCast?.castingResourceKind
      ? {
          kind: snapshotCast.castingResourceKind as 'spell-slot' | 'pact-slot',
          level: snapshotCast.castingResourceLevel ?? 2,
        }
      : undefined;
    const retrySnapshot = await request('/effects/hold-person', {
      operationId: opSnapshot,
      caster: multiEntity,
      target: targetEntity,
      spellcastingSource: { kind: 'class', id: 'wizard' },
      ...(snapshotSlot ? { castingResource: snapshotSlot } : {}),
    });
    const newApply = await holdPerson(multiEntity, { kind: 'class', id: 'wizard' });
    check(
      '76.L) retry devolve a MESMA pendência/CD 14 após INT 16→18; um NOVO cast já usa CD 15',
      snapshotCast?.saveDc === 14 &&
        retrySnapshot.status === 200 &&
        retrySnapshot.data.pending.id === snapshotApply.data.pending.id &&
        retrySnapshot.data.pending.dc === 14 &&
        snapshotPending.dc === 14 &&
        newApply.status === 201 &&
        newApply.data.pending.dc === 15,
      JSON.stringify({ old: snapshotPending.dc, replay: retrySnapshot.data.pending?.dc, fresh: newApply.data.pending?.dc }),
    );
    await cancelPending(newApply.data.pending);

    // =====================================================================
    // M — payload malicioso não altera CD/atributo/proficiência
    // =====================================================================
    const malicious = await holdPerson(
      multiEntity,
      { kind: 'class', id: 'wizard' },
      { dc: 30, spellcastingAbility: 'charisma', proficiencyBonus: 10, spellAttackBonus: 20 },
    );
    const maliciousCast = await castRow(malicious.operationId);
    check(
      '76.M) cliente tentando impor CD/atributo/PB/ataque mágico é IGNORADO (CD 15, INT, PB +3)',
      malicious.status === 201 &&
        malicious.data.pending.dc === 15 &&
        maliciousCast?.spellcastingAbility === 'intelligence' &&
        maliciousCast?.spellcastingProficiencyBonus === 3 &&
        maliciousCast?.spellAttackBonus === 7 &&
        maliciousCast?.saveDc === 15,
      JSON.stringify({ pending: malicious.data.pending, cast: maliciousCast }),
    );
    await cancelPending(malicious.data.pending);

    // =====================================================================
    // N — criatura: statblock explícito (CD 15) e criatura sem perfil
    // =====================================================================
    const shamanApply = await holdPerson(shamanEntity);
    const shamanCast = await castRow(shamanApply.operationId);
    const muteApply = await holdPerson(muteEntity);
    check(
      '76.N) NPC usa a CD EXPLÍCITA do statblock (15/ataque +7) e criatura sem perfil é rejeitada antes do commit',
      shamanApply.status === 201 &&
        shamanApply.data.pending.dc === 15 &&
        shamanCast?.spellcastingMode === 'explicit' &&
        shamanCast?.spellcastingSourceKind === 'creature' &&
        shamanCast?.spellcastingSourceId === 'statblock' &&
        shamanCast?.spellSaveDc === 15 &&
        shamanCast?.spellAttackBonus === 7 &&
        muteApply.status === 409 &&
        muteApply.data.error === 'SPELLCASTING_SOURCE_NOT_AVAILABLE' &&
        (await castRow(muteApply.operationId)) === null,
      JSON.stringify({ shaman: shamanApply.data.pending, mute: muteApply.data, cast: shamanCast }),
    );
    await cancelPending(shamanApply.data.pending);

    // =====================================================================
    // O — instância de combate: perfil do TEMPLATE, cast da INSTÂNCIA
    // =====================================================================
    const combat = await prisma.combat.create({
      data: {
        status: 'ENDED',
        combatants: {
          create: [
            {
              kind: 'CREATURE',
              creatureId: casterCreature.id,
              name: casterCreature.name,
              hpCurrent: 20,
              hpMax: 20,
              armorClass: 10,
              initiative: 5,
              dexterityMod: 1,
            },
          ],
        },
      },
    });
    combatId = combat.id;
    const instance = await prisma.combatant.findFirstOrThrow({ where: { combatId, creatureId: casterCreature.id } });
    const instanceEntity = { kind: 'combatant' as const, id: instance.id };
    const instanceApply = await holdPerson(instanceEntity);
    const instanceCast = await castRow(instanceApply.operationId);
    const instanceCasts = await prisma.spellCast.count({
      where: { casterEntityKind: 'combatant', casterEntityId: instance.id },
    });
    check(
      '76.O) instância de combate usa o perfil do TEMPLATE, mas o SpellCast pertence à INSTÂNCIA',
      instanceApply.status === 201 &&
        instanceApply.data.pending.dc === 15 &&
        instanceCast?.casterEntityKind === 'combatant' &&
        instanceCast?.casterEntityId === instance.id &&
        instanceCasts === 1,
      JSON.stringify({ cast: instanceCast, instanceCasts }),
    );
    await cancelPending(instanceApply.data.pending);

    // =====================================================================
    // P — nenhum slot/Ação consumido e SpellExecutionDefinition sem atributo
    // =====================================================================
    const before = await prisma.character.findUniqueOrThrow({ where: { id: multiCaster.id } });
    const noEconomy = await holdPerson(multiEntity, { kind: 'class', id: 'wizard' });
    const after = await prisma.character.findUniqueOrThrow({ where: { id: multiCaster.id } });
    check(
      '76.P) proof cast continua sem consumir Ação (espaço é gasto, classState/HP intactos — 6.6D)',
      noEconomy.status === 201 &&
        JSON.stringify(before.classState) === JSON.stringify(after.classState) &&
        before.hpCurrent === after.hpCurrent,
      JSON.stringify({ pending: noEconomy.data.pending }),
    );
    await cancelPending(noEconomy.data.pending);
  } finally {
    const casts = await prisma.spellCast.findMany({
      where: { operationId: { in: operationIds } },
      select: { id: true, effectGroupId: true },
    });
    const ids = casts.map((row) => row.id);
    const groups = [
      ...groupIds,
      ...casts.map((row) => row.effectGroupId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    ];
    if (ids.length > 0) {
      await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: ids } } });
    }
    if (groups.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { groupId: { in: groups } } });
    }
    const entityIds = [...characterIds, ...creatureIds];
    if (entityIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { targetEntityId: { in: entityIds } } });
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (operationIds.length > 0) {
      await prisma.spellCast.deleteMany({ where: { operationId: { in: operationIds } } });
      await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    }
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
