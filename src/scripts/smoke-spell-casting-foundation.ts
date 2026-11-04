import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/prisma.js';
import { grantCastingComponents } from './spell-slot-fixtures.js';
import { seedSpellRepertoire } from './spell-slot-fixtures.js';
import { signToken } from '../lib/jwt.js';
import { pickCastingResource, withSpatialEvidence } from './spell-slot-fixtures.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import type { PendingEffectSaveDto } from '../modules/effects/pending-effect-saves.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6A — CASTING FOUNDATION & SPELL RESOLUTION CONTRACT.
 *
 * Prova o contrato ÚNICO de conjuração que as rotas de prova agora usam:
 * VALIDATE → COMMIT → RESOLVE → PRODUCE EFFECTS/RESULT → COMPLETE.
 *
 * O ponto crítico é a semântica de Concentração: no COMMIT de uma magia
 * concentrada a concentração ANTERIOR termina — mesmo que o alvo passe no save
 * ou que a aplicação seja cancelada depois. A nova Concentração só nasce se a
 * resolução produzir Effect durável.
 *
 * Também cobre: SpellCast persistente/idempotente, lock de UM cast resolving
 * por caster (barreira do banco, sem memória do processo), vínculo
 * PendingEffectSave ↔ SpellCast, retry/concorrência, cancelamento, remoção
 * estrutural, self-target, caster incapacitado durante a pendência, ausência de
 * slot/Ação e histórico imutável quando o Effect termina.
 */
export async function smokeSpellCastingFoundation(baseUrl: string, check: Check): Promise<void> {
  console.log('\n75) Fase 6.6A — Casting Foundation (validate → commit → resolve)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const operationIds: string[] = [];
  const groupIds: string[] = [];
  const castIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `sc_m_${suffix}`, displayName: 'Mestre Cast', passwordHash: 'fixture', role: 'MASTER' },
    });
    const casterUser = await prisma.user.create({
      data: { username: `sc_c_${suffix}`, displayName: 'Caster', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `sc_t_${suffix}`, displayName: 'Alvo Cast', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyUser = await prisma.user.create({
      data: { username: `sc_a_${suffix}`, displayName: 'Aliado Cast', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const secondUser = await prisma.user.create({
      data: { username: `sc_s_${suffix}`, displayName: 'Segundo Caster', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, casterUser.id, targetUser.id, allyUser.id, secondUser.id);

    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });
    const casterToken = signToken({
      sub: casterUser.id, username: casterUser.username, displayName: casterUser.displayName, role: casterUser.role,
    });
    const targetToken = signToken({
      sub: targetUser.id, username: targetUser.username, displayName: targetUser.displayName, role: targetUser.role,
    });

    // 6.6B: os conjuradores precisam de uma FONTE de conjuração real (Mago). A
    // CD do save é DERIVADA do perfil — `forceSave` abaixo torna o resultado
    // determinístico sem o cliente enviar números.
    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Caster',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
        intelligence: 16,
        // 6.6C: Hold Person exige espaço de nível 2 — Mago 20 tem o pool inteiro.
        // 6.6F: Bless E Hold Person são da lista do Clérigo; a fonte do conjurador
        // principal do smoke precisa LISTAR as magias que ele conjura.
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    const target = await prisma.character.create({
      data: { userId: targetUser.id, name: 'Alvo Cast', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    const ally = await prisma.character.create({
      data: { userId: allyUser.id, name: 'Aliado Cast', hpCurrent: 40, hpMax: 40, speed: 9, wisdom: 10 },
    });
    const second = await prisma.character.create({
      data: {
        userId: secondUser.id,
        name: 'Segundo Caster',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
        intelligence: 16,
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    characterIds.push(caster.id, target.id, ally.id, second.id);
    // 6.6F: repertório ACTIVE dos conjuradores (Clérigo). Sem isso a autorização
    // recusa antes do commit — e o smoke deixaria de provar o pipeline.
    for (const id of [caster.id, second.id]) {
      await seedSpellRepertoire({
        characterId: id,
        classKey: 'cleric',
        spellIds: ['bless', 'hold-person'],
      });
    }

    // 6.6F — fixture SEPARADO por propósito (cenário de self-target):
    // Hold Person do Mago precisa vir da fonte Wizard, com atributo de conjuração
    // (INT) DIFERENTE do atributo do save (SAB). Num Clérigo os dois são SAB, e o
    // `forceSave` (INT/SAB/CAR 30 no caster + SAB 1 no alvo, que é o próprio
    // caster) acabava tornando o save bem-sucedido — o teste provaria o contrário
    // do que quer provar. Nada de bypass: usa-se a matemática real.
    const selfUser = await prisma.user.create({
      data: { username: `sp_f_${suffix}`, displayName: 'Mago Self', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(selfUser.id);
    const selfToken = signToken({
      sub: selfUser.id,
      username: selfUser.username,
      displayName: selfUser.displayName,
      role: selfUser.role,
    });
    const selfCaster = await prisma.character.create({
      data: {
        userId: selfUser.id,
        name: 'Mago Self',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        wisdom: 10,
        classes: [{ classKey: 'wizard', subclass: '', level: 20 }],
      },
    });
    characterIds.push(selfCaster.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds });
    // Grimório (registrada) + preparação ACTIVE: as duas condições do Mago.
    await seedSpellRepertoire({
      characterId: selfCaster.id,
      classKey: 'wizard',
      spellIds: ['hold-person'],
    });
    const selfEntity = { kind: 'character' as const, id: selfCaster.id };

    const humanoid = await prisma.creature.create({
      data: { name: 'Goblin Cast', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 20, hpMax: 20, speed: 9 },
    });
    const beast = await prisma.creature.create({
      data: { name: 'Lobo Cast', kind: 'CREATURE', type: 'Besta', hpCurrent: 20, hpMax: 20, speed: 12 },
    });
    creatureIds.push(humanoid.id, beast.id);
    // 6.6G: conjuradores de fixture recebem bolsa de componentes REAL.
    await grantCastingComponents({ characters: characterIds, creatures: creatureIds });

    const casterEntity = { kind: 'character' as const, id: caster.id };
    const targetEntity = { kind: 'character' as const, id: target.id };
    const allyEntity = { kind: 'character' as const, id: ally.id };
    const secondEntity = { kind: 'character' as const, id: second.id };
    const beastEntity = { kind: 'creature' as const, id: beast.id };

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

    // 6.6C: o espaço faz parte do payload/fingerprint. O RETRY precisa reenviar
    // o MESMO recurso — por isso ele é memorizado por `operationId`.
    const spentResources = new Map<string, { kind: 'spell-slot' | 'pact-slot'; level: number }>();
    async function resourceFor(
      operationId: string,
      casterRef: { kind: string; id: string },
      spellLevel: number,
    ) {
      const cached = spentResources.get(operationId);
      if (cached) return cached;
      const picked = await pickCastingResource(baseUrl, masterToken, casterRef, spellLevel);
      if (picked) spentResources.set(operationId, picked);
      return picked;
    }

    async function castProof(
      body: Record<string, unknown>,
      token = masterToken,
    ) {
      // 6.6C: o espaço acompanha a intenção; o servidor valida nível/posse.
      const spellLevel = body.spellId === 'bless' ? 1 : body.spellId === 'hold-person' ? 2 : 0;
      const casterRef = body.caster as { kind: string; id: string } | undefined;
      const castingResource =
        spellLevel > 0 && casterRef
          ? await resourceFor(String(body.operationId), casterRef, spellLevel)
          : null;
      const result = await request(
        '/spells/cast-proof',
        { ...body, ...(castingResource ? { castingResource } : {}) },
        token,
      );
      if (result.data?.cast?.id) castIds.push(result.data.cast.id);
      if (result.data?.effectGroupId) groupIds.push(result.data.effectGroupId);
      return result;
    }

    async function bless(
      casterRef: { kind: 'character' | 'creature'; id: string },
      targets: { kind: 'character' | 'creature'; id: string }[],
      token = masterToken,
      operationId = newOperation(),
    ) {
      const castingResource = await resourceFor(operationId, casterRef, 1);
      const result = await request(
        '/effects/bless',
        { operationId, caster: casterRef, targets, ...(castingResource ? { castingResource } : {}) },
        token,
      );
      if (result.data?.groupId) groupIds.push(result.data.groupId);
      return { ...result, operationId };
    }

    async function holdPerson(
      casterRef: { kind: 'character' | 'creature'; id: string },
      targetRef: { kind: 'character' | 'creature'; id: string },
      token = masterToken,
      operationId = newOperation(),
      forcedResource?: { kind: 'spell-slot' | 'pact-slot'; level: number },
    ) {
      const castingResource =
        forcedResource ?? (await resourceFor(operationId, casterRef, 2));
      return {
        ...(await request(
          '/effects/hold-person',
          { operationId, caster: casterRef, target: targetRef, ...(castingResource ? { castingResource } : {}) },
          token,
        )),
        operationId,
      };
    }

    /**
     * Resultado DETERMINÍSTICO do save pela matemática real: CD derivada do
     * caster (INT 1 → 5; INT 30 → 20) e bônus do alvo (SAB 30 → +10; SAB 1 → -5).
     * O cliente nunca envia CD/atributo — só o servidor calcula.
     */
    async function forceSave(
      outcome: 'success' | 'failure',
      casterId: string,
      targetRef: { kind: string; id: string },
    ): Promise<void> {
      // O atributo de conjuração depende da FONTE (INT/SAB/CAR), então os três
      // são ajustados: DC mínima (5) para sucesso, máxima (20) para falha.
      const casting = outcome === 'failure' ? 30 : 1;
      await prisma.character.update({
        where: { id: casterId },
        data: { intelligence: casting, wisdom: casting, charisma: casting },
      });
      const wisdom = outcome === 'failure' ? 1 : 30;
      if (targetRef.kind === 'character') {
        await prisma.character.update({ where: { id: targetRef.id }, data: { wisdom } });
      } else if (targetRef.kind === 'creature') {
        await prisma.creature.update({ where: { id: targetRef.id }, data: { wisdom } });
      }
    }

    async function rollSave(pendingId: string, token = masterToken) {
      return request(
        '/dice/roll',
        { kind: 'save', pendingEffectSaveId: pendingId, dice: [{ sides: 20 }] },
        token,
      );
    }

    async function pendingOf(entity: { kind: string; id: string }) {
      const res = await request(`/effects/pending/${entity.kind}/${entity.id}`);
      return (res.data.pending ?? []) as PendingEffectSaveDto[];
    }

    async function effectsOf(entity: { kind: string; id: string }) {
      const res = await request(`/effects/${entity.kind}/${entity.id}`);
      return (res.data.effects ?? []) as EffectDto[];
    }

    async function mechanicalOf(entity: { kind: string; id: string }) {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`);
      return res.data.mechanical as {
        version: number;
        state: { concentration: { id: string; sourceId?: string } | null };
      };
    }

    async function castRow(operationId: string) {
      return prisma.spellCast.findUnique({ where: { operationId } });
    }

    // =====================================================================
    // A — SpellCast persistente + resolução immediate-effect (Bless)
    // =====================================================================
    const opA = newOperation();
    const first = await castProof({
      operationId: opA,
      spellId: 'bless',
      caster: casterEntity,
      targets: [casterEntity, targetEntity],
    });
    const castA = first.data.cast;
    const casterAfterA = await mechanicalOf(casterEntity);
    check(
      '75.A) conjuração persiste com spellId/caster/targets/status/outcome e a Concentração nasce ligada ao grupo',
      first.status === 201 &&
        castA?.spellId === 'bless' &&
        castA?.status === 'resolved' &&
        castA?.outcome === 'effect' &&
        castA?.requiresConcentration === true &&
        typeof castA?.effectGroupId === 'string' &&
        castA?.targetEntities?.length === 2 &&
        castA?.casterEntity?.id === caster.id &&
        casterAfterA.state.concentration?.sourceId === castA.effectGroupId &&
        (await effectsOf(casterEntity)).length === 1 &&
        (await effectsOf(targetEntity)).length === 1,
      JSON.stringify({ status: first.status, cast: castA }),
    );

    // =====================================================================
    // B/C — idempotência do operationId e recusa de payload diferente
    // =====================================================================
    const replayA = await castProof({
      operationId: opA,
      spellId: 'bless',
      caster: casterEntity,
      targets: [casterEntity, targetEntity],
    });
    const reused = await castProof({
      operationId: opA,
      spellId: 'bless',
      caster: casterEntity,
      targets: [targetEntity],
    });
    check(
      '75.B) retry devolve o MESMO SpellCast/grupo; mesmo id com outro payload → 409 IDEMPOTENCY_KEY_REUSED',
      replayA.status === 200 &&
        replayA.data.replayed === true &&
        replayA.data.cast.id === castA.id &&
        replayA.data.effectGroupId === castA.effectGroupId &&
        reused.status === 409 &&
        reused.data.error === 'IDEMPOTENCY_KEY_REUSED' &&
        (await prisma.spellCast.count({ where: { operationId: opA } })) === 1,
      JSON.stringify({ replay: replayA.status, reused: reused.data }),
    );

    // =====================================================================
    // D — catálogo sem execução não adivinha comportamento
    // =====================================================================
    const opD = newOperation();
    const notExecutable = await castProof({
      operationId: opD,
      spellId: 'fireball',
      caster: casterEntity,
      targets: [targetEntity],
    });
    check(
      '75.D) magia do catálogo sem SpellExecutionDefinition → SPELL_EXECUTION_NOT_IMPLEMENTED, sem cast',
      notExecutable.status === 409 &&
        notExecutable.data.error === 'SPELL_EXECUTION_NOT_IMPLEMENTED' &&
        (await castRow(opD)) === null,
      JSON.stringify(notExecutable.data),
    );

    // =====================================================================
    // E — validação falha ANTES do commit e NÃO encerra a concentração
    // =====================================================================
    const fourTargets = await bless(casterEntity, [casterEntity, targetEntity, allyEntity, secondEntity]);
    const nonHumanoid = await holdPerson(casterEntity, beastEntity);
    const casterAfterInvalid = await mechanicalOf(casterEntity);
    check(
      '75.E) alvos inválidos (4 no Bless / não humanoide) não commitam e mantêm a concentração anterior',
      fourTargets.status === 400 &&
        nonHumanoid.status === 409 &&
        nonHumanoid.data.error === 'SPELL_TARGET_TYPE_INVALID' &&
        casterAfterInvalid.state.concentration?.sourceId === castA.effectGroupId &&
        (await effectsOf(casterEntity)).length === 1,
      JSON.stringify({ four: fourTargets.status, nonHumanoid: nonHumanoid.data, concentration: casterAfterInvalid.state.concentration }),
    );

    // =====================================================================
    // F — CRÍTICO: commit de Hold Person encerra a concentração anterior
    //     mesmo quando o alvo PASSA no save
    // =====================================================================
    const opF = newOperation();
    await forceSave('success', caster.id, targetEntity);
    const applyF = await holdPerson(casterEntity, targetEntity, masterToken, opF);
    const castF = await castRow(opF);
    const afterCommitF = await mechanicalOf(casterEntity);
    const groupAConditions = await prisma.effectInstance.findMany({
      where: { groupId: castA.effectGroupId },
      select: { status: true },
    });
    check(
      '75.F) o COMMIT encerra a Concentração anterior ANTES do save e liga a pendência ao SpellCast',
      applyF.status === 201 &&
        castF?.status === 'resolving' &&
        castF?.outcome === null &&
        afterCommitF.state.concentration === null &&
        groupAConditions.every((row) => row.status === 'ended') &&
        applyF.data.pending.spellCastId === castF?.id,
      JSON.stringify({ status: applyF.status, cast: castF?.status, concentration: afterCommitF.state.concentration }),
    );
    const rollF = await rollSave(applyF.data.pending.id, targetToken);
    const resolvedF = await castRow(opF);
    check(
      '75.F.1) SUCESSO no save: cast resolved/no-effect, sem Effect e sem nova Concentração (a antiga NÃO volta)',
      rollF.status === 201 &&
        resolvedF?.status === 'resolved' &&
        resolvedF?.outcome === 'no-effect' &&
        resolvedF?.effectGroupId === null &&
        typeof resolvedF?.resolvedAt !== 'undefined' &&
        resolvedF?.resolvedAt !== null &&
        (await mechanicalOf(casterEntity)).state.concentration === null &&
        (await pendingOf(targetEntity)).length === 0 &&
        (await effectsOf(targetEntity)).length === 0,
      JSON.stringify({ roll: rollF.data.roll?.total, cast: resolvedF?.outcome }),
    );

    // =====================================================================
    // G — FALHA: Effect + Condition + Concentração + cast/effectGroupId
    // =====================================================================
    const opG = newOperation();
    await forceSave('failure', caster.id, targetEntity);
    const applyG = await holdPerson(casterEntity, targetEntity, masterToken, opG);
    const rollG = await rollSave(applyG.data.pending.id);
    const castG = await castRow(opG);
    const targetEffectsG = await effectsOf(targetEntity);
    const casterG = await mechanicalOf(casterEntity);
    check(
      '75.G) FALHA cria Effect/Paralyzed/Concentração e fecha o cast como resolved/effect com effectGroupId',
      rollG.status === 201 &&
        castG?.status === 'resolved' &&
        castG?.outcome === 'effect' &&
        typeof castG?.effectGroupId === 'string' &&
        targetEffectsG.length === 1 &&
        targetEffectsG[0].definitionId === 'spell.hold-person' &&
        targetEffectsG[0].groupId === castG.effectGroupId &&
        casterG.state.concentration?.sourceId === castG.effectGroupId,
      JSON.stringify({ cast: castG, effects: targetEffectsG.length }),
    );

    // =====================================================================
    // H — UM cast resolving por caster; outros casters não são bloqueados
    // =====================================================================
    const opH = newOperation();
    await forceSave('success', caster.id, targetEntity);
    const applyH = await holdPerson(casterEntity, targetEntity, masterToken, opH);
    const blockedCast = await castProof({
      operationId: newOperation(),
      spellId: 'bless',
      caster: casterEntity,
      targets: [targetEntity],
    });
    const otherCaster = await bless(secondEntity, [allyEntity]);
    const retryH = await holdPerson(casterEntity, targetEntity, masterToken, opH);
    check(
      '75.H) segundo cast do MESMO caster → 409 SPELL_CAST_IN_PROGRESS; outro caster conjura; retry do mesmo operationId não é bloqueado',
      applyH.status === 201 &&
        blockedCast.status === 409 &&
        blockedCast.data.error === 'SPELL_CAST_IN_PROGRESS' &&
        otherCaster.status === 201 &&
        retryH.status === 200 &&
        retryH.data.replayed === true &&
        retryH.data.pending.id === applyH.data.pending.id &&
        retryH.data.pending.spellCastId === applyH.data.pending.spellCastId,
      JSON.stringify({ blocked: blockedCast.data, other: otherCaster.status, retry: retryH.status }),
    );
    await rollSave(applyH.data.pending.id, targetToken);
    check(
      '75.H.1) resolver a pendência libera o lock (o cast deixa de estar resolving)',
      (await castRow(opH))?.status === 'resolved' &&
        (await prisma.spellCast.count({
          where: { casterEntityId: caster.id, status: 'resolving' },
        })) === 0,
    );

    // =====================================================================
    // I — cancelar DEPOIS do commit não restaura a concentração anterior
    // =====================================================================
    const concentrationI = await bless(casterEntity, [targetEntity]);
    const concentrationBeforeI = await mechanicalOf(casterEntity);
    const opI = newOperation();
    const applyI = await holdPerson(casterEntity, targetEntity, masterToken, opI);
    const cancelI = await request(`/effects/pending/${applyI.data.pending.id}/cancel`, {}, masterToken);
    const castI = await castRow(opI);
    check(
      '75.I) cancelar a pendência após o commit → cast cancelled, sem Effect e SEM restaurar a concentração antiga',
      concentrationI.status === 201 &&
        concentrationBeforeI.state.concentration !== null &&
        cancelI.status === 200 &&
        castI?.status === 'cancelled' &&
        castI?.outcome === 'cancelled' &&
        castI?.effectGroupId === null &&
        (await mechanicalOf(casterEntity)).state.concentration === null &&
        (await effectsOf(targetEntity)).filter((effect) => effect.definitionId === 'spell.hold-person').length === 0,
      JSON.stringify({ cancel: cancelI.status, cast: castI?.status, concentration: (await mechanicalOf(casterEntity)).state.concentration }),
    );

    // =====================================================================
    // J — remoção estrutural durante a pendência cancela pendência e cast
    // =====================================================================
    const doomed = await prisma.creature.create({
      data: { name: 'NPC Cast Removido', kind: 'NPC', type: 'Humanoide', hpCurrent: 10, hpMax: 10, speed: 9 },
    });
    creatureIds.push(doomed.id);
    const doomedEntity = { kind: 'creature' as const, id: doomed.id };
    const opJ = newOperation();
    const applyJ = await holdPerson(casterEntity, doomedEntity, masterToken, opJ);
    const deletedJ = await request(`/creatures/${doomed.id}`, {}, masterToken, 'DELETE');
    check(
      '75.J) caster/alvo removido estruturalmente: pendência e SpellCast são cancelados (nada fica resolving)',
      applyJ.status === 201 &&
        deletedJ.status === 204 &&
        (await castRow(opJ))?.status === 'cancelled' &&
        (await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: applyJ.data.pending.id } })).status ===
          'cancelled',
      JSON.stringify({ delete: deletedJ.status, cast: (await castRow(opJ))?.status }),
    );

    // =====================================================================
    // K — self-target: falha resolve o cast e o lifecycle limpa o grupo
    // =====================================================================
    const opK = newOperation();
    // INT 30 → CD 24 (8 + PB 6 + 10); SAB 1 → save máximo 20 − 5 + 6 = 21 < 24.
    // Falha DETERMINÍSTICA, sem natural-20 automático (não existe em save).
    await forceSave('failure', selfCaster.id, selfEntity);
    const applyK = await holdPerson(selfEntity, selfEntity, masterToken, opK);
    const pendingK =
      applyK.status === 201
        ? await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: applyK.data.pending.id } })
        : null;
    const selfRowAfterCast = await prisma.character.findUniqueOrThrow({
      where: { id: selfCaster.id },
      select: { spells: true },
    });
    const rollK = await rollSave(applyK.data.pending.id, selfToken);
    const castK = await castRow(opK);
    const casterK = await mechanicalOf(selfEntity);
    const effectK = castK?.effectGroupId
      ? await prisma.effectInstance.findFirst({ where: { groupId: castK.effectGroupId } })
      : null;
    // `mechanicalOf` do smoke só expõe concentração; as Conditions vêm da linha
    // canônica da ficha (nenhuma Condition pode sobrar com a fonte deste Effect).
    const selfMechanical = await prisma.character.findUniqueOrThrow({
      where: { id: selfCaster.id },
      select: { mechanicalState: true },
    });
    const selfConditions =
      ((selfMechanical.mechanicalState as { conditions?: { sourceId?: string | null }[] } | null)
        ?.conditions ?? []);
    const residualK = selfConditions.filter((entry) => entry.sourceId === effectK?.id).length;
    const slotsK = (selfRowAfterCast.spells as { slotsUsed?: Record<string, number> } | null) ?? {};
    check(
      '75.K) self-target falha (CD 24 > save máx. 21): cast resolved/effect pela fonte Mago, espaço gasto, sem concentração permanente e sem Paralyzed (sem loop)',
      applyK.status === 201 &&
        pendingK?.dc === 24 &&
        pendingK?.ability === 'wisdom' &&
        21 < pendingK!.dc &&
        castK?.spellcastingSourceKind === 'class' &&
        castK?.spellcastingSourceId === 'wizard' &&
        castK?.spellcastingAbility === 'intelligence' &&
        (slotsK.slotsUsed?.['2'] ?? 0) === 1 &&
        rollK.status === 201 &&
        castK?.status === 'resolved' &&
        castK?.outcome === 'effect' &&
        casterK.state.concentration === null &&
        effectK?.status === 'ended' &&
        residualK === 0 &&
        (await effectsOf(selfEntity)).filter((effect) => effect.definitionId === 'spell.hold-person').length === 0,
      JSON.stringify({
        cast: castK?.outcome,
        dc: pendingK?.dc,
        slot: slotsK.slotsUsed,
        concentration: casterK.state.concentration,
        residual: residualK,
      }),
    );

    // =====================================================================
    // L — caster incapacitado DURANTE a pendência: nenhum Effect concentrado
    // =====================================================================
    const opL = newOperation();
    await forceSave('failure', caster.id, targetEntity);
    const applyL = await holdPerson(casterEntity, targetEntity, masterToken, opL);
    const casterBeforeParalyzed = await mechanicalOf(casterEntity);
    const paralyzeCaster = await request(
      '/mechanical/mutate',
      {
        entity: casterEntity,
        expectedVersion: casterBeforeParalyzed.version,
        operationId: newOperation(),
        action: 'apply',
        condition: 'paralyzed',
        sourceLabel: 'Teste 6.6A',
      },
      masterToken,
    );
    const rollL = await rollSave(applyL.data.pending.id);
    const castL = await castRow(opL);
    const casterL = await mechanicalOf(casterEntity);
    check(
      '75.L) caster Incapacitado durante a pendência: a falha resolve o cast, mas nenhum Effect/Concentração permanece',
      applyL.status === 201 &&
        paralyzeCaster.status === 200 &&
        rollL.status === 201 &&
        castL?.status === 'resolved' &&
        castL?.outcome === 'effect' &&
        casterL.state.concentration === null &&
        (await effectsOf(targetEntity)).filter((effect) => effect.definitionId === 'spell.hold-person').length === 0,
      JSON.stringify({ cast: castL?.outcome, concentration: casterL.state.concentration }),
    );

    // =====================================================================
    // M — PLAYER continua sem conjurar (nem pela rota genérica)
    // =====================================================================
    const playerGeneric = await castProof(
      { operationId: newOperation(), spellId: 'bless', caster: casterEntity, targets: [targetEntity] },
      casterToken,
    );
    const playerBless = await bless(casterEntity, [targetEntity], casterToken);
    const playerHold = await holdPerson(casterEntity, targetEntity, casterToken);
    check(
      '75.M) PLAYER não conjura por NENHUMA rota (cast-proof/Bless/Hold Person → 403)',
      playerGeneric.status === 403 &&
        playerBless.status === 403 &&
        playerHold.status === 403,
      JSON.stringify({ generic: playerGeneric.status, bless: playerBless.status, hold: playerHold.status }),
    );

    // =====================================================================
    // N — PLAYER ainda resolve o PRÓPRIO save
    // =====================================================================
    const opN = newOperation();
    await forceSave('success', second.id, targetEntity);
    const applyN = await holdPerson(secondEntity, targetEntity, masterToken, opN);
    const playerSave = await rollSave(applyN.data.pending.id, targetToken);
    check(
      '75.N) PLAYER dono do alvo continua rolando a própria salvaguarda (sem regressão)',
      applyN.status === 201 &&
        playerSave.status === 201 &&
        (await castRow(opN))?.outcome === 'no-effect',
      JSON.stringify({ apply: applyN.status, roll: playerSave.status }),
    );

    // =====================================================================
    // O — Effect terminar depois NÃO reescreve o histórico do cast
    // =====================================================================
    const opO = newOperation();
    await forceSave('failure', second.id, allyEntity);
    const applyO = await holdPerson(secondEntity, allyEntity, masterToken, opO);
    const rollO = await rollSave(applyO.data.pending.id);
    const castO = await castRow(opO);
    const allyEffectsO = await effectsOf(allyEntity);
    await request(`/effects/${allyEffectsO[0].id}/end`, { operationId: newOperation() }, masterToken);
    const castOAfter = await castRow(opO);
    check(
      '75.O) Effect encerrado depois mantém o SpellCast como resolved/effect (histórico, não estado ativo)',
      rollO.status === 201 &&
        castO?.outcome === 'effect' &&
        castOAfter?.status === 'resolved' &&
        castOAfter?.outcome === 'effect' &&
        castOAfter?.effectGroupId === castO?.effectGroupId,
      JSON.stringify({ before: castO?.outcome, after: castOAfter?.outcome }),
    );

    // =====================================================================
    // P — concorrência REAL: dois commits simultâneos do mesmo caster
    // =====================================================================
    // Mesmo espaço nas duas intenções: a corrida é do LOCK/gasto, não da
    // escolha do recurso.
    const concurrencySlot = await pickCastingResource(baseUrl, masterToken, casterEntity, 2);
    const [concurrentA, concurrentB] = await Promise.all([
      holdPerson(casterEntity, targetEntity, masterToken, newOperation(), concurrencySlot ?? undefined),
      holdPerson(casterEntity, targetEntity, masterToken, newOperation(), concurrencySlot ?? undefined),
    ]);
    const statuses = [concurrentA.status, concurrentB.status].sort();
    const resolvingCount = await prisma.spellCast.count({
      where: { casterEntityId: caster.id, status: 'resolving' },
    });
    check(
      '75.P) dois casts simultâneos do mesmo caster: apenas UM commit válido (a corrida não deixa dois resolving)',
      statuses[0] === 201 &&
        statuses[1] === 409 &&
        resolvingCount === 1 &&
        // O perdedor falha no LOCK (o vencedor já está resolving) ou na guarda
        // de versão do espaço; os dois são 409 do SERVIDOR, nunca dois commits.
        [concurrentA, concurrentB].some(
          (item) =>
            item.data.error === 'SPELL_CAST_IN_PROGRESS' ||
            item.data.error === 'SPELLCASTING_RESOURCE_NOT_AVAILABLE',
        ),
      JSON.stringify({ statuses, resolvingCount }),
    );
    // Libera o lock do vencedor (CD 1 → sucesso).
    const winnerPending = await prisma.pendingEffectSave.findFirst({
      where: { casterEntityId: caster.id, status: 'pending' },
    });
    if (winnerPending) await rollSave(winnerPending.id, targetToken);
    check(
      '75.P.1) o lock é do BANCO (nenhum Map em memória) e libera ao resolver',
      (await prisma.spellCast.count({ where: { casterEntityId: caster.id, status: 'resolving' } })) === 0 &&
        source('spell-cast.service.ts').includes('spellCast.findFirst') &&
        !source('spell-cast.service.ts').includes('new Map('),
    );

    // =====================================================================
    // Q — nenhum slot/Ação é consumido (proof cast)
    // =====================================================================
    const beforeCast = await prisma.character.findUniqueOrThrow({ where: { id: second.id } });
    const plainCast = await bless(secondEntity, [allyEntity]);
    const afterCast = await prisma.character.findUniqueOrThrow({ where: { id: second.id } });
    check(
      '75.Q) proof cast continua SEM consumir Ação (classState/HP da ficha intactos — 6.6D)',
      plainCast.status === 201 &&
        JSON.stringify(beforeCast.classState) === JSON.stringify(afterCast.classState) &&
        beforeCast.hpCurrent === afterCast.hpCurrent,
      JSON.stringify({ classState: afterCast.classState }),
    );
  } finally {
    const casts = await prisma.spellCast.findMany({
      where: { operationId: { in: operationIds } },
      select: { id: true, effectGroupId: true },
    });
    const castIds = casts.map((row) => row.id);
    const groups = [...groupIds, ...casts.map((row) => row.effectGroupId).filter((id): id is string => !!id)];
    if (castIds.length > 0) {
      await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
    }
    if (groups.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { groupId: { in: groups } } });
    }
    const entityIds = [...characterIds, ...creatureIds];
    if (entityIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { targetEntityId: { in: entityIds } } });
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (operationIds.length > 0) {
      await prisma.spellCast.deleteMany({ where: { operationId: { in: operationIds } } });
      await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    }
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

/** Lê o arquivo-fonte do módulo de conjuração (invariante estrutural). */
function source(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', 'modules', 'spells', 'execution', file), 'utf8');
}
