import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { setExhaustionRuleEnabled } from '../modules/shared/exhaustion-flag.js';
import { deriveConditionEffects, effectiveMaxHp, effectiveSpeed, type MechanicalEntity } from '../modules/shared/conditions.js';
import type { MechanicalDto } from '../modules/mechanical/mechanical.service.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * HOTFIX 6.2/6.3 — Exaustão como regra OPCIONAL da mesa.
 *
 * Prova, contra o SERVIDOR real, que:
 *  A/B) campanha nova nasce com a regra DESLIGADA e a existente continua LIGADA;
 *  C/D) só o Mestre altera;
 *  E–J) com a regra desligada, os níveis 1..6 são mecanicamente INERTES;
 *  K/L) religar restaura o valor salvo (nunca é apagado nem zerado);
 *  M/N/O) Poisoned, Prone e a persistência fora de combate seguem funcionando;
 *  P/Q/R) Exaustão 6 desligada não abre morte; ligada abre; morte instantânea é
 *         independente da opção;
 *  S/T) o DTO não/traz status de Exaustão conforme a regra;
 *  U) os valores efetivos continuam nos campos principais (deslocamento e PV
 *     máximo), sem segundo contador.
 *
 * Fixtures próprias (usuário/criatura/combate) e limpeza no `finally`.
 */
export async function smokeExhaustionRule(baseUrl: string, check: Check): Promise<void> {
  console.log('\n65) Hotfix 6.2/6.3 — Exaustão opcional da mesa e Condições integradas');
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const entityIds: string[] = [];
  let combatId: string | undefined;
  let characterId = '';
  let creatureId = '';
  const stored = await prisma.gameConfig.findUnique({ where: { id: 'main' } });
  const original = stored?.exhaustionEnabled ?? false;

  try {
    // A) Uma campanha NOVA usa o default da coluna: desligada.
    const fresh = await prisma.gameConfig.create({ data: { id: `smoke-new-${suffix}` } });
    check('65) A. campanha NOVA nasce com a Exaustão DESLIGADA', fresh.exhaustionEnabled === false);
    await prisma.gameConfig.delete({ where: { id: fresh.id } });

    // B) O ARTEFATO da migration: a coluna nasce `DEFAULT false` (campanha NOVA
    //    desligada) e o backfill marca como `true` as configurações EXISTENTES —
    //    é isso que impede uma mesa em andamento de mudar de comportamento em
    //    silêncio. O valor VIVO da mesa pode ter sido alterado pelo Mestre depois
    //    do backfill (o smoke normaliza a regra para ligada nas seções 63/64 e
    //    devolve a escolha no fim), então o que se verifica aqui é o arquivo.
    const migrationSql = await readFile(
      new URL('../../prisma/migrations/20261012170000_add_exhaustion_enabled/migration.sql', import.meta.url),
      'utf8',
    );
    check(
      '65) B. a migration cria a coluna DESLIGADA para campanhas novas e faz backfill das EXISTENTES para ligada',
      /ADD COLUMN "exhaustionEnabled" BOOLEAN NOT NULL DEFAULT false/.test(migrationSql) &&
        /UPDATE "game_config" SET "exhaustionEnabled" = true/.test(migrationSql),
    );
    console.log('   (o smoke normaliza a regra de Exaustão para LIGADA e devolve a escolha do Mestre ao final)');

    // Gating das derivações PURAS (as mesmas funções que o servidor usa).
    setExhaustionRuleEnabled(false);
    check('65) E-J) derivações puras ficam inertes com a regra DESLIGADA',
      deriveConditionEffects({ exhaustionLevel: 6 }).fatalByExhaustion === false &&
      deriveConditionEffects({ exhaustionLevel: 1 }).checkDisadvantage === false &&
      deriveConditionEffects({ exhaustionLevel: 3 }).saveDisadvantage === false &&
      deriveConditionEffects({ exhaustionLevel: 5 }).speedZero === false &&
      effectiveMaxHp(101, { exhaustionLevel: 4 }) === 101 &&
      effectiveSpeed(30, { exhaustionLevel: 4 }) === 30 &&
      deriveConditionEffects({ exhaustionLevel: 2 }).exhaustionEnabled === false);
    setExhaustionRuleEnabled(true);
    check('65) T) derivações puras voltam a valer com a regra LIGADA',
      deriveConditionEffects({ exhaustionLevel: 6 }).fatalByExhaustion === true &&
      effectiveMaxHp(101, { exhaustionLevel: 4 }) === 50 &&
      deriveConditionEffects({ exhaustionLevel: 2 }).exhaustionSummary.length >= 2);

    const master = await prisma.user.create({ data: { username: `exh_m_${suffix}`, displayName: 'Mestre Exaustão', passwordHash: 'fixture', role: 'MASTER' } }); userIds.push(master.id);
    const player = await prisma.user.create({ data: { username: `exh_p_${suffix}`, displayName: 'Jogador Exaustão', passwordHash: 'fixture', role: 'PLAYER' } }); userIds.push(player.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });
    const character = await prisma.character.create({ data: { userId: player.id, name: 'Heroína Exaustão', hpCurrent: 101, hpMax: 101, speed: 30, classes: [{ classKey: 'fighter', level: 5, subclass: '' }] } });
    characterId = character.id;
    entityIds.push(character.id);
    const creature = await prisma.creature.create({ data: { name: `Alvo Exaustão ${suffix}`, hpCurrent: 40, hpMax: 40, speed: 9 } });
    creatureId = creature.id;
    entityIds.push(creature.id);
    const ownEntity: MechanicalEntity = { kind: 'character', id: character.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, data: await res.json() as any };
    }
    const read = async (entity: MechanicalEntity = ownEntity) => (await request(`/mechanical/${entity.kind}/${entity.id}`)).data.mechanical as MechanicalDto;
    async function mutation(entity: MechanicalEntity, extra: Record<string, unknown>, token = masterToken) {
      const current = await read(entity);
      return request('/mechanical/mutate', { entity: current.entity, expectedVersion: current.version, expectedCombatVersion: current.combat?.version, operationId: randomUUID(), ...extra }, token);
    }
    const exhaust = async (level: number) => mutation(ownEntity, { action: 'exhaustion', exhaustionLevel: level });
    const apply = async (condition: string) => mutation(ownEntity, { action: 'apply', condition, sourceLabel: 'Smoke 65' });
    const clear = async () => { for (const instance of (await read()).state.conditions) await mutation(ownEntity, { action: 'remove', instanceId: instance.id }); };
    const deathDto = async () => ((await request(`/death/character/${character.id}`)).data.death as { pending: { kind: string } | null; death: { dead: boolean } });
    const setRule = async (enabled: boolean, token = masterToken) => request('/game/exhaustion', { enabled }, token);

    // C/D) Permissões.
    const turnedOff = await setRule(false);
    check('65) C. MASTER desliga a regra de Exaustão', turnedOff.status === 200 && turnedOff.data.config.exhaustionEnabled === false);
    check('65) D. PLAYER não altera a regra de Exaustão', (await setRule(true, playerToken)).status === 403);
    check('65) D. PLAYER não liga a regra por rota direta', (await request('/game/exhaustion', { enabled: true }, playerToken)).status === 403);

    // E–J) Níveis 1..6 inertes com a regra DESLIGADA (checado pelo DTO real).
    const inert = async (level: number) => { await exhaust(level); return read(); };
    const l1 = await inert(1);
    check('65) E. nível 1 desligado não gera desvantagem em testes', l1.state.exhaustionLevel === 1 && l1.effects.checkDisadvantage === false && l1.effects.exhaustionSummary.length === 0);
    const l2 = await inert(2);
    check('65) F. nível 2 desligado não reduz o deslocamento', l2.effectiveSpeed === 30 && l2.effects.speedMultiplier === 1);
    const l3 = await inert(3);
    check('65) G. nível 3 desligado não gera desvantagem em ataques/salvaguardas', l3.effects.saveDisadvantage === false && !l3.effects.attackDisadvantages.includes('exhaustion'));
    const l4 = await inert(4);
    check('65) H. nível 4 desligado não reduz o PV máximo', l4.effectiveMaxHp === 101 && l4.effects.hpMaxMultiplier === 1);
    const l5 = await inert(5);
    check('65) I. nível 5 desligado não zera o deslocamento', l5.effects.speedZero === false && l5.effectiveSpeed === 30);
    const l6 = await inert(6);
    check('65) J. nível 6 desligado não indica fatalidade', l6.state.exhaustionLevel === 6 && l6.effects.fatalByExhaustion === false);
    check('65) S. DTO não apresenta status de Exaustão com a regra DESLIGADA', l6.effects.exhaustionEnabled === false && l6.effects.exhaustionSummary.length === 0);

    // P) Exaustão 6 desligada NÃO abre decisão de morte.
    const deathOff = await deathDto();
    check('65) P. Exaustão 6 desligada não gera morte pendente', deathOff.pending === null && deathOff.death.dead === false);

    // Checks e salvaguardas REAIS (o servidor rola 1d20 sem a desvantagem).
    await exhaust(1);
    const skillOff = await request('/dice/roll', { entity: ownEntity, kind: 'skill', ability: 'wisdom', dice: [{ sides: 20 }], label: 'Percepção' }, playerToken);
    check('65) E. rolagem de perícia real com a regra desligada usa um único d20', skillOff.status === 201 && skillOff.data.roll.dice.length === 1);
    await exhaust(3);
    const saveOff = await request('/dice/roll', { entity: ownEntity, kind: 'save', ability: 'wisdom', dice: [{ sides: 20 }], label: 'Salvaguarda de Sabedoria' }, playerToken);
    check('65) G. salvaguarda real com a regra desligada usa um único d20', saveOff.status === 201 && saveOff.data.roll.dice.length === 1);

    // K/L) Religar restaura o valor salvo; nada é apagado.
    await exhaust(4);
    const beforeOn = await read();
    check('65) K. nível 4 salvo fica inerte com a regra desligada', beforeOn.effectiveMaxHp === 101 && beforeOn.effectiveSpeed === 30);
    check('65) L. desligar a regra NÃO apaga o nível salvo', beforeOn.state.exhaustionLevel === 4);
    const turnedOn = await setRule(true);
    const afterOn = await read();
    check('65) K. religar restaura os efeitos do nível 4 (PHB 2014)', turnedOn.status === 200 && afterOn.state.exhaustionLevel === 4 && afterOn.effectiveMaxHp === 50 && afterOn.effectiveSpeed === 15 && afterOn.effects.saveDisadvantage === true);
    check('65) T. DTO apresenta o status de Exaustão com a regra LIGADA', afterOn.effects.exhaustionEnabled === true && afterOn.effects.exhaustionSummary.length >= 3);

    // M/N/O) Conditions continuam funcionando e persistindo.
    await setRule(false);
    await clear();
    await apply('poisoned');
    const poisoned = await read();
    check('65) M. Poisoned continua funcionando com a Exaustão desligada', poisoned.effects.checkDisadvantage === true && poisoned.effects.attackDisadvantages.includes('poisoned'));
    await apply('prone');
    const prone = await read();
    check('65) N. Prone continua funcionando com a Exaustão desligada', prone.effects.prone === true && prone.effects.movementCostMultiplier === 2 && prone.effectiveSpeed === 30);
    const reread = await read();
    check('65) O. condições persistem fora de combate', reread.state.conditions.some(instance => instance.condition === 'poisoned') && reread.state.conditions.some(instance => instance.condition === 'prone'));
    await clear();

    // Q) Ligada, a Exaustão 6 volta a abrir a MESMA decisão de morte da 6.3.
    await setRule(true);
    await exhaust(6);
    const deathOn = await deathDto();
    check('65) Q. Exaustão 6 com a regra LIGADA abre a decisão do Mestre', deathOn.pending?.kind === 'exhaustion' && deathOn.death.dead === false);
    const resolved = await request('/death/resolve', { entity: ownEntity, expectedVersion: (await read()).version, operationId: randomUUID(), decision: 'narrative-1hp', reason: 'Smoke 65' });
    check('65) Q. o Mestre resolve a pendência (recurso narrativo, 1 PV)', resolved.status === 200 && (await read()).hpCurrent === 1);

    // R) Morte INSTANTÂNEA independe da opção de Exaustão (regra desligada).
    await setRule(false);
    const started = await request('/combat', { entries: [{ creatureId: creature.id, quantity: 1 }] });
    if (started.status !== 201) throw new Error(`Não iniciou o combate do smoke 65: ${JSON.stringify(started.data)}`);
    let combat = started.data.combat as { id: string; combatants: { id: string; characterId: string | null; rolled: boolean }[] };
    combatId = combat.id;
    for (const participant of combat.combatants.filter(item => !item.rolled)) await request(`/combat/initiative/${participant.id}`, {});
    const active = await request('/combat/active');
    combat = active.data.combat;
    const heroCombatant = combat.combatants.find(item => item.characterId === character.id);
    check('65) R. personagem entra no combate para o teste de morte instantânea', Boolean(heroCombatant) && active.data.combat.status === 'ACTIVE');
    if (!heroCombatant) throw new Error('O personagem do smoke 65 não entrou no combate.');
    const damage = await request('/combat/hp', { combatantId: heroCombatant.id, amount: 202, mode: 'damage' });
    const instant = await deathDto();
    check('65) R. morte instantânea continua valendo com a Exaustão desligada', damage.status === 200 && instant.pending?.kind === 'instant-death' && instant.death.dead === false, JSON.stringify({ damage: damage.status, pending: instant.pending?.kind }));
    check('65) J. a morte instantânea não veio da Exaustão desligada', (await read()).state.exhaustionLevel === 6 && (await read()).effects.fatalByExhaustion === false);
    await request('/combat/end', {});

    // U) Os valores EFETIVOS continuam nos campos principais do DTO (sem duplicar).
    await setRule(true);
    await request('/death/override', { entity: ownEntity, expectedVersion: (await read()).version, operationId: randomUUID(), action: 'revive', reason: 'Smoke 65' });
    await exhaust(4);
    const effective = await read();
    check('65) U. deslocamento e PV máximo efetivos vivem no próprio DTO principal',
      effective.effectiveSpeed === 15 && effective.effectiveMaxHp === 50 && effective.state.exhaustionLevel === 4);
  } finally {
    // Restaura a regra da mesa e limpa APENAS as fixtures criadas aqui.
    setExhaustionRuleEnabled(true);
    await prisma.gameConfig.update({ where: { id: 'main' }, data: { exhaustionEnabled: original } }).catch(() => undefined);
    if (combatId) {
      const participants = await prisma.combatant.findMany({ where: { combatId }, select: { id: true } });
      entityIds.push(...participants.map(item => item.id));
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (characterId) await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
