import { cancelPendingEffectSavesForEntity } from '../modules/effects/pending-effect-saves.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { onTurnStart } from '../modules/shared/action-economy.js';
/** Executado somente depois da sentinela e sobre as fixtures descartáveis de área. */
export async function smokeCreatureArea(
  http: (
    path: string,
    method?: string,
    body?: unknown,
    token?: string,
  ) => Promise<{ status: number; data: any }>,
  combatId: string,
  heroUnitId: string,
  playerToken: string,
) {
  assert.match(
    new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? '',
    /^smoke_/,
  );
  const hero = await prisma.combatant.findUniqueOrThrow({
    where: { id: heroUnitId },
  });
  assert.ok(hero.characterId);
  await prisma.character.update({
    where: { id: hero.characterId },
    data: { hpCurrent: 100, hpMax: 100 },
  });
  const definition = {
    id: 'sopro-teste',
    name: 'Sopro de teste',
    description: 'Chamas de prova isolada.',
    cost: 'action',
    execution: 'area-save-damage',
    maxUses: 2,
    area: {
      shape: { kind: 'cone', lengthFeet: 30 },
      rangeFeet: 0,
      saveAbility: 'dexterity',
      dc: 40,
      onSuccess: 'half',
      damage: [{ type: 'Fogo', dice: { count: 2, sides: 6 } }],
    },
  };
  const template = await prisma.creature.create({
    data: {
      name: 'Fonte isolada de área',
      hpMax: 100,
      hpCurrent: 100,
      abilities: [definition],
    },
  });
  const unit = await prisma.combatant.create({
    data: {
      combatId,
      kind: 'CREATURE',
      creatureId: template.id,
      name: template.name,
      dexterityMod: 0,
      initiative: 30,
      hpMax: 100,
      hpCurrent: 100,
      spatialPosition: { xFeet: 0, yFeet: 0 },
      elevationFeet: 0,
      turnEconomy: onTurnStart(9),
    },
  });
  const target = await prisma.combatant.create({
    data: {
      combatId,
      kind: 'CREATURE',
      creatureId: template.id,
      name: 'Alvo isolado',
      dexterityMod: 0,
      initiative: 5,
      hpMax: 100,
      hpCurrent: 100,
      spatialPosition: { xFeet: 10, yFeet: 0 },
      elevationFeet: 0,
      turnEconomy: onTurnStart(9),
    },
  });
  const high = await prisma.combatant.create({
    data: {
      combatId,
      kind: 'CREATURE',
      creatureId: template.id,
      name: 'Alvo elevado',
      dexterityMod: 0,
      initiative: 1,
      hpMax: 100,
      hpCurrent: 100,
      spatialPosition: { xFeet: 15, yFeet: 0 },
      elevationFeet: 10,
      turnEconomy: onTurnStart(9),
    },
  });
  await prisma.combat.update({
    where: { id: combatId },
    data: { currentIndex: 0 },
  });
  let checks = 0;
  const check = (label: string, ok: unknown) => {
    assert.ok(ok, label);
    checks++;
    console.log('✔ ' + label);
  };
  const preview = (placement: unknown) =>
    http(`/combat/${combatId}/creature-area-preview`, 'POST', {
      combatantId: unit.id,
      abilityId: definition.id,
      placement,
    });
  const origin = { xFeet: 2.5, yFeet: 2.5 };
  try {
    const reading = await preview({ origin, angle: 0 });
    assert.equal(reading.status, 200, JSON.stringify(reading.data));
    check(
      'Mesmo nível é atingido sem altura corporal',
      reading.data.candidates.find((x: any) => x.combatantId === target.id)
        .affected === 'pass',
    );
    check(
      'Outro nível fica fora sem pedir confirmação',
      reading.data.candidates.find((x: any) => x.combatantId === high.id)
        .affected === 'fail',
    );
    const key = `combatant:${high.id}`;
    const exception = await preview({
      origin,
      angle: 0,
      decisions: [{ targetKey: key, affected: true }],
    });
    check(
      'Exceção do Mestre inclui outra elevação nesta execução',
      exception.status === 200 &&
        exception.data.candidates.find((x: any) => x.combatantId === high.id)
          .affected === 'pass',
    );
    check(
      'Exceção não persiste no próximo uso',
      (await preview({ origin, angle: 0 })).data.candidates.find(
        (x: any) => x.combatantId === high.id,
      ).affected === 'fail',
    );
    check(
      'Cliente não altera dimensões da habilidade',
      (
        await preview({
          origin,
          angle: 0,
          shape: { kind: 'sphere', radiusFeet: 100 },
        })
      ).status === 400,
    );
    check(
      'Origem fora do caster é recusada',
      (await preview({ origin: { xFeet: 30, yFeet: 30 }, angle: 0 })).status ===
        400,
    );
    const sceneId = (
      await prisma.combat.findUniqueOrThrow({ where: { id: combatId } })
    ).sceneId!;
    const wall = await prisma.spatialObstacle.create({
      data: {
        sceneId,
        startXFeet: 7,
        startYFeet: 0,
        endXFeet: 7,
        endYFeet: 30,
        blocksMovement: false,
        blocksSight: false,
        blocksTargeting: true,
        coverLevel: 'total',
      },
    });
    const blocked = await preview({ origin, angle: 0 });
    check(
      'Parede que bloqueia ataques impede a área mesmo transparente',
      blocked.data.candidates.find((x: any) => x.combatantId === target.id)
        .affected === 'fail',
    );
    check(
      'Exceção de elevação não atravessa parede',
      (
        await preview({
          origin,
          angle: 0,
          decisions: [{ targetKey: key, affected: true }],
        })
      ).status === 409,
    );
    await prisma.spatialObstacle.update({
      where: { id: wall.id },
      data: { blocksTargeting: false, coverLevel: 'none' },
    });
    check(
      'Parede liberada para ataques deixa a área passar',
      (await preview({ origin, angle: 0 })).data.candidates.find(
        (x: any) => x.combatantId === target.id,
      ).affected === 'pass',
    );
    await prisma.spatialObstacle.delete({ where: { id: wall.id } });
    const combat = await prisma.combat.findUniqueOrThrow({
      where: { id: combatId },
    });
    const input = {
      combatId,
      combatantId: unit.id,
      abilityId: definition.id,
      mode: 'use',
      expectedVersion: combat.version,
      operationId: randomUUID(),
      areaPlacement: {
        origin,
        angle: 0,
        definitionFingerprint: reading.data.definitionFingerprint,
      },
    };
    const use = () => http('/combat/creature-ability', 'POST', input);
    const forged = await http('/combat/creature-ability', 'POST', {
      ...input,
      areaPlacement: {
        ...input.areaPlacement,
        definitionFingerprint: '0'.repeat(64),
      },
    });
    check(
      'Cadastro divergente não gasta ação nem cria pendências',
      forged.status === 409 &&
        (await prisma.creatureAreaUse.count({ where: { combatId } })) === 0,
    );
    const used = await use();
    assert.equal(used.status, 200, JSON.stringify(used.data));
    const group = await prisma.creatureAreaUse.findFirstOrThrow({
      where: { combatId },
    });
    const pendings = await prisma.pendingEffectSave.findMany({
      where: { creatureAreaUseId: group.id },
    });
    check(
      'Uso cria somente salvaguardas dos atingidos',
      pendings.length === 2 &&
        pendings.some((p) => p.targetEntityId === hero.characterId) &&
        pendings.some((p) => p.targetEntityId === target.id),
    );
    const caster = await prisma.combatant.findUniqueOrThrow({
      where: { id: unit.id },
    });
    check(
      'Uma ação e um uso consumidos',
      (caster.turnEconomy as any).actionsUsed === 1 &&
        (caster.abilityUses as any)[definition.id] === 1,
    );
    check(
      'Retry não cria outra execução',
      (await use()).status === 200 &&
        (await prisma.creatureAreaUse.count({ where: { combatId } })) === 1,
    );
    const current = await prisma.combat.findUniqueOrThrow({
      where: { id: combatId },
    });
    const blockedTurn = await http('/combat/next-turn', 'POST', {
      combatId,
      expectedVersion: current.version,
      operationId: randomUUID(),
    });
    check(
      'Turno aguarda as salvaguardas no registro',
      blockedTurn.status === 409 &&
        blockedTurn.data.error === 'ABILITY_RESOLUTION_PENDING',
    );
    const exhausted = await http('/combat/creature-ability', 'POST', {
      ...input,
      expectedVersion: current.version,
      operationId: randomUUID(),
    });
    check(
      'Sem ação disponível, nenhuma pendência extra é persistida',
      exhausted.status === 409 &&
        (await prisma.creatureAreaUse.count({ where: { combatId } })) === 1,
    );
    const cards = await http(`/combat/${combatId}/resolution-requests`);
    check(
      'Salvaguardas aparecem nos cards do registro',
      JSON.stringify(cards.data).includes('ability-saving-throw') &&
        JSON.stringify(cards.data).includes(definition.name),
    );
    const npc = pendings.find((p) => p.targetEntityId === target.id)!;
    const player = pendings.find((p) => p.targetEntityId === hero.characterId)!;
    const roll = (id: string, token?: string) =>
      http(
        '/dice/roll',
        'POST',
        { kind: 'save', dice: [{ sides: 20 }], pendingEffectSaveId: id },
        token,
      );
    check(
      'Jogador não rola salvaguarda de NPC',
      (await roll(npc.id, playerToken)).status === 403,
    );
    const first = await roll(npc.id);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    check(
      'Primeira salvaguarda aguarda a barreira sem aplicar dano',
      (await prisma.combatant.findUniqueOrThrow({ where: { id: target.id } }))
        .hpCurrent === 100,
    );
    // O snapshot da definição não muda se o cadastro for editado após o uso.
    await prisma.creature.update({
      where: { id: template.id },
      data: {
        abilities: [
          {
            ...definition,
            area: {
              ...definition.area,
              damage: [{ type: 'Fogo', dice: { count: 100, sides: 20 } }],
            },
          },
        ],
      },
    });
    const last = await roll(player.id, playerToken);
    assert.equal(last.status, 201, JSON.stringify(last.data));
    const completed = await prisma.creatureAreaUse.findUniqueOrThrow({
      where: { id: group.id },
    });
    const targetAfter = await prisma.combatant.findUniqueOrThrow({
      where: { id: target.id },
    });
    const heroAfter = await prisma.character.findUniqueOrThrow({
      where: { id: hero.characterId! },
    });
    check(
      'Último save aplica um dano compartilhado do snapshot',
      completed.status === 'resolved' &&
        targetAfter.hpCurrent! < 100 &&
        targetAfter.hpCurrent! >= 88 &&
        heroAfter.hpCurrent === targetAfter.hpCurrent,
    );
    check(
      'Alvo de outra elevação não sofre dano',
      (await prisma.combatant.findUniqueOrThrow({ where: { id: high.id } }))
        .hpCurrent === 100,
    );
    await roll(player.id, playerToken);
    check(
      'Repetir save não aplica dano novamente',
      (
        await prisma.character.findUniqueOrThrow({
          where: { id: hero.characterId! },
        })
      ).hpCurrent === heroAfter.hpCurrent,
    );
    const snapshot = JSON.stringify(completed.resolutionSnapshot);
    check(
      'Resultado persistido identifica a habilidade e os alvos',
      snapshot.includes('creature-area:') &&
        snapshot.includes(hero.characterId!),
    );
    // Segunda execução: origem/alvo ocultos, sucesso, duas últimas rolagens concorrentes.
    await prisma.creature.update({
      where: { id: template.id },
      data: {
        abilities: [{ ...definition, area: { ...definition.area, dc: 1 } }],
      },
    });
    await prisma.combatant.update({
      where: { id: unit.id },
      data: { turnEconomy: onTurnStart(9), spatialVisibility: 'master-only' },
    });
    await prisma.combatant.update({
      where: { id: target.id },
      data: { spatialVisibility: 'master-only' },
    });
    const secondReading = await preview({ origin, angle: 0 });
    const useAgain = async () => {
      const state = await prisma.combat.findUniqueOrThrow({
        where: { id: combatId },
      });
      return http('/combat/creature-ability', 'POST', {
        ...input,
        expectedVersion: state.version,
        operationId: randomUUID(),
        areaPlacement: {
          origin,
          angle: 0,
          definitionFingerprint: secondReading.data.definitionFingerprint,
        },
      });
    };
    const second = await useAgain();
    assert.equal(second.status, 200, JSON.stringify(second.data));
    const secondGroup = await prisma.creatureAreaUse.findFirstOrThrow({
      where: { combatId, status: 'resolving' },
    });
    const secondPending = await prisma.pendingEffectSave.findMany({
      where: { creatureAreaUseId: secondGroup.id },
    });
    const playerCards = await http(
      `/combat/${combatId}/resolution-requests`,
      'GET',
      undefined,
      playerToken,
    );
    check(
      'Origem oculta não divulga habilidade no card do jogador',
      !JSON.stringify(playerCards.data).includes(definition.name) &&
        JSON.stringify(playerCards.data).includes('Efeito em área'),
    );
    const rolls = await Promise.all(
      secondPending.map((p) =>
        roll(
          p.id,
          p.targetEntityKind === 'character' ? playerToken : undefined,
        ),
      ),
    );
    check(
      'Duas últimas salvaguardas concorrentes resolvem uma vez',
      rolls.every((row) => row.status === 201) &&
        (
          await prisma.creatureAreaUse.findUniqueOrThrow({
            where: { id: secondGroup.id },
          })
        ).status === 'resolved',
    );
    check(
      'Salvaguarda de alvo oculto é privada mesmo sem pedido do cliente',
      rolls[secondPending.findIndex((p) => p.targetEntityId === target.id)].data
        .roll.isPrivate === true,
    );
    const secondSnapshot = (
      await prisma.creatureAreaUse.findUniqueOrThrow({
        where: { id: secondGroup.id },
      })
    ).resolutionSnapshot as any;
    check(
      'Sucesso reduz cada alvo à metade do mesmo dano',
      secondSnapshot.targets.every(
        (row: any) =>
          row.finalDamage ===
          Math.floor(secondSnapshot.damageRoll.rawDamage / 2),
      ),
    );
    // Cancelamento estrutural usa o lifecycle compartilhado; não devolve custos.
    await prisma.combatant.update({
      where: { id: unit.id },
      data: { turnEconomy: onTurnStart(9), abilityUses: {} },
    });
    const third = await useAgain();
    assert.equal(third.status, 200, JSON.stringify(third.data));
    const thirdGroup = await prisma.creatureAreaUse.findFirstOrThrow({
      where: { combatId, status: 'resolving' },
    });
    const hpBeforeCancel = (
      await prisma.character.findUniqueOrThrow({
        where: { id: hero.characterId! },
      })
    ).hpCurrent;
    await prisma.$transaction((db) =>
      cancelPendingEffectSavesForEntity(
        { kind: 'combatant', id: target.id },
        db,
      ),
    );
    check(
      'Remoção estrutural cancela a execução e todas as pendências',
      (
        await prisma.creatureAreaUse.findUniqueOrThrow({
          where: { id: thirdGroup.id },
        })
      ).status === 'cancelled' &&
        (await prisma.pendingEffectSave.count({
          where: { creatureAreaUseId: thirdGroup.id, status: 'pending' },
        })) === 0,
    );
    check(
      'Cancelamento não aplica dano',
      (
        await prisma.character.findUniqueOrThrow({
          where: { id: hero.characterId! },
        })
      ).hpCurrent === hpBeforeCancel,
    );
  } finally {
    await prisma.creatureAreaUse.deleteMany({ where: { combatId } });
    await prisma.combatant.deleteMany({
      where: { id: { in: [unit.id, target.id, high.id] } },
    });
    await prisma.creature.delete({ where: { id: template.id } });
  }
  console.log(
    `${checks} verificações integradas de habilidades em área aprovadas.`,
  );
}
