import { cancelDuelOpportunities } from '../modules/combat/spatial/opportunity-attack.service.js';
/** Executar apenas com schema descartável e servidor isolado na porta 3131. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { inventoryItemSchema } from '../modules/characters/characters.schema.js';
import { loadEntity } from '../modules/mechanical/mechanical.service.js';
import { resolveSpellAuthorization } from '../modules/spells/execution/spell-authorization.service.js';
import { resolveSpellComponents } from '../modules/spells/execution/spell-components.service.js';
import { allSpells } from '../modules/shared/spells/index.js';
import { onTurnStart, economyOf } from '../modules/shared/action-economy.js';
import {
  seedSpellRepertoire,
  grantCastingComponents,
} from './spell-slot-fixtures.js';

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  const base = process.env.PLAYABLE_BASE_URL;
  assert.equal(base, 'http://127.0.0.1:3131');
  assert.equal(await prisma.user.count(), 0);
  const users: string[] = [],
    characters: string[] = [],
    creatures: string[] = [],
    combats: string[] = [],
    casts: string[] = [];
  try {
    const user = async (role: 'PLAYER' | 'MASTER') => {
      const row = await prisma.user.create({
        data: {
          username: 'war_' + randomUUID(),
          displayName: 'Fixture',
          role,
          passwordHash: 'fixture',
        },
      });
      users.push(row.id);
      return row;
    };
    const master = await user('MASTER'),
      owner = await user('PLAYER'),
      outsider = await user('PLAYER');
    const request = async (path: string, body?: unknown, actor = master) => {
      const response = await fetch(base + '/api' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Bearer ' +
            signToken({
              sub: actor.id,
              role: actor.role,
              username: actor.username,
              displayName: actor.displayName,
            }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    const feat = [
      {
        id: 'talento-fixture',
        source: 'feat',
        featId: 'war-caster',
        name: 'Conjurador de Guerra',
        description: '',
      },
    ];
    const attack = {
      id: 'clava',
      name: 'Clava fixture',
      actionCost: 'action',
      kind: 'melee',
      attackBonus: 2,
      reachFeet: 5,
      damage: { count: 1, sides: 4, bonus: 0, type: 'Concussão' },
      extraDamages: [],
    };
    const caster = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Clérigo fixture',
        hpCurrent: 100,
        hpMax: 100,
        speed: 9,
        wisdom: 16,
        features: feat,
        attacks: [attack],
        classes: [{ classKey: 'cleric', level: 5, subclass: '' }],
      },
    });
    characters.push(caster.id);
    const npc = await prisma.creature.create({
      data: {
        name: 'Alvo fixture',
        kind: 'NPC',
        type: 'Humanoide',
        hpCurrent: 100,
        hpMax: 100,
        speed: 9,
        armorClass: 12,
        attacks: [attack],
      },
    });
    creatures.push(npc.id);
    await seedSpellRepertoire({
      characterId: caster.id,
      classKey: 'cleric',
      spellIds: ['bless', 'hold-person', 'sacred-flame', 'healing-word'],
    });
    await grantCastingComponents({ characters: [caster.id] });
    assert.equal(
      (await request('/characters/me', undefined, owner)).data.character.id,
      caster.id,
      'Sentinela HTTP/banco',
    );
    let combatId = '',
      moverId = '',
      reactorId = '';
    const setup = async (npcReactor = false) => {
      if (combatId)
        await prisma.combat.update({
          where: { id: combatId },
          data: { status: 'ENDED' },
        });
      await prisma.effectInstance.deleteMany({
        where: { createdBy: { in: users } },
      });
      await prisma.character.update({
        where: { id: caster.id },
        data: {
          features: feat,
          hpCurrent: 100,
          deathState: {},
          mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] },
        },
      });
      const combat = await prisma.combat.create({
        data: {
          status: 'ACTIVE',
          currentIndex: 0,
          turnSequence: 1,
          spatialConfig: {
            mode: 'grid-2d',
            widthFeet: 60,
            heightFeet: 40,
            cellSizeFeet: 5,
          },
        },
      });
      combatId = combat.id;
      combats.push(combatId);
      const mover = await prisma.combatant.create({
        data: {
          combatId,
          creatureId: npc.id,
          kind: 'NPC',
          name: npc.name,
          sideKey: 'monsters',
          initiative: npcReactor ? 10 : 20,
          dexterityMod: 0,
          hpCurrent: 100,
          hpMax: 100,
          armorClass: 12,
          spatialPosition: { xFeet: npcReactor ? 5 : 10, yFeet: 5 },
          turnEconomy: onTurnStart(9),
        },
      });
      moverId = mover.id;
      const reactor = await prisma.combatant.create({
        data: {
          combatId,
          characterId: caster.id,
          ownerUserId: owner.id,
          kind: 'CHARACTER',
          name: caster.name,
          sideKey: 'players',
          initiative: npcReactor ? 20 : 10,
          dexterityMod: 0,
          spatialPosition: { xFeet: npcReactor ? 10 : 5, yFeet: 5 },
          turnEconomy: onTurnStart(9),
        },
      });
      reactorId = npcReactor ? mover.id : reactor.id;
      moverId = npcReactor ? reactor.id : mover.id;
      const move = await request(
        `/combat/${combatId}/spatial/movement`,
        {
          combatantId: moverId,
          path: [{ xFeet: 15, yFeet: 5 }],
          expectedVersion: 0,
          operationId: randomUUID(),
        },
        npcReactor ? owner : master,
      );
      assert.equal(move.status, 200, JSON.stringify(move));
      const read = await request(
        `/combat/${combatId}/reaction-opportunities`,
        undefined,
        npcReactor ? master : owner,
      );
      assert.equal(read.status, 200, JSON.stringify(read));
      assert.equal(read.data.opportunities.length, 1);
      return read.data;
    };
    const choose = (read: any, spellId: string) => {
      const option = read.opportunities[0].options.find(
        (o: any) => o.spell?.spellId === spellId,
      );
      assert.ok(option, `${spellId}: ${JSON.stringify(read)}`);
      return option.spell;
    };
    const endpoint = (read: any) =>
      `/combat/${combatId}/reaction-opportunities/${read.opportunities[0].id}/spell`;
    let read = await setup();
    assert.ok(
      read.opportunities[0].options.some((o: any) => o.attackId === attack.id),
      'Ataque comum permanece',
    );
    assert.ok(
      !read.opportunities[0].options.some(
        (o: any) => o.spell?.spellId === 'healing-word',
      ),
      'Ação Bônus não é elegível',
    );
    const payload = {
      combatId,
      expectedVersion: read.combatVersion,
      operationId: randomUUID(),
      spell: choose(read, 'bless'),
    };
    assert.equal(
      (await request(endpoint(read), payload, outsider)).status,
      403,
    );
    await prisma.character.update({
      where: { id: caster.id },
      data: { features: [] },
    });
    assert.equal(
      (
        await request(
          endpoint(read),
          { ...payload, operationId: randomUUID() },
          owner,
        )
      ).status,
      409,
      'Talento é obrigatório mesmo com payload forjado',
    );
    await prisma.character.update({
      where: { id: caster.id },
      data: { features: feat },
    });
    assert.equal(
      (
        await request(
          endpoint(read),
          { ...payload, targets: [{ kind: 'character', id: caster.id }] },
          owner,
        )
      ).status,
      400,
      'Cliente não escolhe alvos',
    );
    const raced = await Promise.all([
      request(endpoint(read), payload, owner),
      request(endpoint(read), payload, owner),
    ]);
    assert.ok(
      raced.every((r) => r.status === 200),
      JSON.stringify(raced),
    );
    const result = raced[0].data;
    casts.push(result.cast.cast.id);
    assert.equal(
      await prisma.spellCast.count({
        where: { operationId: payload.operationId },
      }),
      1,
    );
    assert.equal(
      (
        (await prisma.character.findUniqueOrThrow({ where: { id: caster.id } }))
          .spells as any
      ).slotsUsed['1'],
      1,
      'Retry gasta exatamente um espaço',
    );
    assert.equal(result.cast.cast.casting.timeKind, 'reaction');
    const economy = economyOf(
      (await prisma.combatant.findUniqueOrThrow({ where: { id: reactorId } }))
        .turnEconomy,
    );
    assert.equal(economy.reactionAvailable, false);
    assert.equal(economy.actionsUsed, 0);
    assert.equal(economy.bonusActionUsed, false);
    assert.equal(
      (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
        .spatialPosition &&
        (
          (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
            .spatialPosition as any
        ).xFeet,
      15,
    );
    assert.equal(
      (
        await request(
          endpoint(read),
          { ...payload, spell: choose(read, 'hold-person') },
          owner,
        )
      ).status,
      409,
      'operationId não troca magia',
    );
    console.log(
      '✔ Opções, autorização, alvo fixo, custo somente de Reação e retry concorrente',
    );

    read = await setup();
    const saveCast = await request(
      endpoint(read),
      {
        combatId,
        expectedVersion: read.combatVersion,
        operationId: randomUUID(),
        spell: choose(read, 'sacred-flame'),
      },
      owner,
    );
    assert.equal(saveCast.status, 200, JSON.stringify(saveCast));
    casts.push(saveCast.data.cast.cast.id);
    const pending = saveCast.data.cast.pending;
    assert.ok(pending?.id);
    assert.equal(
      saveCast.data.cast.cast.casting.resourceKind,
      null,
      'Truque não gasta espaço',
    );
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'pending-reaction',
    );
    assert.equal(
      (
        (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
          .spatialPosition as any
      ).xFeet,
      10,
    );
    await prisma.$transaction((tx) =>
      cancelDuelOpportunities(tx, combatId, reactorId, moverId),
    );
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'pending-reaction',
      'Encerrar consentimento não antecipa uma magia já comprometida',
    );
    const waiting = await request(
      `/combat/${combatId}/reaction-opportunities`,
      undefined,
      owner,
    );
    assert.equal(
      waiting.data.opportunities[0].responseKind,
      null,
      'Não oferece outra reação durante o save',
    );
    const saved = await request('/dice/roll', {
      kind: 'save',
      entity: { kind: 'combatant', id: moverId },
      pendingEffectSaveId: pending.id,
      dice: [{ sides: 20 }],
    });
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'committed',
    );
    assert.equal(
      (
        (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
          .spatialPosition as any
      ).xFeet,
      15,
    );
    console.log(
      '✔ Salvaguarda pausa movimento e o retoma somente após resolver a magia',
    );
    read = await setup();
    await prisma.character.update({
      where: { id: caster.id },
      data: { wisdom: 30 },
    });
    await prisma.creature.update({
      where: { id: npc.id },
      data: { wisdom: 1 },
    });
    read = (
      await request(
        `/combat/${combatId}/reaction-opportunities`,
        undefined,
        owner,
      )
    ).data;
    const held = await request(
      endpoint(read),
      {
        combatId,
        expectedVersion: read.combatVersion,
        operationId: randomUUID(),
        spell: choose(read, 'hold-person'),
      },
      owner,
    );
    assert.equal(held.status, 200, JSON.stringify(held));
    casts.push(held.data.cast.cast.id);
    const holdSave = await request('/dice/roll', {
      kind: 'save',
      pendingEffectSaveId: held.data.cast.pending.id,
      dice: [{ sides: 20 }],
    });
    assert.equal(holdSave.status, 201, JSON.stringify(holdSave));
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'interrupted',
      'Paralisia interrompe o trajeto original',
    );
    assert.equal(
      (
        (await prisma.combatant.findUniqueOrThrow({ where: { id: moverId } }))
          .spatialPosition as any
      ).xFeet,
      10,
    );
    console.log(
      '✔ Falha em Imobilizar Pessoa aplica Paralisia antes da retomada e interrompe movimento',
    );
    read = await setup();
    const cancelCast = await request(
      endpoint(read),
      {
        combatId,
        expectedVersion: read.combatVersion,
        operationId: randomUUID(),
        spell: choose(read, 'hold-person'),
      },
      owner,
    );
    assert.equal(cancelCast.status, 200, JSON.stringify(cancelCast));
    casts.push(cancelCast.data.cast.cast.id);
    const cancelled = await request(
      `/effects/pending/${cancelCast.data.cast.pending.id}/cancel`,
      {},
    );
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'committed',
    );
    assert.equal(
      economyOf(
        (await prisma.combatant.findUniqueOrThrow({ where: { id: reactorId } }))
          .turnEconomy,
      ).reactionAvailable,
      false,
      'Cancelar não devolve a Reação',
    );

    await prisma.creature.update({
      where: { id: npc.id },
      data: {
        abilities: [
          {
            id: 'talento',
            name: 'Talento fixture',
            cost: 'passive',
            execution: 'war-caster',
            description: '',
            trigger: '',
            maxUses: null,
          },
        ],
        spellcastingProfile: {
          ability: 'wisdom',
          saveDc: 14,
          attackBonus: 5,
          cantripScalingLevel: 5,
        },
        spellcastingResources: {
          spellSlots: [{ level: 1, max: 2 }],
          pactSlot: null,
        },
        spellRepertoire: { spellIds: ['bless', 'sacred-flame'] },
      },
    });
    await grantCastingComponents({ creatures: [npc.id] });
    read = await setup(true);
    assert.equal(read.opportunities[0].reactorCombatantId, reactorId);
    const npcCast = await request(endpoint(read), {
      combatId,
      expectedVersion: read.combatVersion,
      operationId: randomUUID(),
      spell: choose(read, 'bless'),
    });
    assert.equal(npcCast.status, 200, JSON.stringify(npcCast));
    casts.push(npcCast.data.cast.cast.id);
    assert.equal(
      economyOf(
        (await prisma.combatant.findUniqueOrThrow({ where: { id: reactorId } }))
          .turnEconomy,
      ).reactionAvailable,
      false,
    );
    assert.deepEqual(
      (await prisma.creature.findUniqueOrThrow({ where: { id: npc.id } }))
        .spellcastingUsed,
      {},
      'Uso não vaza para o template',
    );
    console.log(
      '✔ Cancelamento libera movimento sem reembolso; NPC reage pelo Mestre com recursos da instância',
    );
    read = await setup(true);
    const removable = await request(endpoint(read), {
      combatId,
      expectedVersion: read.combatVersion,
      operationId: randomUUID(),
      spell: choose(read, 'sacred-flame'),
    });
    assert.equal(removable.status, 200, JSON.stringify(removable));
    casts.push(removable.data.cast.cast.id);
    const remove = await request('/combat/participants/remove', {
      combatId,
      expectedVersion: removable.data.combat.version,
      operationId: randomUUID(),
      combatantId: reactorId,
    });
    assert.equal(remove.status, 200, JSON.stringify(remove));
    assert.equal(
      (
        await prisma.spellCast.findUniqueOrThrow({
          where: { id: removable.data.cast.cast.id },
        })
      ).status,
      'cancelled',
    );
    assert.equal(
      (
        await prisma.pendingEffectSave.findUniqueOrThrow({
          where: { id: removable.data.cast.pending.id },
        })
      ).status,
      'cancelled',
    );
    assert.equal(
      (await prisma.movementIntent.findFirstOrThrow({ where: { combatId } }))
        .status,
      'cancelled',
    );
    console.log(
      '✔ Remover conjurador cancela a magia e suas salvaguardas sem deixar movimento travado',
    );
    read = await setup(true);
    const finishing = await request(endpoint(read), {combatId, expectedVersion: read.combatVersion, operationId: randomUUID(), spell: choose(read, 'sacred-flame')});
    assert.equal(finishing.status, 200, JSON.stringify(finishing)); casts.push(finishing.data.cast.cast.id);
    assert.equal((await request('/combat/end', {})).status, 200);
    assert.equal((await prisma.spellCast.findUniqueOrThrow({where: {id: finishing.data.cast.cast.id}})).status, 'cancelled');
    assert.equal((await prisma.pendingEffectSave.findUniqueOrThrow({where: {id: finishing.data.cast.pending.id}})).status, 'cancelled');
    console.log('✔ Encerrar combate também encerra a conjuração de oportunidade e suas pendências');


    const weapons = [
      inventoryItemSchema.parse({
        id: 'arma',
        name: 'Arma fixture',
        category: 'Arma',
        slot: 'hand1',
      }),
      inventoryItemSchema.parse({
        id: 'escudo',
        name: 'Escudo fixture',
        category: 'Escudo',
        slot: 'hand2',
      }),
    ];
    await prisma.character.update({
      where: { id: caster.id },
      data: { inventory: weapons, features: feat },
    });
    const loaded = await loadEntity({ kind: 'character', id: caster.id });
    const authorization = await resolveSpellAuthorization(
      loaded,
      'sacred-flame',
      { kind: 'class', id: 'cleric' },
    );
    const components = (spellId: string) =>
      resolveSpellComponents({
        db: prisma,
        spell: allSpells().find((s) => s.id === spellId)!,
        source: authorization.profile.source,
        entity: loaded.entity,
      });
    assert.equal((await components('sacred-flame')).somatic.hand, 'war-caster');
    assert.equal(
      (await components('hold-person')).material.available,
      false,
      'Talento não dispensa materiais',
    );
    await prisma.character.update({
      where: { id: caster.id },
      data: { features: [] },
    });
    assert.equal((await components('sacred-flame')).somatic.available, false);
    for (const exhaustionLevel of [0, 3]) {
      const pendingId = randomUUID(),
        concentrationId = randomUUID();
      await prisma.character.update({
        where: { id: caster.id },
        data: {
          features: feat,
          mechanicalState: {
            conditions: [],
            exhaustionLevel,
            log: [],
            concentration: {
              id: concentrationId,
              label: 'Teste fixture',
              sourceType: 'manual',
              visibility: 'public',
              startedAt: new Date().toISOString(),
            },
            pendingConcentrationSaves: [
              {
                id: pendingId,
                concentrationId,
                dc: 10,
                damage: 10,
                eventId: randomUUID(),
                at: new Date().toISOString(),
              },
            ],
          },
        },
      });
      const concentration = await request(
        '/dice/roll',
        {
          kind: 'concentration',
          entity: { kind: 'character', id: caster.id },
          pendingConcentrationSaveId: pendingId,
          dice: [{ sides: 20 }],
        },
        owner,
      );
      assert.equal(concentration.status, 201, JSON.stringify(concentration));
      const roll = concentration.data.roll ?? concentration.data;
      assert.equal(roll.advantage, exhaustionLevel === 0);
      assert.equal(
        roll.dice.length,
        exhaustionLevel === 0 ? 2 : 1,
        'Vantagem cancela desvantagem sem somar',
      );
    }
    console.log(
      '✔ Componentes somáticos com armas/escudo e vantagem na concentração, incluindo cancelamento por desvantagem',
    );
    read = await setup();
    const bonusChoice = choose(read, 'sacred-flame');
    const priorBonus = await prisma.spellCast.create({data: {spellId: 'healing-word', casterEntityKind: 'character', casterEntityId: caster.id, combatId, turnSequence: 1, combatantId: reactorId, castingTimeKind: 'bonusAction', spellLevel: 1, status: 'resolved', outcome: 'effect', operationId: randomUUID(), fingerprint: 'fixture'}});
    casts.push(priorBonus.id);
    const blocked = await request(endpoint(read), {combatId, expectedVersion: read.combatVersion, operationId: randomUUID(), spell: bonusChoice}, owner);
    assert.equal(blocked.status, 409, JSON.stringify(blocked));
    assert.equal(economyOf((await prisma.combatant.findUniqueOrThrow({where: {id: reactorId}})).turnEconomy).reactionAvailable, true, 'Restrição de Ação Bônus recusa antes de consumir Reação');
    console.log('✔ Magia de Ação Bônus no mesmo turno impede a conjuração de Reação, inclusive truque');
  } finally {
    await prisma.effectInstance.deleteMany({
      where: { createdBy: { in: users } },
    });
    await prisma.spellCast.deleteMany({ where: { id: { in: casts } } });
    await prisma.combat.deleteMany({ where: { id: { in: combats } } });
    await prisma.creature.deleteMany({ where: { id: { in: creatures } } });
    await prisma.character.deleteMany({ where: { id: { in: characters } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
