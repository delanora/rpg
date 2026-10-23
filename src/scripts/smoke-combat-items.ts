import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import type { CreatureDto } from '../modules/creatures/creatures.dto.js';
import { inventoryListSchema } from '../modules/characters/characters.schema.js';
import type { InventoryItemDto } from '../modules/characters/characters.dto.js';
import { parseJson } from '../modules/shared/json.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * HOTFIX — INVENTÁRIO DE NPC, EQUIPAMENTO E "USAR ITEM" EM COMBATE.
 *
 * Exercita o fluxo REAL por HTTP: cria NPC/item de catálogo, equipa armadura/
 * escudo/arma, sintoniza, mexe nas moedas, inicia combate, usa poção em si e
 * em um aliado a 0 PV, usa item manual e confere a privacidade do jogador.
 * Tudo é limpo no `finally` (contas, fichas, NPC, itens e combate).
 */
export async function smokeCombatItems(baseUrl: string, check: Check): Promise<void> {
  console.log('\n67) Hotfix — inventário de NPC e uso de item em combate');
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const itemIds: string[] = [];
  let localityId: string | undefined;
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({
      data: { username: `item_m_${suffix}`, displayName: 'Mestre Itens', passwordHash: 'fixture', role: 'MASTER' },
    });
    const player = await prisma.user.create({
      data: { username: `item_p_${suffix}`, displayName: 'Jogador Itens', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyUser = await prisma.user.create({
      data: { username: `item_a_${suffix}`, displayName: 'Aliado Itens', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, player.id, allyUser.id);
    const masterToken = signToken({ sub: master.id, username: master.username, displayName: master.displayName, role: master.role });
    const playerToken = signToken({ sub: player.id, username: player.username, displayName: player.displayName, role: player.role });

    const potion = {
      name: 'Poção de Cura de Teste',
      category: 'Poção',
      details: { potionCategory: 'healing', healingDice: { count: 1, sides: 4, bonus: 5 } },
    };
    const hero = await prisma.character.create({
      data: {
        userId: player.id,
        name: 'Herói dos Itens',
        hpCurrent: 10,
        hpMax: 100,
        dexterity: 20,
        speed: 9,
        inventory: [
          { ...potion, id: 'potion-self', quantity: 2 },
          { ...potion, id: 'potion-ally', quantity: 1 },
        ],
      },
    });
    characterIds.push(hero.id);
    const ally = await prisma.character.create({
      data: {
        userId: allyUser.id,
        name: 'Aliado Caído',
        hpCurrent: 1,
        hpMax: 60,
        dexterity: 8,
        speed: 9,
      },
    });
    characterIds.push(ally.id);

    const region = await prisma.region.create({ data: { name: `Região Itens ${suffix}` } });
    const locality = await prisma.locality.create({
      data: { name: `Local Itens ${suffix}`, regionId: region.id },
    });
    localityId = locality.id;

    const catalog = async (data: {
      name: string;
      category: string;
      requiresAttunement?: boolean;
      details?: Record<string, unknown>;
    }) => {
      const item = await prisma.item.create({
        data: {
          name: data.name,
          category: data.category,
          requiresAttunement: data.requiresAttunement ?? false,
          details: (data.details ?? {}) as any,
        },
      });
      itemIds.push(item.id);
      return item;
    };

    const sword = await catalog({
      name: 'Espada Cerimonial +1',
      category: 'Arma',
      details: {
        weaponType: 'melee',
        weaponCategory: 'martial',
        damageDie: 8,
        damageCount: 1,
        damageType: 'Cortante',
        attackBonus: 1,
        damageBonus: 1,
        properties: [],
      },
    });
    const armor = await catalog({
      name: 'Cota de Malha de Teste',
      category: 'Armadura',
      details: { armorType: 'Pesada', baseArmorClass: 16 },
    });
    const shield = await catalog({
      name: 'Escudo de Teste',
      category: 'Escudo',
      details: { armorClassBonus: 2 },
    });
    const ring = await catalog({
      name: 'Anel de Proteção',
      category: 'Anel',
      details: { armorClassBonus: 1 },
      requiresAttunement: true,
    });
    const attuneItems: Awaited<ReturnType<typeof catalog>>[] = [];
    for (let index = 0; index < 4; index += 1) {
      attuneItems.push(
        await catalog({
          name: `Talismã Sintonizável ${index + 1}`,
          category: 'Item Geral',
          requiresAttunement: true,
        }),
      );
    }
    const npcPotion = await catalog({
      name: 'Poção de Cura do NPC',
      category: 'Poção',
      details: { potionCategory: 'healing', healingDice: { count: 1, sides: 4, bonus: 5 } },
    });

    async function request(
      path: string,
      body?: unknown,
      token = masterToken,
    ): Promise<{ status: number; data: any }> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json()) as any };
    }

    // --- Criação do NPC pelo endpoint real ---------------------------------
    const created = await request('/creatures', {
      name: 'NPC Cerimonial',
      kind: 'NPC',
      localityIds: [locality.id],
      hpMax: 40,
      armorClass: 12,
    });
    const npcId: string = created.data?.creature?.id;
    if (!npcId) throw new Error(`Não criou o NPC: ${JSON.stringify(created.data)}`);
    creatureIds.push(npcId);

    const attackedNpc = await fetch(`${baseUrl}/api/creatures/${npcId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({
        attacks: [
          {
            id: 'bite',
            name: 'Mordida',
            attackBonus: 5,
            damage: { count: 1, sides: 6, bonus: 2, type: 'Perfurante' },
            extraDamages: [],
            finesse: false,
            ranged: false,
            notes: 'Ataque natural',
          },
        ],
      }),
    });
    check('67.AS) NPC aceita ataque próprio no statblock', attackedNpc.status === 200);

    const readNpc = async (token = masterToken): Promise<CreatureDto> =>
      (await request(`/creatures/${npcId}`, undefined, token)).data.creature as CreatureDto;

    let npc = await readNpc();
    const add = async (payload: Record<string, unknown>) =>
      request(`/creatures/${npcId}/inventory`, { expectedVersion: npc.version, ...payload }).then(async (res) => {
        if (res.data?.creature) npc = res.data.creature as CreatureDto;
        return res;
      });

    // --- M/N: receber item e persistir -------------------------------------
    await add({ itemId: sword.id, quantity: 1 });
    await add({ itemId: armor.id, quantity: 1 });
    await add({ itemId: shield.id, quantity: 1 });
    await add({ itemId: ring.id, quantity: 1 });
    const potionAdd = await add({ itemId: npcPotion.id, quantity: 2 });
    check(
      '67.M) NPC recebe item do catálogo (quantidade persistente)',
      potionAdd.status === 200 &&
        npc.inventory.some((item) => item.name.includes('Poção de Cura do NPC') && item.quantity === 2),
    );
    npc = await readNpc();
    check(
      '67.N) item persiste na leitura seguinte (não é cópia do combatente)',
      npc.inventory.filter((item) => item.itemId === npcPotion.id).length === 1 &&
        npc.inventory.find((item) => item.itemId === npcPotion.id)?.quantity === 2,
    );

    // --- O/P/Q: equipar arma e derivar ataques -----------------------------
    const swordEntry = npc.inventory.find((item) => item.itemId === sword.id)!;
    const moved = await request(`/creatures/${npcId}/inventory/move`, {
      expectedVersion: npc.version,
      itemInventoryId: swordEntry.id,
      targetSlot: 'hand1',
    });
    npc = moved.data.creature as CreatureDto;
    check('67.O) NPC equipa arma no slot de mão', moved.status === 200 && npc.inventory.find((item) => item.id === swordEntry.id)?.slot === 'hand1');
    check(
      '67.P) arma equipada aparece nos ataques derivados',
      npc.derivedAttacks.some((attack) => attack.name.includes('Espada Cerimonial +1')),
    );
    check(
      '67.Q) ataque natural continua existindo ao lado da arma',
      npc.attacks.some((attack) => attack.id === 'bite') &&
        npc.derivedAttacks.every((attack) => attack.id !== 'bite'),
    );
    const swordAttack = npc.derivedAttacks.find((attack) => attack.name.includes('Espada Cerimonial +1'))!;
    check(
      '67.T) bônus mágico +1 entra no acerto e no dano pelo motor existente',
      swordAttack.attackBonus >= 3 && swordAttack.damage.bonus >= 1,
    );

    // --- R/S: armadura e escudo alteram a CA -------------------------------
    const armorEntry = npc.inventory.find((item) => item.itemId === armor.id)!;
    npc = (await request(`/creatures/${npcId}/inventory/move`, {
      expectedVersion: npc.version,
      itemInventoryId: armorEntry.id,
      targetSlot: 'chest',
    })).data.creature as CreatureDto;
    const shieldEntry = npc.inventory.find((item) => item.itemId === shield.id)!;
    npc = (await request(`/creatures/${npcId}/inventory/move`, {
      expectedVersion: npc.version,
      itemInventoryId: shieldEntry.id,
      targetSlot: 'hand2',
    })).data.creature as CreatureDto;
    check(
      '67.R/S) armadura pesada + escudo recalculam a CA efetiva (16 + 2)',
      npc.armorClass === 12 && npc.effectiveArmorClass === 18,
    );

    // --- T2: anel mágico soma bônus de CA ----------------------------------
    const ringEntry = npc.inventory.find((item) => item.itemId === ring.id)!;
    npc = (await request(`/creatures/${npcId}/inventory/move`, {
      expectedVersion: npc.version,
      itemInventoryId: ringEntry.id,
      targetSlot: 'ring1',
    })).data.creature as CreatureDto;
    check('67.T2) item mágico equipado soma +1 de CA', npc.effectiveArmorClass === 19);

    // --- U: sintonização máxima 3 -----------------------------------------
    for (const item of attuneItems) {
      npc = (await request(`/creatures/${npcId}/inventory`, {
        expectedVersion: npc.version,
        itemId: item.id,
        quantity: 1,
      })).data.creature as CreatureDto;
    }
    const attuneOne = async (itemId: string) => {
      const entry = npc.inventory.find((item) => item.itemId === itemId)!;
      return request(`/creatures/${npcId}/inventory/attune`, {
        expectedVersion: npc.version,
        itemInventoryId: entry.id,
        attuned: true,
      });
    };
    for (const item of attuneItems.slice(0, 3)) {
      const res = await attuneOne(item.id);
      if (res.data.creature) npc = res.data.creature as CreatureDto;
    }
    const fourth = await attuneOne(attuneItems[3].id);
    if (fourth.data.creature) npc = fourth.data.creature as CreatureDto;
    check(
      '67.U) sintonização respeita o limite de 3',
      npc.inventory.filter((item) => item.attuned).length === 3 && fourth.status === 409,
    );

    // --- V: moedas com saldo protegido ------------------------------------
    const give = await request(`/creatures/${npcId}/coins`, {
      expectedVersion: npc.version,
      delta: { gp: 10 },
    });
    npc = give.data.creature as CreatureDto;
    const remove = await request(`/creatures/${npcId}/coins`, {
      expectedVersion: npc.version,
      delta: { gp: -3 },
    });
    npc = remove.data.creature as CreatureDto;
    const overdraft = await request(`/creatures/${npcId}/coins`, {
      expectedVersion: npc.version,
      delta: { gp: -999 },
    });
    check(
      '67.V) moedas do NPC usam o motor existente e nunca ficam negativas',
      give.status === 200 && remove.status === 200 && npc.coins.gp === 7 && overdraft.status === 409,
    );

    // Adiciona o item MANUAL (efeito não modelado).
    const manualAdd = await add({
      name: 'Óleo Misterioso',
      category: 'Item Geral',
      quantity: 2,
      details: { consumable: true },
    });
    npc = manualAdd.data.creature as CreatureDto;
    check('67.AI) item sem efeito automatizado entra no inventário do NPC', npc.inventory.some((item) => item.name === 'Óleo Misterioso'));

    // --- Combate ----------------------------------------------------------
    const started = await request('/combat', {
      localityId: locality.id,
      entries: [{ creatureId: npcId, quantity: 1 }],
    });
    if (started.status !== 201) throw new Error(`Combate não iniciou: ${JSON.stringify(started.data)}`);
    let combat = started.data.combat as CombatDto;
    combatId = combat.id;
    const heroCombatant = combat.combatants.find((item) => item.characterId === hero.id)!;
    const allyCombatant = combat.combatants.find((item) => item.characterId === ally.id)!;
    const npcCombatant = combat.combatants.find((item) => item.creatureId === npcId)!;

    // Privacidade (o router de criaturas é master-only).
    const playerCreatureRead = await request(`/creatures/${npcId}`, undefined, playerToken);
    check('67.AP) rota de NPC responde 403 para PLAYER', playerCreatureRead.status === 403);
    const playerItemList = await request(`/combat/items/${npcCombatant.id}`, undefined, playerToken);
    check('67.AQ) PLAYER não recebe a lista de consumíveis do NPC', playerItemList.status === 403);
    const masterItemList = await request(`/combat/items/${npcCombatant.id}`);
    check(
      '67.AR) MASTER recebe os itens usáveis do NPC (com quantidade)',
      masterItemList.status === 200 &&
        masterItemList.data.items.some((item: any) => item.name.includes('Poção de Cura do NPC') && item.quantity === 2),
    );
    const playerCombatView = (await request('/combat/active', undefined, playerToken)).data.combat as CombatDto;
    const hiddenNpc = playerCombatView.combatants.find((item) => item.id === npcCombatant.id)!;
    check(
      '67.AO2) DTO do jogador esconde CA/vida e os estados operacionais do NPC',
      hiddenNpc.armorClass === null &&
        hiddenNpc.hpCurrent === null &&
        !('inventory' in hiddenNpc) &&
        hiddenNpc.turnEconomy.dodging === false &&
        hiddenNpc.turnEconomy.ready === null,
    );
    check(
      '67.AT) CA do NPC no combate (visão do Mestre) reflete o equipamento',
      (combat.combatants.find((item) => item.id === npcCombatant.id)?.armorClass ?? 0) === 19,
    );
    check(
      '67.AU) ataques do NPC = próprios + arma equipada (motor do combate)',
      npc.attacks.some((attack) => attack.id === 'bite') &&
        npc.derivedAttacks.some((attack) => attack.name.includes('Espada')),
    );

    // Rolagens de iniciativa (Mestre por todos).
    for (const participant of combat.combatants) {
      await request(`/combat/initiative/${participant.id}`, {});
    }
    const refresh = async (): Promise<CombatDto> => {
      combat = (await request('/combat/active')).data.combat as CombatDto;
      return combat;
    };
    await refresh();

    async function advanceTo(combatantId: string): Promise<void> {
      await refresh();
      for (let attempt = 0; attempt <= combat.combatants.length * 2; attempt += 1) {
        if (combat.currentCombatantId === combatantId) return;
        const next = await request('/combat/next-turn', {
          combatId,
          expectedVersion: combat.version,
          operationId: randomUUID(),
          skipDeathSave: true,
        });
        if (next.status !== 200) throw new Error(`Falha ao avançar: ${JSON.stringify(next.data)}`);
        combat = next.data.combat as CombatDto;
      }
      throw new Error('Não alcançou o turno desejado.');
    }

    async function override(adjustment: string, combatantId: string, extra: Record<string, unknown> = {}) {
      await refresh();
      const res = await request('/combat/economy/override', {
        combatId,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        combatantId,
        adjustment,
        reason: 'Preparação do smoke de itens',
        ...extra,
      });
      if (res.data.combat) combat = res.data.combat as CombatDto;
      return res;
    }

    async function useItem(
      combatantId: string,
      itemInventoryId: string,
      token = playerToken,
      extra: Record<string, unknown> = {},
      operationId = randomUUID(),
    ) {
      await refresh();
      const res = await request(
        '/combat/use-item',
        {
          combatId,
          expectedVersion: combat.version,
          operationId,
          combatantId,
          itemInventoryId,
          ...extra,
        },
        token,
      );
      if (res.data.combat) combat = res.data.combat as CombatDto;
      return res;
    }

    // --- W/X/Y/Z: jogador usa poção em si ---------------------------------
    await advanceTo(heroCombatant.id);
    const heroInventory = async (): Promise<InventoryItemDto[]> =>
      parseJson<InventoryItemDto[]>(
        inventoryListSchema,
        (await prisma.character.findUniqueOrThrow({ where: { id: hero.id } })).inventory,
        [],
      );
    const heroBefore = await prisma.character.findUniqueOrThrow({ where: { id: hero.id } });
    const heroPotion = (await heroInventory()).find((item) => item.id === 'potion-self')!;
    const selfUse = await useItem(heroCombatant.id, 'potion-self');
    const heroAfter = await prisma.character.findUniqueOrThrow({ where: { id: hero.id } });
    const heroPotionAfter = (await heroInventory()).find((item) => item.id === 'potion-self');
    const heroTurn = combat.combatants.find((item) => item.id === heroCombatant.id)!.turnEconomy;
    check(
      '67.W/X/Y/Z) poção em si: Ação consumida, unidade decrementada e cura aplicada',
      selfUse.status === 200 &&
        heroTurn.actionsUsed === 1 &&
        heroPotionAfter?.quantity === heroPotion.quantity - 1 &&
        heroAfter.hpCurrent > heroBefore.hpCurrent,
    );

    // --- AA: mesmo operationId não consome duas vezes ---------------------
    // Restaura a Ação para que o PRIMEIRO pedido seja realmente aceito; o
    // retry reenvia o MESMO payload (inclusive expectedVersion), como um retry
    // de rede — é assim que a idempotência do servidor é exercitada.
    await override('restore-action', heroCombatant.id);
    await refresh();
    const operationId = randomUUID();
    const retryPayload = {
      combatId,
      expectedVersion: combat.version,
      operationId,
      combatantId: heroCombatant.id,
      itemInventoryId: 'potion-self',
    };
    const retryOne = await request('/combat/use-item', retryPayload, playerToken);
    if (retryOne.data.combat) combat = retryOne.data.combat as CombatDto;
    const afterOne = await heroInventory();
    const retryTwo = await request('/combat/use-item', retryPayload, playerToken);
    const afterTwo = await heroInventory();
    check(
      '67.AA) retry com o MESMO operationId devolve o snapshot e não consome de novo',
      retryOne.status === 200 &&
        retryTwo.status === 200 &&
        retryTwo.data.replayed === true &&
        JSON.stringify(afterTwo) === JSON.stringify(afterOne),
    );

    // --- 58.A–D: fontes reais das etiquetas de estado (Dodge/Ready) --------
    await override('restore-action', heroCombatant.id);
    await refresh();
    await request(
      '/combat/action',
      {
        combatId,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        combatantId: heroCombatant.id,
        action: 'dodge',
      },
      playerToken,
    );
    await refresh();
    check(
      '58.A) Esquiva ativa grava o estado REAL (badge ESQUIVANDO)',
      combat.combatants.find((item) => item.id === heroCombatant.id)?.turnEconomy.dodging === true,
    );
    await advanceTo(npcCombatant.id);
    await advanceTo(heroCombatant.id);
    check(
      '58.B) ao começar o próximo turno a Esquiva termina (badge some)',
      combat.combatants.find((item) => item.id === heroCombatant.id)?.turnEconomy.dodging === false,
    );
    await override('restore-action', heroCombatant.id);
    await refresh();
    await request(
      '/combat/action',
      {
        combatId,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        combatantId: heroCombatant.id,
        action: 'ready',
        trigger: 'Inimigo se aproximar',
        intent: 'Atacar',
      },
      playerToken,
    );
    await refresh();
    check(
      '58.C) ação preparada grava o estado REAL (badge PREPARANDO AÇÃO)',
      Boolean(combat.combatants.find((item) => item.id === heroCombatant.id)?.turnEconomy.ready),
    );
    await request(
      '/combat/action',
      {
        combatId,
        expectedVersion: combat.version,
        operationId: randomUUID(),
        combatantId: heroCombatant.id,
        action: 'execute-ready',
      },
      playerToken,
    );
    await refresh();
    check(
      '58.D) ao resolver a ação preparada o Ready termina (badge some)',
      combat.combatants.find((item) => item.id === heroCombatant.id)?.turnEconomy.ready === null,
    );

    // --- AD/AE/AF/AG/AH: administrar no aliado a 0 ------------------------
    const downed = await request('/combat/hp', {
      combatantId: allyCombatant.id,
      amount: 10,
      mode: 'damage',
    });
    if (downed.status !== 200) throw new Error(`Não derrubou o aliado: ${JSON.stringify(downed.data)}`);
    await refresh();
    const allyDeath = combat.combatants.find((item) => item.id === allyCombatant.id)!.deathState!;
    check(
      '67.AD0) aliado a 0 PV com Testes contra a Morte ativos',
      allyDeath.deathSaves === true && allyDeath.stabilized === false && allyDeath.dead === false,
    );
    await override('restore-action', heroCombatant.id);
    const administered = await useItem(heroCombatant.id, 'potion-ally', playerToken, {
      targetCombatantId: allyCombatant.id,
    });
    const allyAfter = await prisma.character.findUniqueOrThrow({ where: { id: ally.id } });
    const allyDeathAfter = combat.combatants.find((item) => item.id === allyCombatant.id)!.deathState!;
    const heroAfterAdmin = combat.combatants.find((item) => item.id === heroCombatant.id)!.turnEconomy;
    check(
      '67.AD/AE/AF/AG/AH) administrar em aliado a 0: cura, limpa o ciclo, mantém Caído e gasta a Ação',
      administered.status === 200 &&
        allyAfter.hpCurrent > 0 &&
        allyDeathAfter.deathSaves === false &&
        allyDeathAfter.successes === 0 &&
        allyDeathAfter.failures === 0 &&
        allyDeathAfter.stabilized === false &&
        combat.combatants.find((item) => item.id === allyCombatant.id)!.conditionEffects.prone === true &&
        heroAfterAdmin.actionsUsed === 1,
    );

    // --- NPC usa poção e item manual --------------------------------------
    await advanceTo(npcCombatant.id);
    const npcBefore = await readNpc();
    const npcPotionEntry = npcBefore.inventory.find((item) => item.itemId === npcPotion.id)!;
    const npcUse = await useItem(npcCombatant.id, npcPotionEntry.id, masterToken);
    const npcAfter = await readNpc();
    check(
      '67.AB/AC) NPC usa poção: inventário PERSISTENTE decrementa',
      npcUse.status === 200 &&
        npcAfter.inventory.find((item) => item.itemId === npcPotion.id)?.quantity ===
          npcPotionEntry.quantity - 1,
    );
    await override('restore-action', npcCombatant.id);
    const manualEntry = npcAfter.inventory.find((item) => item.name === 'Óleo Misterioso')!;
    const npcHpBefore = combat.combatants.find((item) => item.id === npcCombatant.id)!.hpCurrent;
    const manualUse = await useItem(npcCombatant.id, manualEntry.id, masterToken);
    const npcAfterManual = await readNpc();
    check(
      '67.AJ/AK/AL/AM/AN) item manual: Ação + unidade consumidas, log de resolução do Mestre e NENHUM efeito inventado',
      manualUse.status === 200 &&
        npcAfterManual.inventory.find((item) => item.id === manualEntry.id)?.quantity ===
          manualEntry.quantity - 1 &&
        manualUse.data.combat.combatants.find((item: any) => item.id === npcCombatant.id).turnEconomy
          .actionsUsed === 1 &&
        manualUse.data.combat.economyLog.some(
          (entry: any) =>
            entry.action === 'use-item' &&
            entry.message.includes('Efeito resolvido pelo Mestre'),
        ) &&
        manualUse.data.combat.combatants.find((item: any) => item.id === npcCombatant.id).hpCurrent ===
          npcHpBefore,
    );

    // --- AV: consumível persistente após o combate -----------------------
    const potionAfterCombat = npcAfter.inventory.find((item) => item.itemId === npcPotion.id)?.quantity ?? 0;
    await request('/combat/end', {});
    const npcFinal = await readNpc();
    check(
      '67.AV) consumível usado no combate continua decrementado depois do combate',
      npcFinal.inventory.find((item) => item.itemId === npcPotion.id)?.quantity === potionAfterCombat,
    );
  } finally {
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    if (characterIds.length) await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    if (creatureIds.length) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    if (localityId) {
      const locality = await prisma.locality.findUnique({ where: { id: localityId } });
      await prisma.locality.deleteMany({ where: { id: localityId } });
      if (locality) await prisma.region.deleteMany({ where: { id: locality.regionId } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
