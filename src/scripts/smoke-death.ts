import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  addHpZeroUnconscious,
  clearDeathLifecycle,
  damageBreakdown,
  deathBlocksActions,
  deathSaveOutcome,
  deathSaveRequiredThisTurn,
  deathStateOf,
  hasDeathLifecycle,
  removeHpZeroUnconscious,
  stabilizeDeathLifecycle,
} from '../modules/shared/death.js';
import { medicineBonus, stabilizationSucceeds, STABILIZE_DC } from '../modules/shared/medicine.js';
import { mechanicalStateOf, type MechanicalEntity } from '../modules/shared/conditions.js';
import {
  answerRelentless,
  applyDamageConsequences,
  applyDeathSave,
  applyStabilization,
  type DeathActor,
  type DeathDto,
} from '../modules/death/death.service.js';
import type { CombatDto } from '../modules/combat/combat.dto.js';
import { restoreTurnEconomyAfterRevival } from '../modules/combat/combat.service.js';
import { planNextTurn } from '../modules/combat/turn-order.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * Fase 6.3 — 0 PV / Testes contra a Morte / Estabilização / Morte instantânea.
 *
 * Cobre os cenários A–BC do pedido: queda normal, Resistência Implacável,
 * morte instantânea, decisão do Mestre (confirmar morte / recurso narrativo /
 * cair a 0), Testes contra a Morte públicos e privados, dano a 0 PV, cura,
 * estabilização, NPCs com cópias independentes, override, concorrência,
 * reconexão, estado de morto na economia de ações e Exaustão 6.
 *
 * Fixtures próprias (contas/combate criados e apagados aqui) e HTTP real; as
 * regras determinísticas (nat 1 / nat 20) usam o MESMO domínio do servidor.
 */
export async function smokeDeath(baseUrl: string, check: Check): Promise<void> {
  console.log('\n64) Fase 6.3 — 0 PV, Testes contra a Morte, estabilização e morte instantânea');

  // --- Unidade: aritmética da morte e resultado do Teste --------------------
  const normal = damageBreakdown({ hpBefore: 30, toHp: 30, maxHp: 30 });
  const instant = damageBreakdown({ hpBefore: 30, toHp: 60, maxHp: 30 });
  check(
    '64.A/U) dano que só derruba a 0 PV não é morte instantânea; dano restante ≥ PV máximo é',
    normal.hpAfter === 0 && normal.remaining === 0 && !normal.instantDeath && instant.remaining === 30 && instant.instantDeath,
    JSON.stringify({ normal, instant }),
  );
  check(
    '64.A) dano parcial não entra no ciclo de morte (HP permanece > 0)',
    !damageBreakdown({ hpBefore: 30, toHp: 12, maxHp: 30 }).instantDeath &&
      damageBreakdown({ hpBefore: 30, toHp: 12, maxHp: 30 }).hpAfter === 18,
  );
  const outcomes = [1, 2, 9, 10, 19, 20].map((value) => [value, deathSaveOutcome(value)] as const);
  check(
    '64.M/N/O/P) 10–19 = 1 sucesso; 2–9 = 1 falha; 1 natural = 2 falhas; 20 natural = 1 PV',
    deathSaveOutcome(15).successes === 1 &&
      deathSaveOutcome(10).successes === 1 &&
      deathSaveOutcome(19).successes === 1 &&
      deathSaveOutcome(9).failures === 1 &&
      deathSaveOutcome(2).failures === 1 &&
      deathSaveOutcome(1).failures === 2 &&
      deathSaveOutcome(20).revived &&
      outcomes.every(([, outcome]) => outcome.successes + outcome.failures <= 2),
    JSON.stringify(outcomes),
  );
  // Mapeamento DETERMINÍSTICO dos 20 resultados possíveis (sem RNG): é o que
  // garante as probabilidades do PHB 2014 — 1 → 2 falhas; 2–9 → 1 falha;
  // 10–19 → 1 sucesso; 20 → 1 PV. Nenhuma tabela de pesos artificial.
  const mapping = Array.from({ length: 20 }, (_, index) => deathSaveOutcome(index + 1));
  const mappingOk = mapping.every((outcome, index) => {
    const value = index + 1;
    if (value === 20) return outcome.revived && outcome.successes === 0 && outcome.failures === 0;
    if (value === 1) return outcome.failures === 2 && outcome.successes === 0 && !outcome.revived;
    if (value >= 10) return outcome.successes === 1 && outcome.failures === 0 && !outcome.revived;
    return outcome.failures === 1 && outcome.successes === 0 && !outcome.revived;
  });
  check(
    '64.45) os 20 resultados do d20 mapeiam exatamente para o PHB 2014 (10–19 sucesso; 2–9 falha; 1 = 2 falhas; 20 = 1 PV)',
    mappingOk &&
      mapping.filter((outcome) => outcome.successes > 0).length === 10 &&
      mapping.filter((outcome) => outcome.failures === 1).length === 8 &&
      mapping.filter((outcome) => outcome.failures === 2).length === 1 &&
      mapping.filter((outcome) => outcome.revived).length === 1,
    mapping.map((outcome, index) => `${index + 1}:${outcome.successes}/${outcome.failures}${outcome.revived ? '/revive' : ''}`).join(' '),
  );
  // Planejamento do próximo turno (regra pura usada por `nextTurn` e
  // `finalizeInitiative`): mortos/estabilizados são pulados, uma volta no
  // máximo e `null` quando ninguém pode agir.
  const onlyPositions = (positions: number[]) => (index: number) => positions.includes(index);
  const skipPlan = planNextTurn(4, 0, onlyPositions([3]));
  const wrapPlan = planNextTurn(3, 2, onlyPositions([0]));
  check(
    '65.A2) plano de turno pula posições inelegíveis, conta a volta e nunca passa de uma volta',
    skipPlan?.index === 3 &&
      skipPlan.rounds === 0 &&
      skipPlan.skipped.join(',') === '1,2' &&
      wrapPlan?.index === 0 &&
      wrapPlan.rounds === 1 &&
      planNextTurn(4, 0, onlyPositions([0]))?.index === 0 &&
      planNextTurn(4, 0, onlyPositions([0]))?.rounds === 1 &&
      planNextTurn(4, 0, () => false) === null,
    JSON.stringify({ skipPlan, wrapPlan }),
  );
  check(
    '65.B2) um único combatente elegível recebe o turno e vira a rodada',
    planNextTurn(1, 0, () => true)?.index === 0 &&
      planNextTurn(1, 0, () => true)?.rounds === 1 &&
      planNextTurn(0, 0, () => true) === null,
  );

  // Medicina (Sabedoria) CD 10: sem proficiência soma só Sabedoria; com
  // proficiência soma o bônus; Expertise dobra; metade da proficiência vale
  // quando a mesa tem Pau para Toda Obra.
  const medicinePlain = medicineBonus({ wisdom: 14, level: 5, proficient: false, expertise: false });
  const medicineProficient = medicineBonus({ wisdom: 14, level: 5, proficient: true, expertise: false });
  const medicineExpertise = medicineBonus({ wisdom: 14, level: 5, proficient: true, expertise: true });
  const medicineHalf = medicineBonus({ wisdom: 14, level: 5, proficient: false, expertise: false, halfProficiency: 1 });
  check(
    '64.51) Medicina = Sabedoria + proficiência (Expertise dobra; sem proficiência tenta mesmo assim)',
    STABILIZE_DC === 10 &&
      medicinePlain.total === 2 &&
      medicineProficient.total === 5 &&
      medicineExpertise.total === 8 &&
      medicineHalf.total === 3 &&
      stabilizationSucceeds(10) &&
      !stabilizationSucceeds(9),
    JSON.stringify({ medicinePlain, medicineProficient, medicineExpertise, medicineHalf }),
  );
  // Trava do turno: o Teste é obrigatório até a chave daquele turno ser gravada.
  const pendingKey = 'combat:1:0';
  check(
    '64.31) o Teste Contra a Morte só deixa de ser obrigatório quando a chave DESTE turno foi gravada',
    deathSaveRequiredThisTurn(deathStateOf({ deathSaves: true }), pendingKey) &&
      !deathSaveRequiredThisTurn(deathStateOf({ deathSaves: true, saveTurnKey: pendingKey }), pendingKey) &&
      // Chave de OUTRO turno não vale: o Teste deste turno continua pendente.
      deathSaveRequiredThisTurn(deathStateOf({ deathSaves: true, saveTurnKey: 'combat:2:0' }), pendingKey) &&
      !deathSaveRequiredThisTurn(deathStateOf({ deathSaves: true, stabilized: true }), pendingKey) &&
      !deathSaveRequiredThisTurn(deathStateOf({ deathSaves: true }), null),
  );
  const stabilizedCycle = stabilizeDeathLifecycle(
    deathStateOf({ successes: 2, failures: 1, deathSaves: true }),
  );
  check(
    '64.16/19) estabilizar zera o ciclo, mantém 0 PV e NÃO revive nem recupera PV',
    stabilizedCycle.stabilized &&
      !stabilizedCycle.deathSaves &&
      stabilizedCycle.successes === 0 &&
      stabilizedCycle.failures === 0 &&
      stabilizedCycle.pending === null,
    JSON.stringify(stabilizedCycle),
  );

  const zeroed = addHpZeroUnconscious({}).state;
  const again = addHpZeroUnconscious(zeroed).state;
  check(
    '64) Inconsciência de 0 PV é idempotente e deriva Queda (mesma engine da 6.2)',
    zeroed.conditions.filter((item) => item.condition === 'unconscious').length === 1 &&
      zeroed.conditions.some((item) => item.condition === 'prone') &&
      again.conditions.length === zeroed.conditions.length &&
      !removeHpZeroUnconscious(zeroed).state.conditions.some((item) => item.condition === 'unconscious'),
  );
  const lifecycle = deathStateOf({ successes: 2, failures: 1, stabilized: true, deathSaves: true });
  check(
    '64) estado de morte tem fonte própria e bloqueia agir enquanto pendente/morto',
    hasDeathLifecycle(lifecycle) &&
      deathBlocksActions({ ...lifecycle, pending: { id: 'p', kind: 'failures', reason: 'x', createdAt: 'now', cause: null } }) &&
      deathBlocksActions({ ...lifecycle, dead: true }) &&
      !deathBlocksActions(clearDeathLifecycle({ ...lifecycle }))
  );
  check(
    '64) deathState ausente/campos faltando ganham os padrões e chaves extras somem',
    JSON.stringify(deathStateOf(undefined)) === JSON.stringify(deathStateOf({})) &&
      JSON.stringify(deathStateOf({ dead: true, extra: 'x' })) ===
        JSON.stringify({ ...deathStateOf({}), dead: true }),
  );

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const sockets: Socket[] = [];
  let creatureId: string | undefined;
  let combatId: string | undefined;
  // Fixtures do hotfix de turno/NPC (criadas e apagadas por esta execução).
  let hotfixCombatId: string | undefined;
  let npcId: string | undefined;

  const connect = async (token: string): Promise<Socket> => {
    const socket = io(baseUrl, { autoConnect: false, transports: ['websocket'], auth: { token } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  };

  try {
    const master = await prisma.user.create({
      data: { username: `death_m_${suffix}`, displayName: 'Mestre Morte', passwordHash: 'fixture', role: 'MASTER' },
    });
    userIds.push(master.id);
    const masterToken = signToken({
      sub: master.id, username: master.username, displayName: master.displayName, role: master.role,
    });
    const masterActor: DeathActor = { userId: master.id, username: master.username, role: 'MASTER' };

    /** Herói = usuário + ficha + token próprio (identidade carimbada do token). */
    const makeHero = async (
      tag: string,
      data: { hpMax: number; raceId?: string; race?: string; className?: string; attacks?: unknown[] },
    ) => {
      const user = await prisma.user.create({
        data: { username: `death_${tag}_${suffix}`, displayName: `Herói ${tag}`, passwordHash: 'fixture', role: 'PLAYER' },
      });
      userIds.push(user.id);
      const character = await prisma.character.create({
        data: {
          userId: user.id,
          name: `Herói ${tag}`,
          hpMax: data.hpMax,
          hpCurrent: data.hpMax,
          speed: 9,
          classes: [{ classKey: 'fighter', level: 1, subclass: '' }],
          ...(data.raceId ? { raceId: data.raceId, race: data.race ?? '' } : {}),
          ...(data.attacks ? { attacks: data.attacks as never } : {}),
        },
      });
      const token = signToken({
        sub: user.id, username: user.username, displayName: user.displayName, role: user.role,
      });
      const actor: DeathActor = { userId: user.id, username: user.username, role: 'PLAYER' };
      return { user, character, token, actor };
    };

    const heroA = await makeHero('a', { hpMax: 30 }); // queda normal + Testes contra a Morte
    const heroB = await makeHero('b', { hpMax: 40 }); // morte instantânea → confirmar morte
    const heroC = await makeHero('c', { hpMax: 40 }); // instantânea → narrativo; cair a 0
    const heroD = await makeHero('d', { hpMax: 30, raceId: 'half-orc', race: 'Meio-Orc' }); // Resistência Implacável
    const heroE = await makeHero('e', { hpMax: 40 }); // dano a 0, cura e estabilização
    const heroF = await makeHero('f', { hpMax: 40 }); // Exaustão e PV máximo efetivo
    // Espectador: só observa os eventos (nenhuma ficha).
    const spectator = await prisma.user.create({
      data: { username: `death_s_${suffix}`, displayName: 'Espectador Morte', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(spectator.id);
    const spectatorToken = signToken({
      sub: spectator.id, username: spectator.username, displayName: spectator.displayName, role: spectator.role,
    });

    const creature = await prisma.creature.create({
      data: {
        name: 'Goblin Template Morte',
        kind: 'CREATURE',
        hpMax: 12,
        hpCurrent: 12,
        armorClass: 12,
        speed: 9,
        attacks: [
          {
            id: 'bite', name: 'Mordida', attackBonus: 30,
            damage: { count: 0, sides: 0, bonus: 30, type: 'Cortante' },
            extraDamages: [], finesse: false, ranged: false, notes: '',
          },
        ] as never,
      },
    });
    creatureId = creature.id;

    // Combate ACTIVE criado direto pela fixture (ordem por iniciativa decrescente).
    const makeCombat = () =>
      prisma.combat.create({
        data: {
          status: 'ACTIVE',
          round: 1,
          currentIndex: 0,
          combatants: {
            create: [
              { kind: 'CHARACTER', characterId: heroA.character.id, ownerUserId: heroA.user.id, name: heroA.character.name, initiative: 800, dexterityMod: 0 },
              { kind: 'CHARACTER', characterId: heroB.character.id, ownerUserId: heroB.user.id, name: heroB.character.name, initiative: 700, dexterityMod: 0 },
              { kind: 'CHARACTER', characterId: heroC.character.id, ownerUserId: heroC.user.id, name: heroC.character.name, initiative: 600, dexterityMod: 0 },
              { kind: 'CHARACTER', characterId: heroD.character.id, ownerUserId: heroD.user.id, name: heroD.character.name, initiative: 500, dexterityMod: 0 },
              { kind: 'CHARACTER', characterId: heroE.character.id, ownerUserId: heroE.user.id, name: heroE.character.name, initiative: 400, dexterityMod: 0 },
              { kind: 'CHARACTER', characterId: heroF.character.id, ownerUserId: heroF.user.id, name: heroF.character.name, initiative: 350, dexterityMod: 0 },
              { kind: 'CREATURE', creatureId: creature.id, name: 'Goblin 1', hpCurrent: creature.hpCurrent, hpMax: creature.hpMax, armorClass: creature.armorClass, initiative: 200, dexterityMod: 0 },
              { kind: 'CREATURE', creatureId: creature.id, name: 'Goblin 2', hpCurrent: creature.hpCurrent, hpMax: creature.hpMax, armorClass: creature.armorClass, initiative: 100, dexterityMod: 0 },
            ],
          },
        },
      });
    let combat: { id: string };
    try {
      combat = await makeCombat();
    } catch {
      // Outro combate ativo ficou para trás: encerra e tenta uma vez.
      await prisma.combat.updateMany({ where: { status: { not: 'ENDED' } }, data: { status: 'ENDED', endedAt: new Date() } });
      combat = await makeCombat();
    }
    combatId = combat.id;
    const participants = await prisma.combatant.findMany({ where: { combatId: combat.id } });
    const idOf = (name: string) => participants.find((item) => item.name === name)!.id;
    const combatantA = idOf(heroA.character.name);
    const combatantB = idOf(heroB.character.name);
    const combatantC = idOf(heroC.character.name);
    const combatantD = idOf(heroD.character.name);
    const combatantE = idOf(heroE.character.name);
    const combatantF = idOf(heroF.character.name);
    const goblin1 = idOf('Goblin 1');
    const goblin2 = idOf('Goblin 2');

    async function request(path: string, body?: unknown, auth = masterToken) {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json().catch(() => ({}))) as any };
    }
    const readDeath = async (entity: MechanicalEntity, auth = masterToken): Promise<DeathDto> =>
      (await request(`/death/${entity.kind}/${entity.id}`, undefined, auth)).data.death as DeathDto;
    const characterEntity = (hero: { character: { id: string } }): MechanicalEntity => ({ kind: 'character', id: hero.character.id });
    const resolve = (entity: MechanicalEntity, decision: string, version: number, auth = masterToken) =>
      request('/death/resolve', { entity, decision, expectedVersion: version, operationId: randomUUID() }, auth);
    const override = (entity: MechanicalEntity, action: string, version: number, reason = 'Verificação 6.3', auth = masterToken) =>
      request('/death/override', { entity, action, expectedVersion: version, operationId: randomUUID(), reason }, auth);
    const stabilize = (entity: MechanicalEntity, version: number) =>
      request('/death/stabilize', { entity, expectedVersion: version, operationId: randomUUID(), reason: 'Estabilização assistida' }, masterToken);
    const manualHp = (combatantId: string, amount: number, mode: 'damage' | 'heal') =>
      request('/combat/hp', { combatantId, amount, mode }, masterToken);
    /**
     * Mudança mecânica (Exaustão) pelo domínio da 6.2. Dentro de um combate
     * ativo, o `expectedCombatVersion` é obrigatório (concorrência da 6.1).
     */
    const mechanicalMutate = async (entity: MechanicalEntity, extra: Record<string, unknown>) => {
      const current = await readDeath(entity);
      const combatNow = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto | null;
      return request('/mechanical/mutate', {
        entity,
        expectedVersion: current.version,
        ...(combatNow ? { expectedCombatVersion: combatNow.version } : {}),
        operationId: randomUUID(),
        ...extra,
      });
    };

    let state = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const advance = async () => {
      // Releitura a cada avanço: o dano/cura manual e as escritas do ciclo de
      // morte mexem na versão do combate, e o `expectedVersion` precisa estar
      // fresco (senão o avanço devolve 409 e o turno nunca anda).
      state = ((await request('/combat/active', undefined, masterToken)).data.combat as CombatDto | null) ?? state;
      // `skipDeathSave` é a CONFIRMAÇÃO do Mestre (o harness avança sem esperar
      // o Teste Contra a Morte). O bloqueio sem confirmação é verificado à parte.
      const response = await request(
        '/combat/next-turn',
        { combatId: state.id, expectedVersion: state.version, operationId: randomUUID(), skipDeathSave: true },
        masterToken,
      );
      if (response.data.combat) state = response.data.combat;
      return response;
    };
    /** Avança até o turno do combatente. `cycle` garante a virada de turno. */
    const advanceTo = async (combatantId: string, cycle = false): Promise<boolean> => {
      if (cycle) await advance();
      for (let step = 0; step < 12 && state.currentCombatantId !== combatantId; step += 1) {
        await advance();
      }
      return state.currentCombatantId === combatantId;
    };
    /** Reseta o ciclo de morte de um herói (fixture entre cenários). */
    const resetHero = async (
      hero: { character: { id: string } },
      hp: number,
      death: Record<string, unknown> = {},
    ) => {
      await prisma.character.update({
        where: { id: hero.character.id },
        data: {
          hpCurrent: hp,
          deathState: deathStateOf({ ...death }) as never,
          version: { increment: 1 },
        },
      });
    };

    // --- A) Queda normal a 0 PV (ajuste manual do Mestre = caminho do dano) --
    await manualHp(combatantA, 30, 'damage');
    const afterZero = await readDeath(characterEntity(heroA));
    const sheetA = await prisma.character.findUniqueOrThrow({ where: { id: heroA.character.id } });
    const mechanicalA = mechanicalStateOf(sheetA.mechanicalState);
    check(
      '64.A) 0 PV sem morte instantânea: HP 0, ciclo iniciado, Inconsciente, NÃO morto, sem modal',
      afterZero.hpCurrent === 0 &&
        afterZero.death.successes === 0 &&
        afterZero.death.failures === 0 &&
        afterZero.death.deathSaves &&
        !afterZero.death.dead &&
        afterZero.pending === null &&
        mechanicalA.conditions.some((item) => item.condition === 'unconscious' && item.sourceType === 'hp-zero'),
      JSON.stringify({ death: afterZero.death, hp: afterZero.hpCurrent }),
    );

    // --- J) Elegibilidade: só no início do PRÓPRIO turno --------------------
    await advanceTo(combatantB);
    const wrongTurn = await readDeath(characterEntity(heroA));
    const early = await request('/dice/roll', { entity: characterEntity(heroA), kind: 'death-save', label: 'Teste contra a Morte', dice: [{ sides: 20 }] }, heroA.token);
    check(
      '64.J) Teste contra a Morte fora do próprio turno não é oferecido nem aceito',
      !wrongTurn.deathSave.available && wrongTurn.deathSave.reason.includes('turno') && early.status === 409,
      JSON.stringify({ reason: wrongTurn.deathSave.reason, status: early.status }),
    );
    check('64.J) PLAYER não pode rolar o Teste contra a Morte de outra ficha', (
      await request('/dice/roll', { entity: characterEntity(heroB), kind: 'death-save', dice: [{ sides: 20 }] }, heroA.token)
    ).status === 409);

    // --- L/K) Rolagem PÚBLICA na bandeja existente (server-authoritative) ---
    await advanceTo(combatantA, true);
    const spectatorSocket = await connect(spectatorToken);
    const publicRoll = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      spectatorSocket.once('dice:roll', (payload: any) => {
        clearTimeout(timer);
        resolve(payload.roll);
      });
    });
    const ownTurn = await readDeath(characterEntity(heroA));
    const rolled = await request('/dice/roll', {
      entity: characterEntity(heroA), kind: 'death-save', label: 'Teste contra a Morte', dice: [{ sides: 20 }],
    }, heroA.token);
    const broadcast = await publicRoll;
    const value = rolled.data.roll?.total as number;
    const expected = deathSaveOutcome(value);
    const afterRoll = await readDeath(characterEntity(heroA));
    check(
      '64.L) o Teste contra a Morte do personagem aparece na bandeja da MESA',
      rolled.status === 201 && broadcast !== null && broadcast.kind === 'death-save' && broadcast.total === value,
      JSON.stringify({ status: rolled.status, broadcast }),
    );
    check(
      '64.K) o d20 é do SERVIDOR e o pool do cliente é ignorado',
      ownTurn.deathSave.available && rolled.data.roll.dice.length === 1 && rolled.data.roll.dice[0].sides === 20 && value >= 1 && value <= 20,
      JSON.stringify({ dice: rolled.data.roll.dice, value }),
    );
    check(
      '64.M/N/O/P) o resultado aplicado no servidor segue o PHB para o valor sorteado',
      afterRoll.death.successes === Math.min(3, expected.successes) &&
        afterRoll.death.failures === Math.min(3, expected.failures) &&
        afterRoll.hpCurrent === (expected.revived ? 1 : 0),
      JSON.stringify({ value, expected, death: afterRoll.death }),
    );

    // --- AS) Duplo clique não gera dois resultados --------------------------
    await resetHero(heroA, 0, { deathSaves: true });
    await prisma.character.update({
      where: { id: heroA.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    await advanceTo(combatantA, true);
    const doubleClick = await Promise.all([
      request('/dice/roll', { entity: characterEntity(heroA), kind: 'death-save', dice: [{ sides: 20 }] }, heroA.token),
      request('/dice/roll', { entity: characterEntity(heroA), kind: 'death-save', dice: [{ sides: 20 }] }, heroA.token),
    ]);
    const afterDouble = await readDeath(characterEntity(heroA));
    check(
      '64.AS) duplo clique no Teste contra a Morte gera UMA rolagem (1 rolagem por turno)',
      doubleClick.filter((item) => item.status === 201).length === 1 &&
        doubleClick.filter((item) => item.status === 409).length === 1 &&
        // Um único resultado: no máximo 2 falhas (1 natural) ou 1 sucesso.
        afterDouble.death.successes <= 1 &&
        afterDouble.death.failures <= 2,
      JSON.stringify({ statuses: doubleClick.map((item) => item.status), death: afterDouble.death }),
    );

    // --- O/P) nat 1 e nat 20 determinísticos (mesmo domínio do servidor) ----
    await resetHero(heroA, 0, { deathSaves: true });
    await advanceTo(combatantA, true);
    const natOne = await applyDeathSave(heroA.actor, characterEntity(heroA), 1);
    check(
      '64.O) 1 natural soma DUAS falhas',
      natOne.failures === 2 && natOne.naturalOne && !natOne.dead && !!natOne.pending === false,
      JSON.stringify(natOne),
    );
    await resetHero(heroA, 0, { deathSaves: true, failures: 1 });
    await advanceTo(combatantA, true);
    const natTwenty = await applyDeathSave(heroA.actor, characterEntity(heroA), 20);
    const afterTwenty = await readDeath(characterEntity(heroA));
    const mechanicalA20 = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroA.character.id } })).mechanicalState,
    );
    check(
      '64.P) 20 natural: 1 PV, ciclo limpo e Inconsciência de 0 PV removida',
      natTwenty.revived &&
        afterTwenty.hpCurrent === 1 &&
        afterTwenty.death.successes === 0 &&
        afterTwenty.death.failures === 0 &&
        !afterTwenty.death.stabilized &&
        !afterTwenty.death.deathSaves &&
        !mechanicalA20.conditions.some((item) => item.sourceType === 'hp-zero'),
      JSON.stringify({ natTwenty, death: afterTwenty.death, hp: afterTwenty.hpCurrent }),
    );

    // --- Q) Três sucessos → estabilizado (0 PV, Inconsciente, sem novas rolagens)
    await resetHero(heroA, 0, { deathSaves: true });
    // O cenário começa no estado REAL de 0 PV: Inconsciente presente (o ciclo
    // de morte é quem a remove, nunca o fixture).
    await prisma.character.update({
      where: { id: heroA.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    for (let roll = 0; roll < 3; roll += 1) {
      await advanceTo(combatantA, true);
      await applyDeathSave(heroA.actor, characterEntity(heroA), 15);
    }
    const stabilized = await readDeath(characterEntity(heroA));
    const mechanicalStabilized = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroA.character.id } })).mechanicalState,
    );
    await advanceTo(combatantA, true);
    check(
      '64.Q) três sucessos: estabilizado, 0 PV, Inconsciente e sem novas rolagens',
      stabilized.death.successes === 3 &&
        stabilized.death.stabilized &&
        stabilized.hpCurrent === 0 &&
        !stabilized.death.dead &&
        !stabilized.deathSave.available &&
        stabilized.deathSave.reason.includes('estabilizado') &&
        mechanicalStabilized.conditions.some((item) => item.condition === 'unconscious'),
      JSON.stringify({ death: stabilized.death, reason: stabilized.deathSave.reason }),
    );

    // --- F/G) Morte instantânea de PERSONAGEM → decisão do Mestre ------------
    await manualHp(combatantB, 90, 'damage');
    const instantB = await readDeath(characterEntity(heroB));
    check(
      '64.F) morte instantânea NÃO mata: fica PENDENTE para o Mestre, com a aritmética registrada',
      instantB.death.pending?.kind === 'instant-death' &&
        !instantB.death.dead &&
        instantB.death.pending.cause?.remaining === 50 &&
        instantB.death.pending.cause?.hpMax === 40,
      JSON.stringify(instantB.death.pending),
    );
    const confirmDeath = await resolve(characterEntity(heroB), 'confirm-death', instantB.version);
    check(
      '64.G) Mestre confirma a morte: dead, 0 PV e ciclo encerrado',
      confirmDeath.status === 200 &&
        confirmDeath.data.death.death.dead &&
        confirmDeath.data.death.hpCurrent === 0 &&
        confirmDeath.data.death.pending === null,
      JSON.stringify(confirmDeath.data.death?.death),
    );

    // --- H) Recurso narrativo: permanece vivo com 1 PV ----------------------
    await manualHp(combatantC, 90, 'damage');
    const instantC = await readDeath(characterEntity(heroC));
    const narrative = await resolve(characterEntity(heroC), 'narrative-1hp', instantC.version);
    const mechanicalC = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroC.character.id } })).mechanicalState,
    );
    check(
      '64.H) recurso narrativo: 1 PV, vivo, ciclo limpo e Unconscious removido',
      narrative.status === 200 &&
        narrative.data.death.hpCurrent === 1 &&
        !narrative.data.death.death.dead &&
        narrative.data.death.death.successes === 0 &&
        narrative.data.death.death.failures === 0 &&
        !mechanicalC.conditions.some((item) => item.sourceType === 'hp-zero'),
      JSON.stringify(narrative.data.death),
    );

    // --- I) Mestre ignora a morte instantânea e permite cair a 0 ------------
    await manualHp(combatantC, 90, 'damage');
    const instantC2 = await readDeath(characterEntity(heroC));
    const fallToZero = await resolve(characterEntity(heroC), 'fall-to-zero', instantC2.version);
    check(
      '64.I) cair a 0 pela decisão do Mestre: vivo, 0 PV, ciclo de Testes zerado',
      fallToZero.status === 200 &&
        fallToZero.data.death.hpCurrent === 0 &&
        !fallToZero.data.death.death.dead &&
        fallToZero.data.death.death.successes === 0 &&
        fallToZero.data.death.death.failures === 0 &&
        fallToZero.data.death.death.deathSaves &&
        fallToZero.data.death.pending === null,
      JSON.stringify(fallToZero.data.death?.death),
    );

    // --- AV/R/S) Persistência da pendência + três falhas → decisão ----------
    await advanceTo(combatantC, true);
    await applyDeathSave(heroC.actor, characterEntity(heroC), 5);
    await advanceTo(combatantC, true);
    const failuresPending = await applyDeathSave(heroC.actor, characterEntity(heroC), 1);
    const pendingRead = await readDeath(characterEntity(heroC));
    check(
      '64.R) três falhas NÃO matam: abrem a MESMA decisão do Mestre',
      failuresPending.failures === 3 &&
        failuresPending.pending?.kind === 'failures' &&
        !failuresPending.dead &&
        pendingRead.death.pending?.kind === 'failures' &&
        // Um pedido de Teste contra a Morte com a decisão aberta é recusado.
        (await request('/dice/roll', { entity: characterEntity(heroC), kind: 'death-save', dice: [{ sides: 20 }] }, heroC.token)).status === 409,
      JSON.stringify({ failuresPending, pending: pendingRead.death.pending }),
    );
    check(
      '64.AV) a decisão pendente sobrevive a refresh/reconexão (leitura nova, mesmo id)',
      pendingRead.death.pending?.id === failuresPending.pending?.id,
    );
    const confirmFailures = await resolve(characterEntity(heroC), 'confirm-death', pendingRead.version);
    check(
      '64.S) confirmar a morte após três falhas',
      confirmFailures.status === 200 && confirmFailures.data.death.death.dead && confirmFailures.data.death.hpCurrent === 0,
    );

    // --- B/C/D/E) Resistência Implacável (Meio-Orc) -------------------------
    await manualHp(combatantD, 30, 'damage');
    const offer = await readDeath(characterEntity(heroD));
    check(
      '64.B) queda normal com Resistência Implacável disponível oferece a escolha (nunca automática)',
      offer.death.relentless !== null && offer.death.relentless.resourceId === 'relentless-endurance' &&
        offer.hpCurrent === 0 && !offer.death.deathSaves && offer.pending === null,
      JSON.stringify(offer.death),
    );
    const used = await answerRelentless(heroD.actor, {
      entity: characterEntity(heroD),
      answer: 'use',
      expectedVersion: offer.version,
      operationId: randomUUID(),
    });
    const afterUse = await readDeath(characterEntity(heroD));
    const sheetD = await prisma.character.findUniqueOrThrow({ where: { id: heroD.character.id } });
    check(
      '64.C) usar: recurso racial consumido, 1 PV e nenhum Teste contra a Morte',
      used.death.hpCurrent === 1 &&
        afterUse.death.relentless === null &&
        !afterUse.death.deathSaves &&
        !mechanicalStateOf(sheetD.mechanicalState).conditions.some((item) => item.sourceType === 'hp-zero') &&
        (sheetD.racialState as { used?: Record<string, number> }).used?.['relentless-endurance'] === 1,
      JSON.stringify({ hp: used.death.hpCurrent, racialState: sheetD.racialState }),
    );
    await manualHp(combatantD, 30, 'damage');
    const reused = await readDeath(characterEntity(heroD));
    check(
      '64.D) sem usos restantes a oferta NÃO volta: segue o fluxo normal de 0 PV',
      reused.death.relentless === null && reused.death.deathSaves && reused.hpCurrent === 0,
      JSON.stringify(reused.death),
    );
    // E) morte instantânea nunca oferece Resistência Implacável.
    await resetHero(heroD, 30);
    await manualHp(combatantD, 60, 'damage');
    const instantD = await readDeath(characterEntity(heroD));
    check(
      '64.E) dano que atinge morte instantânea NÃO oferece Resistência Implacável',
      instantD.death.relentless === null && instantD.death.pending?.kind === 'instant-death' && !instantD.death.dead,
      JSON.stringify({ relentless: instantD.death.relentless, pending: instantD.death.pending?.kind }),
    );
    await resolve(characterEntity(heroD), 'fall-to-zero', instantD.version);
    await advanceTo(combatantD, true);
    await applyDeathSave(heroD.actor, characterEntity(heroD), 1);
    await advanceTo(combatantD, true);
    const dFailures = await applyDeathSave(heroD.actor, characterEntity(heroD), 1);
    const dPending = await readDeath(characterEntity(heroD));
    const dNarrative = await resolve(characterEntity(heroD), 'narrative-1hp', dPending.version);
    check(
      '64.T) três falhas + recurso narrativo: vivo com 1 PV',
      dFailures.failures === 3 &&
        dNarrative.status === 200 &&
        dNarrative.data.death.hpCurrent === 1 &&
        !dNarrative.data.death.death.dead &&
        dNarrative.data.death.death.failures === 0,
      JSON.stringify(dNarrative.data.death),
    );

    // --- V/W/X) Dano sofrido já a 0 PV + morte instantânea a 0 --------------
    await resetHero(heroE, 0, { deathSaves: true });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    const entityE = characterEntity(heroE);
    await applyDamageConsequences(entityE, { damage: 6, hpBefore: 0, hpTempBefore: 0, critical: false }, prisma, master.username);
    const oneFailure = await readDeath(entityE);
    await applyDamageConsequences(entityE, { damage: 6, hpBefore: 0, hpTempBefore: 0, critical: true }, prisma, master.username);
    const twoFailures = await readDeath(entityE);
    check(
      '64.V/W) dano a 0 PV: +1 falha; crítico a 0 PV: +2 falhas',
      oneFailure.death.failures === 1 && twoFailures.death.failures === 3 && twoFailures.death.pending?.kind === 'failures',
      JSON.stringify({ one: oneFailure.death.failures, two: twoFailures.death.failures }),
    );
    await resolve(entityE, 'confirm-death', twoFailures.version);
    await resetHero(heroE, 0, { deathSaves: true });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    await applyDamageConsequences(entityE, { damage: 60, hpBefore: 0, hpTempBefore: 0, critical: false }, prisma, master.username);
    const instantAtZero = await readDeath(entityE);
    check(
      '64.X) morte instantânea com o alvo já a 0 PV abre decisão (nunca morte automática)',
      instantAtZero.death.pending?.kind === 'instant-death' && !instantAtZero.death.dead,
      JSON.stringify(instantAtZero.death.pending),
    );
    // Cura durante decisão pendente não pode contornar a escolha do Mestre.
    const healWhilePending = await manualHp(combatantE, 20, 'heal');
    check(
      '64) cura durante decisão pendente é bloqueada (o Mestre resolve primeiro)',
      healWhilePending.status === 409 && (await readDeath(entityE)).death.pending !== null,
      JSON.stringify(healWhilePending.data),
    );
    await resolve(entityE, 'narrative-1hp', instantAtZero.version);

    // --- Y/Z) Cura limpa o ciclo e PRESERVA condições independentes ---------
    await mechanicalMutate(entityE, { action: 'apply', condition: 'poisoned', sourceLabel: 'Aranha gigante' });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { hpCurrent: 0, deathState: deathStateOf({ deathSaves: true, failures: 1, successes: 1 }) as never },
    });
    await manualHp(combatantE, 12, 'heal');
    const healed = await readDeath(entityE);
    const mechanicalHealed = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroE.character.id } })).mechanicalState,
    );
    check(
      '64.Y/Z) cura acima de 0 PV limpa os Testes e a Inconsciência de 0 PV, sem apagar condições independentes',
      healed.hpCurrent === 12 &&
        healed.death.successes === 0 &&
        healed.death.failures === 0 &&
        !healed.death.deathSaves &&
        !healed.death.stabilized &&
        !mechanicalHealed.conditions.some((item) => item.sourceType === 'hp-zero') &&
        mechanicalHealed.conditions.some((item) => item.condition === 'poisoned'),
      JSON.stringify({ hp: healed.hpCurrent, conditions: mechanicalHealed.conditions.map((item) => item.condition) }),
    );

    // --- 21/23/AA) Estabilização e dano a um estabilizado -------------------
    await prisma.character.update({ where: { id: heroE.character.id }, data: { hpCurrent: 0 } });
    const beforeStabilize = await readDeath(entityE);
    const stabilizedNow = await stabilize(entityE, beforeStabilize.version);
    check(
      '64.21/23) estabilizar: 0 PV, sem Testes contra a Morte, Inconsciente e vivo',
      stabilizedNow.status === 200 &&
        stabilizedNow.data.death.death.stabilized &&
        stabilizedNow.data.death.hpCurrent === 0 &&
        !stabilizedNow.data.death.death.deathSaves &&
        !stabilizedNow.data.death.death.dead,
      JSON.stringify(stabilizedNow.data.death?.death),
    );
    await applyDamageConsequences(entityE, { damage: 5, hpBefore: 0, hpTempBefore: 0, critical: false }, prisma, master.username);
    const damagedStabilized = await readDeath(entityE);
    check(
      '64.AA) estabilizado que recebe dano deixa de estar estabilizado, soma falha e volta ao fluxo',
      !damagedStabilized.death.stabilized && damagedStabilized.death.failures === 1 && damagedStabilized.death.deathSaves,
      JSON.stringify(damagedStabilized.death),
    );

    // --- AB–AF) NPC/criatura a 0 PV: decisão do Mestre ----------------------
    await manualHp(goblin1, 12, 'damage');
    const npcZero = await readDeath({ kind: 'combatant', id: goblin1 });
    check(
      '64.AB) NPC a 0 PV abre a decisão do Mestre (nada de "monstro morre sozinho")',
      npcZero.death.pending?.kind === 'npc-zero' && !npcZero.death.dead && npcZero.hpCurrent === 0,
      JSON.stringify(npcZero.death),
    );
    const npcDeath = await resolve({ kind: 'combatant', id: goblin1 }, 'confirm-death', npcZero.version);
    check('64.AC) Mestre confirma a morte do NPC', npcDeath.status === 200 && npcDeath.data.death.death.dead);
    const npcTemplate = await prisma.creature.findUniqueOrThrow({ where: { id: creature.id } });
    check(
      '64.AN) o template do bestiário NÃO recebe Death Saves da cópia (nem PV alterado)',
      npcTemplate.hpCurrent === 12 && !JSON.stringify(npcTemplate.mechanicalState).includes('hp-zero'),
      JSON.stringify({ hp: npcTemplate.hpCurrent }),
    );

    await manualHp(goblin2, 12, 'damage');
    const npcZero2 = await readDeath({ kind: 'combatant', id: goblin2 });
    const npcNarrative = await resolve({ kind: 'combatant', id: goblin2 }, 'narrative-1hp', npcZero2.version);
    check(
      '64.AD) NPC com recurso narrativo: 1 PV e vivo',
      npcNarrative.data.death.hpCurrent === 1 && !npcNarrative.data.death.death.dead,
      JSON.stringify(npcNarrative.data.death),
    );
    await manualHp(goblin2, 30, 'damage');
    const npcZero3 = await readDeath({ kind: 'combatant', id: goblin2 });
    const npcFall = await resolve({ kind: 'combatant', id: goblin2 }, 'fall-to-zero', npcZero3.version);
    check(
      '64.AE) NPC "cair a 0": permanece a 0 PV, sem Testes contra a Morte automáticos',
      npcFall.data.death.hpCurrent === 0 && !npcFall.data.death.death.deathSaves && !npcFall.data.death.death.dead,
      JSON.stringify(npcFall.data.death?.death),
    );
    const npcSaves = await override({ kind: 'combatant', id: goblin2 }, 'death-saves', npcFall.data.death.version, 'Mestre autorizou Testes privados');
    check(
      '64.AF) NPC "Rodar Death Saves": entra no fluxo privado de Testes',
      npcSaves.status === 200 && npcSaves.data.death.death.deathSaves,
      JSON.stringify(npcSaves.data.death?.death),
    );
    const goblin1Dead = await readDeath({ kind: 'combatant', id: goblin1 });
    check(
      '64.AM) Goblin 1 morto e Goblin 2 em Testes contra a Morte: cada cópia tem o próprio ciclo',
      goblin1Dead.death.dead && !npcSaves.data.death.death.dead && npcSaves.data.death.death.deathSaves,
      JSON.stringify({ goblin1: goblin1Dead.death.dead, goblin2: npcSaves.data.death.death }),
    );

    // --- AG–AL) Teste contra a Morte PRIVADO do NPC ------------------------
    const inTurn = await advanceTo(goblin2, true);
    const goblinBefore = await readDeath({ kind: 'combatant', id: goblin2 });
    const playerSaw: string[] = [];
    const playerListener = (payload: any) => playerSaw.push(payload?.roll?.kind ?? 'evento');
    let playerRollLeak: any = null;
    spectatorSocket.on('dice:roll', (payload: any) => { playerRollLeak = payload; });
    spectatorSocket.on('death:updated', playerListener);
    const masterSocket = await connect(masterToken);
    const masterRollEvent = new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      masterSocket.once('dice:roll', (payload: any) => { clearTimeout(timer); resolve(payload.roll); });
    });
    const privateRoll = await request('/dice/roll', {
      entity: { kind: 'combatant', id: goblin2 }, kind: 'death-save', label: 'Teste contra a Morte', dice: [{ sides: 20 }],
    }, masterToken);
    const masterSaw = await masterRollEvent;
    await new Promise((resolve) => setTimeout(resolve, 700));
    spectatorSocket.off('death:updated', playerListener);
    const goblinAfter = await readDeath({ kind: 'combatant', id: goblin2 });
    check(
      '64.AG/AH) o Mestre inicia e o SERVIDOR gera o resultado (evento só para os mestres)',
      inTurn && privateRoll.status === 201 && masterSaw !== null && masterSaw.audience === 'masters' && masterSaw.total >= 1 && masterSaw.total <= 20,
      JSON.stringify({ status: privateRoll.status, masterSaw }),
    );
    check(
      '64.AI/AJ/AK/AL) jogadores não recebem rolagem, resultado, contador nem a existência do Teste',
      playerRollLeak === null &&
        playerSaw.length === 0 &&
        (await request(`/death/combatant/${goblin2}`, undefined, spectatorToken)).status === 403,
      JSON.stringify({ leak: playerRollLeak, saw: playerSaw }),
    );
    const playerCombat = (await request('/combat/active', undefined, spectatorToken)).data.combat as CombatDto;
    const masterCombat = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    check(
      '64.AK) o estado de morte do NPC não vaza no combate dos jogadores (privacidade do servidor)',
      playerCombat.combatants.find((item) => item.id === goblin2)?.deathState === null &&
        masterCombat.combatants.find((item) => item.id === goblin2)?.deathState !== null &&
        goblinBefore.death.deathSaves,
      JSON.stringify({
        player: playerCombat.combatants.find((item) => item.id === goblin2)?.deathState,
        death: goblinAfter.death,
      }),
    );
    const privateValue = privateRoll.data.roll?.total as number;
    const privateExpect = deathSaveOutcome(privateValue);
    check(
      '64.AG) o resultado do Teste privado foi aplicado pelo servidor conforme o PHB',
      goblinAfter.hpCurrent === (privateExpect.revived ? 1 : 0) &&
        goblinAfter.death.successes === Math.min(3, privateExpect.successes) &&
        goblinAfter.death.failures === Math.min(3, privateExpect.failures),
      JSON.stringify({ privateValue, privateExpect, after: goblinAfter.death }),
    );
    check(
      '64.AH) o log de rolagens é do Mestre (jogador não consulta o histórico)',
      (await request('/dice/history', undefined, spectatorToken)).status === 403 &&
        ((await request('/dice/history', undefined, masterToken)).data.rolls as any[]).some((roll) => roll.kind === 'death-save'),
    );

    // --- AO–AR) Override do Mestre, tudo logado ----------------------------
    const beforeOverride = await readDeath({ kind: 'combatant', id: goblin2 });
    const addedSuccess = await override({ kind: 'combatant', id: goblin2 }, 'add-success', beforeOverride.version, 'Sucesso manual');
    const removedSuccess = await override({ kind: 'combatant', id: goblin2 }, 'remove-success', addedSuccess.data.death.version, 'Reversão manual');
    const addedFailure = await override({ kind: 'combatant', id: goblin2 }, 'add-failure', removedSuccess.data.death.version, 'Falha manual');
    const removedFailure = await override({ kind: 'combatant', id: goblin2 }, 'remove-failure', addedFailure.data.death.version, 'Reversão da falha');
    const logText = JSON.stringify(removedFailure.data.death.log);
    check(
      '64.AO/AR) override: sucesso/falha podem ser somados e removidos, com log do Mestre',
      addedSuccess.data.death.death.successes === beforeOverride.death.successes + 1 &&
        removedSuccess.data.death.death.successes === beforeOverride.death.successes &&
        addedFailure.data.death.death.failures === removedSuccess.data.death.death.failures + 1 &&
        removedFailure.data.death.death.failures === removedSuccess.data.death.death.failures &&
        logText.includes('Mestre') &&
        logText.includes('Sucesso manual'),
      JSON.stringify(removedFailure.data.death?.death),
    );
    const revived = await override({ kind: 'combatant', id: goblin2 }, 'revive', removedFailure.data.death.version, 'Reversão administrativa');
    check(
      '64.AQ) reviver administrativamente: vivo com 1 PV e ciclo limpo',
      revived.data.death.hpCurrent === 1 && !revived.data.death.death.dead && !revived.data.death.death.deathSaves,
      JSON.stringify(revived.data.death?.death),
    );

    // --- AT) Duas decisões simultâneas: só uma resolve ----------------------
    // Reinicia a instância (cópia 1) e a derruba a 0 PV para abrir a pendência.
    await prisma.combatant.update({
      where: { id: goblin1 },
      data: { hpCurrent: 5, deathState: deathStateOf({}) as never },
    });
    await manualHp(goblin1, 5, 'damage');
    const concurrentPending = await readDeath({ kind: 'combatant', id: goblin1 });
    const twin = await Promise.all([
      resolve({ kind: 'combatant', id: goblin1 }, 'confirm-death', concurrentPending.version),
      resolve({ kind: 'combatant', id: goblin1 }, 'narrative-1hp', concurrentPending.version),
    ]);
    check(
      '64.AT) duas decisões simultâneas do Mestre: apenas uma resolve',
      twin.filter((item) => item.status === 200).length === 1 && twin.filter((item) => item.status === 409).length === 1,
      JSON.stringify({ statuses: twin.map((item) => item.status), pending: concurrentPending.pending?.kind }),
    );

    // --- AZ–BC) Morto NÃO recebe turno (regra do hotfix) -------------------
    // O servidor pula o morto: a iniciativa não pára nele e nenhuma economia
    // é liberada. A Ação/Ataque continuam recusados pelo ciclo de morte.
    const beforeDeadAdvance = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    await advance();
    const trackerAfterDeath = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const deadAction = await request('/combat/action', {
      combatId: trackerAfterDeath.id, expectedVersion: trackerAfterDeath.version, operationId: randomUUID(),
      combatantId: combatantB, action: 'dodge', description: 'Morto tentando agir',
    }, heroB.token);
    const deadAttack = await request('/combat/attack', {
      combatId: trackerAfterDeath.id, expectedVersion: trackerAfterDeath.version, operationId: randomUUID(),
      attackerCombatantId: combatantB, targetCombatantId: goblin1, attackId: 'unarmed',
    }, masterToken);
    check(
      '64.AZ/BA/BB) morto é PULADO no avanço e não pode gastar Ação/Movimento (Ação/Ataque 409)',
      beforeDeadAdvance.currentCombatantId !== combatantB &&
        trackerAfterDeath.currentCombatantId !== combatantB &&
        deadAction.status === 409 &&
        deadAttack.status === 409,
      JSON.stringify({ current: trackerAfterDeath.currentCombatantId, action: deadAction.status, attack: deadAttack.status }),
    );
    check(
      '64.BC) o combatente morto NÃO é removido do combate automaticamente',
      trackerAfterDeath.combatants.some((item) => item.id === combatantB),
    );

    // --- AY) Persistência (refresh não revive nem apaga nada) --------------
    const deadAfterReload = await readDeath(characterEntity(heroB));
    const savesAfterReload = await readDeath(characterEntity(heroF));
    check(
      '64.AW/AX/AY) morto, estabilizado e Testes contra a Morte sobrevivem ao refresh',
      deadAfterReload.death.dead &&
        (await readDeath(characterEntity(heroA))).death.stabilized &&
        (await readDeath(characterEntity(heroE))).death.deathSaves,
      JSON.stringify({ dead: deadAfterReload.death.dead, saves: savesAfterReload.death.deathSaves }),
    );

    // --- 52/53) Exaustão 6 e PV máximo EFETIVO na morte instantânea --------
    await mechanicalMutate(characterEntity(heroF), {
      action: 'exhaustion', exhaustionLevel: 4, reason: 'Teste de PV máximo efetivo',
    });
    await prisma.character.update({ where: { id: heroF.character.id }, data: { hpCurrent: 10 } });
    // 10 PV + 30 de dano: sobram 20, que é >= o PV máximo EFETIVO (40/2 = 20).
    await manualHp(combatantF, 30, 'damage');
    const effectiveMax = await readDeath(characterEntity(heroF));
    check(
      '64.53) a morte instantânea usa o PV máximo EFETIVO (Exaustão 4 reduz à metade)',
      effectiveMax.hpMax === 20 && effectiveMax.death.pending?.kind === 'instant-death' && effectiveMax.death.pending.cause?.hpMax === 20,
      JSON.stringify({ hpMax: effectiveMax.hpMax, pending: effectiveMax.death.pending }),
    );
    await resolve(characterEntity(heroF), 'narrative-1hp', effectiveMax.version);
    const fatal = await mechanicalMutate(characterEntity(heroF), {
      action: 'exhaustion', exhaustionLevel: 6, reason: 'Exaustão fatal',
    });
    const exhausted = await readDeath(characterEntity(heroF));
    check(
      '64.52) Exaustão 6 abre a MESMA decisão do Mestre, sem morte automática nem PV zerado',
      fatal.status === 200 && exhausted.death.pending?.kind === 'exhaustion' && !exhausted.death.dead && exhausted.hpCurrent === 1,
      JSON.stringify({ pending: exhausted.death.pending?.kind, hp: exhausted.hpCurrent }),
    );
    const exhaustChoice = await resolve(characterEntity(heroF), 'narrative-1hp', exhausted.version);
    const afterExhaustChoice = await readDeath(characterEntity(heroF));
    check(
      '64.52) recurso narrativo na Exaustão 6 mantém a Exaustão no nível 6 (o Mestre ajusta depois)',
      exhaustChoice.status === 200 &&
        afterExhaustChoice.death.pending === null &&
        afterExhaustChoice.hpCurrent === 1 &&
        mechanicalStateOf((await prisma.character.findUniqueOrThrow({ where: { id: heroF.character.id } })).mechanicalState).exhaustionLevel === 6,
      JSON.stringify({ hp: afterExhaustChoice.hpCurrent }),
    );

    // --- 53/54/59) INTEGRAÇÃO RUNTIME: dano por ATAQUE real até a morte -----
    // Os testes anteriores exercitam `manualHp` e os endpoints de morte. Aqui o
    // dano entra pelo caminho REAL do combate
    // (`/combat/attack` → changeHp → applyDamageConsequences) e o evento
    // `death:updated` precisa chegar ao Mestre SEM refresh: é exatamente o que
    // abre a resolução pendente no navegador. Foi a lacuna que os testes
    // anteriores (que chamavam o serviço direto) não pegavam.
    const attacker = await prisma.combatant.create({
      data: {
        combatId: combat.id,
        kind: 'CREATURE',
        creatureId: creature.id,
        name: 'Goblin Ataque',
        hpCurrent: 12,
        hpMax: 12,
        armorClass: 12,
        initiative: -100,
        dexterityMod: 0,
      },
    });
    const stabilizedBefore = await readDeath(characterEntity(heroA));
    let hitResult: { hit?: boolean } | null = null;
    let attackDeathEvent: { pending?: { kind?: string } | null } | null = null;
    // O ataque pode errar num 1 natural: repete a rodada até acertar (3 vezes).
    for (let attempt = 0; attempt < 3 && hitResult?.hit !== true; attempt += 1) {
      await advanceTo(attacker.id, true);
      const combatNow = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
      let onDeath: ((payload: any) => void) | null = null;
      const eventPromise = new Promise<any>((resolveEvent) => {
        const timer = setTimeout(() => resolveEvent(null), 4000);
        onDeath = (payload: any) => {
          clearTimeout(timer);
          resolveEvent(payload.death);
        };
        masterSocket.once('death:updated', onDeath);
      });
      const attacked = await request('/combat/attack', {
        combatId: combatNow.id,
        expectedVersion: combatNow.version,
        operationId: randomUUID(),
        attackerCombatantId: attacker.id,
        targetCombatantId: combatantA,
        attackId: 'bite',
      }, masterToken);
      hitResult = attacked.status === 200 ? (attacked.data.result as { hit?: boolean }) : null;
      const payload = await eventPromise;
      if (onDeath) masterSocket.off('death:updated', onDeath);
      if (hitResult?.hit === true) attackDeathEvent = payload;
    }
    const attackedDeath = await readDeath(characterEntity(heroA));
    check(
      '64.53/54/59) ataque REAL a 0 PV: morte instantânea vira decisão do Mestre, sem falhas antes, com evento sem refresh',
      stabilizedBefore.death.stabilized &&
        hitResult?.hit === true &&
        attackedDeath.hpCurrent === 0 &&
        attackedDeath.death.pending?.kind === 'instant-death' &&
        attackedDeath.death.failures === 0 &&
        attackDeathEvent?.pending?.kind === 'instant-death',
      JSON.stringify({
        hit: hitResult?.hit,
        pending: attackedDeath.death.pending?.kind,
        failures: attackedDeath.death.failures,
        event: attackDeathEvent?.pending?.kind,
      }),
    );
    const pendingList = await request('/death/pending', undefined, masterToken);
    const pendingListPlayer = await request('/death/pending', undefined, spectatorToken);
    check(
      '64.51) reconnect: o Mestre recupera as decisões pendentes pelo servidor (jogador não)',
      pendingList.status === 200 &&
        (pendingList.data.deaths as { entity: { id: string }; pending: { kind: string } | null }[]).some(
          (entry) => entry.entity.id === heroA.character.id && entry.pending?.kind === 'instant-death',
        ) &&
        pendingListPlayer.status === 403,
      JSON.stringify({ status: pendingList.status, player: pendingListPlayer.status }),
    );

    // Fecha a decisão aberta pelo ataque para as verificações seguintes.
    await resolve(characterEntity(heroA), 'narrative-1hp', attackedDeath.version);

    /* ---------------------------------------------------------------------- */
    /* HOTFIX — encerrar turno, Registro, Medicina e "Deixar estabilizado"    */
    /* ---------------------------------------------------------------------- */

    // --- 28) O Teste Contra a Morte de PERSONAGEM entra no Registro ---------
    const journalRows = async () =>
      (await prisma.combat.findUniqueOrThrow({ where: { id: combat.id }, select: { economyLog: true } }))
        .economyLog as { action?: string; message?: string }[];
    const journalDeath = await journalRows();
    check(
      '64.28) o Teste contra a Morte de PERSONAGEM aparece no Registro lateral (persistido)',
      journalDeath.some(
        (entry) => entry.action === 'death-save' && /Teste contra a Morte/.test(entry.message ?? ''),
      ),
      JSON.stringify(journalDeath.filter((entry) => entry.action === 'death-save').slice(-2)),
    );

    // --- 31/32/33/34) Encerrar turno com Teste Contra a Morte pendente ------
    await resetHero(heroE, 0, { deathSaves: true });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    await advanceTo(combatantE, true);
    const turnE = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const playerEnd = await request(
      '/combat/next-turn',
      { combatId: turnE.id, expectedVersion: turnE.version, operationId: randomUUID() },
      heroE.token,
    );
    // Q) Rola o Teste deste turno e o MESMO jogador passa a poder encerrar.
    const rolledE = await request(
      '/dice/roll',
      {
        entity: characterEntity(heroE),
        kind: 'death-save',
        label: 'Teste contra a Morte',
        dice: [{ sides: 20 }],
      },
      heroE.token,
    );
    const turnEAfterRoll = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const endAfterRoll = await request(
      '/combat/next-turn',
      { combatId: turnEAfterRoll.id, expectedVersion: turnEAfterRoll.version, operationId: randomUUID() },
      heroE.token,
    );
    // Reabre o cenário de Teste PENDENTE para a confirmação do Mestre.
    await resetHero(heroE, 0, { deathSaves: true });
    await advanceTo(combatantE, true);
    const turnESkip = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const masterEnd = await request(
      '/combat/next-turn',
      { combatId: turnESkip.id, expectedVersion: turnESkip.version, operationId: randomUUID() },
      masterToken,
    );
    const beforeSkip = await readDeath(characterEntity(heroE));
    const skip = await request(
      '/combat/next-turn',
      {
        combatId: turnESkip.id,
        expectedVersion: turnESkip.version,
        operationId: randomUUID(),
        skipDeathSave: true,
      },
      masterToken,
    );
    const afterSkip = await readDeath(characterEntity(heroE));
    const journalSkip = await journalRows();
    check(
      '64.31/32/33/34) PLAYER não encerra sem o Teste Contra a Morte; MASTER só avança confirmando, sem inventar resultado',
      playerEnd.status === 409 &&
        playerEnd.data.error === 'DEATH_SAVE_PENDING' &&
        rolledE.status === 201 &&
        endAfterRoll.status === 200 &&
        masterEnd.status === 409 &&
        masterEnd.data.error === 'DEATH_SAVE_PENDING' &&
        skip.status === 200 &&
        skip.data.combat.currentCombatantId !== combatantE &&
        afterSkip.death.successes === beforeSkip.death.successes &&
        afterSkip.death.failures === beforeSkip.death.failures &&
        journalSkip.some(
          (entry) =>
            entry.action === 'death-override' &&
            /avançou o turno sem o Teste Contra a Morte/.test(entry.message ?? ''),
        ),
      JSON.stringify({
        player: [playerEnd.status, playerEnd.data.error],
        rolled: rolledE.status,
        endAfterRoll: endAfterRoll.status,
        master: [masterEnd.status, masterEnd.data.error],
        skip: skip.status,
        death: afterSkip.death,
      }),
    );

    // --- 9–17/43/51) ESTABILIZAR por Sabedoria (Medicina) CD 10 ------------
    await resetHero(heroF, 40);
    await advanceTo(combatantF, true);
    const turnF = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const invalidStabilize = await request(
      '/combat/action',
      {
        combatId: turnF.id,
        expectedVersion: turnF.version,
        operationId: randomUUID(),
        combatantId: combatantF,
        action: 'stabilize',
        targetCombatantId: combatantA,
      },
      heroF.token,
    );
    const targetBefore = await readDeath(characterEntity(heroE));
    const turnFAgain = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const stabilizeAttempt = await request(
      '/combat/action',
      {
        combatId: turnFAgain.id,
        expectedVersion: turnFAgain.version,
        operationId: randomUUID(),
        combatantId: combatantF,
        action: 'stabilize',
        targetCombatantId: combatantE,
      },
      heroF.token,
    );
    const targetAfter = await readDeath(characterEntity(heroE));
    const journalStabilize = await journalRows();
    const stabilizeLine = journalStabilize
      .filter((entry) => entry.action === 'stabilize')
      .map((entry) => entry.message ?? '')
      .find((message) => message.includes('Medicina para estabilizar')) ?? '';
    const stabilizeWorked = stabilizeLine.includes('SUCESSO');
    const combatAfterStabilize = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const actorEconomy = combatAfterStabilize.combatants.find((item) => item.id === combatantF)?.turnEconomy;
    const targetMechanical = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroE.character.id } })).mechanicalState,
    );
    check(
      '64.9/10/12/15/16/17/51) ESTABILIZAR usa Sabedoria (Medicina) CD 10, consome a Ação e só muda o alvo no sucesso',
      invalidStabilize.status === 409 &&
        stabilizeAttempt.status === 200 &&
        stabilizeLine.includes(`vs CD ${10}`) &&
        actorEconomy?.actionsUsed === 1 &&
        (stabilizeWorked
          ? targetAfter.death.stabilized &&
            !targetAfter.death.deathSaves &&
            targetAfter.death.successes === 0 &&
            targetAfter.death.failures === 0 &&
            targetAfter.hpCurrent === 0 &&
            targetMechanical.conditions.some((item) => item.condition === 'unconscious') &&
            targetMechanical.conditions.some((item) => item.condition === 'prone')
          : !targetAfter.death.stabilized &&
            targetAfter.death.failures === targetBefore.death.failures &&
            targetAfter.death.successes === targetBefore.death.successes),
      JSON.stringify({ line: stabilizeLine, worked: stabilizeWorked, death: targetAfter.death }),
    );

    // --- 18/19/50) "Deixar estabilizado" na decisão pendente do Mestre ------
    await resetHero(heroE, 0, { deathSaves: true, failures: 2 });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { mechanicalState: addHpZeroUnconscious({}).state as never },
    });
    await manualHp(combatantE, 1, 'damage');
    const pendingE = await readDeath(characterEntity(heroE));
    const leave = await resolve(characterEntity(heroE), 'leave-stabilized', pendingE.version);
    const left = await readDeath(characterEntity(heroE));
    const leftMechanical = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroE.character.id } })).mechanicalState,
    );
    check(
      '64.18/19/50) "Deixar estabilizado": 0 PV, vivo, estabilizado, contadores zerados, Inconsciente e Caído',
      pendingE.death.pending?.kind === 'failures' &&
        leave.status === 200 &&
        left.hpCurrent === 0 &&
        !left.death.dead &&
        left.death.stabilized &&
        !left.death.deathSaves &&
        left.death.successes === 0 &&
        left.death.failures === 0 &&
        left.death.pending === null &&
        leftMechanical.conditions.some((item) => item.condition === 'unconscious') &&
        leftMechanical.conditions.some((item) => item.condition === 'prone'),
      JSON.stringify({ pending: pendingE.death.pending?.kind, status: leave.status, death: left.death }),
    );

    // --- 16) Medicina aplicada no domínio = MESMO estado da estabilização ---
    await resetHero(heroE, 0, { deathSaves: true, successes: 2, failures: 1 });
    await prisma.character.update({
      where: { id: heroE.character.id },
      data: { mechanicalState: { ...addHpZeroUnconscious({}).state, conditions: [] } as never },
    });
    const directStabilize = await prisma.$transaction(async (tx) => {
      await applyStabilization(characterEntity(heroE), 'Medicina (smoke)', tx);
      return tx.character.findUniqueOrThrow({ where: { id: heroE.character.id } });
    });
    const directDeath = deathStateOf(directStabilize.deathState);
    const directMechanical = mechanicalStateOf(directStabilize.mechanicalState);
    check(
      '64.16) estabilização por Medicina zera os contadores e mantém Inconsciente + Caído a 0 PV',
      directStabilize.hpCurrent === 0 &&
        directDeath.stabilized &&
        !directDeath.deathSaves &&
        directDeath.successes === 0 &&
        directDeath.failures === 0 &&
        directMechanical.conditions.some((item) => item.condition === 'unconscious') &&
        directMechanical.conditions.some((item) => item.condition === 'prone'),
      JSON.stringify({ hp: directStabilize.hpCurrent, death: directDeath }),
    );

    // --- 52) LEVANTAR-SE: metade do deslocamento efetivo, sem gastar Ação --
    const proneState = {
      conditions: [
        {
          id: randomUUID(),
          condition: 'prone',
          sourceType: 'posture',
          sourceLabel: 'Queda',
          appliedAt: new Date().toISOString(),
        },
      ],
      exhaustionLevel: 0,
      log: [],
    };
    await prisma.character.update({
      where: { id: heroF.character.id },
      data: { hpCurrent: 40, mechanicalState: proneState as never },
    });
    const heroFRow = await prisma.character.findUniqueOrThrow({ where: { id: heroF.character.id } });
    // Leitura FRESCA: o estado mecânico mudou (Caído sem Exaustão) — o DTO
    // anterior ainda trazia a velocidade efetiva da Exaustão 6.
    const combatBeforeStand = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const combatantFBefore = combatBeforeStand.combatants.find((item) => item.id === combatantF)!;
    const standEntity = characterEntity(heroF);
    const stand = await request(
      '/mechanical/mutate',
      {
        entity: standEntity,
        expectedVersion: heroFRow.version,
        expectedCombatVersion: combatBeforeStand.version,
        action: 'stand',
        operationId: randomUUID(),
      },
      heroF.token,
    );
    const combatAfterStand = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const economyAfterStand = combatAfterStand.combatants.find((item) => item.id === combatantF)!.turnEconomy;
    const mechAfterStand = mechanicalStateOf(
      (await prisma.character.findUniqueOrThrow({ where: { id: heroF.character.id } })).mechanicalState,
    );
    check(
      '64.52/AL/AN/AO/AR) Levantar-se custa METADE do deslocamento efetivo, não gasta Ação e remove só Caído',
      stand.status === 200 &&
        combatantFBefore.effectiveSpeed > 0 &&
        Math.abs(economyAfterStand.movementUsed - combatantFBefore.effectiveSpeed / 2) < 1e-6 &&
        economyAfterStand.actionsUsed === combatantFBefore.turnEconomy.actionsUsed &&
        !mechAfterStand.conditions.some((item) => item.condition === 'prone'),
      JSON.stringify({
        status: stand.status,
        speed: combatantFBefore.effectiveSpeed,
        economy: economyAfterStand,
      }),
    );
    const heroFNoProne = await prisma.character.findUniqueOrThrow({ where: { id: heroF.character.id } });
    const combatStandAgain = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const standAgain = await request(
      '/mechanical/mutate',
      {
        entity: standEntity,
        expectedVersion: heroFNoProne.version,
        expectedCombatVersion: combatStandAgain.version,
        action: 'stand',
        operationId: randomUUID(),
      },
      heroF.token,
    );
    check(
      '64.52/AM) Levantar-se não existe para quem NÃO está Caído (servidor recusa)',
      standAgain.status === 409,
      JSON.stringify({ status: standAgain.status, message: standAgain.data.message }),
    );
    await prisma.character.update({
      where: { id: heroF.character.id },
      data: {
        mechanicalState: {
          ...proneState,
          conditions: [
            ...proneState.conditions,
            {
              id: randomUUID(),
              condition: 'grappled',
              sourceType: 'test',
              appliedAt: new Date().toISOString(),
            },
          ],
        } as never,
      },
    });
    const heroFGrappled = await prisma.character.findUniqueOrThrow({ where: { id: heroF.character.id } });
    const combatZeroSpeed = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const standZeroSpeed = await request(
      '/mechanical/mutate',
      {
        entity: standEntity,
        expectedVersion: heroFGrappled.version,
        expectedCombatVersion: combatZeroSpeed.version,
        action: 'stand',
        operationId: randomUUID(),
      },
      heroF.token,
    );
    check(
      '64.52/AP) deslocamento efetivo 0 bloqueia Levantar-se com a mensagem da regra',
      standZeroSpeed.status === 409 &&
        /deslocamento efetivo for 0/.test(String(standZeroSpeed.data.message ?? '')),
      JSON.stringify({ status: standZeroSpeed.status, message: standZeroSpeed.data.message }),
    );

    // --- 40/41) 20 natural devolve o turno normal (e o Movimento p/ levantar) -
    // Estado saudável: o teste anterior deixou Grabbed/Caído (deslocamento 0).
    await prisma.character.update({
      where: { id: heroF.character.id },
      data: { mechanicalState: { conditions: [], exhaustionLevel: 0, log: [] } as never },
    });
    await prisma.combatant.update({
      where: { id: combatantF },
      data: {
        turnEconomy: {
          actionsGranted: 0,
          actionsUsed: 0,
          bonusActionUsed: true,
          reactionAvailable: false,
          movementBudget: 0,
          movementUsed: 0,
        } as never,
      },
    });
    await restoreTurnEconomyAfterRevival(characterEntity(heroF));
    const afterRevival = (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
    const revivalEconomy = afterRevival.combatants.find((item) => item.id === combatantF)!.turnEconomy;
    check(
      '64.40/41) 20 natural devolve o turno normal: Ação e Movimento cheio (base para Levantar-se, sem gastar Ação)',
      revivalEconomy.actionsGranted === 1 &&
        revivalEconomy.actionsUsed === 0 &&
        revivalEconomy.movementBudget === 9 &&
        revivalEconomy.movementUsed === 0 &&
        !revivalEconomy.bonusActionUsed &&
        revivalEconomy.reactionAvailable,
      JSON.stringify(revivalEconomy),
    );

    // --- 46) Reconexão de verdade: sockets novos leem o mesmo estado -------
    for (const socket of sockets) socket.disconnect();
    const reconnected = await connect(masterToken);
    const afterReconnect = await readDeath(characterEntity(heroF));
    const reconnectPromise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      reconnected.once('death:updated', () => { clearTimeout(timer); resolve(true); });
    });
    const relife = await override(characterEntity(heroF), 'add-success', afterReconnect.version, 'Reconexão');
    const sawDeathEvent = await reconnectPromise;
    check(
      '64.AW) após reconectar, o evento de morte volta a chegar e o estado continua consistente',
      relife.status === 200 && sawDeathEvent && (await readDeath(characterEntity(heroF))).death.successes === 1,
      JSON.stringify({ status: relife.status, sawDeathEvent }),
    );

    // --- 2) Isolamento: nada de morte em classState/racialState ------------
    const leaked = await prisma.character.findMany({
      where: { id: { in: [heroA.character.id, heroB.character.id, heroD.character.id] } },
      select: { classState: true, racialState: true, deathState: true },
    });
    check(
      '64.2) deathState é fonte própria: nunca vive em classState/racialState',
      leaked.every((row) => !JSON.stringify([row.classState, row.racialState]).includes('deathSaves') && row.deathState !== null),
    );
    check(
      '64.C) a Resistência Implacável consumida continua consumida (só o descanso longo devolve)',
      ((await prisma.character.findUniqueOrThrow({ where: { id: heroD.character.id } })).racialState as { used?: Record<string, number> }).used?.['relentless-endurance'] === 1,
    );

    // ==================================================================
    // 65) HOTFIX — NPC no combate, privacidade de morte e skip de turnos
    // ==================================================================
    await (async () => {
      // O combate anterior precisa sair do caminho para exercitar a CRIAÇÃO.
      const ended = await request('/combat/end', {}, masterToken);
      check('65.A) combate anterior encerrado para testar a entrada de NPC', ended.status === 200, JSON.stringify(ended.data));

      const npc = await prisma.creature.create({
        data: {
          name: `Bartolomeu ${suffix}`,
          kind: 'NPC',
          type: 'Humanoide',
          hpMax: 20,
          hpCurrent: 20,
          armorClass: 13,
          speed: 9,
          attacks: [
            {
              id: 'rapier',
              name: 'Rapieira',
              attackBonus: 4,
              damage: { count: 1, sides: 8, bonus: 2, type: 'Perfurante' },
              extraDamages: [],
              finesse: true,
              ranged: false,
              notes: '',
            },
          ] as never,
        },
      });
      npcId = npc.id;

      // NPC é entidade única: quantidade > 1 e duplicata são recusadas.
      const npcTwice = await request(
        '/combat',
        { entries: [{ creatureId: npc.id, quantity: 2 }] },
        masterToken,
      );
      check(
        '65.B) NPC não aceita quantidade > 1 (409 com motivo claro)',
        npcTwice.status === 409 && /NPC/.test(String(npcTwice.data.message ?? '')),
        JSON.stringify(npcTwice.data),
      );
      const npcDuplicate = await request(
        '/combat',
        { entries: [{ creatureId: npc.id, quantity: 1 }, { creatureId: npc.id, quantity: 1 }] },
        masterToken,
      );
      check(
        '65.C) o MESMO NPC persistente não entra duas vezes no combate',
        npcDuplicate.status === 409 && /já está neste combate/.test(String(npcDuplicate.data.message ?? '')),
        JSON.stringify(npcDuplicate.data),
      );

      const started = await request(
        '/combat',
        { entries: [{ creatureId: npc.id, quantity: 1 }, { creatureId: creature.id, quantity: 2 }] },
        masterToken,
      );
      const hotfixCombat = started.data.combat as CombatDto;
      hotfixCombatId = hotfixCombat.id;
      const npcCombatant = hotfixCombat.combatants.find((item) => item.creatureId === npc.id)!;
      const goblins = hotfixCombat.combatants
        .filter((item) => item.creatureId === creature.id)
        .map((item) => item.id);
      check(
        '65.D) NPC entra como TIPO próprio e a criatura-template mantém cópias independentes',
        started.status === 201 &&
          npcCombatant.kind === 'NPC' &&
          goblins.length === 2 &&
          new Set(goblins).size === 2 &&
          hotfixCombat.combatants.filter((item) => item.kind === 'NPC').length === 1,
        JSON.stringify({ status: started.status, kinds: hotfixCombat.combatants.map((item) => item.kind) }),
      );

      // Ordem CONTROLADA (sem RNG): heróis primeiro, depois NPC e criaturas.
      const heroCombatants = hotfixCombat.combatants.filter((item) => item.kind === 'CHARACTER');
      const order = [
        heroCombatants[0].id,
        heroCombatants[1].id,
        npcCombatant.id,
        goblins[0],
        goblins[1],
        ...heroCombatants.slice(2).map((item) => item.id),
      ];
      for (const [index, id] of order.entries()) {
        await prisma.combatant.update({
          where: { id },
          data: { initiative: 1000 - index, initiativeRoll: 20 - (index % 10) },
        });
      }
      const activate = () =>
        prisma.combat.update({
          where: { id: hotfixCombat.id },
          data: { status: 'ACTIVE', currentIndex: 1, round: 1, version: { increment: 1 } },
        });
      await activate();

      const activeMaster = async (): Promise<CombatDto> =>
        (await request('/combat/active', undefined, masterToken)).data.combat as CombatDto;
      const activePlayer = async (auth: string): Promise<CombatDto> =>
        (await request('/combat/active', undefined, auth)).data.combat as CombatDto;
      const advanceFrom = async (current: CombatDto) =>
        request(
          '/combat/next-turn',
          {
            combatId: current.id,
            expectedVersion: current.version,
            operationId: randomUUID(),
            skipDeathSave: true,
          },
          masterToken,
        );

      // --- NPC entra no MESMO ciclo de morte (decisão pendente do Mestre) --
      const damaged = await request(
        '/combat/hp',
        { combatantId: npcCombatant.id, amount: 20, mode: 'damage' },
        masterToken,
      );
      const masterAfterDamage = damaged.data.combat as CombatDto;
      const npcAfterDamage = masterAfterDamage.combatants.find((item) => item.id === npcCombatant.id)!;
      check(
        '65.E) NPC a 0 PV entra no lifecycle de morte (pendente do Mestre) com HP da PRÓPRIA instância',
        damaged.status === 200 &&
          npcAfterDamage.hpCurrent === 0 &&
          npcAfterDamage.deathState?.pending?.kind === 'npc-zero',
        JSON.stringify({ hp: npcAfterDamage.hpCurrent, pending: npcAfterDamage.deathState?.pending?.kind }),
      );

      // --- PRIVACIDADE (DTO do jogador, decidida no servidor) --------------
      const playerView = await activePlayer(heroA.token);
      const hiddenNpc = playerView.combatants.find((item) => item.id === npcCombatant.id)!;
      check(
        '65.F) PLAYER não recebe HP/CA/deathState/pendência de NPC (o Mestre recebe)',
        hiddenNpc.deathState === null &&
          hiddenNpc.hpCurrent === null &&
          hiddenNpc.armorClass === null &&
          hiddenNpc.statsHidden &&
          !hiddenNpc.deathBlocksActions &&
          npcAfterDamage.deathState?.pending !== null,
      );

      // O Mestre escolhe DEIXAR ESTABILIZADO: é o caminho REAL que aplica
      // Inconsciente + Caído. A privacidade é verificada nesse estado.
      const pendingNpcDeath = await readDeath({ kind: 'combatant', id: npcCombatant.id });
      const stabilized = await resolve(
        { kind: 'combatant', id: npcCombatant.id },
        'leave-stabilized',
        pendingNpcDeath.version,
      );
      const masterStabilized = await activeMaster();
      const visibleNpc = masterStabilized.combatants.find((item) => item.id === npcCombatant.id)!;
      const playerStabilized = await activePlayer(heroA.token);
      const hiddenStabilized = playerStabilized.combatants.find(
        (item) => item.id === npcCombatant.id,
      )!;
      check(
        '65.G) ESTABILIZADO: o Mestre vê 0 PV + Inconsciente/Caído; o PLAYER não vê nada disso',
        stabilized.status === 200 &&
          visibleNpc.hpCurrent === 0 &&
          visibleNpc.deathState?.stabilized === true &&
          visibleNpc.mechanicalState.conditions.some((item) => item.condition === 'unconscious') &&
          visibleNpc.mechanicalState.conditions.some((item) => item.condition === 'prone') &&
          hiddenStabilized.deathState === null &&
          hiddenStabilized.hpCurrent === null &&
          !hiddenStabilized.mechanicalState.conditions.some(
            (item) => item.condition === 'unconscious' || item.condition === 'prone',
          ) &&
          hiddenStabilized.conditionEffects.canAct &&
          !hiddenStabilized.conditionEffects.prone,
        JSON.stringify({
          status: stabilized.status,
          master: visibleNpc.mechanicalState.conditions.map((item) => item.condition),
          player: hiddenStabilized.mechanicalState.conditions.map((item) => item.condition),
        }),
      );
      check(
        '65.H) a linha de estabilização de NPC é PRIVADA no Registro (o jogador não lê)',
        masterStabilized.economyLog.some(
          (entry) => entry.action === 'stabilize' && entry.private === true,
        ) &&
          !playerStabilized.economyLog.some((entry) => entry.action === 'stabilize'),
        JSON.stringify({
          master: masterStabilized.economyLog.filter((entry) => entry.action === 'stabilize').length,
          player: playerStabilized.economyLog.filter((entry) => entry.action === 'stabilize').length,
        }),
      );
      check(
        '65.I) a entrada do NPC PERMANECE na iniciativa visível (não denuncia o estado)',
        playerStabilized.combatants.length === hotfixCombat.combatants.length &&
          playerStabilized.combatants.some((item) => item.id === npcCombatant.id) &&
          playerView.combatants.some((item) => item.id === npcCombatant.id),
      );

      // Mestre CONFIRMA a morte pela mesma rota do ciclo (sem fluxo paralelo).
      const stabilizedDeathDto = await readDeath({ kind: 'combatant', id: npcCombatant.id });
      const confirmed = await override(
        { kind: 'combatant', id: npcCombatant.id },
        'confirm-death',
        stabilizedDeathDto.version,
        'Morte confirmada no teste do hotfix',
      );
      const playerAfterDeath = await activePlayer(heroA.token);
      const deadForPlayer = playerAfterDeath.combatants.find((item) => item.id === npcCombatant.id)!;
      check(
        '65.J) MORTO de NPC não chega ao PLAYER e ele segue na iniciativa',
        confirmed.status === 200 &&
          deadForPlayer.deathState === null &&
          playerAfterDeath.combatants.some((item) => item.id === npcCombatant.id),
        JSON.stringify({ status: confirmed.status, death: deadForPlayer.deathState }),
      );

      // --- SKIP DE MORTO ---------------------------------------------------
      const beforeDeadSkip = await activeMaster();
      const deadSkip = await advanceFrom(beforeDeadSkip);
      const afterDeadSkip = deadSkip.data.combat as CombatDto;
      check(
        '65.K) turno de combatente MORTO é pulado sem parar nele',
        deadSkip.status === 200 &&
          afterDeadSkip.currentCombatantId === goblins[0] &&
          afterDeadSkip.currentCombatantId !== npcCombatant.id,
        JSON.stringify({ status: deadSkip.status, current: afterDeadSkip.currentCombatantId, expected: goblins[0] }),
      );
      const skipMasterView = afterDeadSkip.economyLog.some(
        (entry) => entry.action === 'turn-skip' && entry.private === true,
      );
      const skipPlayerView = (await activePlayer(heroA.token)).economyLog.some(
        (entry) => entry.action === 'turn-skip',
      );
      check(
        '65.L) o motivo do pulo é PRIVADO do Mestre (não vaza para o Registro do jogador)',
        skipMasterView && !skipPlayerView,
        JSON.stringify({ skipMasterView, skipPlayerView }),
      );

      // --- SKIP DE ESTABILIZADO A 0 PV (sem Death Save e sem economia) -----
      await prisma.combatant.update({
        where: { id: goblins[0] },
        data: {
          hpCurrent: 0,
          // Economia BLOQUEADA, como um estabilizado que nunca agiu: o skip não
          // pode conceder Ação/Movimento por cima.
          turnEconomy: {
            actionsGranted: 0,
            actionsUsed: 0,
            bonusActionUsed: true,
            reactionAvailable: false,
            movementBudget: 0,
            movementUsed: 0,
          } as never,
          deathState: {
            successes: 0, failures: 0, stabilized: true, dead: false,
            deathSaves: false, pending: null, relentless: null, saveTurnKey: null, log: [],
          } as never,
        },
      });
      const resetStab = await prisma.combat.update({
        where: { id: hotfixCombat.id },
        data: { currentIndex: 1, version: { increment: 1 } },
      });
      void resetStab;
      const beforeStabSkip = await activeMaster();
      const stabSkip = await advanceFrom(beforeStabSkip);
      const afterStabSkip = stabSkip.data.combat as CombatDto;
      const stabilizedRow = await prisma.combatant.findUniqueOrThrow({ where: { id: goblins[0] } });
      const stabilizedDeath = deathStateOf(stabilizedRow.deathState);
      check(
        '65.M) morto + estabilizado a 0 são pulados juntos até o próximo elegível',
        stabSkip.status === 200 && afterStabSkip.currentCombatantId === goblins[1],
        JSON.stringify({ status: stabSkip.status, current: afterStabSkip.currentCombatantId }),
      );
      check(
        '65.N) estabilizado não rola Death Save nem recebe Ação/Movimento',
        !stabilizedDeath.deathSaves &&
          stabilizedDeath.saveTurnKey === null &&
          stabilizedDeath.successes === 0 &&
          stabilizedDeath.failures === 0 &&
          ((stabilizedRow.turnEconomy as { actionsGranted?: number } | null)?.actionsGranted ?? 0) === 0,
        JSON.stringify({ death: { ...stabilizedDeath, log: [] }, economy: stabilizedRow.turnEconomy }),
      );

      // --- 0 PV COM DEATH SAVES ATIVOS **NÃO** É PULADO --------------------
      await prisma.combatant.update({
        where: { id: goblins[1] },
        data: {
          hpCurrent: 0,
          deathState: {
            successes: 0, failures: 0, stabilized: false, dead: false,
            deathSaves: true, pending: null, relentless: null, saveTurnKey: null, log: [],
          } as never,
        },
      });
      await prisma.combat.update({
        where: { id: hotfixCombat.id },
        data: { currentIndex: 3, version: { increment: 1 } },
      });
      const beforeSaveTurn = await activeMaster();
      const saveTurn = await advanceFrom(beforeSaveTurn);
      const afterSaveTurn = saveTurn.data.combat as CombatDto;
      const saveTurnRow = afterSaveTurn.combatants.find((item) => item.id === goblins[1])!;
      check(
        '65.O) 0 PV com Testes contra a Morte ATIVOS continua recebendo o turno (não é pulado)',
        saveTurn.status === 200 &&
          afterSaveTurn.currentCombatantId === goblins[1] &&
          saveTurnRow.deathState?.deathSaves === true &&
          saveTurnRow.turnEconomy.actionsGranted === 0,
        JSON.stringify({ status: saveTurn.status, current: afterSaveTurn.currentCombatantId }),
      );

      // --- FALLBACK SEGURO: todos mortos/inválidos -------------------------
      const deadState = {
        successes: 0, failures: 0, stabilized: false, dead: true,
        deathSaves: false, pending: null, relentless: null, saveTurnKey: null, log: [],
      };
      for (const item of (await activeMaster()).combatants) {
        if (item.characterId) {
          await prisma.character.update({
            where: { id: item.characterId },
            data: { hpCurrent: 0, deathState: deadState as never },
          });
        } else {
          await prisma.combatant.update({
            where: { id: item.id },
            data: { hpCurrent: 0, deathState: deadState as never },
          });
        }
      }
      const beforeAllDead = await activeMaster();
      const allDead = await advanceFrom(beforeAllDead);
      const afterAllDead = await activeMaster();
      check(
        '65.P) todos mortos/estabilizados: fallback SEGURO (409 reportável, sem laço e sem mudar o turno)',
        allDead.status === 409 &&
          allDead.data.error === 'NO_ELIGIBLE_COMBATANT' &&
          afterAllDead.currentCombatantId === beforeAllDead.currentCombatantId,
        JSON.stringify({ status: allDead.status, error: allDead.data.error }),
      );
    })();
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (combatId) await prisma.combat.deleteMany({ where: { id: combatId } });
    if (hotfixCombatId) await prisma.combat.deleteMany({ where: { id: hotfixCombatId } });
    if (creatureId) await prisma.creature.deleteMany({ where: { id: creatureId } });
    if (npcId) await prisma.creature.deleteMany({ where: { id: npcId } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
