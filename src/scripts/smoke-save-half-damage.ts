import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { allSpells } from '../modules/shared/spells/index.js';
import { spellDefinitionId } from '../modules/spells/execution/spell-execution-definition.js';
import { spellExecutionDefinition } from '../modules/spells/execution/spell-execution-registry.js';
import { resolveSaveDamagePending } from '../modules/spells/execution/save-damage-resolution.js';
import {
  applySaveDamageOutcome,
  applySaveDamageShare,
} from '../modules/spells/execution/save-damage-outcome.js';
import { applyDamageDefense } from '../modules/combat/damage-resolution.js';
import { BLESS_LABEL, blessModifiers } from '../modules/effects/definitions/bless.js';
import {
  SYNTHETIC_SAVE_HALF_DAMAGE_TYPE,
  SYNTHETIC_SAVE_HALF_SPELL_ID,
} from '../modules/spells/execution/save-half-test-definition.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6J.1 — SAVE FOR HALF DAMAGE (fundação genérica).
 *
 * Prova que `save-damage` declara o desfecho do save (`none`/`half`/`full`) e
 * que a meia-dano é aplicada na ORDEM do PHB 2014:
 *
 *   dano bruto → consequência do save (floor POR COMPONENTE)
 *              → resistência/imunidade/vulnerabilidade
 *              → dano final → PV → Concentração
 *
 * A prova usa uma definição SINTÉTICA (`test.synthetic-save-half`): salvaguarda
 * de Destreza, 3d6 de Fogo, sucesso = metade e falha = cheio. Ela NÃO está no
 * catálogo, no repertório, no cast-options nem em UI alguma — Fireball/Burning
 * Hands/Thunderwave continuam fora do escopo (exigem área).
 *
 * Determinismo: a parte de números exatos usa o MESMO resolvedor do servidor
 * com a fonte de rolagem injetada (nunca "rolar até sair"). A parte de HTTP
 * prova o card, o save e as regras de Esquiva/Paralisia/Bless com construções
 * garantidas (CD alta/baixa, auto-falha), não com sorte.
 */
export async function smokeSaveHalfDamage(baseUrl: string, check: Check): Promise<void> {
  console.log('\n84) Fase 6.6J.1 — save for half damage (fundação genérica)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const castIds: string[] = [];
  const pendingIds: string[] = [];
  const effectIds: string[] = [];
  const combatIds: string[] = [];

  try {
    const request = async (
      path: string,
      token: string,
      body?: unknown,
    ): Promise<{ status: number; data: any }> => {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    };

    const makeUser = (label: string, role: 'MASTER' | 'PLAYER' = 'PLAYER') =>
      prisma.user.create({
        data: {
          username: `sh_${label}_${suffix}`,
          displayName: `SH ${label}`,
          passwordHash: 'fixture',
          role,
        },
      });
    const master = await makeUser('m', 'MASTER');
    const casterOwner = await makeUser('c');
    const targetOwner = await makeUser('t');
    userIds.push(master.id, casterOwner.id, targetOwner.id);
    const tokenOf = (user: { id: string; username: string; displayName: string; role: string }) =>
      signToken({
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role as 'MASTER' | 'PLAYER',
      });
    const masterToken = tokenOf(master);
    const targetToken = tokenOf(targetOwner);

    // 1 usuário ↔ 1 ficha (`Character.userId` é único): cada alvo de fixture tem
    // o PRÓPRIO dono. `owner` só é passado quando o teste precisa do token dele.
    const makeCharacter = async (
      name: string,
      data: Record<string, unknown> = {},
      owner?: { id: string },
    ) => {
      const user = owner ?? (await makeUser(`u${characterIds.length}`));
      if (!owner) userIds.push(user.id);
      const character = await prisma.character.create({
        data: {
          userId: user.id,
          name,
          hpCurrent: 60,
          hpMax: 60,
          speed: 9,
          dexterity: 10,
          wisdom: 10,
          ...data,
        } as never,
      });
      characterIds.push(character.id);
      return character;
    };
    const caster = await prisma.character.create({
      data: {
        userId: casterOwner.id,
        name: 'Conjurador SH',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      } as never,
    });
    characterIds.push(caster.id);

    const defensesOf = (kind: 'resistance' | 'immunity' | 'vulnerability', type: string) => ({
      resistances: new Set(kind === 'resistance' ? [type] : []),
      immunities: new Set(kind === 'immunity' ? [type] : []),
      vulnerabilities: new Set(kind === 'vulnerability' ? [type] : []),
    });

    // =====================================================================
    // A–I — REGRA PURA (sem banco, sem sorte)
    // =====================================================================
    check(
      '84.A) `full` mantém o dano bruto (10 → 10)',
      applySaveDamageShare(10, 'full') === 10,
      String(applySaveDamageShare(10, 'full')),
    );
    check(
      '84.B) `half` par divide exatamente (10 → 5)',
      applySaveDamageShare(10, 'half') === 5,
      String(applySaveDamageShare(10, 'half')),
    );
    check(
      '84.C) `half` ímpar arredonda para BAIXO (9 → 4)',
      applySaveDamageShare(9, 'half') === 4,
      String(applySaveDamageShare(9, 'half')),
    );
    check(
      '84.D) `none` zera a parcela (10 → 0)',
      applySaveDamageShare(10, 'none') === 0,
      String(applySaveDamageShare(10, 'none')),
    );
    const multiRaw = [
      { type: 'Fogo', rawAmount: 5 },
      { type: 'Frio', rawAmount: 5 },
    ];
    const multiHalf = applySaveDamageOutcome(multiRaw, 'half');
    check(
      '84.E) multi-componente: 5 Fogo + 5 Frio → metade POR COMPONENTE (2 + 2), tipos preservados',
      multiHalf.length === 2 &&
        multiHalf[0]?.type === 'Fogo' &&
        multiHalf[0]?.rawAmount === 2 &&
        multiHalf[1]?.type === 'Frio' &&
        multiHalf[1]?.rawAmount === 2,
      JSON.stringify(multiHalf),
    );
    const fireAfterHalf = applyDamageDefense('Fogo', multiHalf[0]!.rawAmount, defensesOf('resistance', 'Fogo'));
    const coldAfterHalf = applyDamageDefense('Frio', multiHalf[1]!.rawAmount, defensesOf('resistance', 'Fogo'));
    const aggregated = applyDamageDefense(
      'Fogo',
      applySaveDamageShare(10, 'half'),
      defensesOf('resistance', 'Fogo'),
    );
    check(
      '84.F) ORDEM: save (por componente) ANTES da resistência → 1 Fogo + 2 Frio = 3 (agregar daria 2)',
      fireAfterHalf.applied === 1 &&
        coldAfterHalf.applied === 2 &&
        fireAfterHalf.applied + coldAfterHalf.applied === 3 &&
        aggregated.applied === 2,
      JSON.stringify({ fire: fireAfterHalf, cold: coldAfterHalf, aggregated }),
    );
    const vulnerability = applyDamageDefense('Fogo', applySaveDamageShare(15, 'half'), defensesOf('vulnerability', 'Fogo'));
    check(
      '84.G) vulnerabilidade depois do save: 15 → 7 → 14 (nunca 15 → 30 → 15)',
      vulnerability.applied === 14 && vulnerability.modifier === 'vulnerability',
      JSON.stringify(vulnerability),
    );
    const immunity = applyDamageDefense('Fogo', applySaveDamageShare(15, 'half'), defensesOf('immunity', 'Fogo'));
    check(
      '84.H) imunidade zera independentemente do save (final 0)',
      immunity.applied === 0 && immunity.modifier === 'immunity',
      JSON.stringify(immunity),
    );
    const secondType = applyDamageDefense('Frio', multiHalf[1]!.rawAmount, defensesOf('immunity', 'Fogo'));
    check(
      '84.I) a defesa de um tipo não afeta o OUTRO componente (Frio segue inteiro)',
      secondType.applied === 2 && secondType.modifier === null,
      JSON.stringify(secondType),
    );

    // =====================================================================
    // J–M — DEFINIÇÃO DECLARATIVA, SINTÉTICA FORA DO CATÁLOGO
    // =====================================================================
    const synthetic = spellExecutionDefinition(SYNTHETIC_SAVE_HALF_SPELL_ID);
    const syntheticResolution = synthetic?.resolution;
    check(
      '84.J) a definição declara `outcome` none/half/full e componentes independentes (sem nome de magia no núcleo)',
      syntheticResolution?.kind === 'save-damage' &&
        syntheticResolution.outcome.success === 'half' &&
        syntheticResolution.outcome.failure === 'full' &&
        syntheticResolution.damage.components.length === 1 &&
        syntheticResolution.damage.components[0]?.type === SYNTHETIC_SAVE_HALF_DAMAGE_TYPE &&
        syntheticResolution.damage.components[0]?.dice.count === 3 &&
        syntheticResolution.damage.components[0]?.dice.sides === 6 &&
        synthetic?.requiresConcentration === false &&
        synthetic?.duration === undefined,
      JSON.stringify(syntheticResolution),
    );
    check(
      '84.K) a definição sintética NÃO está no catálogo (nem em repertório/cast-options/UI)',
      !allSpells().some((spell) => spell.id === SYNTHETIC_SAVE_HALF_SPELL_ID),
      String(allSpells().length),
    );
    const sacredFlame = spellExecutionDefinition('sacred-flame');
    check(
      '84.L) Chama Sagrada continua sucesso = NENHUM dano (regressão obrigatória)',
      sacredFlame?.resolution.kind === 'save-damage' &&
        sacredFlame.resolution.outcome.success === 'none' &&
        sacredFlame.resolution.outcome.failure === 'full',
      JSON.stringify(sacredFlame?.resolution),
    );
    check(
      '84.M) Fireball, Burning Hands e Thunderwave continuam NÃO implementadas',
      spellExecutionDefinition('fireball') === null &&
        spellExecutionDefinition('burning-hands') === null &&
        spellExecutionDefinition('thunderwave') === null,
      String([
        spellExecutionDefinition('fireball'),
        spellExecutionDefinition('burning-hands'),
        spellExecutionDefinition('thunderwave'),
      ]),
    );

    // =====================================================================
    // FIXTURE: cast + pendência da definição sintética
    // =====================================================================
    const makeCast = async (
      target: { kind: 'character' | 'creature'; id: string },
      options: { dc?: number; ability?: string; requiresConcentration?: boolean } = {},
    ) => {
      const dc = options.dc ?? 15;
      const cast = await prisma.spellCast.create({
        data: {
          spellId: SYNTHETIC_SAVE_HALF_SPELL_ID,
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          casterLabel: caster.name,
          targets: [{ kind: target.kind, id: target.id }] as never,
          status: 'resolving',
          requiresConcentration: options.requiresConcentration ?? false,
          spellcastingMode: 'derived',
          spellcastingAbility: 'wisdom',
          spellcastingAbilityModifier: 0,
          spellcastingProficiencyBonus: 3,
          spellSaveDc: dc,
          spellLevel: 1,
          castAtLevel: 1,
          operationId: `shalf-${randomUUID()}`,
          fingerprint: randomUUID(),
          createdBy: master.id,
        },
      });
      castIds.push(cast.id);
      const pending = await prisma.pendingEffectSave.create({
        data: {
          definitionId: spellDefinitionId(SYNTHETIC_SAVE_HALF_SPELL_ID),
          spellCastId: cast.id,
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          casterLabel: caster.name,
          targetEntityKind: target.kind,
          targetEntityId: target.id,
          ability: options.ability ?? 'dexterity',
          dc,
          visibility: 'public',
          status: 'pending',
          operationId: `${cast.id}:${target.kind}:${target.id}`,
          fingerprint: randomUUID(),
          createdBy: master.id,
        },
      });
      pendingIds.push(pending.id);
      return { cast, pending };
    };

    /**
     * Resolve com a MESMA implementação do servidor, injetando os dados. Assim os
     * números exatos (metade ímpar, resistência… ) são provados sem sorte.
     */
    const resolveWithRolls = (
      pendingId: string,
      total: number,
      values: number[],
    ) => {
      let index = 0;
      return resolveSaveDamagePending(pendingId, total, 'Smoke SH', {
        roll: () => values[index++] ?? 1,
      });
    };
    const hpOf = async (id: string) =>
      (await prisma.character.findUniqueOrThrow({ where: { id }, select: { hpCurrent: true } }))
        .hpCurrent;

    // N — sucesso com meia-dano (par)
    const evenTarget = await makeCharacter('Alvo SH par');
    characterIds.push(evenTarget.id);
    const evenCast = await makeCast({ kind: 'character', id: evenTarget.id });
    const hpBeforeEven = await hpOf(evenTarget.id);
    const evenResult = await resolveWithRolls(evenCast.pending.id, 20, [1, 3, 6]);
    const evenSnapshot = evenResult.snapshot!;
    check(
      '84.N) SUCESSO com meia-dano: 10 bruto → 5 após o save → 5 final e PV pelo núcleo',
      evenResult.success &&
        evenSnapshot.rawDamage === 10 &&
        evenSnapshot.damageAfterSave === 5 &&
        evenSnapshot.finalDamage === 5 &&
        (await hpOf(evenTarget.id)) === hpBeforeEven - 5,
      JSON.stringify(evenSnapshot),
    );

    // O — arredondamento ímpar
    const oddTarget = await makeCharacter('Alvo SH ímpar');
    characterIds.push(oddTarget.id);
    const oddCast = await makeCast({ kind: 'character', id: oddTarget.id });
    const oddResult = await resolveWithRolls(oddCast.pending.id, 20, [1, 2, 6]);
    check(
      '84.O) 9 bruto → floor(9/2) = 4 após o save (nunca 4.5 nem 5)',
      oddResult.snapshot?.rawDamage === 9 &&
        oddResult.snapshot?.damageAfterSave === 4 &&
        oddResult.snapshot?.finalDamage === 4,
      JSON.stringify(oddResult.snapshot),
    );

    // P — falha = dano cheio
    const failTarget = await makeCharacter('Alvo SH falha');
    characterIds.push(failTarget.id);
    const failCast = await makeCast({ kind: 'character', id: failTarget.id }, { dc: 20 });
    const failResult = await resolveWithRolls(failCast.pending.id, 5, [3, 3, 3]);
    check(
      '84.P) FALHA não reduz: 9 bruto → 9 após o save → 9 final',
      !failResult.success &&
        failResult.snapshot?.rawDamage === 9 &&
        failResult.snapshot?.damageAfterSave === 9 &&
        failResult.snapshot?.finalDamage === 9,
      JSON.stringify(failResult.snapshot),
    );

    // Q — resistência DEPOIS da metade
    const resistTarget = await makeCharacter('Alvo SH resistente', {
      raceResistances: [SYNTHETIC_SAVE_HALF_DAMAGE_TYPE],
    });
    characterIds.push(resistTarget.id);
    const resistCast = await makeCast({ kind: 'character', id: resistTarget.id });
    const resistResult = await resolveWithRolls(resistCast.pending.id, 20, [5, 5, 5]);
    check(
      '84.Q) resistência depois do save: 15 → 7 → 3 (a ordem inversa daria outro número)',
      resistResult.snapshot?.rawDamage === 15 &&
        resistResult.snapshot?.damageAfterSave === 7 &&
        resistResult.snapshot?.finalDamage === 3 &&
        resistResult.snapshot?.components?.[0]?.modifier === 'resistance',
      JSON.stringify(resistResult.snapshot?.components),
    );

    // R — imunidade: final 0, sem PV, sem Concentração, cast no-effect
    const immune = await prisma.creature.create({
      data: {
        name: 'Elemental SH imune',
        type: 'Elemental',
        hpCurrent: 50,
        hpMax: 50,
        speed: 9,
        dexterity: 10,
        immunities: [SYNTHETIC_SAVE_HALF_DAMAGE_TYPE],
        mechanicalState: {
          concentration: {
            id: 'sh-conc-imune',
            label: 'Prova (imunidade)',
            sourceType: 'manual',
            visibility: 'public',
            startedAt: new Date().toISOString(),
          },
        },
      } as never,
    });
    creatureIds.push(immune.id);
    const immuneCast = await makeCast({ kind: 'creature', id: immune.id });
    const immuneResult = await resolveWithRolls(immuneCast.pending.id, 20, [5, 5, 5]);
    const immuneRow = await prisma.creature.findUniqueOrThrow({ where: { id: immune.id } });
    const immuneConcentration = JSON.stringify(immuneRow.mechanicalState ?? {});
    const immuneCastRow = await prisma.spellCast.findUniqueOrThrow({
      where: { id: immuneCast.cast.id },
    });
    check(
      '84.R) IMUNIDADE: benefício do save não importa — final 0, PV intacto, sem Concentração e cast `no-effect`',
      immuneResult.snapshot?.damageAfterSave === 7 &&
        immuneResult.snapshot?.finalDamage === 0 &&
        immuneRow.hpCurrent === 50 &&
        !immuneConcentration.includes('pendingConcentrationSaves') &&
        immuneCastRow.outcome === 'no-effect',
      JSON.stringify({ snapshot: immuneResult.snapshot, hp: immuneRow.hpCurrent, outcome: immuneCastRow.outcome }),
    );

    // S — vulnerabilidade
    const vulnerable = await prisma.creature.create({
      data: {
        name: 'Elemental SH vulnerável',
        type: 'Elemental',
        hpCurrent: 50,
        hpMax: 50,
        speed: 9,
        dexterity: 10,
        vulnerabilities: [SYNTHETIC_SAVE_HALF_DAMAGE_TYPE],
      } as never,
    });
    creatureIds.push(vulnerable.id);
    const vulnerableCast = await makeCast({ kind: 'creature', id: vulnerable.id });
    const vulnerableResult = await resolveWithRolls(vulnerableCast.pending.id, 20, [5, 5, 5]);
    check(
      '84.S) vulnerabilidade depois do save: 15 → 7 → 14',
      vulnerableResult.snapshot?.damageAfterSave === 7 &&
        vulnerableResult.snapshot?.finalDamage === 14 &&
        vulnerableResult.snapshot?.components?.[0]?.modifier === 'vulnerability',
      JSON.stringify(vulnerableResult.snapshot?.components),
    );

    // T — identidade do evento e snapshot persistido
    const storedEven = await prisma.pendingEffectSave.findUniqueOrThrow({
      where: { id: evenCast.pending.id },
    });
    const storedSnapshot = evenResult.snapshot!;
    check(
      '84.T) eventId DETERMINÍSTICO por ALVO (`spell-cast:<castId>:target:<kind>:<id>:damage`), dano persistido e cast resolvido',
      storedSnapshot.eventId ===
        `spell-cast:${storedEven.spellCastId}:target:${storedEven.targetEntityKind}:${storedEven.targetEntityId}:damage` &&
        JSON.stringify(storedEven.resolutionSnapshot ?? {}).includes('"damageAfterSave":5') &&
        (await prisma.spellCast.findUniqueOrThrow({ where: { id: evenCast.cast.id } })).status ===
          'resolved',
      JSON.stringify(storedSnapshot),
    );
    check(
      '84.U) o snapshot guarda o DESFECHO declarado e os dados rolados por componente',
      storedSnapshot.outcome?.success === 'half' &&
        storedSnapshot.outcome?.failure === 'full' &&
        storedSnapshot.components?.[0]?.rolls?.join(',') === '1,3,6' &&
        storedSnapshot.components[0]?.count === 3,
      JSON.stringify(storedSnapshot.components),
    );

    // =====================================================================
    // V–W — PIPELINE HTTP REAL (dados rolados pelo servidor)
    // =====================================================================
    const httpTarget = await makeCharacter('Alvo SH HTTP', { dexterity: 1 });
    characterIds.push(httpTarget.id);
    // CD 20 com Destreza 1 (-5): o total máximo possível (15) não alcança — a
    // falha é GARANTIDA pela regra, não pela sorte do d20.
    const httpFailCast = await makeCast({ kind: 'character', id: httpTarget.id }, { dc: 20 });
    const httpFailRoll = await request('/dice/roll', masterToken, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: httpFailCast.pending.id,
    });
    const httpFailSnapshot = (
      await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: httpFailCast.pending.id } })
    ).resolutionSnapshot as any;
    check(
      '84.V) HTTP: falha GARANTIDA (CD 20, DES 1) aplica dano CHEIO e o log/roll vem do servidor',
      httpFailRoll.status === 201 &&
        httpFailRoll.data?.roll?.total < 20 &&
        httpFailSnapshot?.success === false &&
        httpFailSnapshot?.damageAfterSave === httpFailSnapshot?.rawDamage &&
        httpFailSnapshot?.rawDamage > 0,
      JSON.stringify({ roll: httpFailRoll.data?.roll, snapshot: httpFailSnapshot }),
    );

    const httpOkTarget = await makeCharacter('Alvo SH HTTP sucesso', { dexterity: 30 });
    characterIds.push(httpOkTarget.id);
    // CD 1 com Destreza 30 (+10): sucesso garantido; o dano é metade.
    const httpOkCast = await makeCast({ kind: 'character', id: httpOkTarget.id }, { dc: 1 });
    const httpOkRoll = await request('/dice/roll', masterToken, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: httpOkCast.pending.id,
    });
    const httpOkSnapshot = (
      await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: httpOkCast.pending.id } })
    ).resolutionSnapshot as any;
    check(
      '84.W) HTTP: SUCESSO também rola dano — `damageAfterSave` é floor(bruto/2) e o cast vira `effect`',
      httpOkRoll.status === 201 &&
        httpOkSnapshot?.success === true &&
        httpOkSnapshot?.damageAfterSave === Math.floor(httpOkSnapshot?.rawDamage / 2) &&
        httpOkSnapshot?.finalDamage === httpOkSnapshot?.damageAfterSave &&
        (await prisma.spellCast.findUniqueOrThrow({ where: { id: httpOkCast.cast.id } })).outcome ===
          'effect',
      JSON.stringify(httpOkSnapshot),
    );

    // =====================================================================
    // X — RESOLUTION CARD genérico + ESQUIVA no save de Destreza
    // =====================================================================
    const combatTarget = await makeCharacter('Alvo SH combate', {}, targetOwner);
    const combat = await prisma.combat.create({
      data: {
        status: 'ACTIVE',
        currentIndex: 0,
        round: 1,
        turnSequence: 1,
        combatants: {
          create: [
            {
              kind: 'CHARACTER',
              characterId: combatTarget.id,
              ownerUserId: targetOwner.id,
              name: combatTarget.name,
              initiative: 20,
              initiativeRoll: 20,
              dexterityMod: 0,
            },
          ],
        },
      },
      include: { combatants: true },
    });
    combatIds.push(combat.id);
    const cardCast = await makeCast({ kind: 'character', id: combatTarget.id }, { dc: 12 });
    const card = await request(`/combat/${combat.id}/resolution-requests`, targetToken);
    const savingCard = (card.data?.requests ?? []).find(
      (item: any) => item.kind === 'spell-saving-throw',
    );
    check(
      '84.X) o RESOLUTION CARD continua genérico: deriva da pendência, sem saber \"success = metade\"',
      card.status === 200 &&
        savingCard?.reference?.pendingId === cardCast.pending.id &&
        savingCard?.ability === 'dexterity' &&
        !('dc' in (savingCard ?? {})) &&
        !('outcome' in (savingCard ?? {})),
      JSON.stringify(savingCard),
    );
    const combatant = combat.combatants[0]!;
    await prisma.combatant.update({
      where: { id: combatant.id },
      data: { turnEconomy: { dodging: true } as never },
    });
    const dodgeRoll = await request('/dice/roll', masterToken, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: cardCast.pending.id,
    });
    check(
      '84.Y) Esquiva do alvo concede VANTAGEM no save de Destreza (mesma engine, sem hardcode)',
      dodgeRoll.status === 201 &&
        dodgeRoll.data?.roll?.advantage === true &&
        dodgeRoll.data?.roll?.dice?.length === 2,
      JSON.stringify(dodgeRoll.data?.roll),
    );

    // =====================================================================
    // Z–AB — BLESS, PARALISIA e NAT 1/20
    // =====================================================================
    const blessedTarget = await makeCharacter('Alvo SH abençoado');
    characterIds.push(blessedTarget.id);
    const blessEffect = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'spell.bless',
        label: BLESS_LABEL,
        sourceType: 'spell',
        sourceId: 'bless',
        sourceEntityKind: 'character',
        sourceEntityId: caster.id,
        sourceLabel: caster.name,
        modifiers: blessModifiers() as never,
        conditions: [] as never,
        targetEntityKind: 'character',
        targetEntityId: blessedTarget.id,
        visibility: 'public',
        status: 'active',
      },
    });
    effectIds.push(blessEffect.id);
    const blessCast = await makeCast({ kind: 'character', id: blessedTarget.id }, { dc: 12 });
    const blessRoll = await request('/dice/roll', masterToken, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: blessCast.pending.id,
      selectedEffectModifiers: [`${blessEffect.id}:save`],
    });
    const blessSnapshot = (
      await prisma.pendingEffectSave.findUniqueOrThrow({ where: { id: blessCast.pending.id } })
    ).resolutionSnapshot as any;
    const blessDice = (blessRoll.data?.roll?.effectModifiers?.dice ?? []) as any[];
    check(
      '84.Z) Bless (+1d4 opcional) entra no SAVE e o desfecho segue o TOTAL: sucesso → metade, falha → cheio',
      blessRoll.status === 201 &&
        blessDice.length === 1 &&
        blessDice[0]?.sides === 4 &&
        blessSnapshot?.damageAfterSave ===
          (blessSnapshot?.success
            ? Math.floor(blessSnapshot?.rawDamage / 2)
            : blessSnapshot?.rawDamage),
      JSON.stringify({ roll: blessRoll.data?.roll, snapshot: blessSnapshot }),
    );

    const paralyzedTarget = await makeCharacter('Alvo SH paralisado', {
      mechanicalState: {
        conditions: [
          {
            id: 'sh-paralyzed',
            condition: 'paralyzed',
            sourceType: 'manual',
            sourceLabel: 'Smoke',
            appliedAt: new Date().toISOString(),
          },
        ],
      },
    });
    characterIds.push(paralyzedTarget.id);
    const paralyzedCast = await makeCast({ kind: 'character', id: paralyzedTarget.id }, { dc: 5 });
    const paralyzedRoll = await request('/dice/roll', masterToken, {
      kind: 'save',
      dice: [{ sides: 20 }],
      pendingEffectSaveId: paralyzedCast.pending.id,
    });
    const paralyzedSnapshot = (
      await prisma.pendingEffectSave.findUniqueOrThrow({
        where: { id: paralyzedCast.pending.id },
      })
    ).resolutionSnapshot as any;
    check(
      '84.AA) Paralisado auto-falha o save de Destreza (motor existente) → dano CHEIO, sem dado',
      paralyzedRoll.status === 201 &&
        paralyzedRoll.data?.roll?.autoFail === true &&
        paralyzedSnapshot?.success === false &&
        paralyzedSnapshot?.damageAfterSave === paralyzedSnapshot?.rawDamage,
      JSON.stringify({ roll: paralyzedRoll.data?.roll, snapshot: paralyzedSnapshot }),
    );

    const natTarget = await makeCharacter('Alvo SH nat');
    characterIds.push(natTarget.id);
    const nat20Cast = await makeCast({ kind: 'character', id: natTarget.id }, { dc: 21 });
    const nat20Result = await resolveWithRolls(nat20Cast.pending.id, 20, [2, 2, 2]);
    const nat1Cast = await makeCast({ kind: 'character', id: natTarget.id }, { dc: 1 });
    const nat1Result = await resolveWithRolls(nat1Cast.pending.id, 1, [2, 2, 2]);
    check(
      '84.AB) nat 20 NÃO é sucesso automático e nat 1 NÃO é falha automática em Saving Throw',
      !nat20Result.success && nat1Result.success,
      JSON.stringify({ nat20: nat20Result.success, nat1: nat1Result.success }),
    );

    // =====================================================================
    // AC–AF — CONCENTRAÇÃO (dano FINAL), 0 PV, RETRY e CONCORRÊNCIA
    // =====================================================================
    const concentrationTarget = await makeCharacter('Alvo SH concentrando', {
      mechanicalState: {
        concentration: {
          id: 'sh-conc',
          label: 'Prova',
          sourceType: 'manual',
          visibility: 'public',
          startedAt: new Date().toISOString(),
        },
      },
    });
    characterIds.push(concentrationTarget.id);
    const concentrationCast = await makeCast({ kind: 'character', id: concentrationTarget.id });
    const concentrationResult = await resolveWithRolls(concentrationCast.pending.id, 20, [5, 5, 5]);
    const concentrationState = (
      await prisma.character.findUniqueOrThrow({ where: { id: concentrationTarget.id } })
    ).mechanicalState as any;
    const concentrationSaves = concentrationState?.pendingConcentrationSaves ?? [];
    check(
      '84.AC) Concentração usa o dano FINAL (15 → 7; CD max(10, floor(7/2)) = 10), nunca o bruto',
      concentrationResult.snapshot?.finalDamage === 7 &&
        concentrationSaves.length === 1 &&
        concentrationSaves[0]?.dc === Math.max(10, Math.floor(7 / 2)) &&
        concentrationSaves[0]?.eventId ===
          `spell-cast:${concentrationCast.cast.id}:target:character:${concentrationTarget.id}:damage`,
      JSON.stringify(concentrationSaves),
    );

    const dyingTarget = await makeCharacter('Alvo SH 0 PV', { hpCurrent: 2, hpMax: 30 });
    characterIds.push(dyingTarget.id);
    const dyingCast = await makeCast({ kind: 'character', id: dyingTarget.id }, { dc: 20 });
    await resolveWithRolls(dyingCast.pending.id, 1, [3, 3, 3]);
    const dyingRow = await prisma.character.findUniqueOrThrow({ where: { id: dyingTarget.id } });
    check(
      '84.AD) meia-dano/cheio que leva a 0 PV usa o lifecycle de morte existente (nenhuma regra paralela)',
      dyingRow.hpCurrent === 0 &&
        (dyingRow.deathState as any)?.deathSaves === true,
      JSON.stringify({ hp: dyingRow.hpCurrent, death: dyingRow.deathState }),
    );

    const retryTarget = await makeCharacter('Alvo SH retry');
    characterIds.push(retryTarget.id);
    const retryCast = await makeCast({ kind: 'character', id: retryTarget.id });
    const firstRetry = await resolveWithRolls(retryCast.pending.id, 20, [4, 4, 4]);
    const hpAfterFirst = await hpOf(retryTarget.id);
    const secondRetry = await resolveWithRolls(retryCast.pending.id, 20, [4, 4, 4]);
    check(
      '84.AE) retry devolve o snapshot salvo (`replayed`), NÃO rerola e NÃO aplica PV de novo',
      firstRetry.replayed === false &&
        secondRetry.replayed === true &&
        secondRetry.snapshot?.rawDamage === firstRetry.snapshot?.rawDamage &&
        (await hpOf(retryTarget.id)) === hpAfterFirst,
      JSON.stringify({ first: firstRetry.snapshot?.rawDamage, second: secondRetry.snapshot?.rawDamage }),
    );

    const raceTarget = await makeCharacter('Alvo SH corrida');
    characterIds.push(raceTarget.id);
    const raceCast = await makeCast({ kind: 'character', id: raceTarget.id });
    const raceBefore = await hpOf(raceTarget.id);
    const [raceA, raceB] = await Promise.all([
      resolveWithRolls(raceCast.pending.id, 20, [5, 5, 5]),
      resolveWithRolls(raceCast.pending.id, 20, [5, 5, 5]),
    ]);
    check(
      '84.AF) duas resoluções CONCORRENTES: uma vence, a outra recebe replay e o PV muda UMA vez',
      [raceA.replayed, raceB.replayed].filter(Boolean).length === 1 &&
        raceBefore - (await hpOf(raceTarget.id)) === 7,
      JSON.stringify({ a: raceA.replayed, b: raceB.replayed, hp: await hpOf(raceTarget.id) }),
    );

    // =====================================================================
    // AG–AI — NENHUM EFEITO DURÁVEL, NENHUMA SPELL REAL
    // =====================================================================
    const effectsFromSmoke = await prisma.effectInstance.count({
      where: { targetEntityId: { in: characterIds }, definitionId: { not: 'spell.bless' } },
    });
    check(
      '84.AG) nenhuma conjuração instantânea criou EffectInstance (só o Bless da prova existe)',
      effectsFromSmoke === 0,
      String(effectsFromSmoke),
    );
    const pendingGroups = await prisma.pendingEffectSave.count({
      where: { id: { in: pendingIds }, groupId: { not: null } },
    });
    check(
      '84.AH) nenhuma pendência de dano ganhou Effect Group/duração (sem Concentração do caster)',
      pendingGroups === 0 &&
        (await prisma.spellCast.count({
          where: { id: { in: castIds }, requiresConcentration: true },
        })) === 0,
      String(pendingGroups),
    );
    check(
      '84.AI) nenhuma magia PHB nova foi registrada para a prova',
      ['fireball', 'burning-hands', 'thunderwave', 'sacred-flame'].every(
        (id) => id !== SYNTHETIC_SAVE_HALF_SPELL_ID,
      ) &&
        spellExecutionDefinition(SYNTHETIC_SAVE_HALF_SPELL_ID) !== null &&
        !allSpells().some((spell) => spell.id === SYNTHETIC_SAVE_HALF_SPELL_ID),
      String(SYNTHETIC_SAVE_HALF_SPELL_ID),
    );
    void syntheticResolution;
    void masterToken;
  } finally {
    // Cleanup SOMENTE do que esta execução criou (mesma política do 6.6I.4).
    try {
      if (pendingIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { id: { in: pendingIds } } });
      }
      if (castIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
        await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
      }
      if (effectIds.length > 0) {
        await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
      }
      if (combatIds.length > 0) {
        await prisma.combatOperation.deleteMany({ where: { combatId: { in: combatIds } } });
        await prisma.combat.deleteMany({ where: { id: { in: combatIds } } });
      }
      if (creatureIds.length > 0) {
        await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      }
      if (characterIds.length > 0) {
        await prisma.effectInstance.deleteMany({
          where: { OR: [{ targetEntityId: { in: characterIds } }, { sourceEntityId: { in: characterIds } }] },
        });
        await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } catch (error) {
      console.error('[smoke-save-half-damage] falha na limpeza:', error);
    }
  }
}
