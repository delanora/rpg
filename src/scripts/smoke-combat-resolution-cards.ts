import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { emptyDeathState } from '../modules/shared/death.js';
import { HOLD_PERSON_DEFINITION_ID } from '../modules/effects/definitions/hold-person.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6I (A–D) — SMOKE DEDICADO DOS RESOLUTION CARDS.
 *
 * Usa o endpoint REAL `GET /api/combat/:combatId/resolution-requests` e prova:
 *  • o card de salvaguarda de magia deriva de `PendingEffectSave` (sem tabela
 *    paralela) e carrega atributo/prompt do SERVIDOR;
 *  • o cliente nunca recebe CD/bônus/resultado como campo de entrada;
 *  • posse e privacidade são filtradas no servidor (jogador A × jogador B × Mestre);
 *  • `initial` não tem recusa; `ongoing` opcional tem;
 *  • resolver pelo endpoint de dados remove o card e registra o desfecho no
 *    Registro do combate (`action: 'spell-save'`);
 *  • o card de Teste contra a Morte é DERIVADO do turno real, tem id
 *    determinístico, não duplica em refresh, nunca tem recusa e não sobrevive a
 *    cura/estabilização/morte/fora de turno;
 *  • a rolagem usa o fluxo EXISTENTE e o mesmo turno não rola duas vezes.
 *
 * NPC/criatura não entra aqui: exige Localidade + bestiário, já cobertos pelos
 * smokes de Hold Person/Concentração. O caso de privacidade é provado com um
 * combatente de personagem SEM dono (mesma política `ownerUserId`).
 */
export async function smokeCombatResolutionCards(baseUrl: string, check: Check): Promise<void> {
  console.log('\n79) Fase 6.6I — Resolution Cards (read-model do registro)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const combatIds: string[] = [];
  // 6.6J.0: a fixture cria SpellCast/PendingEffectSave DIRETO no banco e a
  // resolução pode criar Effect Group. Sem rastrear esses ids o cleanup deixava
  // resíduo órfão (auditado: casts `rc-cast-*` + pendings `rc-initial-*`).
  const castIds: string[] = [];
  const pendingIds: string[] = [];
  const effectGroupIds: string[] = [];

  const request = async (
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; data: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };

  try {
    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `rc_${label}_${suffix}`,
          displayName: `RC ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    const ownerA = await makeUser('a');
    const ownerB = await makeUser('b');
    const casterUser = await makeUser('c');
    userIds.push(master.id, ownerA.id, ownerB.id, casterUser.id);
    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);
    const tokenA = tokenOf(ownerA);
    const tokenB = tokenOf(ownerB);

    const makeCharacter = (name: string, userId: string, hp = 30) =>
      prisma.character.create({
        data: { userId, name, hpCurrent: hp, hpMax: 30, speed: 9, wisdom: 10, dexterity: 12 },
      });
    const alvo = await makeCharacter('Alvo RC', ownerA.id);
    const outro = await makeCharacter('Outro RC', ownerB.id);
    const caster = await makeCharacter('Caster RC', casterUser.id, 40);
    characterIds.push(alvo.id, outro.id, caster.id);

    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: alvo.id,
              ownerUserId: ownerA.id,
              name: alvo.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 1,
            },
            {
              kind: 'CHARACTER',
              characterId: outro.id,
              ownerUserId: ownerB.id,
              name: outro.name,
              initiative: 10,
              initiativeRoll: 10,
              dexterityMod: 1,
            },
            // Sem DONO: jogador nenhum vê; Mestre vê (mesma política do NPC).
            {
              kind: 'CHARACTER',
              characterId: caster.id,
              ownerUserId: null,
              name: caster.name,
              initiative: 5,
              initiativeRoll: 5,
              dexterityMod: 1,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const alvoCombatant = combat.combatants.find((item) => item.characterId === alvo.id)!;
    const outroCombatant = combat.combatants.find((item) => item.characterId === outro.id)!;

    const cardsOf = (token: string) => request(`/combat/${combat.id}/resolution-requests`, token);

    // =====================================================================
    // A1–A11 — SPELL SAVING THROW CARD
    // =====================================================================
    // A conjuração REAL que originou a pendência: é dela que o card tira o
    // título (catálogo) e o prompt curto (metadata da execução).
    const castFixture = await prisma.spellCast.create({
      data: {
        spellId: 'hold-person',
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targets: [] as never,
        status: 'resolved',
        outcome: 'effect',
        requiresConcentration: true,
        saveDc: 14,
        spellSaveDc: 14,
        spellLevel: 2,
        castAtLevel: 2,
        combatId: combat.id,
        turnSequence: 1,
        operationId: `rc-cast-${suffix}`,
        fingerprint: `rc-cast-${suffix}`,
      },
    });
    castIds.push(castFixture.id);
    const initialPending = await prisma.pendingEffectSave.create({
      data: {
        definitionId: HOLD_PERSON_DEFINITION_ID,
        spellCastId: castFixture.id,
        casterEntityKind: 'character',
        casterEntityId: caster.id,
        casterLabel: caster.name,
        targetEntityKind: 'character',
        targetEntityId: alvo.id,
        ability: 'wisdom',
        dc: 14,
        visibility: 'public',
        phase: 'initial',
        optional: false,
        status: 'pending',
        operationId: `rc-initial-${suffix}`,
        fingerprint: `rc-initial-${suffix}`,
      },
    });
    pendingIds.push(initialPending.id);

    const asOwner = await cardsOf(tokenA);
    const spellCard = asOwner.data?.requests?.find((card: any) => card.kind === 'spell-saving-throw');
    check(
      '79.A1) o PLAYER alvo recebe exatamente o card da pendência inicial',
      asOwner.status === 200 &&
        Boolean(spellCard) &&
        asOwner.data.requests.filter((card: any) => card.kind === 'spell-saving-throw').length === 1,
      JSON.stringify(asOwner.data?.requests),
    );
    check(
      '79.A2) o card deriva do PendingEffectSave (id determinístico, sem tabela paralela)',
      spellCard?.reference?.pendingId === initialPending.id &&
        spellCard?.id === `spell-save:${initialPending.id}` &&
        !('combatResolutionCard' in prisma),
      JSON.stringify(spellCard?.reference),
    );
    check(
      '79.A3/A4) atributo vem do SERVIDOR (Sabedoria) e o card não expõe CD/bônus/resultado como entrada',
      spellCard?.ability === 'wisdom' &&
        !('dc' in (spellCard ?? {})) &&
        !('saveDc' in (spellCard ?? {})) &&
        !('bonus' in (spellCard ?? {})) &&
        !('result' in (spellCard ?? {})),
      JSON.stringify(spellCard),
    );
    check(
      '79.A9) salvaguarda INITIAL é obrigatória: só existe a ação de rolar (sem decline)',
      Array.isArray(spellCard?.actions) &&
        spellCard.actions.length === 1 &&
        spellCard.actions[0].kind === 'roll' &&
        !spellCard.actions.some((action: any) => action.kind === 'decline'),
      JSON.stringify(spellCard?.actions),
    );
    check(
      '79.A11) descrição curta vem do metadata da execução (combatPrompt), não do texto integral',
      spellCard?.shortDescription === 'Uma força mágica tenta paralisar seu corpo.' &&
        spellCard?.title === 'Imobilizar Pessoa',
      JSON.stringify({ title: spellCard?.title, desc: spellCard?.shortDescription }),
    );

    const asOther = await cardsOf(tokenB);
    check(
      '79.A5) outro PLAYER não recebe o card interativo do personagem alheio',
      asOther.status === 200 &&
        !asOther.data.requests.some((card: any) => card.kind === 'spell-saving-throw'),
      JSON.stringify(asOther.data?.requests),
    );
    const asMaster = await cardsOf(masterToken);
    const masterSpellCard = asMaster.data?.requests?.find(
      (card: any) => card.kind === 'spell-saving-throw',
    );
    check(
      '79.A6/A8) o Mestre recebe a pendência e pode rolá-la pública ou privada',
      asMaster.status === 200 &&
        Boolean(masterSpellCard) &&
        masterSpellCard.actions.some(
          (action: any) => action.kind === 'roll' && action.visibility === 'private',
        ),
      JSON.stringify(masterSpellCard?.actions),
    );

    const noOwnerCard = asOther.data?.requests?.find(
      (card: any) => card.target?.name === caster.name,
    );
    check(
      '79.A7/A8) pendência de combatente SEM dono não vai para jogador e vai para o Mestre',
      !noOwnerCard && Boolean(masterSpellCard),
      JSON.stringify(asOther.data?.requests),
    );

    // A10 — fim de turno OPCIONAL: roll + decline.
    await prisma.pendingEffectSave.update({
      where: { id: initialPending.id },
      data: { phase: 'ongoing', optional: true },
    });
    const ongoing = await cardsOf(tokenA);
    const ongoingCard = ongoing.data?.requests?.find(
      (card: any) => card.reference?.pendingId === initialPending.id,
    );
    check(
      '79.A10) salvaguarda ONGOING opcional oferece rolar E recusar',
      ongoingCard?.phase === 'ongoing' &&
        ongoingCard.actions.some((action: any) => action.kind === 'roll') &&
        ongoingCard.actions.some((action: any) => action.kind === 'decline'),
      JSON.stringify(ongoingCard?.actions),
    );

    // A13/A14 — resolver pelo endpoint REAL e registrar no histórico.
    await prisma.pendingEffectSave.update({
      where: { id: initialPending.id },
      data: { phase: 'initial', optional: false },
    });
    const roll = await request('/dice/roll', tokenA, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: initialPending.id,
      label: 'Salvaguarda de Sabedoria',
    });
    const afterRoll = await cardsOf(tokenA);
    const storedRoll = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: initialPending.id },
    });
    check(
      '79.A13) resolver a salvaguarda pelo endpoint existente tira o card ativo',
      (roll.status === 200 || roll.status === 201) &&
        storedRoll.status !== 'pending' &&
        !afterRoll.data?.requests?.some(
          (card: any) => card.reference?.pendingId === initialPending.id,
        ),
      JSON.stringify({ status: roll.status, pending: storedRoll.status }),
    );
    const journalCombat = await prisma.combat.findUniqueOrThrow({ where: { id: combat.id } });
    check(
      '79.A14) o desfecho aparece no Registro do combate como `spell-save`',
      JSON.stringify(journalCombat.economyLog ?? []).includes('spell-save') &&
        JSON.stringify(journalCombat.economyLog ?? []).includes('Salvaguarda de Sabedoria'),
      JSON.stringify(journalCombat.economyLog ?? []).slice(0, 300),
    );

    // =====================================================================
    // A15–A26 — DEATH SAVING THROW CARD
    // =====================================================================
    // Dano manual do Mestre derruba o alvo a 0 PV com o lifecycle REAL (6.3).
    const damage = await request('/combat/hp', masterToken, {
      combatantId: alvoCombatant.id,
      mode: 'damage',
      amount: 35,
    });
    const alvoAfterDamage = await prisma.character.findUniqueOrThrow({ where: { id: alvo.id } });
    const deathCardOf = async (token: string) => {
      const payload = await cardsOf(token);
      return {
        payload,
        card: payload.data?.requests?.find((card: any) => card.kind === 'death-saving-throw'),
      };
    };
    const first = await deathCardOf(tokenA);
    check(
      '79.A15) personagem a 0 PV no próprio turno recebe UM card de Teste contra a Morte',
      damage.status === 200 &&
        alvoAfterDamage.hpCurrent === 0 &&
        Boolean(first.card) &&
        first.payload.data.requests.filter((card: any) => card.kind === 'death-saving-throw').length === 1,
      JSON.stringify({ status: damage.status, card: first.card }),
    );
    const second = await deathCardOf(tokenA);
    check(
      '79.A16/A17) o id é determinístico e refresh não duplica a oportunidade',
      Boolean(first.card?.id) &&
        first.card?.id === second.card?.id &&
        first.card.id.includes('death-save') &&
        first.card.id.includes(`turn:${1}`),
      JSON.stringify({ first: first.card?.id, second: second.card?.id }),
    );
    const deathOther = await deathCardOf(tokenB);
    const deathMaster = await deathCardOf(masterToken);
    check(
      '79.A18/A19) outro jogador não recebe; o Mestre recebe a mesma oportunidade',
      !deathOther.card && Boolean(deathMaster.card) && deathMaster.card?.id === first.card?.id,
      JSON.stringify({ other: deathOther.card, master: deathMaster.card }),
    );
    check(
      '79.A20) Teste contra a Morte NUNCA oferece recusa',
      Array.isArray(first.card?.actions) &&
        first.card.actions.length === 1 &&
        first.card.actions[0].kind === 'roll' &&
        !first.card.actions.some((action: any) => action.kind === 'decline'),
      JSON.stringify(first.card?.actions),
    );

    const deathRoll = await request('/dice/roll', tokenA, {
      kind: 'death-save',
      entity: { kind: 'character', id: alvo.id },
      dice: [{ sides: 20 }],
    });
    const afterDeathRoll = await deathCardOf(tokenA);
    check(
      '79.A21/A22) o fluxo existente rola o Teste e a MESMA oportunidade não rola duas vezes',
      (deathRoll.status === 200 || deathRoll.status === 201) &&
        !afterDeathRoll.card &&
        deathRoll.data?.roll?.kind === 'death-save',
      JSON.stringify({ status: deathRoll.status, data: deathRoll.data?.error }),
    );
    const secondDeathRoll = await request('/dice/roll', tokenA, {
      kind: 'death-save',
      entity: { kind: 'character', id: alvo.id },
      dice: [{ sides: 20 }],
    });
    check(
      '79.A22) o servidor recusa um segundo Teste na mesma oportunidade (sem depender da UI)',
      secondDeathRoll.status === 409,
      JSON.stringify({ status: secondDeathRoll.status, error: secondDeathRoll.data?.error }),
    );

    // A23 — cura/HP positivo invalida o card (nenhum healing spell envolvido).
    // Reabre a oportunidade do MESMO turno (fixture de estado, como uma nova
    // queda faria) para provar que é o HP que invalida — não o save já rolado.
    await prisma.character.update({
      where: { id: alvo.id },
      data: {
        hpCurrent: 0,
        deathState: { ...emptyDeathState(), deathSaves: true, saveTurnKey: null },
      },
    });
    const reopened = await deathCardOf(tokenA);
    const healing = await request('/combat/hp', masterToken, {
      combatantId: alvoCombatant.id,
      mode: 'heal',
      amount: 5,
    });
    const healed = await prisma.character.findUniqueOrThrow({ where: { id: alvo.id } });
    const afterHealing = await deathCardOf(tokenA);
    check(
      '79.A23) HP volta a ser positivo e o card de Teste contra a Morte deixa de existir',
      Boolean(reopened.card) &&
        healing.status === 200 &&
        healed.hpCurrent === 5 &&
        !afterHealing.card,
      JSON.stringify({ status: healing.status, hp: healed.hpCurrent, card: afterHealing.card }),
    );
    check(
      '79.A23b) a Queda (Prone) derivada do 0 PV é PRESERVADA depois da cura',
      JSON.stringify(healed.mechanicalState ?? {}).includes('"prone"'),
      JSON.stringify(healed.mechanicalState ?? {}).slice(0, 200),
    );

    // A24/A25 — estabilizado e morto não geram card.
    const fresh = await prisma.character.findUniqueOrThrow({ where: { id: outro.id } });
    await prisma.character.update({
      where: { id: outro.id },
      data: {
        hpCurrent: 0,
        deathState: { ...emptyDeathState(), deathSaves: false, stabilized: true },
      },
    });
    // Torna o estabilizado o personagem ATUAL do turno (senão o card nem seria
    // considerável): o turno é dado ao combatente dele.
    await prisma.combat.update({
      where: { id: combat.id },
      data: { currentIndex: 1, turnSequence: 2 },
    });
    const stabilized = await deathCardOf(tokenB);
    check(
      '79.A24) personagem ESTABILIZADO a 0 PV não gera oportunidade de Teste',
      !stabilized.card && (await prisma.character.findUniqueOrThrow({ where: { id: outro.id } })).hpCurrent === 0,
      JSON.stringify(stabilized.payload.data?.requests),
    );
    await prisma.character.update({
      where: { id: outro.id },
      data: { deathState: { ...emptyDeathState(), deathSaves: false, dead: true } },
    });
    const dead = await deathCardOf(tokenB);
    check(
      '79.A25) personagem MORTO não gera oportunidade de Teste',
      !dead.card,
      JSON.stringify(dead.payload.data?.requests),
    );

    // A26 — fora do próprio turno não há card, mesmo a 0 PV.
    await prisma.combat.update({ where: { id: combat.id }, data: { currentIndex: 0 } });
    await prisma.character.update({
      where: { id: outro.id },
      data: { deathState: { ...emptyDeathState(), deathSaves: true } },
    });
    const offTurn = await deathCardOf(tokenB);
    check(
      '79.A26) a 0 PV fora da própria oportunidade de turno o card interativo não existe',
      !offTurn.card,
      JSON.stringify(offTurn.payload.data?.requests),
    );

    check(
      '79.A30) nenhuma tabela/estado paralelo de cards foi criado',
      !('combatResolutionCard' in prisma) && !('resolutionCard' in prisma),
    );
    void fresh;
  } finally {
    // 6.6J.0 — HIGIENE: resolver o save pode criar Effect Group/Instance. O
    // cleanup agora remove pendências, Effects e casts ANTES das fichas, sempre
    // pelos ids que esta execução criou (nunca por status/label).
    const trackedCasts = castIds.length > 0
      ? await prisma.spellCast.findMany({
          where: { id: { in: castIds } },
          select: { id: true, effectGroupId: true },
        })
      : [];
    const groups = [
      ...effectGroupIds,
      ...trackedCasts
        .map((row) => row.effectGroupId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ];
    if (pendingIds.length > 0) {
      await prisma.pendingEffectSave.deleteMany({ where: { id: { in: pendingIds } } });
    }
    if (castIds.length > 0) {
      await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
    }
    if (groups.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { groupId: { in: groups } } });
    }
    if (characterIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { targetEntityId: { in: characterIds } } });
    }
    if (castIds.length > 0) await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
    if (combatIds.length > 0) {
      await prisma.combatOperation.deleteMany({ where: { combatId: { in: combatIds } } });
      await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
    }
    if (characterIds.length > 0) await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
