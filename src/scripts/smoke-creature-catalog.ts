/** Cadastro, arte por instância e oportunidades: somente fixtures em schema descartável. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
import { loadCombatById } from '../modules/combat/combat-load.js';
import { combatantCanReact } from '../modules/combat/combat.dto.js';
import { scanReactionThreats } from '../modules/combat/spatial/opportunity-openers.js';
async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  assert.ok(process.env.PLAYABLE_BASE_URL?.endsWith(':3131'));
  assert.equal(await prisma.user.count(), 0);
  const users: string[] = [],
    creatureIds: string[] = [];
  let characterId: string | undefined,
    regionId: string | undefined,
    combatId: string | undefined;
  let socket: ReturnType<typeof io> | undefined;
  try {
    const suffix = randomUUID();
    const master = await prisma.user.create({
      data: {
        username: 'master_' + suffix,
        displayName: 'Mestre fixture',
        role: 'MASTER',
        passwordHash: 'fixture',
      },
    });
    users.push(master.id);
    const owner = await prisma.user.create({
      data: {
        username: 'player_' + suffix,
        displayName: 'Jogador fixture',
        role: 'PLAYER',
        passwordHash: 'fixture',
      },
    });
    users.push(owner.id);
    const token = (u: typeof owner) =>
      signToken({
        sub: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
      });
    const request = async (
      path: string,
      body?: unknown,
      actor = master,
      method = body ? 'POST' : 'GET',
    ) => {
      const r = await fetch(process.env.PLAYABLE_BASE_URL + '/api' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token(actor),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: (await r.json()) as any };
    };
    const hero = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Herói fixture',
        raceId: 'human',
        hpCurrent: 30,
        hpMax: 30,
        speed: 9,
        classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
      },
    });
    characterId = hero.id;
    assert.equal(
      (await request('/characters/me', undefined, owner)).data.character.id,
      hero.id,
      'Sentinela HTTP e banco devem coincidir',
    );
    const region = await prisma.region.create({
      data: { name: 'Região ' + suffix },
    });
    regionId = region.id;
    const locality = await prisma.locality.create({
      data: { name: 'Local fixture', regionId: region.id },
    });
    const scene = await prisma.scene.create({
      data: {
        name: 'Cena fixture',
        localityId: locality.id,
        spatialConfig: {
          mode: 'grid-2d',
          widthFeet: 60,
          heightFeet: 40,
          cellSizeFeet: 5,
        },
      },
    });
    const images = [
      '/uploads/creatures/fixture_' + suffix + '_a.png',
      '/uploads/creatures/fixture_' + suffix + '_b.png',
    ];
    const input = {
      name: 'Sentinela ' + suffix,
      kind: 'CREATURE',
      localityIds: [locality.id],
      type: 'Humanoide',
      size: 'Medium',
      strength: 16,
      dexterity: 12,
      hpMax: 25,
      hpCurrent: 25,
      armorClass: 14,
      speed: 9,
      tokenImages: images,
      imageUrl: images[0],
      abilities: [
        { id: 'escape', name: 'Escape ágil', cost: 'bonus-action', execution: 'disengage', description: 'Desengajar como bônus', maxUses: 1 },
        { id: 'hide', name: 'Esconder-se', cost: 'bonus-action', execution: 'assisted', description: 'Teste assistido', maxUses: null },
        { id: 'guard', name: 'Guarda', cost: 'reaction', execution: 'assisted', trigger: 'Mestre confirma o gatilho', maxUses: 2 },
        { id: 'dash', name: 'Corrida', cost: 'action', execution: 'dash', maxUses: null },
        { id: 'dodge', name: 'Esquiva', cost: 'action', execution: 'dodge', maxUses: null },
        { id: 'senses', name: 'Sentidos', cost: 'passive', execution: 'assisted', maxUses: null },
      ],
      attacks: [
        {
          id: 'spear',
          name: 'Lança',
          attackBonus: 5,
          reachFeet: 5,
          damage: { count: 1, sides: 6, bonus: 3, type: 'Perfurante' },
          extraDamages: [{ count: 1, sides: 4, bonus: 0, type: 'Fogo' }],
        },
      ],
      spellcastingProfile: { ability: 'wisdom', saveDc: 12 },
      spellcastingResources: {
        spellSlots: [{ level: 1, max: 2 }],
        pactSlot: null,
      },
      spellRepertoire: { spellIds: ['bless'] },
      resistances: ['Frio'],
      description: 'Fixture do wizard',
    };
    assert.equal((await request('/creatures', input, owner)).status, 403);
    assert.equal((await request('/creatures', { ...input, abilities: [input.abilities[0], input.abilities[0]] })).status, 400);
    const created = await request('/creatures', input);
    assert.equal(created.status, 201, JSON.stringify(created));
    const creature = created.data.creature;
    creatureIds.push(creature.id);
    assert.equal(creature.attacks[0].extraDamages[0].type, 'Fogo');
    assert.equal(creature.strength, 16);
    assert.deepEqual(creature.tokenImages, images);
    assert.deepEqual(creature.spellRepertoire.spellIds, ['bless']);
    const started = await request('/combat', {
      characterIds: [hero.id],
      characterPositions: [
        { characterId: hero.id, position: { xFeet: 5, yFeet: 0 } },
      ],
      localityId: locality.id,
      sceneId: scene.id,
      entries: [
        {
          creatureId: creature.id,
          quantity: 3,
          positions: [
            { xFeet: 0, yFeet: 0 },
            { xFeet: 30, yFeet: 0 },
            { xFeet: 40, yFeet: 0 },
          ],
          spatialVisibilities: ['master-only', 'public', 'public'],
        },
      ],
    });
    assert.equal(started.status, 201, JSON.stringify(started));
    let combat = started.data.combat;
    combatId = combat.id;
    const copies = combat.combatants
      .filter((c: any) => c.kind === 'CREATURE')
      .sort((a: any, b: any) => a.tokenNumber - b.tokenNumber);
    const hidden = copies[0],
      heroUnit = combat.combatants.find((c: any) => c.characterId === hero.id);
    assert.deepEqual(
      copies.map((c: any) => c.tokenNumber),
      [1, 2, 3],
    );
    assert.notEqual(
      copies[0].spatial.tokenImageRef,
      copies[1].spatial.tokenImageRef,
    );
    const reload = (await request('/combat/active')).data.combat;
    assert.deepEqual(
      reload.combatants.map((c: any) => c.imageUrl),
      combat.combatants.map((c: any) => c.imageUrl),
    );
    const playerView = (await request('/combat/active', undefined, owner)).data
      .combat;
    assert.ok(
      !playerView.combatants.some((c: any) => c.id === hidden.id),
      'Oculto não pode aparecer na iniciativa',
    );
    assert.equal(playerView.combatants.length, 3);
    assert.equal(
      playerView.combatants.find((c: any) => c.id === copies[1].id).hpCurrent,
      null,
    );
    await request(
      '/creatures/' + creature.id,
      { tokenImages: ['/uploads/creatures/fixture_' + suffix + '_c.png'] },
      master,
      'PATCH',
    );
    const afterGallery = (await request('/combat/active')).data.combat;
    assert.deepEqual(
      afterGallery.combatants.map((c: any) => c.imageUrl),
      combat.combatants.map((c: any) => c.imageUrl),
    );
    console.log(
      '✔ Criação completa, galeria distribuída e arte persistida por cópia',
    );
    const events: { type: string; payload: any }[] = [];
    socket = io(process.env.PLAYABLE_BASE_URL!, {
      auth: { token: token(owner) },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error('Socket não conectou')),
        3000,
      );
      socket!.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket!.once('connect_error', reject);
    });
    socket.on('combat:turn', (p) => events.push({ type: 'turn', payload: p }));
    socket.on('dice:rolled', (p) => events.push({ type: 'dice', payload: p }));
    for (const unit of combat.combatants) {
      const r = await request('/combat/initiative/' + unit.id, {});
      assert.equal(r.status, 200);
      combat = r.data.combat;
    }
    await prisma.combatant.updateMany({
      where: { combatId },
      data: { initiative: 5 },
    });
    await prisma.combatant.update({
      where: { id: hidden.id },
      data: { initiative: 10, turnEconomy: onTurnStart(9) },
    });
    await prisma.combatant.update({
      where: { id: heroUnit.id },
      data: { initiative: 20, turnEconomy: onTurnStart(9) },
    });
    await prisma.combat.update({
      where: { id: combatId },
      data: { currentIndex: 0 },
    });
    combat = (await request('/combat/active')).data.combat;
    const next = await request('/combat/next-turn', {
      combatId,
      expectedVersion: combat.version,
      operationId: randomUUID(),
    });
    assert.equal(next.status, 200, JSON.stringify(next));
    combat = next.data.combat;
    assert.equal(combat.currentCombatantId, hidden.id);
    assert.equal(
      (await request('/combat/active', undefined, owner)).data.combat
        .currentCombatantId,
      null,
    );
    // Operações de habilidade usam somente as próprias cópias desta fixture.
    assert.equal(combat.combatants.find((c: any) => c.id === hidden.id).abilities.length, 6);
    const publicSkills = (await request('/combat/active', undefined, owner)).data.combat;
    assert.deepEqual(publicSkills.combatants.find((c: any) => c.id === copies[1].id).abilities, []);
    const abilityRequest = (abilityId: string, extra: Record<string, unknown> = {}) => ({
      combatId, expectedVersion: combat.version, operationId: randomUUID(), combatantId: hidden.id, abilityId, ...extra,
    });
    assert.equal((await request('/combat/creature-ability', abilityRequest('escape'), owner)).status, 403);
    assert.equal((await request('/combat/creature-ability', abilityRequest('senses'))).status, 400);
    assert.equal((await request('/combat/creature-ability', abilityRequest('hide'))).status, 400);
    const useInput = abilityRequest('escape');
    const use = await request('/combat/creature-ability', useInput);
    assert.equal(use.status, 200, JSON.stringify(use));
    combat = use.data.combat;
    let activeAbilityUnit = combat.combatants.find((c: any) => c.id === hidden.id);
    assert.equal(activeAbilityUnit.turnEconomy.bonusActionUsed, true);
    assert.equal(activeAbilityUnit.turnEconomy.disengaging, true);
    assert.equal(activeAbilityUnit.abilityUses.escape, 1);
    assert.equal(combat.combatants.find((c: any) => c.id === copies[1].id).abilityUses.escape, undefined);
    assert.equal((await request('/combat/creature-ability', useInput)).data.replayed, true);
    assert.equal((await request('/combat/creature-ability', { ...useInput, abilityId: 'hide' })).status, 409);
    assert.equal((await request('/combat/creature-ability', abilityRequest('escape'))).status, 409);
    assert.equal((await request('/combat/creature-ability', abilityRequest('hide', { confirmed: true }))).status, 409);
    // Zerar somente a economia desta fixture comprova limite independente da Ação Bônus.
    await prisma.combatant.update({ where: { id: hidden.id }, data: { turnEconomy: onTurnStart(9) } });
    assert.equal((await request('/combat/creature-ability', abilityRequest('escape'))).status, 409);
    const restored = await request('/combat/creature-ability', abilityRequest('escape', { mode: 'restore' }));
    assert.equal(restored.status, 200); combat = restored.data.combat;
    assert.equal(combat.combatants.find((c: any) => c.id === hidden.id).abilityUses.escape, 0);
    const hideUse = await request('/combat/creature-ability', abilityRequest('hide', { confirmed: true }));
    assert.equal(hideUse.status, 200); combat = hideUse.data.combat;
    const dashUse = await request('/combat/creature-ability', abilityRequest('dash'));
    assert.equal(dashUse.status, 200); combat = dashUse.data.combat;
    assert.equal(combat.combatants.find((c: any) => c.id === hidden.id).turnEconomy.movementBudget, 18);
    assert.equal(combat.combatants.find((c: any) => c.id === hidden.id).turnEconomy.actionsUsed, 1);
    await prisma.combatant.update({ where: { id: hidden.id }, data: { turnEconomy: onTurnStart(9) } });
    const dodgeUse = await request('/combat/creature-ability', abilityRequest('dodge'));
    assert.equal(dodgeUse.status, 200); combat = dodgeUse.data.combat;
    assert.equal(combat.combatants.find((c: any) => c.id === hidden.id).turnEconomy.dodging, true);
    // Habilidade assistida não cria invisibilidade, condição ou ocultação.
    assert.equal(combat.combatants.find((c: any) => c.id === copies[1].id).spatialVisibility, 'public');
    const reaction = await request('/combat/creature-ability', abilityRequest('guard', { combatantId: copies[1].id, confirmed: true }));
    assert.equal(reaction.status, 200, JSON.stringify(reaction)); combat = reaction.data.combat;
    assert.equal(combat.combatants.find((c: any) => c.id === copies[1].id).turnEconomy.reactionAvailable, false);
    assert.equal((await request('/combat/creature-ability', abilityRequest('guard', { combatantId: copies[1].id, confirmed: true }))).status, 409);
    assert.equal((await request('/combat/creature-ability', abilityRequest('escape', { combatantId: copies[1].id }))).status, 403);
    assert.ok(!(await request('/combat/active', undefined, owner)).data.combat.economyLog.some((entry: any) => entry.action === 'creature-ability'));
    console.log('✔ habilidades: custo, usos por cópia, privacidade, assistência, reação fora do turno, restore e retry');
    const nextAgain = await request('/combat/next-turn', {
      combatId,
      expectedVersion: combat.version,
      operationId: randomUUID(),
    });
    assert.equal(nextAgain.status, 200);
    combat = nextAgain.data.combat;
    for (
      let attempt = 0;
      attempt < 50 &&
      !events.some(
        (e) =>
          e.type === 'turn' &&
          e.payload.combatantId === combat.currentCombatantId,
      );
      attempt++
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(
      events.some(
        (e) =>
          e.type === 'turn' &&
          e.payload.combatantId === combat.currentCombatantId,
      ),
    );
    assert.ok(
      !events.some(
        (e) =>
          e.payload.combatantName === hidden.name ||
          e.payload.actorName === hidden.name,
      ),
      'Avisos e dados não revelam o nome oculto',
    );
    assert.ok(
      events.some((e) => e.type === 'dice'),
      'Socket deve ter recebido as iniciativas públicas',
    );
    const toggle = async (value: string) => {
      const r = await request(
        `/combat/${combatId}/combatants/${hidden.id}/spatial-visibility`,
        {
          expectedVersion: combat.version,
          operationId: randomUUID(),
          spatialVisibility: value,
        },
        master,
        'PATCH',
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      combat = r.data.combat;
    };
    await toggle('public');
    assert.ok(
      (
        await request('/combat/active', undefined, owner)
      ).data.combat.combatants.some((c: any) => c.id === hidden.id),
    );
    await toggle('master-only');
    assert.ok(
      !(
        await request('/combat/active', undefined, owner)
      ).data.combat.combatants.some((c: any) => c.id === hidden.id),
    );
    console.log(
      '✔ Ocultação inicial e em combate protege grid, iniciativa, rolagens e aviso de turno',
    );
    await toggle('public');
    // Reutiliza a função autoritativa que alimenta preview e abertura de oportunidades.
    for (const [label, state, hp, death, eligible, dimmed] of [
      ['saudável', {}, 25, {}, true, false],
      [
        'caído',
        {
          conditions: [
            {
              id: 'prone',
              condition: 'prone',
              appliedAt: new Date().toISOString(),
            },
          ],
        },
        25,
        {},
        true,
        false,
      ],
      [
        'inconsciente',
        {
          conditions: [
            {
              id: 'sleep',
              condition: 'unconscious',
              appliedAt: new Date().toISOString(),
            },
          ],
        },
        25,
        {},
        false,
        true,
      ],
      [
        'incapacitado',
        {
          conditions: [
            {
              id: 'incap',
              condition: 'incapacitated',
              appliedAt: new Date().toISOString(),
            },
          ],
        },
        25,
        {},
        false,
        false,
      ],
      ['morto', {}, 25, { dead: true }, false, true],
      ['zero PV legado', {}, 0, {}, false, true],
      ['estabilizado', {}, 0, { stabilized: true }, false, true],
    ] as const) {
      await prisma.combatant.update({
        where: { id: hidden.id },
        data: {
          mechanicalState: state as any,
          hpCurrent: hp,
          deathState: death as any,
          turnEconomy: onTurnStart(9),
        },
      });
      if (!eligible) {
        const fresh = (await request('/combat/active')).data.combat;
        assert.equal((await request('/combat/creature-ability', { combatId, expectedVersion: fresh.version, operationId: randomUUID(), combatantId: hidden.id, abilityId: 'guard', confirmed: true })).status, 409);
      }
      const loaded = await loadCombatById(combatId!);
      const target = loaded.combatants.find((c) => c.id === hidden.id)!,
        mover = loaded.combatants.find((c) => c.id === heroUnit.id)!;
      assert.equal(combatantCanReact(target), eligible, label);
      assert.equal(
        scanReactionThreats(loaded, mover, onTurnStart(9)).threats.some(
          (t) => t.reactorCombatantId === hidden.id,
        ),
        eligible,
        label + ' no scanner',
      );
      const dto = (await request('/combat/active')).data.combat.combatants.find(
        (c: any) => c.id === hidden.id,
      );
      assert.equal(dto.tokenDimmed, dimmed, label + ' visual');
      const publicUnit = (
        await request('/combat/active', undefined, owner)
      ).data.combat.combatants.find((c: any) => c.id === hidden.id);
      assert.ok(publicUnit, 'Estado de morte não remove da iniciativa');
      assert.equal(publicUnit.hpCurrent, null);
      assert.equal(publicUnit.deathState, null);
      assert.equal(publicUnit.tokenDimmed, dimmed);
    }
    console.log(
      '✔ Mortos, inconscientes e incapazes não ameaçam; Caído sozinho continua elegível',
    );
    await prisma.combat.update({
      where: { id: combatId },
      data: { currentIndex: 0 },
    });
    await prisma.combatant.update({
      where: { id: hidden.id },
      data: {
        hpCurrent: 0,
        deathState: {},
        mechanicalState: {},
        turnEconomy: onTurnStart(9),
      },
    });
    const intent = await prisma.movementIntent.create({
      data: {
        combatId: combatId!,
        combatantId: heroUnit.id,
        operationId: randomUUID(),
        fingerprint: 'fixture',
        checkpoint: { xFeet: 5, yFeet: 0 },
        remainingPath: [{ xFeet: 10, yFeet: 0 }],
      },
    });
    const opportunity = await prisma.reactionOpportunity.create({
      data: {
        combatId: combatId!,
        movementIntentId: intent.id,
        moverCombatantId: heroUnit.id,
        reactorCombatantId: hidden.id,
        reachFeet: 5,
        visibilityStatus: 'known-visible',
        options: [
          {
            id: 'spear',
            attackId: 'spear',
            label: 'Lança',
            description: '',
            reachFeet: 5,
          },
        ],
      },
    });
    const beforeAttempt = await prisma.character.findUniqueOrThrow({
      where: { id: hero.id },
    });
    const version = (
      await prisma.combat.findUniqueOrThrow({ where: { id: combatId } })
    ).version;
    const rejected = await request(
      `/combat/${combatId}/reaction-opportunities/${opportunity.id}/attack`,
      {
        combatId,
        expectedVersion: version,
        operationId: randomUUID(),
        attackId: 'spear',
      },
    );
    assert.equal(rejected.status, 409, JSON.stringify(rejected));
    assert.equal(
      rejected.data.error,
      'REACTION_UNAVAILABLE',
      JSON.stringify(rejected),
    );
    assert.equal(
      (await prisma.character.findUniqueOrThrow({ where: { id: hero.id } }))
        .hpCurrent,
      beforeAttempt.hpCurrent,
    );
    assert.equal(
      (
        (await prisma.combatant.findUniqueOrThrow({ where: { id: hidden.id } }))
          .turnEconomy as any
      ).reactionAvailable,
      true,
    );
    await prisma.reactionOpportunity.update({
      where: { id: opportunity.id },
      data: { status: 'cancelled' },
    });
    await prisma.movementIntent.update({
      where: { id: intent.id },
      data: { status: 'cancelled' },
    });
    console.log(
      '✔ Oportunidade antiga não permite ataque de criatura a zero PV nem gasta reação',
    );
    combat = (await request('/combat/active')).data.combat;
    const reinforcement = await request('/combat/participants/add', {
      combatId,
      expectedVersion: combat.version,
      operationId: randomUUID(),
      entries: [
        {
          creatureId: creature.id,
          quantity: 1,
          spatialVisibilities: ['master-only'],
        },
      ],
    });
    assert.equal(reinforcement.status, 200, JSON.stringify(reinforcement));
    const newCopy = reinforcement.data.combat.combatants.find(
      (c: any) => c.tokenNumber === 4,
    );
    assert.ok(newCopy && newCopy.name.endsWith(' 4'));
    assert.equal(
      newCopy.spatial.tokenImageRef,
      '/uploads/creatures/fixture_' + suffix + '_c.png',
    );
    assert.ok(
      !(
        await request('/combat/active', undefined, owner)
      ).data.combat.combatants.some((c: any) => c.id === newCopy.id),
    );
    console.log(
      '✔ Reforços preservam a numeração, usam a galeria atual e podem entrar ocultos',
    );
  } finally {
    socket?.disconnect();
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (regionId) await prisma.region.deleteMany({ where: { id: regionId } });
    if (characterId)
      await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
