import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { pickCastingResource, withSpatialEvidence } from './spell-slot-fixtures.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import type { PendingEffectSaveDto } from '../modules/effects/pending-effect-saves.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.5H — IMOBILIZAR PESSOA como SEGUNDO efeito real.
 *
 * Prova o caminho completo Effect → Condition SEM hardcode:
 *  • aplicação MASTER-only cria só uma PENDÊNCIA persistente (nada mecânico
 *    antes do save);
 *  • a salvaguarda de SABEDORIA é resolvida pelo pipeline real, com atributo e
 *    CD fixados no SERVIDOR (o cliente manda apenas o id da pendência);
 *  • SUCESSO não cria Effect/Condition/Concentração;
 *  • FALHA cria um grupo + uma instância cujo `conditions: ['paralyzed']` vira
 *    uma ConditionInstance REAL do motor existente (sourceType 'effect');
 *  • Concentração do caster ligada ao grupo, substituindo a anterior;
 *  • self-target estabiliza (Paralyzed → Incapacitado → Concentração termina →
 *    grupo encerra → Paralyzed sai), sem loop;
 *  • duas fontes de Paralyzed coexistem e encerrar uma não remove a outra;
 *  • pendência sobrevive a reconnect e é cancelada na remoção estrutural.
 *
 * O que NÃO é testado aqui porque NÃO existe nesta fase: duração de 1 minuto,
 * save repetido no fim do turno, upcasting, alcance/componentes, Ação/slot e
 * conjuração por PLAYER.
 */
export async function smokeHoldPersonEffect(baseUrl: string, check: Check): Promise<void> {
  console.log('\n74) Fase 6.5H — Imobilizar Pessoa (Effect → Condition)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const operationIds: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({
      data: { username: `hp_m_${suffix}`, displayName: 'Mestre HP', passwordHash: 'fixture', role: 'MASTER' },
    });
    const heroUser = await prisma.user.create({
      data: { username: `hp_h_${suffix}`, displayName: 'Caster HP', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const targetUser = await prisma.user.create({
      data: { username: `hp_t_${suffix}`, displayName: 'Alvo HP', passwordHash: 'fixture', role: 'PLAYER' },
    });
    // Um personagem por usuário (constraint do domínio): o segundo caster de
    // Bless precisa de conta própria.
    const casterTwoUser = await prisma.user.create({
      data: { username: `hp_c_${suffix}`, displayName: 'Segundo Caster HP', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, heroUser.id, targetUser.id, casterTwoUser.id);

    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });
    const heroToken = signToken({
      sub: heroUser.id,
      username: heroUser.username,
      displayName: heroUser.displayName,
      role: heroUser.role,
    });
    const targetToken = signToken({
      sub: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      role: targetUser.role,
    });

    // 6.6B: o caster precisa de uma FONTE de conjuração real (Mago). A CD do save
    // passa a ser DERIVADA (8 + proficiência + INT) — ver `forceSave` abaixo.
    const hero = await prisma.character.create({
      data: {
        userId: heroUser.id,
        name: 'Caster HP',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
        intelligence: 16,
        // 6.6C: Hold Person (nível 2) precisa de espaço real; Mago 20 tem o pool
        // completo, mas o teste continua consumindo UM por conjuração.
        classes: [{ classKey: 'wizard', subclass: '', level: 20 }],
      },
    });
    const target = await prisma.character.create({
      data: {
        userId: targetUser.id,
        name: 'Alvo HP',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
      },
    });
    characterIds.push(hero.id, target.id);

    const humanoid = await prisma.creature.create({
      data: { name: 'Goblin HP', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 30, hpMax: 30, speed: 9 },
    });
    const otherHumanoid = await prisma.creature.create({
      data: { name: 'Goblin Intocado', kind: 'CREATURE', type: 'Humanoide', hpCurrent: 30, hpMax: 30, speed: 9 },
    });
    const beast = await prisma.creature.create({
      data: { name: 'Lobo HP', kind: 'CREATURE', type: 'Besta', hpCurrent: 30, hpMax: 30, speed: 12 },
    });
    creatureIds.push(humanoid.id, otherHumanoid.id, beast.id);

    const heroEntity = { kind: 'character' as const, id: hero.id };
    const targetEntity = { kind: 'character' as const, id: target.id };
    const humanoidEntity = { kind: 'creature' as const, id: humanoid.id };
    const otherHumanoidEntity = { kind: 'creature' as const, id: otherHumanoid.id };
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

    async function apply(
      caster: { kind: 'character' | 'creature'; id: string },
      alvo: { kind: 'character' | 'creature' | 'combatant'; id: string },
      token = masterToken,
      operationId: string = randomUUID(),
    ) {
      operationIds.push(operationId);
      // 6.6C: todo cast gasta um espaço REAL de nível >= 2. A escolha vem da
      // rota de recursos (o servidor valida posse/nível/remaining de novo).
      const castingResource = await pickCastingResource(baseUrl, masterToken, caster, 2);
      return request(
        '/effects/hold-person',
        { operationId, caster, target: alvo, ...(castingResource ? { castingResource } : {}) },
        token,
      );
    }

    /**
     * Resultado DETERMINÍSTICO do save sem burlar a autoridade do servidor: a CD
     * é derivada do caster (INT 1 → CD 5; INT 30 → CD 20) e o bônus do save vem
     * do alvo (SAB 30 → +10; SAB 1 → -5). O cliente continua sem enviar números.
     */
    async function forceSave(
      outcome: 'success' | 'failure',
      casterId: string,
      alvo: { kind: string; id: string },
    ): Promise<void> {
      // O atributo de conjuração depende da FONTE (INT/SAB/CAR), então os três
      // são ajustados: DC mínima (5) para sucesso, máxima (20) para falha.
      const casting = outcome === 'failure' ? 30 : 1;
      await prisma.character.update({
        where: { id: casterId },
        data: { intelligence: casting, wisdom: casting, charisma: casting },
      });
      const wisdom = outcome === 'failure' ? 1 : 30;
      if (alvo.kind === 'character') {
        await prisma.character.update({ where: { id: alvo.id }, data: { wisdom } });
      } else if (alvo.kind === 'creature') {
        await prisma.creature.update({ where: { id: alvo.id }, data: { wisdom } });
      }
    }

    async function pendingOf(entity: { kind: 'character' | 'creature' | 'combatant'; id: string }) {
      const res = await request(`/effects/pending/${entity.kind}/${entity.id}`);
      return (res.data.pending ?? []) as PendingEffectSaveDto[];
    }

    async function effectsOf(entity: { kind: 'character' | 'creature' | 'combatant'; id: string }) {
      const res = await request(`/effects/${entity.kind}/${entity.id}`);
      return (res.data.effects ?? []) as EffectDto[];
    }

    async function mechanicalOf(entity: { kind: 'character' | 'creature' | 'combatant'; id: string }) {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`);
      return res.data.mechanical as {
        version: number;
        state: {
          concentration: { id: string; label: string; sourceType: string; sourceId?: string } | null;
          pendingConcentrationSaves: unknown[];
          conditions: { condition: string; sourceType?: string; sourceId?: string }[];
        };
        effects: { incapacitated: boolean; speedZero: boolean };
        effectiveSpeed: number;
        combat?: { id: string; version: number } | null;
      };
    }

    async function rollSave(pendingId: string, token = masterToken, extra: Record<string, unknown> = {}) {
      return request(
        '/dice/roll',
        {
          kind: 'save',
          pendingEffectSaveId: pendingId,
          // Ignorado pelo servidor: a pendência fixa UM d20.
          dice: [{ sides: 20 }],
          ...extra,
        },
        token,
      );
    }

    // =====================================================================
    // A — aplicação controlada cria SÓ a pendência (nada mecânico)
    // =====================================================================
    await forceSave('success', hero.id, targetEntity);
    const first = await apply(heroEntity, targetEntity);
    const firstPending = first.data.pending as PendingEffectSaveDto;
    const targetPending = await pendingOf(targetEntity);
    const targetMechanicalBefore = await mechanicalOf(targetEntity);
    const heroBefore = await mechanicalOf(heroEntity);
    check(
      '74.A) MASTER cria a pendência com id canônico, Sabedoria, CD e caster do SERVIDOR — sem Effect/Condition/Concentração',
      first.status === 201 &&
        firstPending.definitionId === 'spell.hold-person' &&
        firstPending.ability === 'wisdom' &&
        // Derivada: Mago INT 1, nível 20 → 8 + 6 - 5 = 9.
        firstPending.dc === 9 &&
        firstPending.status === 'pending' &&
        firstPending.targetEntity.kind === 'character' &&
        firstPending.casterEntity.kind === 'character' &&
        firstPending.casterName === 'Caster HP' &&
        targetPending.length === 1 &&
        targetPending[0].id === firstPending.id &&
        (await effectsOf(targetEntity)).length === 0 &&
        targetMechanicalBefore.state.conditions.length === 0 &&
        heroBefore.state.concentration === null,
      JSON.stringify({ pending: firstPending, list: targetPending }),
    );

    // =====================================================================
    // B — permissões, alvo inválido, CD inválida e idempotência da aplicação
    // =====================================================================
    const asPlayer = await apply(heroEntity, targetEntity, targetToken);
    const beastApply = await apply(heroEntity, beastEntity);
    // Payload malicioso: o cliente tenta impor CD/atributo/proficiência. Zod
    // descarta esses campos e o replay do MESMO operationId devolve a pendência
    // original — a CD derivada NÃO muda.
    // O espaço faz parte do fingerprint (6.6C): o replay legítimo reenvia o
    // MESMO recurso; campos mecânicos inventados continuam sendo descartados.
    const replayResource = await pickCastingResource(baseUrl, masterToken, heroEntity, 2);
    const replay = await request(
      '/effects/hold-person',
      {
        operationId: operationIds[0],
        caster: heroEntity,
        target: targetEntity,
        ...(replayResource ? { castingResource: replayResource } : {}),
        dc: 99,
        spellcastingAbility: 'charisma',
        proficiencyBonus: 10,
      },
      masterToken,
    );
    check(
      '74.B) PLAYER não aplica, não humanoide é rejeitado ANTES do save e payload malicioso (DC/atributo/PB) NÃO altera a CD derivada',
      asPlayer.status === 403 &&
        beastApply.status === 409 &&
        beastApply.data.error === 'SPELL_TARGET_TYPE_INVALID' &&
        replay.status === 200 &&
        replay.data.replayed === true &&
        replay.data.pending.id === firstPending.id &&
        replay.data.pending.dc === 9 &&
        (await prisma.pendingEffectSave.count({ where: { targetEntityId: beast.id } })) === 0,
      JSON.stringify({ asPlayer: asPlayer.status, beast: beastApply.data, replay: replay.status, dc: replay.data.pending?.dc }),
    );

    // =====================================================================
    // C — SUCESSO: nenhum Effect, nenhuma Condition, nenhuma Concentração
    // =====================================================================
    const successRoll = await rollSave(firstPending.id, targetToken);
    const afterSuccess = await mechanicalOf(targetEntity);
    check(
      '74.C) save >= CD DERIVADA resolve SUCESSO: pendência some, zero Effect/Paralyzed e caster NÃO começa a concentrar',
      successRoll.status === 201 &&
        successRoll.data.roll.total >= firstPending.dc &&
        (await pendingOf(targetEntity)).length === 0 &&
        (await effectsOf(targetEntity)).length === 0 &&
        afterSuccess.state.conditions.length === 0 &&
        (await mechanicalOf(heroEntity)).state.concentration === null,
      JSON.stringify({ roll: successRoll.data.roll, conditions: afterSuccess.state.conditions }),
    );

    // =====================================================================
    // D — FALHA (NPC humanoide): Effect → Paralyzed → Concentração
    // =====================================================================
    await forceSave('failure', hero.id, humanoidEntity);
    const failApply = await apply(heroEntity, humanoidEntity);
    const failPending = failApply.data.pending as PendingEffectSaveDto;
    const failRoll = await rollSave(failPending.id);
    const humanoidEffects = await effectsOf(humanoidEntity);
    const humanoidMechanical = await mechanicalOf(humanoidEntity);
    const heroAfterFail = await mechanicalOf(heroEntity);
    const failEffect = humanoidEffects[0] as EffectDto;
    const paralyzed = humanoidMechanical.state.conditions.find(
      (item) => item.condition === 'paralyzed',
    );
    const resolvedRow = await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: failPending.id } });
    check(
      '74.D) falha cria UM Effect (Paralyzed) e liga a Concentração do caster ao grupo',
      failRoll.status === 201 &&
        failRoll.data.roll.total < failPending.dc &&
        humanoidEffects.length === 1 &&
        failEffect.definitionId === 'spell.hold-person' &&
        failEffect.conditions.join(',') === 'paralyzed' &&
        failEffect.modifiers.length === 0 &&
        failEffect.groupId === resolvedRow.groupId &&
        paralyzed?.sourceType === 'effect' &&
        paralyzed?.sourceId === failEffect.id &&
        humanoidMechanical.state.concentration === null &&
        heroAfterFail.state.concentration?.sourceType === 'effect' &&
        heroAfterFail.state.concentration?.sourceId === failEffect.groupId &&
        resolvedRow.status === 'resolved' &&
        resolvedRow.result === 'failure',
      JSON.stringify({ effects: humanoidEffects, conditions: humanoidMechanical.state.conditions, concentration: heroAfterFail.state.concentration }),
    );
    check(
      '74.D.1) Paralyzed é DERIVADO pelo motor (Incapacitado e deslocamento 0) — nada implementado no Hold Person',
      humanoidMechanical.effects.incapacitated &&
        humanoidMechanical.effects.speedZero &&
        humanoidMechanical.effectiveSpeed === 0,
      JSON.stringify(humanoidMechanical.effects),
    );

    // =====================================================================
    // E — Paralyzed MANUAL coexiste; encerrar o Effect remove só a fonte dele
    // =====================================================================
    const manualApply = await request(
      '/mechanical/mutate',
      {
        entity: humanoidEntity,
        expectedVersion: humanoidMechanical.version,
        operationId: randomUUID(),
        action: 'apply',
        condition: 'paralyzed',
        sourceLabel: 'Apanhado na rede',
      },
      masterToken,
    );
    const beforeEnd = await effectsOf(humanoidEntity);
    await request(`/effects/${failEffect.id}/end`, { operationId: randomUUID() }, masterToken);
    const afterEndMechanical = await mechanicalOf(humanoidEntity);
    const remainingParalyzed = afterEndMechanical.state.conditions.filter(
      (item) => item.condition === 'paralyzed',
    );
    check(
      '74.E) encerrar o Effect remove APENAS o Paralyzed daquela fonte; o manual permanece',
      manualApply.status === 200 &&
        beforeEnd.length === 1 &&
        remainingParalyzed.length === 1 &&
        remainingParalyzed[0].sourceType === 'manual',
      JSON.stringify({ beforeEnd: beforeEnd.length, remainingParalyzed }),
    );

    // =====================================================================
    // F — Bless (6.5G) compõe com o save pendente do Hold Person (6.5H)
    // =====================================================================
    const casterTwo = await prisma.character.create({
      data: {
        userId: casterTwoUser.id,
        name: 'Caster Two',
        hpCurrent: 10,
        hpMax: 10,
        speed: 9,
        intelligence: 16,
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    characterIds.push(casterTwo.id);
    const blessResource = await pickCastingResource(
      baseUrl,
      masterToken,
      { kind: 'character', id: casterTwo.id },
      1,
    );
    const bless = await request(
      '/effects/bless',
      {
        operationId: randomUUID(),
        caster: { kind: 'character', id: casterTwo.id },
        targets: [targetEntity],
        ...(blessResource ? { castingResource: blessResource } : {}),
      },
      masterToken,
    );
    operationIds.push(bless.data.effects?.[0]?.id ?? '');
    const blessEffect = (bless.data.effects ?? [])[0] as EffectDto;
    const blessOptions = await request(
      `/dice/options/character/${target.id}?roll=save&ability=wisdom`,
      undefined,
      targetToken,
    );
    const blessOption = (blessOptions.data.options ?? [])[0] as { id: string } | undefined;
    // Falha garantida pela CD DERIVADA (INT 30 → CD 20; alvo SAB 1 → máx. 15 + 1d4).
    // O ponto aqui é o d4 SERVIDOR-SIDE escolhido pelo cliente.
    await forceSave('failure', hero.id, targetEntity);
    const pendingBlessed = await apply(heroEntity, targetEntity);
    // 6.6A: o COMMIT (antes do save) encerra a concentração ANTERIOR do caster.
    const heroAtCommit = await mechanicalOf(heroEntity);
    const blessedRoll = await rollSave(pendingBlessed.data.pending.id, targetToken, {
      selectedEffectModifiers: [blessOption?.id],
    });
    const rollDice = (blessedRoll.data.roll?.effectModifiers?.dice ?? []) as { sides: number; value: number }[];
    const kept = (blessedRoll.data.roll?.dice ?? []).reduce(
      (sum: number, die: { dropped?: boolean; value: number }) =>
        die.dropped ? sum : sum + die.value,
      0,
    );
    check(
      '74.F) o save de Sabedoria do Hold Person aceita o +1d4 OPCIONAL do Bless, rolado pelo servidor',
      bless.status === 201 &&
        blessOptions.data.options.length === 1 &&
        blessOption?.id === `${blessEffect.id}:save` &&
        heroAtCommit.state.concentration === null &&
        blessedRoll.status === 201 &&
        rollDice.length === 1 &&
        rollDice[0].sides === 4 &&
        blessedRoll.data.roll.total ===
          kept + blessedRoll.data.roll.bonus + rollDice[0].value &&
        blessedRoll.data.roll.total < pendingBlessed.data.pending.dc,
      JSON.stringify({ options: blessOptions.data.options, roll: blessedRoll.data.roll }),
    );
    // Encerra o Effect do Bless (a concentração do caster 2 não fica presa).
    await request(`/effects/${blessEffect.id}/end`, { operationId: randomUUID() }, masterToken);
    // O Hold Person do alvo (falha acima) permanece ativo até o fim do teste.
    const targetAfterComposition = await effectsOf(targetEntity);
    check(
      '74.F.1) dois Effects reais coexistem no mesmo alvo (Bless encerra, Hold Person permanece)',
      targetAfterComposition.length === 1 &&
        targetAfterComposition[0].definitionId === 'spell.hold-person',
      JSON.stringify(targetAfterComposition),
    );

    // =====================================================================
    // G — self-target: Paralyzed → Incapacitado → Concentração termina → grupo
    // =====================================================================
    await forceSave('failure', hero.id, heroEntity);
    const selfApply = await apply(heroEntity, heroEntity);
    const selfRoll = await rollSave(selfApply.data.pending.id, heroToken);
    const selfMechanical = await mechanicalOf(heroEntity);
    const selfPendingRow = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: selfApply.data.pending.id },
    });
    const selfEffect = selfPendingRow.effectId
      ? await prisma.effectInstance.findUniqueOrThrow({ where: { id: selfPendingRow.effectId } })
      : null;
    const selfEffects = await effectsOf(heroEntity);
    check(
      '74.G) caster == alvo falha, fica Paralyzed, perde a concentração e o lifecycle limpa o grupo SEM loop',
      selfRoll.status === 201 &&
        selfRoll.data.roll.total < selfApply.data.pending.dc &&
        selfMechanical.state.concentration === null &&
        selfMechanical.state.conditions.every((item) => item.condition !== 'paralyzed') &&
        selfEffects.length === 0 &&
        selfEffect?.status === 'ended' &&
        selfEffect?.endReason === 'concentration',
      JSON.stringify({ mechanical: selfMechanical.state, effect: selfEffect?.status, effects: selfEffects }),
    );

    // =====================================================================
    // H — NPC do mesmo template fica isolado
    // =====================================================================
    check(
      '74.H) NPC do mesmo statblock NÃO recebe o efeito (isolamento por INSTÂNCIA)',
      (await effectsOf(otherHumanoidEntity)).length === 0 &&
        (await pendingOf(otherHumanoidEntity)).length === 0,
    );

    // =====================================================================
    // I — Cancelar a aplicação antes do save: nada é criado
    // =====================================================================
    const cancelApply = await apply(heroEntity, otherHumanoidEntity);
    const cancelled = await request(
      `/effects/pending/${cancelApply.data.pending.id}/cancel`,
      {},
      masterToken,
    );
    check(
      '74.I) cancelar a pendência é idempotente e NÃO cria Effect/Condition',
      cancelled.status === 200 &&
        cancelled.data.pending.status === 'cancelled' &&
        (await pendingOf(otherHumanoidEntity)).length === 0 &&
        (await effectsOf(otherHumanoidEntity)).length === 0,
    );

    // =====================================================================
    // J — remoção ESTRUTURAL do alvo cancela a pendência (nunca órfã)
    // =====================================================================
    const doomed = await prisma.creature.create({
      data: { name: 'NPC Removido', kind: 'NPC', type: 'Humanoide', hpCurrent: 10, hpMax: 10, speed: 9 },
    });
    const doomedEntity = { kind: 'creature' as const, id: doomed.id };
    const doomedApply = await apply(heroEntity, doomedEntity);
    const doomedDelete = await request(`/creatures/${doomed.id}`, {}, masterToken, 'DELETE');
    const doomedRow = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: doomedApply.data.pending.id },
    });
    check(
      '74.J) alvo removido estruturalmente cancela a pendência (nenhum efeito para entidade inexistente)',
      doomedDelete.status === 204 &&
        doomedRow.status === 'cancelled' &&
        (await prisma.effectInstance.count({ where: { targetEntityId: doomed.id } })) === 0,
      JSON.stringify({ delete: doomedDelete.status, status: doomedRow.status }),
    );

    // =====================================================================
    // K — resolução repetida não duplica consequência (concorrência lógica)
    // =====================================================================
    await forceSave('failure', hero.id, humanoidEntity);
    const repeatApply = await apply(heroEntity, humanoidEntity);
    const repeatPending = repeatApply.data.pending as PendingEffectSaveDto;
    const firstResolve = await rollSave(repeatPending.id);
    const secondResolve = await rollSave(repeatPending.id);
    const repeatEffects = await effectsOf(humanoidEntity);
    check(
      '74.K) resolver a MESMA pendência duas vezes devolve erro controlado e NÃO duplica Effect',
      firstResolve.status === 201 &&
        (secondResolve.status === 409 || secondResolve.status === 200) &&
        repeatEffects.filter((effect) => effect.definitionId === 'spell.hold-person').length === 1,
      JSON.stringify({ first: firstResolve.status, second: secondResolve.status }),
    );

    // =====================================================================
    // L — combatente de PERSONAGEM canonicaliza para a ficha
    // =====================================================================
    // Combate ENCERRADO de propósito: o teste é a CANONICALIZAÇÃO do alvo, não
    // a economia de turno — assim não disputa o índice de combate ativo único.
    const combat = await prisma.combat.create({
      data: {
        status: 'ENDED',
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: hero.id,
              ownerUserId: heroUser.id,
              name: hero.name,
              initiative: 100,
              dexterityMod: 2,
            },
            {
              kind: 'CREATURE',
              creatureId: humanoid.id,
              name: humanoid.name,
              hpCurrent: 30,
              hpMax: 30,
              armorClass: 10,
              initiative: 5,
              dexterityMod: 1,
            },
          ],
        },
      },
    });
    combatId = combat.id;
    const heroCombatant = await prisma.combatant.findFirstOrThrow({
      where: { combatId, characterId: hero.id },
    });
    const combatApply = await apply(heroEntity, { kind: 'combatant', id: heroCombatant.id });
    check(
      '74.L) alvo combatente de PERSONAGEM é canonicalizado para a FICHA (sem duplicar estado)',
      combatApply.status === 201 &&
        combatApply.data.pending.targetEntity.kind === 'character' &&
        combatApply.data.pending.targetEntity.id === hero.id,
      JSON.stringify(combatApply.data.pending?.targetEntity),
    );
  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    // 6.6A: a pendência pertence ao SpellCast (operationId próprio) — limpa
    // pelos casts das operações deste teste.
    const casts = await prisma.spellCast.findMany({
      where: { operationId: { in: operationIds } },
      select: { id: true },
    });
    const castIds = casts.map((row) => row.id);
    if (castIds.length > 0) {
      await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
    }
    await prisma.pendingEffectSave.deleteMany({ where: { operationId: { in: operationIds } } });
    if (operationIds.length > 0) {
      await prisma.spellCast.deleteMany({ where: { operationId: { in: operationIds } } });
      await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    }
    const entityIds = [...characterIds, ...creatureIds];
    if (entityIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { targetEntityId: { in: entityIds } } });
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (creatureIds.length > 0) {
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    }
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
