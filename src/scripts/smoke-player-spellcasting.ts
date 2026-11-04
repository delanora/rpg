import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { grantCastingComponents } from './spell-slot-fixtures.js';
import { signToken } from '../lib/jwt.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { activatePreparationPlans } from '../modules/spells/execution/preparation-plan.js';
import { pickCastingResource, seedSpellRepertoire } from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const EVIDENCE = { withinRange: true, sight: true, clearPath: true, groupDistance: true };

/**
 * FASE 6.6F — CONJURAÇÃO DO JOGADOR e AUTORIZAÇÃO DE REPERTÓRIO.
 *
 * Prova que a pergunta "a engine sabe executar?" não autoriza nada por si só:
 *  • fonte precisa LISTAR a magia (Bless não é do Mago);
 *  • Mago exige grimório + preparação ACTIVE (registrada ≠ preparada);
 *  • PLANEJADO não autoriza antes do Descanso Longo, e o Descanso Longo ativa;
 *  • PLAYER só conjura o próprio personagem e nunca confirma requisito espacial;
 *  • sem geometria confiável, o cast do jogador vira INTENÇÃO (202) com ZERO
 *    custo; a aprovação do Mestre REVALIDA e só então commita (um cast só).
 */
export async function smokePlayerSpellcasting(baseUrl: string, check: Check): Promise<void> {
  console.log('\n76.P) Fase 6.6F — conjuração do jogador e repertório');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const intents: string[] = [];
  const castCasters: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `psc_m_${suffix}`, displayName: 'Mestre PSC', passwordHash: 'fixture', role: 'MASTER' },
    });
    const owner = await prisma.user.create({
      data: { username: `psc_o_${suffix}`, displayName: 'Dono PSC', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const other = await prisma.user.create({
      data: { username: `psc_x_${suffix}`, displayName: 'Outro PSC', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, owner.id, other.id);

    const token = (user: { id: string; username: string; displayName: string; role: 'MASTER' | 'PLAYER' }) =>
      signToken({ sub: user.id, username: user.username, displayName: user.displayName, role: user.role });
    const masterToken = token(master);
    const ownerToken = token(owner);
    const otherToken = token(other);

    const cleric = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Clérigo PSC',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 16,
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      },
    });
    const wizard = await prisma.character.create({
      data: {
        userId: other.id,
        name: 'Mago PSC',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        classes: [{ classKey: 'wizard', subclass: '', level: 3 }],
      },
    });
    characterIds.push(cleric.id, wizard.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds });
    castCasters.push(cleric.id, wizard.id);

    const request = async (
      path: string,
      body: unknown,
      authToken = masterToken,
      method?: 'GET' | 'POST' | 'PUT',
    ) => {
      const verb = method ?? (body === undefined ? 'GET' : 'POST');
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: verb,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (data?.intent?.id) intents.push(data.intent.id);
      return { status: res.status, data };
    };

    const spellsOf = async (id: string) => {
      const row = await prisma.character.findUniqueOrThrow({ where: { id }, select: { spells: true } });
      return (row.spells ?? {}) as any;
    };
    const castCount = (casterId: string) =>
      prisma.spellCast.count({ where: { casterEntityId: casterId } });

    // =====================================================================
    // A) Repertório: limite por FONTE (Clérigo 5 + SAB 16 = 8)
    // =====================================================================
    await seedSpellRepertoire({ characterId: cleric.id, classKey: 'cleric', spellIds: ['bless'] });
    const repertoire = await request(`/spells/repertoire/${cleric.id}`, undefined, ownerToken);
    const clericSource = repertoire.data.sources?.[0];
    check(
      '76.P.1) repertório é POR FONTE: limite manual = nível da classe + modificador (5+3=8)',
      repertoire.status === 200 && clericSource?.manualLimit === 8 && clericSource?.mode === 'prepared-list',
      JSON.stringify({ status: repertoire.status, source: clericSource }),
    );
    check(
      '76.P.2) Bless preparada aparece como conjurável e executável',
      clericSource?.entries?.some(
        (entry: any) => entry.spellId === 'bless' && entry.active && entry.executable,
      ) === true,
      JSON.stringify(clericSource?.entries),
    );

    // =====================================================================
    // B) PLAYER só conjura o PRÓPRIO personagem
    // =====================================================================
    const foreign = await request(
      '/spells/cast',
      { operationId: randomUUID(), spellId: 'bless', caster: { kind: 'character', id: cleric.id }, targets: [{ kind: 'character', id: wizard.id }] },
      otherToken,
    );
    check(
      '76.P.3) PLAYER não conjura ficha de outro jogador (403, nada gasto)',
      foreign.status === 403 && foreign.data?.error === 'SPELL_CASTER_FORBIDDEN',
      JSON.stringify(foreign.data),
    );

    const playerConfirmation = await request(
      '/spells/cast',
      {
        operationId: randomUUID(),
        spellId: 'bless',
        caster: { kind: 'character', id: cleric.id },
        targets: [{ kind: 'character', id: wizard.id }],
        spatialConfirmation: EVIDENCE,
      },
      ownerToken,
    );
    check(
      '76.P.4) PLAYER não tem poder de confirmação espacial (403)',
      playerConfirmation.status === 403 &&
        playerConfirmation.data?.error === 'SPELL_SPATIAL_CONFIRMATION_FORBIDDEN',
      JSON.stringify(playerConfirmation.data),
    );

    // =====================================================================
    // C) EXECUTABLE ≠ AVAILABLE: Bless não é do Mago
    // =====================================================================
    await seedSpellRepertoire({ characterId: wizard.id, classKey: 'wizard', spellIds: ['bless'] });
    const wizardBless = await request(
      '/spells/cast',
      { operationId: randomUUID(), spellId: 'bless', caster: { kind: 'character', id: wizard.id }, targets: [{ kind: 'character', id: cleric.id }] },
      otherToken,
    );
    check(
      '76.P.5) linha persistida INVÁLIDA não autoriza: Mago não conjura Bless (lista da fonte manda)',
      wizardBless.status === 409 &&
        wizardBless.data?.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE',
      JSON.stringify(wizardBless.data),
    );

    // =====================================================================
    // D) Mago: registrada mas NÃO preparada não conjura
    // =====================================================================
    await seedSpellRepertoire({
      characterId: wizard.id,
      classKey: 'wizard',
      spellIds: ['hold-person'],
      prepared: false,
    });
    const wizardUnprepared = await request(
      '/spells/cast',
      { operationId: randomUUID(), spellId: 'hold-person', caster: { kind: 'character', id: wizard.id }, targets: [{ kind: 'character', id: cleric.id }] },
      otherToken,
    );
    check(
      '76.P.6) Mago com Hold Person REGISTRADA e não preparada não conjura (ritual é futuro)',
      wizardUnprepared.status === 409 &&
        wizardUnprepared.data?.details?.availabilityKind === 'recorded-unprepared',
      JSON.stringify(wizardUnprepared.data),
    );

    // =====================================================================
    // E) PLANEJADO não autoriza; Descanso Longo ativa (função pura do motor)
    // =====================================================================
    await seedSpellRepertoire({
      characterId: cleric.id,
      classKey: 'cleric',
      spellIds: ['bless'],
      prepared: false,
      planned: true,
    });
    const plannedCast = await request(
      '/spells/cast',
      { operationId: randomUUID(), spellId: 'bless', caster: { kind: 'character', id: cleric.id }, targets: [{ kind: 'character', id: wizard.id }] },
      ownerToken,
    );
    check(
      '76.P.7) magia apenas PLANEJADA não autoriza conjuração',
      plannedCast.status === 409 && plannedCast.data?.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE',
      JSON.stringify(plannedCast.data),
    );

    const blessSpell = getSpell('bless')!;
    const activation = activatePreparationPlans({
      spells: {
        list: [
          {
            id: blessSpell.id,
            name: blessSpell.namePt,
            level: blessSpell.level,
            school: blessSpell.school,
            description: blessSpell.description.slice(0, 500),
            prepared: false,
            preparedPlanned: true,
            classKey: 'cleric',
          },
        ],
        slotsUsed: { '1': 2 },
        pactMagic: { used: 0 },
      },
      classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 16, charisma: 10 },
    });
    check(
      '76.P.8) Descanso Longo válido promove PLANEJADO → ACTIVE e preserva o uso dos espaços',
      activation.list[0]?.prepared === true &&
        activation.list[0]?.preparedPlanned === undefined &&
        activation.activated.length === 1 &&
        activation.list.length === 1,
      JSON.stringify(activation),
    );

    const invalidActivation = activatePreparationPlans({
      spells: {
        list: [
          {
            id: 'hold-person',
            name: 'Imobilizar Pessoa',
            level: 9,
            school: blessSpell.school,
            description: 'Fixture de plano inválido (nível acima do acesso da fonte).',
            prepared: true,
            preparedPlanned: true,
            classKey: 'cleric',
          },
        ],
        slotsUsed: {},
        pactMagic: { used: 0 },
      },
      classes: [{ classKey: 'cleric', subclass: '', level: 2 }],
      abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    });
    check(
      '76.P.9) plano inválido no Descanso Longo preserva o ACTIVE anterior e é reportado (sem clamp)',
      invalidActivation.invalid.length === 1 && invalidActivation.list[0]?.prepared === true,
      JSON.stringify(invalidActivation),
    );

    // Restaura o repertório ACTIVE do Clérigo para o fluxo de intenção.
    await seedSpellRepertoire({ characterId: cleric.id, classKey: 'cleric', spellIds: ['bless'] });

    // =====================================================================
    // F) UNKNOWN espacial → INTENÇÃO sem custo → aprovação do Mestre
    // =====================================================================
    const operationId = randomUUID();
    // 6.6C continua valendo: com MAIS de um espaço compatível o jogador escolhe
    // (aqui o teste lê as opções com o token do Mestre e envia kind+level).
    const clericSlot = await pickCastingResource(
      baseUrl,
      masterToken,
      { kind: 'character', id: cleric.id },
      1,
    );
    const castBody = {
      operationId,
      spellId: 'bless',
      caster: { kind: 'character', id: cleric.id },
      targets: [
        { kind: 'character', id: cleric.id },
        { kind: 'character', id: wizard.id },
      ],
      ...(clericSlot ? { castingResource: clericSlot } : {}),
    };
    const intentRes = await request('/spells/cast', castBody, ownerToken);
    const intent = intentRes.data?.intent;
    const spellsWaiting = await spellsOf(cleric.id);
    check(
      '76.P.10) PLAYER sem geometria confiável: 202 AWAITING, SEM SpellCast, espaços intactos',
      intentRes.status === 202 &&
        intent?.status === 'pending' &&
        (intent?.requiredConfirmations?.length ?? 0) > 0 &&
        (await castCount(cleric.id)) === 0 &&
        Object.keys(spellsWaiting.slotsUsed ?? {}).length === 0,
      JSON.stringify({ status: intentRes.status, intent, slotsUsed: spellsWaiting.slotsUsed }),
    );

    const retry = await request('/spells/cast', castBody, ownerToken);
    check(
      '76.P.11) retry do MESMO operationId devolve a MESMA intenção (sem duplicar)',
      retry.status === 202 && retry.data?.intent?.id === intent?.id,
      JSON.stringify({ retry: retry.data?.intent?.id, first: intent?.id }),
    );

    const reusedKey = await request(
      '/spells/cast',
      { ...castBody, spellId: 'hold-person' },
      ownerToken,
    );
    check(
      '76.P.12) mesmo operationId com payload diferente → IDEMPOTENCY_KEY_REUSED',
      reusedKey.status === 409 && reusedKey.data?.error === 'IDEMPOTENCY_KEY_REUSED',
      JSON.stringify(reusedKey.data),
    );

    const secondIntent = await request(
      '/spells/cast',
      { ...castBody, operationId: randomUUID() },
      ownerToken,
    );
    check(
      '76.P.13) uma intenção PENDENTE por conjurador (a segunda é bloqueada)',
      secondIntent.status === 409 && secondIntent.data?.error === 'SPELL_CAST_INTENT_PENDING',
      JSON.stringify(secondIntent.data),
    );

    const approveWithoutEvidence = await request(
      `/spells/intents/${intent?.id}/approve`,
      {},
      masterToken,
    );
    check(
      '76.P.14) aprovação sem confirmação dos requisitos é recusada (400) sem custo',
      approveWithoutEvidence.status === 400 &&
        approveWithoutEvidence.data?.error === 'SPELL_SPATIAL_CONFIRMATION_REQUIRED' &&
        (await castCount(cleric.id)) === 0,
      JSON.stringify(approveWithoutEvidence.data),
    );

    const approved = await request(
      `/spells/intents/${intent?.id}/approve`,
      { spatialConfirmation: EVIDENCE },
      masterToken,
    );
    const spellsAfter = await spellsOf(cleric.id);
    check(
      '76.P.15) aprovação revalida e commita UM cast: espaço gasto, Ação não duplicada',
      approved.status === 201 &&
        (await castCount(cleric.id)) === 1 &&
        (spellsAfter.slotsUsed?.['1'] ?? 0) === 1,
      JSON.stringify({ status: approved.status, slotsUsed: spellsAfter.slotsUsed }),
    );

    const approvedAgain = await request(
      `/spells/intents/${intent?.id}/approve`,
      { spatialConfirmation: EVIDENCE },
      masterToken,
    );
    const spellsAfterRetry = await spellsOf(cleric.id);
    check(
      '76.P.16) retry da aprovação NÃO gasta de novo (um cast, um espaço)',
      ((approvedAgain.status === 200 || approvedAgain.status === 201) ?? false) &&
        (await castCount(cleric.id)) === 1 &&
        (spellsAfterRetry.slotsUsed?.['1'] ?? 0) === 1,
      JSON.stringify({ status: approvedAgain.status, slotsUsed: spellsAfterRetry.slotsUsed }),
    );

    // =====================================================================
    // G) NEGAR e CANCELAR: terminal, zero custo
    // =====================================================================
    const deniedCast = await request(
      '/spells/cast',
      { ...castBody, operationId: randomUUID() },
      ownerToken,
    );
    const denied = await request(
      `/spells/intents/${deniedCast.data?.intent?.id}/deny`,
      { reason: 'Sem linha de visão na mesa.' },
      masterToken,
    );
    const spellsAfterDeny = await spellsOf(cleric.id);
    check(
      '76.P.17) Mestre nega: intenção denied, nenhum cast novo e nenhum custo',
      denied.status === 200 &&
        denied.data?.intent?.status === 'denied' &&
        (await castCount(cleric.id)) === 1 &&
        (spellsAfterDeny.slotsUsed?.['1'] ?? 0) === 1,
      JSON.stringify({ status: denied.status, slotsUsed: spellsAfterDeny.slotsUsed }),
    );

    const cancelledCast = await request(
      '/spells/cast',
      { ...castBody, operationId: randomUUID() },
      ownerToken,
    );
    const cancelled = await request(
      `/spells/intents/${cancelledCast.data?.intent?.id}/cancel`,
      {},
      ownerToken,
    );
    check(
      '76.P.18) jogador cancela a própria intenção pendente (zero custo)',
      cancelled.status === 200 && cancelled.data?.intent?.status === 'cancelled',
      JSON.stringify(cancelled.data),
    );

    // =====================================================================
    // H) NPC: repertório EXPLÍCITO é obrigatório e não vaza para o jogador
    // =====================================================================
    const npc = await prisma.creature.create({
      data: {
        name: 'Xamã PSC',
        kind: 'CREATURE',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'wisdom', saveDc: 14, attackBonus: 6 },
      },
    });
    creatureIds.push(npc.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds, creatures: creatureIds });
    const npcCast = await request('/spells/cast', {
      operationId: randomUUID(),
      spellId: 'bless',
      caster: { kind: 'creature', id: npc.id },
      targets: [{ kind: 'character', id: wizard.id }],
      spatialConfirmation: EVIDENCE,
    });
    check(
      '76.P.19) NPC sem repertório no statblock não conjura só porque tem perfil',
      npcCast.status === 409 && npcCast.data?.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE',
      JSON.stringify(npcCast.data),
    );

    const npcRepertoireLeak = await request(
      `/spells/repertoire/${npc.id}`,
      undefined,
      ownerToken,
    );
    check(
      '76.P.20) repertório de NPC não vaza por rota de personagem',
      npcRepertoireLeak.status >= 400,
      JSON.stringify(npcRepertoireLeak.data),
    );

    // =====================================================================
    // I) Multiclasse: duas fontes autorizadas exigem escolha explícita
    // =====================================================================
    const multi = await prisma.character.create({
      data: {
        userId: (await prisma.user.create({
          data: { username: `psc_u_${suffix}`, displayName: 'Multiclasse PSC', passwordHash: 'fixture', role: 'PLAYER' },
        })).id,
        name: 'Wizard/Cleric PSC',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        wisdom: 14,
        // Clérigo 3 (não 2): precisa alcançar magias de NÍVEL 2 para que Hold
        // Person seja elegível pelas DUAS fontes — o caso de ambiguidade.
        classes: [
          { classKey: 'wizard', subclass: '', level: 3 },
          { classKey: 'cleric', subclass: '', level: 3 },
        ],
      },
    });
    characterIds.push(multi.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds });
    castCasters.push(multi.id);
    userIds.push((await prisma.character.findUniqueOrThrow({ where: { id: multi.id } })).userId);
    await seedSpellRepertoire({ characterId: multi.id, classKey: 'wizard', spellIds: ['hold-person'] });
    await seedSpellRepertoire({ characterId: multi.id, classKey: 'cleric', spellIds: ['hold-person'] });

    const ambiguous = await request(
      '/spells/cast',
      {
        operationId: randomUUID(),
        spellId: 'hold-person',
        caster: { kind: 'character', id: multi.id },
        targets: [{ kind: 'character', id: wizard.id }],
        castingResource: { kind: 'spell-slot', level: 2 },
        // Mestre confirma o espaço: o teste quer chegar na escolha de FONTE.
        spatialConfirmation: EVIDENCE,
      },
      masterToken,
    );
    check(
      '76.P.21) duas fontes autorizadas: o pedido precisa dizer QUAL (nunca "a primeira")',
      ambiguous.status === 400 && ambiguous.data?.error === 'SPELLCASTING_SOURCE_REQUIRED',
      JSON.stringify(ambiguous.data),
    );

    const wrongSource = await request(
      '/spells/cast',
      {
        operationId: randomUUID(),
        spellId: 'bless',
        caster: { kind: 'character', id: multi.id },
        targets: [{ kind: 'character', id: wizard.id }],
        spellcastingSource: { kind: 'class', id: 'wizard' },
        castingResource: { kind: 'spell-slot', level: 1 },
      },
      masterToken,
    );
    check(
      '76.P.22) fonte escolhida que não autoriza → SPELL_NOT_AVAILABLE_FROM_SOURCE antes do commit',
      wrongSource.status === 409 && wrongSource.data?.error === 'SPELL_NOT_AVAILABLE_FROM_SOURCE',
      JSON.stringify(wrongSource.data),
    );
    // =====================================================================
    // J) cast-options — read-model da UI (6.6F.1): read-only e derivado
    // =====================================================================
    await seedSpellRepertoire({ characterId: cleric.id, classKey: 'cleric', spellIds: ['bless'] });
    const castsBeforeOptions = await castCount(cleric.id);
    const intentsBeforeOptions = await prisma.spellCastIntent.count({
      where: { casterEntityId: cleric.id },
    });
    const options = await request(
      `/spells/cast-options/${cleric.id}/bless`,
      undefined,
      ownerToken,
    );
    const optionTargeting = (options.data.targeting ?? []) as any[];
    const maxAt = (level: number) =>
      optionTargeting.find((item) => item.castAtLevel === level)?.maxTargets;
    check(
      '76.P.23) cast-options devolve fontes autorizadas, espaços válidos e o próprio personagem como alvo',
      options.status === 200 &&
        options.data.spell?.executable === true &&
        options.data.sources?.length === 1 &&
        options.data.sources?.[0]?.kind === 'class' &&
        typeof options.data.sources?.[0]?.spellSaveDc === 'number' &&
        options.data.resources?.length > 0 &&
        options.data.targets?.some(
          (target: any) => target.kind === 'character' && target.id === cleric.id && target.isSelf === true,
        ) === true,
      JSON.stringify({ status: options.status, data: options.data }).slice(0, 700),
    );
    check(
      '76.P.24) máximo de alvos é DERIVADO do espaço escolhido (Bless 1º→3, 2º→4)',
      maxAt(1) === 3 && maxAt(2) === 4,
      JSON.stringify(optionTargeting),
    );
    check(
      '76.P.25) cast-options é READ-ONLY: nenhum cast/intenção criado e nada gasto',
      (await castCount(cleric.id)) === castsBeforeOptions &&
        (await prisma.spellCastIntent.count({ where: { casterEntityId: cleric.id } })) ===
          intentsBeforeOptions &&
        options.data.pendingIntent === null,
      JSON.stringify({ before: castsBeforeOptions, data: options.data.pendingIntent }),
    );
    const foreignOptions = await request(
      `/spells/cast-options/${cleric.id}/bless`,
      undefined,
      otherToken,
    );
    check(
      '76.P.26) cast-options é ownership-guarded (outro jogador recebe 403)',
      foreignOptions.status === 403 && foreignOptions.data?.error === 'SPELL_CASTER_FORBIDDEN',
      JSON.stringify(foreignOptions.data),
    );
    const unavailableOptions = await request(
      `/spells/cast-options/${wizard.id}/bless`,
      undefined,
      otherToken,
    );
    check(
      '76.P.27) cast-options NÃO inventa opção: sem fonte que autorize, nenhum espaço/alvo é oferecido',
      unavailableOptions.status === 200 &&
        unavailableOptions.data.sources?.length === 0 &&
        unavailableOptions.data.resources?.length === 0 &&
        unavailableOptions.data.targeting?.length === 0,
      JSON.stringify(unavailableOptions.data).slice(0, 400),
    );
  } finally {
    await prisma.spellCastIntent
      .deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { casterEntityId: { in: castCasters } }] } })
      .catch(() => undefined);
    await prisma.spellCast
      .deleteMany({ where: { casterEntityId: { in: castCasters } } })
      .catch(() => undefined);
    await prisma.combat.deleteMany({ where: { id: { in: [] } } }).catch(() => undefined);
    if (creatureIds.length > 0) {
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } }).catch(() => undefined);
    }
    if (characterIds.length > 0) {
      await prisma.characterOperation
        .deleteMany({ where: { characterId: { in: characterIds } } })
        .catch(() => undefined);
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }
}
