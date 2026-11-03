import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { pickCastingResource } from './spell-slot-fixtures.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import type { EffectDto } from '../modules/effects/effects.dto.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.5G — BLESS COMO PRIMEIRO EFEITO REAL.
 *
 * Prova que uma regra do PHB 2014 entra na engine genérica sem hardcode:
 *  • `+1d4` OPCIONAL em ataques/salvaguardas, oferecido pelo SERVIDOR;
 *  • `stackingKey` faz dois Bless no mesmo alvo valerem UM d4 (o segundo não é
 *    descartado: assume quando o primeiro termina);
 *  • Concentração do caster ligada ao grupo (mesmo motor), self-target incluído;
 *  • falha/!fim da concentração desmonta o grupo pelo lifecycle da 6.5D;
 *  • Ability Checks NÃO recebem o bônus e nada vaza de efeito privado.
 */
export async function smokeBlessEffect(baseUrl: string, check: Check): Promise<void> {
  console.log('\n73) Fase 6.5G — Bless como primeiro efeito real');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const operationIds: string[] = [];
  const groups: string[] = [];
  let combatId: string | undefined;

  try {
    const master = await prisma.user.create({
      data: { username: `bls_m_${suffix}`, displayName: 'Mestre Bless', passwordHash: 'fixture', role: 'MASTER' },
    });
    const heroUser = await prisma.user.create({
      data: { username: `bls_h_${suffix}`, displayName: 'Herói Bless', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const allyUser = await prisma.user.create({
      data: { username: `bls_a_${suffix}`, displayName: 'Aliado Bless', passwordHash: 'fixture', role: 'PLAYER' },
    });
    const thirdUser = await prisma.user.create({
      data: { username: `bls_t_${suffix}`, displayName: 'Terceiro Bless', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, heroUser.id, allyUser.id, thirdUser.id);
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
    const allyToken = signToken({
      sub: allyUser.id,
      username: allyUser.username,
      displayName: allyUser.displayName,
      role: allyUser.role,
    });

    const attacks = [
      {
        id: 'bless-golpe',
        name: 'Golpe de prova',
        attackBonus: 5,
        damage: { count: 1, sides: 4, bonus: 1, type: 'Contundente' },
        extraDamages: [],
        finesse: false,
        ranged: false,
        notes: '',
      },
    ];
    const hero = await prisma.character.create({
      data: {
        userId: heroUser.id,
        name: 'Herói Bless',
        hpCurrent: 60,
        hpMax: 60,
        speed: 9,
        // CON 30 garante que o PRIMEIRO concentration save (DC 10) sempre
        // passa: se ele falhasse, a concentração terminaria e limparia a
        // SEGUNDA pendência — o teste de 73.H compararia uma rolagem inexistente.
        constitution: 30,
        dexterity: 14,
        // 6.6B: todo cast registra a FONTE de conjuração (perfil derivado).
        intelligence: 16,
        // 6.6C: Bless (nível 1) agora gasta espaço; o pool completo do Mago 20
        // sustenta todas as aplicações deste smoke.
        classes: [{ classKey: 'wizard', subclass: '', level: 20 }],
        attacks: attacks as never,
      },
    });
    const ally = await prisma.character.create({
      data: {
        userId: allyUser.id,
        name: 'Aliado Bless',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        dexterity: 14,
        intelligence: 16,
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    const third = await prisma.character.create({
      data: {
        userId: thirdUser.id,
        name: 'Terceiro Bless',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        classes: [{ classKey: 'wizard', subclass: '', level: 20 }],
      },
    });
    characterIds.push(hero.id, ally.id, third.id);
    // 6.6B: para CONJURAR (Bless de stacking abaixo) a criatura precisa do perfil
    // explícito do statblock — existir no cadastro não a torna conjuradora.
    const goblin = await prisma.creature.create({
      data: {
        name: 'Goblin Bless',
        kind: 'CREATURE',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
        // 6.6C: o statblock declara os espaços; sem eles o NPC não conjura.
        spellcastingResources: { spellSlots: [{ level: 1, max: 6 }, { level: 2, max: 3 }], pactSlot: null },
      },
    });
    const otherGoblin = await prisma.creature.create({
      data: {
        name: 'Goblin Intocado',
        kind: 'CREATURE',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
        spellcastingProfile: { ability: 'charisma', saveDc: 15, attackBonus: 7 },
        spellcastingResources: { spellSlots: [{ level: 1, max: 6 }, { level: 2, max: 3 }], pactSlot: null },
      },
    });
    creatureIds.push(goblin.id, otherGoblin.id);

    const heroEntity = { kind: 'character' as const, id: hero.id };
    const allyEntity = { kind: 'character' as const, id: ally.id };
    const thirdEntity = { kind: 'character' as const, id: third.id };
    const goblinEntity = { kind: 'creature' as const, id: goblin.id };
    const otherGoblinEntity = { kind: 'creature' as const, id: otherGoblin.id };

    async function request(path: string, body?: unknown, token = masterToken) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    async function applyBless(
      caster: { kind: 'character' | 'creature'; id: string },
      targets: { kind: 'character' | 'creature'; id: string }[],
      token = masterToken,
      operationId = randomUUID(),
    ) {
      operationIds.push(operationId);
      const castingResource = await pickCastingResource(baseUrl, masterToken, caster, 1);
      const res = await request(
        '/effects/bless',
        { operationId, caster, targets, ...(castingResource ? { castingResource } : {}) },
        token,
      );
      if (res.status === 201 || res.status === 200) groups.push(res.data.groupId);
      return { ...res, operationId };
    }

    async function options(
      entity: { kind: 'character' | 'creature'; id: string },
      roll: 'attack' | 'save' | 'check',
      token: string,
      ability?: string,
    ) {
      const query = ability ? `?roll=${roll}&ability=${ability}` : `?roll=${roll}`;
      return request(`/dice/options/${entity.kind}/${entity.id}${query}`, undefined, token);
    }

    async function effectsOf(entity: { kind: 'character' | 'creature'; id: string }): Promise<EffectDto[]> {
      const res = await request(`/effects/${entity.kind}/${entity.id}`);
      return (res.data.effects ?? []) as EffectDto[];
    }

    async function mechanicalOf(entity: { kind: 'character' | 'creature'; id: string }) {
      const res = await request(`/mechanical/${entity.kind}/${entity.id}`);
      return res.data.mechanical as {
        version: number;
        state: {
          concentration: { id: string; label: string; sourceType: string; sourceId?: string } | null;
          pendingConcentrationSaves: { id: string; dc: number }[];
          conditions: { condition: string }[];
        };
        combat?: { version: number };
      };
    }

    async function endEffect(effectId: string) {
      return request(`/effects/${effectId}/end`, { operationId: randomUUID() });
    }

    // =====================================================================
    // A — aplicação de prova (2 alvos, self-target) e grupo/concentração
    // =====================================================================
    const first = await applyBless(heroEntity, [heroEntity, allyEntity]);
    const firstEffects = (first.data.effects ?? []) as EffectDto[];
    const heroConcentration = await mechanicalOf(heroEntity);
    check(
      '73.A) Bless cria UM grupo, uma instância por alvo, sourceEntity do caster e id canônico',
      first.status === 201 &&
        firstEffects.length === 2 &&
        firstEffects.every((effect) => effect.groupId === first.data.groupId) &&
        firstEffects.every((effect) => effect.definitionId === 'spell.bless') &&
        firstEffects.every((effect) => effect.visibility === 'public') &&
        firstEffects.some((effect) => effect.targetEntity.kind === 'character' && effect.targetEntity.id === hero.id) &&
        heroConcentration.state.concentration?.sourceType === 'effect' &&
        heroConcentration.state.concentration?.sourceId === first.data.groupId,
      JSON.stringify({ status: first.status, effects: firstEffects, concentration: heroConcentration.state.concentration }),
    );

    const heroEffect = firstEffects.find((effect) => effect.targetEntity.id === hero.id)!;
    const allyEffect = firstEffects.find((effect) => effect.targetEntity.id === ally.id)!;

    // =====================================================================
    // B — limites e permissões (server-side)
    // =====================================================================
    const noTarget = await applyBless(heroEntity, []);
    const fourTargets = await applyBless(heroEntity, [heroEntity, allyEntity, thirdEntity, goblinEntity]);
    const duplicated = await applyBless(heroEntity, [allyEntity, allyEntity]);
    const playerApply = await applyBless(heroEntity, [allyEntity], heroToken);
    check(
      '73.B) 0 alvo, 4 alvos e alvo repetido são rejeitados; PLAYER não aplica',
      noTarget.status === 400 &&
        fourTargets.status === 400 &&
        duplicated.status === 400 &&
        playerApply.status === 403,
      JSON.stringify({ noTarget: noTarget.status, fourTargets: fourTargets.status, duplicated: duplicated.status, player: playerApply.status }),
    );

    // =====================================================================
    // C — optional modifier é SERVER-DERIVED e escopado (sem d4 em check)
    // =====================================================================
    const attackOptions = await options(allyEntity, 'attack', allyToken);
    const saveOptions = await options(allyEntity, 'save', allyToken, 'dexterity');
    const checkOptions = await options(allyEntity, 'check', allyToken, 'strength');
    const attackOption = (attackOptions.data.options ?? [])[0];
    const saveOption = (saveOptions.data.options ?? [])[0];
    check(
      '73.C) +1d4 aparece em ataque e salvaguarda (opcional, sem valores do cliente) e NÃO em teste de habilidade',
      attackOptions.status === 200 &&
        attackOptions.data.options.length === 1 &&
        attackOption.label === 'Bless' &&
        attackOption.kind === 'roll-dice' &&
        attackOption.count === 1 &&
        attackOption.sides === 4 &&
        attackOption.id === `${allyEffect.id}:attack` &&
        saveOptions.data.options.length === 1 &&
        saveOption.id === `${allyEffect.id}:save` &&
        checkOptions.status === 200 &&
        checkOptions.data.options.length === 0,
      JSON.stringify({ attack: attackOptions.data, save: saveOptions.data, check: checkOptions.data }),
    );

    // =====================================================================
    // D/E — Saving Throw com e sem o d4 escolhido (rolado pelo servidor)
    // =====================================================================
    const saveBase = await request(
      '/dice/roll',
      { entity: allyEntity, dice: [{ sides: 20 }], kind: 'save', ability: 'dexterity', bonus: 0 },
      allyToken,
    );
    const saveWithBless = await request(
      '/dice/roll',
      {
        entity: allyEntity,
        dice: [{ sides: 20 }],
        kind: 'save',
        ability: 'dexterity',
        bonus: 0,
        selectedEffectModifiers: [saveOption.id],
      },
      allyToken,
    );
    const saveDice = (saveWithBless.data.roll?.effectModifiers?.dice ?? []) as { sides: number; value: number; label: string }[];
    const keptWithBless = saveWithBless.data.roll?.dice?.reduce((sum: number, die: any) => (die.dropped ? sum : sum + die.value), 0);
    check(
      '73.D/E) save sem seleção não rola d4; com seleção rola EXATAMENTE 1d4 e soma no total',
      saveBase.status === 201 &&
        !saveBase.data.roll.effectModifiers &&
        saveWithBless.status === 201 &&
        saveDice.length === 1 &&
        saveDice[0].sides === 4 &&
        saveDice[0].label === 'Bless' &&
        saveWithBless.data.roll.total === keptWithBless + saveWithBless.data.roll.bonus + saveDice[0].value,
      JSON.stringify({ base: saveBase.data.roll, withBless: saveWithBless.data.roll }),
    );

    // =====================================================================
    // F — combate real: ataque com e sem Bless + id inválido/encerrado
    // =====================================================================
    const combatRow = await prisma.combat.create({
      data: {
        combatants: {
          create: [
            { kind: 'CHARACTER', characterId: hero.id, ownerUserId: heroUser.id, name: hero.name, initiative: 100, dexterityMod: 2 },
            { kind: 'CREATURE', creatureId: goblin.id, name: goblin.name, hpCurrent: 500, hpMax: 500, armorClass: 10 },
          ],
        },
      },
    });
    combatId = combatRow.id;
    // Relê o combate criado direto no banco: rola só a criatura (o herói já tem
    // iniciativa) para ativar e deixar o turno do herói.
    const heroCombatant = await prisma.combatant.findFirstOrThrow({ where: { combatId, characterId: hero.id } });
    const npcCombatant = await prisma.combatant.findFirstOrThrow({ where: { combatId, creatureId: goblin.id } });
    const rolled = await request(`/combat/initiative/${npcCombatant.id}`, {});
    let activeCombat = rolled.data.combat as CombatDto;
    for (let i = 0; activeCombat.status !== 'ACTIVE' && i < 3; i += 1) {
      activeCombat = (await request('/combat/active')).data.combat as CombatDto;
    }
    for (let i = 0; activeCombat.currentCombatantId !== heroCombatant.id && i < 4; i += 1) {
      const next = await request('/combat/next-turn', {
        combatId,
        expectedVersion: activeCombat.version,
        operationId: randomUUID(),
      });
      activeCombat = next.data.combat as CombatDto;
    }

    async function restoreAction() {
      activeCombat = (await request('/combat/active')).data.combat as CombatDto;
      await request('/combat/economy/override', {
        combatId,
        expectedVersion: activeCombat.version,
        operationId: randomUUID(),
        combatantId: heroCombatant.id,
        adjustment: 'restore-action',
        reason: 'Smoke Bless',
      });
      activeCombat = (await request('/combat/active')).data.combat as CombatDto;
    }
    async function attack(extra: Record<string, unknown> = {}) {
      await restoreAction();
      return request(
        '/combat/attack',
        {
          combatId,
          expectedVersion: activeCombat.version,
          operationId: randomUUID(),
          targetCombatantId: npcCombatant.id,
          attackId: 'unarmed',
          ...extra,
        },
        heroToken,
      );
    }

    const attackBase = await attack();
    const attackWithBless = await attack({ selectedEffectModifiers: [`${heroEffect.id}:attack`] });
    const baseDelta = attackBase.data.result?.attackTotal - attackBase.data.result?.attackRoll - attackBase.data.result?.attackBonus;
    const blessDelta = attackWithBless.data.result?.attackTotal - attackWithBless.data.result?.attackRoll - attackWithBless.data.result?.attackBonus;
    check(
      '73.F) ataque sem seleção não soma d4; com seleção soma um valor de 1..4 no total',
      attackBase.status === 200 &&
        baseDelta === 0 &&
        attackWithBless.status === 200 &&
        (blessDelta ?? -1) >= 1 &&
        (blessDelta ?? -1) <= 4,
      JSON.stringify({ baseDelta, blessDelta, base: attackBase.data.result, withBless: attackWithBless.data.result }),
    );

    const invented = await attack({ selectedEffectModifiers: ['inventado:attack'] });
    const wrongScope = await attack({ selectedEffectModifiers: [`${heroEffect.id}:save`] });
    check(
      '73.G) ID inventado ou de outro escopo é REJEITADO (nunca aplicado em silêncio)',
      invented.status === 400 &&
        invented.data.error === 'INVALID_EFFECT_MODIFIER' &&
        wrongScope.status === 400,
      JSON.stringify({ invented: invented.data, wrongScope: wrongScope.data }),
    );

    // =====================================================================
    // H — self-bless no teste de Concentração (dano antes de falhar)
    // =====================================================================
    await request('/combat/hp', { combatantId: heroCombatant.id, amount: 1, mode: 'damage' });
    await request('/combat/hp', { combatantId: heroCombatant.id, amount: 1, mode: 'damage' });
    const heroWithPendings = await mechanicalOf(heroEntity);
    const pendings = heroWithPendings.state.pendingConcentrationSaves;
    const concentrationWithBless = await request(
      '/dice/roll',
      {
        kind: 'concentration',
        entity: heroEntity,
        pendingConcentrationSaveId: pendings[0]?.id,
        dice: [{ sides: 20 }],
        selectedEffectModifiers: [`${heroEffect.id}:save`],
      },
      heroToken,
    );
    const concentrationDice = (concentrationWithBless.data.roll?.effectModifiers?.dice ?? []) as { sides: number; label: string }[];
    const concentrationWithout = await request(
      '/dice/roll',
      {
        kind: 'concentration',
        entity: heroEntity,
        pendingConcentrationSaveId: pendings[1]?.id,
        dice: [{ sides: 20 }],
      },
      heroToken,
    );
    check(
      '73.H) Concentration Save do próprio caster oferece o d4 quando selecionado e não rola sem seleção',
      pendings.length === 2 &&
        concentrationWithBless.status === 201 &&
        concentrationDice.length === 1 &&
        concentrationDice[0].sides === 4 &&
        concentrationDice[0].label === 'Bless' &&
        concentrationWithout.status === 201 &&
        !concentrationWithout.data.roll.effectModifiers,
      JSON.stringify({ pendings: pendings.length, withBless: concentrationWithBless.data.roll, without: concentrationWithout.data.roll }),
    );

    // =====================================================================
    // I — dois Bless no MESMO alvo: persistem, mas UMA contribuição
    // =====================================================================
    // Base conhecida: a concentração do herói (se ainda ativa) termina aqui.
    // O teste de stacking não pode depender do resultado aleatório do save.
    const heroStateBeforeStack = await mechanicalOf(heroEntity);
    if (heroStateBeforeStack.state.concentration) {
      await request(
        '/mechanical/mutate',
        {
          entity: heroEntity,
          expectedVersion: heroStateBeforeStack.version,
          ...(heroStateBeforeStack.combat
            ? { expectedCombatVersion: heroStateBeforeStack.combat.version }
            : {}),
          operationId: randomUUID(),
          action: 'concentrate-end',
          concentrationId: heroStateBeforeStack.state.concentration.id,
        },
        heroToken,
      );
    }
    const stackFirst = await applyBless(goblinEntity, [heroEntity]);
    const stackFirstEffect = (stackFirst.data.effects ?? [])[0] as EffectDto;
    const stackSecond = await applyBless(otherGoblinEntity, [heroEntity]);
    const stackSecondEffect = (stackSecond.data.effects ?? [])[0] as EffectDto;
    const twoBlessOptions = await options(heroEntity, 'attack', heroToken);
    const bothRows = await prisma.effectInstance.findMany({
      where: { id: { in: [stackFirstEffect.id, stackSecondEffect.id] } },
      select: { id: true, status: true },
    });
    check(
      '73.I) duas aplicações de Bless coexistem, mas o ataque oferece SÓ UM +1d4',
      stackFirst.status === 201 &&
        stackSecond.status === 201 &&
        bothRows.every((row) => row.status === 'active') &&
        twoBlessOptions.data.options.length === 1 &&
        twoBlessOptions.data.options[0].id === `${stackFirstEffect.id}:attack`,
      JSON.stringify({ options: twoBlessOptions.data.options, rows: bothRows }),
    );
    await endEffect(stackFirstEffect.id);
    const afterFirstEnd = await options(heroEntity, 'attack', heroToken);
    check(
      '73.I.1) encerrar o primeiro Bless faz o segundo assumir sozinho (nunca somar, nunca zerar)',
      afterFirstEnd.data.options.length === 1 &&
        afterFirstEnd.data.options[0].id === `${stackSecondEffect.id}:attack`,
      JSON.stringify(afterFirstEnd.data.options),
    );
    const endedSelection = await attack({ selectedEffectModifiers: [`${stackFirstEffect.id}:attack`] });
    check(
      '73.I.2) selecionar modificador de Effect já encerrado → 400 (sem efeito mecânico)',
      endedSelection.status === 400 && endedSelection.data.error === 'INVALID_EFFECT_MODIFIER',
      JSON.stringify(endedSelection.data),
    );

    // =====================================================================
    // J — encerrar UM alvo do grupo não termina a concentração nem os demais
    // =====================================================================
    const thirdGroup = await applyBless(heroEntity, [heroEntity, allyEntity, thirdEntity]);
    const thirdEffects = thirdGroup.data.effects as EffectDto[];
    const thirdAlly = thirdEffects.find((effect) => effect.targetEntity.id === ally.id)!;
    await endEffect(thirdAlly.id);
    const thirdConcentration = await mechanicalOf(heroEntity);
    const thirdActive = await prisma.effectInstance.findMany({
      where: { groupId: thirdGroup.data.groupId },
      select: { id: true, targetEntityId: true, status: true },
    });
    check(
      '73.J) encerrar a instância de UM alvo mantém os outros e a concentração do caster',
      thirdActive.filter((row) => row.status === 'active').length === 2 &&
        thirdActive.find((row) => row.id === thirdAlly.id)?.status === 'ended' &&
        thirdConcentration.state.concentration?.sourceId === thirdGroup.data.groupId,
      JSON.stringify({ rows: thirdActive, concentration: thirdConcentration.state.concentration }),
    );

    // =====================================================================
    // K — encerrar a concentração desmonta TODO o grupo (2 fontes distintas)
    // =====================================================================
    const heroBeforeEnd = await mechanicalOf(heroEntity);
    const concentration = heroBeforeEnd.state.concentration!;
    const endConcentration = await request(
      '/mechanical/mutate',
      {
        entity: heroEntity,
        expectedVersion: heroBeforeEnd.version,
        ...(heroBeforeEnd.combat ? { expectedCombatVersion: heroBeforeEnd.combat.version } : {}),
        operationId: randomUUID(),
        action: 'concentrate-end',
        concentrationId: concentration.id,
      },
      heroToken,
    );
    // Grupo da terceira aplicação terminou; o Bless do OUTRO caster continua.
    const afterGroupEnd = await prisma.effectInstance.findMany({
      where: { groupId: thirdGroup.data.groupId },
      select: { status: true },
    });
    const heroAfterGroupEnd = await effectsOf(heroEntity);
    check(
      '73.K) fim da concentração encerra as instâncias do grupo e preserva o Bless de OUTRA fonte',
      endConcentration.status === 200 &&
        afterGroupEnd.every((row) => row.status === 'ended') &&
        heroAfterGroupEnd.length === 1 &&
        heroAfterGroupEnd[0].id === stackSecondEffect.id,
      JSON.stringify({ status: endConcentration.status, data: endConcentration.data, group: afterGroupEnd, hero: heroAfterGroupEnd.map((effect) => effect.id) }),
    );

    // =====================================================================
    // L — idempotência do apply e isolamento de NPC do mesmo tipo
    // =====================================================================
    const replay = await applyBless(otherGoblinEntity, [heroEntity], masterToken, stackSecond.operationId);
    const npcBless = await applyBless(goblinEntity, [goblinEntity]);
    const goblinEffects = await effectsOf(goblinEntity);
    const otherEffects = await effectsOf(otherGoblinEntity);
    check(
      '73.L) retry do apply devolve o MESMO grupo e não duplica; NPC do mesmo tipo fica isolado',
      replay.status === 200 &&
        replay.data.replayed === true &&
        replay.data.groupId === stackSecond.data.groupId &&
        npcBless.status === 201 &&
        goblinEffects.length === 1 &&
        otherEffects.length === 0,
      JSON.stringify({ replay: replay.data.groupId, original: stackSecond.data.groupId, goblin: goblinEffects.length, other: otherEffects.length }),
    );

    // Encerramento manual do último Bless limpa a opção de rolagem.
    await endEffect(stackSecondEffect.id);
    const finalOptions = await options(heroEntity, 'attack', heroToken);
    check('73.L.1) sem Bless ativo não há opção de d4', finalOptions.status === 200 && finalOptions.data.options.length === 0);
  } finally {
    if (combatId) {
      await prisma.combatOperation.deleteMany({ where: { combatId } });
      await prisma.combat.deleteMany({ where: { id: combatId } });
    }
    if (groups.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { groupId: { in: groups } } });
    }
    if (operationIds.length > 0) {
      // 6.6A: a conjuração agora tem identidade própria (SpellCast).
      await prisma.spellCast.deleteMany({ where: { operationId: { in: operationIds } } });
      await prisma.effectOperation.deleteMany({ where: { operationId: { in: operationIds } } });
    }
    const entityIds = [...characterIds, ...creatureIds];
    if (entityIds.length > 0) {
      await prisma.mechanicalOperation.deleteMany({ where: { entityId: { in: entityIds } } });
    }
    if (creatureIds.length > 0) await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
