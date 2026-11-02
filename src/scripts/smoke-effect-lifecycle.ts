import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { endEffectGroup } from '../modules/effects/effects.service.js';
import { findEndedEffectsWithLiveConditions } from '../modules/effects/effect-lifecycle.js';
import { HP_ZERO_SOURCE } from '../modules/shared/death.js';
import { mechanicalStateOf, type MechanicalEntity } from '../modules/shared/conditions.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.5D — LIFECYCLE CENTRAL DE ENCERRAMENTO.
 *
 * Prova que `endEffect`/`endEffectGroup` desmontam TUDO o que a instância
 * produziu, pelo mesmo pipeline: modificadores deixam de ser derivados (status
 * `ended`), Conditions daquela fonte somem, fonte manual/outro Effect/`hp-zero`
 * permanecem, retry não reescreve `endedAt`/`endReason` e a remoção ESTRUTURAL
 * de entidade não deixa efeito órfão. Nada de duração/dispel/spell aqui.
 */
export async function smokeEffectLifecycle(baseUrl: string, check: Check): Promise<void> {
  console.log('\n72) Fase 6.5D — lifecycle central de Effects');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const combatantIds: string[] = [];
  const effectIds: string[] = [];
  const operationIds: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({ data: { username: `efl_m_${suffix}`, displayName: 'Mestre Lifecycle', passwordHash: 'fixture', role: 'MASTER' } });
    const player = await prisma.user.create({ data: { username: `efl_p_${suffix}`, displayName: 'Jogador Lifecycle', passwordHash: 'fixture', role: 'PLAYER' } });
    const other = await prisma.user.create({ data: { username: `efl_o_${suffix}`, displayName: 'Outro Lifecycle', passwordHash: 'fixture', role: 'PLAYER' } });
    userIds.push(master.id, player.id, other.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });
    const otherToken = signToken({ sub: other.id, username: other.username, displayName: other.displayName, role: other.role });

    const hero = await prisma.character.create({ data: { userId: player.id, name: 'Herói Lifecycle', hpCurrent: 40, hpMax: 40, constitution: 14, speed: 9 } });
    const ally = await prisma.character.create({ data: { userId: other.id, name: 'Aliado Lifecycle', hpCurrent: 40, hpMax: 40, constitution: 14, speed: 9 } });
    characterIds.push(hero.id, ally.id);

    const template = await prisma.creature.create({ data: { name: 'Goblin Lifecycle', kind: 'CREATURE', hpCurrent: 20, hpMax: 20, speed: 9 } });
    const doomed = await prisma.creature.create({ data: { name: 'Criatura Removida', kind: 'CREATURE', hpCurrent: 10, hpMax: 10, speed: 9 } });
    creatureIds.push(template.id, doomed.id);

    const heroEntity: MechanicalEntity = { kind: 'character', id: hero.id };
    const allyEntity: MechanicalEntity = { kind: 'character', id: ally.id };
    const templateEntity: MechanicalEntity = { kind: 'creature', id: template.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function del(path: string, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function create(body: Record<string, unknown>) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      const res = await request('/effects', {
        operationId,
        label: 'Efeito de lifecycle',
        target: heroEntity,
        visibility: 'public',
        sourceType: 'manual',
        ...body,
      });
      if (res.status === 201 && res.data.effect) effectIds.push(res.data.effect.id);
      return res;
    }

    async function end(effectId: string, body: Record<string, unknown> = {}) {
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request(`/effects/${effectId}/end`, { operationId, ...body });
    }

    async function list(entity: MechanicalEntity, token = masterToken): Promise<EffectDto[]> {
      return (await request(`/effects/${entity.kind}/${entity.id}`, undefined, token)).data.effects as EffectDto[];
    }

    async function mechanicalOf(entity: MechanicalEntity, token = masterToken) {
      return (await request(`/mechanical/${entity.kind}/${entity.id}`, undefined, token)).data.mechanical;
    }

    async function conditionsOf(entity: MechanicalEntity, token = masterToken) {
      return ((await mechanicalOf(entity, token)).state.conditions ?? []) as {
        id: string; condition: string; sourceType?: string; sourceId?: string; sourceLabel?: string;
      }[];
    }

    async function sheetOf(token = playerToken) {
      const res = await request('/characters/me', undefined, token);
      if (res.status !== 200) throw new Error(`Falha ao ler a ficha: ${res.status} ${JSON.stringify(res.data)}`);
      return res.data.character as { armorClass: number; effectiveSpeed: number; version: number };
    }

    async function mutate(entity: MechanicalEntity, extra: Record<string, unknown>) {
      const mechanical = await mechanicalOf(entity);
      const operationId = randomUUID();
      operationIds.push(operationId);
      return request('/mechanical/mutate', {
        entity,
        expectedVersion: mechanical.version,
        ...(mechanical.combat ? { expectedCombatVersion: mechanical.combat.version } : {}),
        operationId,
        ...extra,
      });
    }

    async function effectRow(effectId: string) {
      return prisma.effectInstance.findUniqueOrThrow({ where: { id: effectId } });
    }

    // =====================================================================
    // A/B/C — consequências combinadas e idempotência do encerramento
    // =====================================================================
    const base = await sheetOf();
    const combined = await create({
      label: 'Combinado 6.5D',
      conditions: ['poisoned'],
      modifiers: [{ kind: 'ac-flat', value: 2 }, { kind: 'speed-flat', value: 3 }],
    });
    const withCombined = await sheetOf();
    check(
      '72.A) Effect ativo aplica CA +2, speed +3 e Poisoned ao mesmo tempo',
      combined.status === 201 &&
        withCombined.armorClass === base.armorClass + 2 &&
        withCombined.effectiveSpeed === base.effectiveSpeed + 3 &&
        (await conditionsOf(heroEntity)).some(
          (item) => item.condition === 'poisoned' && item.sourceType === 'effect' && item.sourceId === combined.data.effect.id,
        ),
      JSON.stringify({ base, withCombined }),
    );

    const endedCombined = await end(combined.data.effect.id);
    const afterCombined = await sheetOf();
    const combinedRow = await effectRow(combined.data.effect.id);
    const combinedEndedAt = combinedRow.endedAt?.toISOString();
    check(
      '72.B) endEffect desmonta TUDO: CA volta, speed volta e a Condition daquela fonte sai',
      endedCombined.status === 200 &&
        endedCombined.data.effect.status === 'ended' &&
        combinedRow.status === 'ended' &&
        combinedRow.endReason === 'manual' &&
        Boolean(combinedEndedAt) &&
        afterCombined.armorClass === base.armorClass &&
        afterCombined.effectiveSpeed === base.effectiveSpeed &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceId === combined.data.effect.id),
      JSON.stringify({ afterCombined, row: combinedRow }),
    );

    const endedAgain = await end(combined.data.effect.id, { reason: 'system' });
    const repeatedRow = await effectRow(combined.data.effect.id);
    check(
      '72.C) endEffect é idempotente: retry não altera endedAt nem endReason',
      endedAgain.status === 200 &&
        repeatedRow.endedAt?.toISOString() === combinedEndedAt &&
        repeatedRow.endReason === 'manual',
      JSON.stringify({ endedAt: repeatedRow.endedAt, endedAtBefore: combinedEndedAt, reason: repeatedRow.endReason }),
    );

    const concurrent = await create({ label: 'Concorrente 6.5D', target: allyEntity, conditions: ['blinded'] });
    const [concurrentA, concurrentB] = await Promise.all([
      end(concurrent.data.effect.id),
      end(concurrent.data.effect.id),
    ]);
    check(
      '72.D) encerramentos concorrentes: um estado final consistente e UMA limpeza',
      concurrentA.status === 200 &&
        concurrentB.status === 200 &&
        (await effectRow(concurrent.data.effect.id)).status === 'ended' &&
        !(await conditionsOf(allyEntity)).some((item) => item.sourceId === concurrent.data.effect.id),
      JSON.stringify({ a: concurrentA.status, b: concurrentB.status }),
    );

    // =====================================================================
    // E — fontes independentes da MESMA Condition
    // =====================================================================
    await mutate(heroEntity, { action: 'apply', condition: 'poisoned' });
    const poisonA = await create({ label: 'Veneno A 6.5D', conditions: ['poisoned'] });
    const poisonB = await create({ label: 'Veneno B 6.5D', conditions: ['poisoned'] });
    const poisonedBefore = (await conditionsOf(heroEntity)).filter((item) => item.condition === 'poisoned').length;
    await end(poisonA.data.effect.id);
    const poisonedAfterA = (await conditionsOf(heroEntity)).filter((item) => item.condition === 'poisoned').length;
    await end(poisonB.data.effect.id);
    const poisonedAfterB = (await conditionsOf(heroEntity)).filter((item) => item.condition === 'poisoned').length;
    check(
      '72.E) identidade por sourceId: encerrar A preserva manual + B; encerrar B preserva a manual',
      poisonedBefore === 3 && poisonedAfterA === 2 && poisonedAfterB === 1,
      JSON.stringify({ poisonedBefore, poisonedAfterA, poisonedAfterB }),
    );
    const manualPoison = (await conditionsOf(heroEntity)).find((item) => item.sourceType !== 'effect');
    if (manualPoison) await mutate(heroEntity, { action: 'remove', instanceId: manualPoison.id });

    // =====================================================================
    // F — grupo multi-alvo usa o MESMO lifecycle e não toca noutro grupo
    // =====================================================================
    const outsiderGroup = `efl-outsider-${suffix}`;
    const outsider = await create({ label: 'Fora do grupo 6.5D', groupId: outsiderGroup, modifiers: [{ kind: 'ac-flat', value: 2 }] });
    const heroBeforeGroup = await sheetOf();
    const allyBase = await sheetOf(otherToken);
    const groupId = `efl-group-${suffix}`;
    const groupHero = await create({
      label: 'Grupo herói',
      groupId,
      conditions: ['poisoned'],
      modifiers: [{ kind: 'ac-flat', value: 1 }],
    });
    const groupAlly = await create({
      label: 'Grupo aliado',
      groupId,
      target: allyEntity,
      conditions: ['grappled'],
      modifiers: [{ kind: 'speed-flat', value: 3 }],
    });
    const groupCreature = await create({
      label: 'Grupo criatura',
      groupId,
      target: templateEntity,
      conditions: ['blinded'],
      modifiers: [{ kind: 'ac-flat', value: 1 }],
    });
    // Sem bônus de speed o aliado fica Agarrado (0 m); o +3 é DERIVADO, mas o
    // zero por Condition vence por último — prova a integração 6.5B + 6.5C.
    const allyWithGroup = await sheetOf(otherToken);
    const targets = await endEffectGroup(groupId, 'manual', prisma);
    const heroAfterGroup = await sheetOf();
    const allyAfterGroup = await sheetOf(otherToken);
    const groupRows = await prisma.effectInstance.findMany({
      where: { id: { in: [groupHero.data.effect.id, groupAlly.data.effect.id, groupCreature.data.effect.id] } },
      select: { id: true, status: true },
    });
    check(
      '72.F) endEffectGroup encerra os 3 alvos, desmonta modificadores/Conditions e preserva outro grupo',
      outsider.status === 201 &&
        groupHero.status === 201 && groupAlly.status === 201 && groupCreature.status === 201 &&
        allyWithGroup.effectiveSpeed === 0 &&
        targets.length === 3 &&
        groupRows.every((row) => row.status === 'ended') &&
        heroAfterGroup.armorClass === heroBeforeGroup.armorClass &&
        allyAfterGroup.effectiveSpeed === allyBase.effectiveSpeed &&
        (await effectRow(outsider.data.effect.id)).status === 'active' &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceId === groupHero.data.effect.id) &&
        !(await conditionsOf(allyEntity)).some((item) => item.sourceId === groupAlly.data.effect.id) &&
        !(await conditionsOf(templateEntity)).some((item) => item.sourceId === groupCreature.data.effect.id),
      JSON.stringify({
        targets: targets.length,
        groupStatuses: groupRows.map((row) => row.status),
        heroAc: [heroBeforeGroup.armorClass, heroAfterGroup.armorClass],
        allySpeed: [allyBase.effectiveSpeed, allyWithGroup.effectiveSpeed, allyAfterGroup.effectiveSpeed],
        outsider: (await effectRow(outsider.data.effect.id)).status,
        heroConditions: (await conditionsOf(heroEntity)).map((item) => item.condition),
        allyConditions: (await conditionsOf(allyEntity)).map((item) => item.condition),
        creatureConditions: (await conditionsOf(templateEntity)).map((item) => item.condition),
      }),
    );
    await end(outsider.data.effect.id);

    // =====================================================================
    // G — efeito PRIVADO: mecânica visível, nome secreto nunca existe
    // =====================================================================
    const secret = await create({ label: 'Segredo Lifecycle', visibility: 'private', conditions: ['poisoned'] });
    const secretCondition = (await conditionsOf(heroEntity)).find((item) => item.sourceId === secret.data.effect.id);
    const playerSecretView = await list(heroEntity, playerToken);
    check(
      '72.G) efeito privado aplica a Condition com rótulo neutro e não aparece para o PLAYER',
      secret.status === 201 &&
        secretCondition?.condition === 'poisoned' &&
        secretCondition?.sourceLabel === 'Efeito' &&
        !playerSecretView.some((effect) => effect.id === secret.data.effect.id) &&
        !JSON.stringify(playerSecretView).includes('Segredo Lifecycle'),
      JSON.stringify({ secretCondition, playerSecretView }),
    );
    await end(secret.data.effect.id);
    check(
      '72.G.1) encerrar o efeito privado remove a consequência sem vazar o nome secreto',
      !(await conditionsOf(heroEntity)).some((item) => item.sourceId === secret.data.effect.id) &&
        !JSON.stringify(await conditionsOf(heroEntity)).includes('Segredo Lifecycle'),
    );

    // =====================================================================
    // H — 0 PV protegido NÃO é tocado pelo cleanup
    // =====================================================================
    const heroRow = await prisma.character.findUniqueOrThrow({ where: { id: hero.id } });
    const hpZeroState = mechanicalStateOf(heroRow.mechanicalState);
    const hpZeroUnconscious = randomUUID();
    const hpZeroProne = randomUUID();
    const hpZeroAt = new Date().toISOString();
    hpZeroState.conditions.push(
      { id: hpZeroUnconscious, condition: 'unconscious', appliedAt: hpZeroAt, sourceType: HP_ZERO_SOURCE, sourceLabel: 'Inconsciente (0 PV)' },
      { id: hpZeroProne, condition: 'prone', appliedAt: hpZeroAt, sourceType: HP_ZERO_SOURCE, sourceLabel: 'Inconsciente (0 PV)' },
    );
    await prisma.character.update({
      where: { id: hero.id },
      data: { mechanicalState: hpZeroState as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    const hpEffect = await create({ label: 'Efeito com 0 PV', conditions: ['poisoned'] });
    await end(hpEffect.data.effect.id);
    const hpConditions = await conditionsOf(heroEntity);
    check(
      '72.H) lifecycle com 0 PV preserva Unconscious/Queda protegidos e remove só a própria fonte',
      hpConditions.some((item) => item.id === hpZeroUnconscious) &&
        hpConditions.some((item) => item.id === hpZeroProne) &&
        !hpConditions.some((item) => item.sourceId === hpEffect.data.effect.id),
      JSON.stringify(hpConditions),
    );
    await prisma.character.update({
      where: { id: hero.id },
      data: {
        mechanicalState: {
          ...hpZeroState,
          conditions: hpZeroState.conditions.filter((item) => item.id !== hpZeroUnconscious && item.id !== hpZeroProne),
        } as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    // =====================================================================
    // I/J — fonte a 0 PV (não concentrada) e saída do combate
    // =====================================================================
    const fromDyingSource = await create({
      label: 'Origem a 0 PV',
      target: heroEntity,
      sourceEntity: templateEntity,
      modifiers: [{ kind: 'ac-flat', value: 1 }],
    });
    await prisma.creature.update({ where: { id: template.id }, data: { hpCurrent: 0 } });
    check(
      '72.I) fonte NÃO concentrada a 0 PV não encerra o efeito (morte ≠ remoção estrutural)',
      fromDyingSource.status === 201 &&
        (await effectRow(fromDyingSource.data.effect.id)).status === 'active',
      JSON.stringify({ status: (await effectRow(fromDyingSource.data.effect.id)).status }),
    );

    const combatStarted = await request('/combat', { entries: [{ creatureId: template.id, quantity: 1 }] });
    if (combatStarted.status !== 201) throw new Error(`Não iniciou o combate da 6.5D: ${JSON.stringify(combatStarted.data)}`);
    const combat = combatStarted.data.combat as CombatDto;
    combatId = combat.id;
    combatantIds.push(...combat.combatants.map((item) => item.id));
    const heroCombatant = combat.combatants.find((item) => item.characterId === hero.id)!;

    async function setDodging(value: boolean) {
      const row = await prisma.combatant.findUniqueOrThrow({ where: { id: heroCombatant.id } });
      const economy = row.turnEconomy as Record<string, unknown>;
      await prisma.combatant.update({
        where: { id: heroCombatant.id },
        data: { turnEconomy: { ...economy, dodging: value } as Prisma.InputJsonValue },
      });
    }

    async function dexSave() {
      return request(
        '/dice/roll',
        { entity: heroEntity, dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', bonus: 0 },
        playerToken,
      );
    }

    await setDodging(true);
    const dodgeBase = await dexSave();
    const grapple = await create({ label: 'Agarrado no fim', conditions: ['grappled'] });
    const dodgeGrappled = await dexSave();
    await end(grapple.data.effect.id);
    const dodgeRestored = await dexSave();
    await setDodging(false);
    check(
      '72.J) Effect encerrado libera a Esquiva no mesmo instante (speed 0 → normal)',
      grapple.status === 201 &&
        dodgeBase.data.roll.advantage === true &&
        dodgeGrappled.data.roll.advantage === false && dodgeGrappled.data.roll.disadvantage === false &&
        dodgeRestored.data.roll.advantage === true,
      JSON.stringify({ base: dodgeBase.data.roll.advantage, grappled: dodgeGrappled.data.roll.advantage, restored: dodgeRestored.data.roll.advantage }),
    );

    await request('/combat/end', {});
    const afterCombatEffects = await list(heroEntity);
    check(
      '72.J.1) sair do combate NÃO encerra efeito persistente da ficha',
      afterCombatEffects.some((effect) => effect.id === fromDyingSource.data.effect.id),
      JSON.stringify(afterCombatEffects.map((effect) => effect.id)),
    );

    // =====================================================================
    // K — remoção ESTRUTURAL de criatura encerra efeitos (sem contaminar outros)
    // =====================================================================
    const doomedTarget = await create({
      label: 'Alvo da criatura removida',
      target: { kind: 'creature', id: doomed.id },
      conditions: ['poisoned'],
      modifiers: [{ kind: 'ac-flat', value: 1 }],
    });
    const doomedSource = await create({
      label: 'Origem removida',
      target: heroEntity,
      sourceEntity: { kind: 'creature', id: doomed.id },
      conditions: ['blinded'],
    });
    const removed = await del(`/creatures/${doomed.id}`);
    const doomedRows = await prisma.effectInstance.findMany({
      where: { id: { in: [doomedTarget.data.effect.id, doomedSource.data.effect.id] } },
      select: { id: true, status: true, endReason: true },
    });
    check(
      '72.K) remover a entidade encerra alvo (target-removed) e origem (source-removed)',
      removed.status === 204 &&
        doomedRows.every((row) => row.status === 'ended') &&
        doomedRows.find((row) => row.id === doomedTarget.data.effect.id)?.endReason === 'target-removed' &&
        doomedRows.find((row) => row.id === doomedSource.data.effect.id)?.endReason === 'source-removed' &&
        !(await conditionsOf(heroEntity)).some((item) => item.sourceId === doomedSource.data.effect.id),
      JSON.stringify({ removed: removed.status, doomedRows }),
    );

    // =====================================================================
    // L — invariante final: nenhum efeito encerrado mantém Condition viva
    // =====================================================================
    const tracked = new Set(effectIds);
    const orphans = (await findEndedEffectsWithLiveConditions(prisma)).filter((item) => tracked.has(item.effectId));
    check(
      '72.L) invariante 6.5D: nenhum Effect encerrado deste fluxo mantém Condition ativa',
      orphans.length === 0,
      JSON.stringify(orphans),
    );

    // A criatura usada como alvo/origem ainda pode existir; os efeitos dela
    // encerrados no delete não deixam Condition viva.
    const templateOrphans = (await findEndedEffectsWithLiveConditions(prisma)).filter(
      (item) => item.target.kind === 'creature' && item.target.id === doomed.id,
    );
    check('72.L.1) entidade removida não deixa diagnóstico órfão', templateOrphans.length === 0);
  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (effectIds.length > 0) await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
    if (operationIds.length > 0) await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    const entityIds = [...characterIds, ...creatureIds, ...combatantIds];
    if (entityIds.length > 0) {
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
