import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import { grantCastingComponents, pickCastingResource, seedSpellRepertoire } from './spell-slot-fixtures.js';
import {
  consumeSpellComponents,
  resolveSpellComponents,
} from '../modules/spells/execution/spell-components.service.js';
import { spellComponentRequirement } from '../modules/shared/spells/components.js';
import { getSpell } from '../modules/shared/spells/index.js';
import type { Spell } from '../modules/shared/spells/types.js';
import type { SpellcastingSource } from '../modules/spells/execution/spellcasting-source.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

const EVIDENCE = { withinRange: true, sight: true, clearPath: true, groupDistance: true };

let gearCounter = 0;
function gearItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  gearCounter += 1;
  return {
    id: `cmp-gear-${gearCounter}`,
    name: 'Item de prova',
    description: '',
    quantity: 1,
    weight: 0,
    slot: null,
    backpackX: null,
    backpackY: null,
    imageUrl: '',
    itemId: '',
    category: 'Item Geral',
    rarity: null,
    requiresAttunement: false,
    attuned: false,
    details: {},
    campSupply: { enabled: false, value: 0 },
    ...overrides,
  };
}

const pouch = () => gearItem({ name: 'Bolsa de Componentes', details: { componentPouch: true } });
const holySymbol = (slot: string | null = 'hand1', extras: Record<string, unknown> = {}) =>
  gearItem({ name: 'Símbolo Sagrado', slot, details: { spellFocusKinds: ['holy-symbol'], ...extras } });
const arcaneFocus = (slot: string | null = 'hand1') =>
  gearItem({ name: 'Foco Arcano', slot, details: { spellFocusKinds: ['arcane'] } });
const weapon = (slot: string | null = 'hand2', extras: Record<string, unknown> = {}) =>
  gearItem({ name: 'Espada Longa', slot, category: 'Arma', details: { properties: [], ...extras } });
const shield = (extras: Record<string, unknown> = {}) =>
  gearItem({ name: 'Escudo', slot: 'hand2', category: 'Escudo', details: extras });

/** Magia SINTÉTICA só para o domínio (nunca registrada no catálogo público). */
function syntheticSpell(input: {
  id: string;
  verbal: boolean;
  somatic: boolean;
  material: null | { key: string | null; costGp?: number; consumed?: boolean };
}): Spell {
  const base = getSpell('bless')!;
  return {
    ...base,
    id: input.id,
    namePt: input.id,
    nameEn: input.id,
    level: 1,
    components: {
      verbal: input.verbal,
      somatic: input.somatic,
      material: input.material !== null,
    },
    ...(input.material
      ? {
          material: {
            text: 'material sintético de prova',
            ...(input.material.key ? { componentKey: input.material.key } : {}),
            ...(input.material.costGp !== undefined ? { costGp: input.material.costGp } : {}),
            ...(input.material.consumed ? { consumed: true } : {}),
          },
        }
      : { material: undefined }),
  };
}

/**
 * FASE 6.6G — COMPONENTES V/S/M e restrições de conjuração.
 *
 * Prova que a conjuração é recusada ANTES de qualquer custo quando o conjurador
 * não consegue fornecer os componentes, e que:
 *  • o tipo de FOCO vem da fonte (Clérigo = símbolo sagrado; Mago = arcano);
 *  • bolsa de componentes substitui material comum, nunca material com custo ou
 *    consumido (definições SINTÉTICAS, fora do catálogo público);
 *  • S + M usa a MESMA mão do foco/material, mas S sem M não ganha essa mão;
 *  • arma de duas mãos não prende as duas mãos; duas armas prendem;
 *  • símbolo sagrado apenas vestido satisfaz M e NÃO cria mão para S;
 *  • bloqueio genérico de componente vale pela mecânica, sem vazar segredo;
 *  • material consumido é debitado UMA vez, no COMMIT, com guarda de versão.
 */
export async function smokeSpellComponents(baseUrl: string, check: Check): Promise<void> {
  console.log('\n77) Fase 6.6G — componentes V/S/M e restrições de conjuração');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const effectIds: string[] = [];

  try {
    const master = await prisma.user.create({
      data: { username: `cmp_m_${suffix}`, displayName: 'Mestre CMP', passwordHash: 'fixture', role: 'MASTER' },
    });
    const owner = await prisma.user.create({
      data: { username: `cmp_o_${suffix}`, displayName: 'Dono CMP', passwordHash: 'fixture', role: 'PLAYER' },
    });
    // 1 usuário ↔ 1 ficha (`Character.userId` é único): o Mago tem conta própria.
    const wizardOwner = await prisma.user.create({
      data: { username: `cmp_w_${suffix}`, displayName: 'Mago Dono CMP', passwordHash: 'fixture', role: 'PLAYER' },
    });
    userIds.push(master.id, owner.id, wizardOwner.id);
    const token = (user: { id: string; username: string; displayName: string; role: 'MASTER' | 'PLAYER' }) =>
      signToken({ sub: user.id, username: user.username, displayName: user.displayName, role: user.role });
    const masterToken = token(master);
    const ownerToken = token(owner);

    const cleric = await prisma.character.create({
      data: {
        userId: owner.id,
        name: 'Clérigo CMP',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 16,
        constitution: 30,
        classes: [{ classKey: 'cleric', subclass: '', level: 5 }],
      },
    });
    const wizard = await prisma.character.create({
      data: {
        userId: wizardOwner.id,
        name: 'Mago CMP',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        intelligence: 16,
        constitution: 30,
        classes: [{ classKey: 'wizard', subclass: '', level: 5 }],
      },
    });
    characterIds.push(cleric.id, wizard.id);

    await seedSpellRepertoire({ characterId: cleric.id, classKey: 'cleric', spellIds: ['bless'] });
    await seedSpellRepertoire({ characterId: wizard.id, classKey: 'wizard', spellIds: ['hold-person'] });

    const request = async (
      path: string,
      body: unknown,
      authToken = masterToken,
      method?: 'GET' | 'POST',
    ) => {
      const verb = method ?? (body === undefined ? 'GET' : 'POST');
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: verb,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    };

    const setInventory = async (characterId: string, inventory: unknown[]) => {
      await prisma.character.update({
        where: { id: characterId },
        data: { inventory: inventory as never },
      });
    };
    const reload = (characterId: string) =>
      prisma.character.findUniqueOrThrow({ where: { id: characterId } });

    const blessCast = async (characterId: string) => {
      const resource = await pickCastingResource(baseUrl, masterToken, { kind: 'character', id: characterId }, 1);
      const body: Record<string, unknown> = {
        operationId: randomUUID(),
        spellId: 'bless',
        caster: { kind: 'character', id: characterId },
        targets: [{ kind: 'character', id: cleric.id }],
        spatialConfirmation: EVIDENCE,
      };
      if (resource) body.castingResource = resource;
      return request('/spells/cast', body, masterToken);
    };
    const holdPersonCast = async (characterId: string) => {
      const resource = await pickCastingResource(baseUrl, masterToken, { kind: 'character', id: characterId }, 2);
      const body: Record<string, unknown> = {
        operationId: randomUUID(),
        spellId: 'hold-person',
        caster: { kind: 'character', id: characterId },
        targets: [{ kind: 'character', id: cleric.id }],
        spatialConfirmation: EVIDENCE,
      };
      if (resource) body.castingResource = resource;
      return request('/spells/cast', body, masterToken);
    };

    // =====================================================================
    // A) Componentes vêm do CATÁLOGO (sem parser de "V, S, M (...)")
    // =====================================================================
    const blessRequirement = spellComponentRequirement(getSpell('bless')!);
    const holdRequirement = spellComponentRequirement(getSpell('hold-person')!);
    check(
      '77.A) Bless exige V, S e material comum (sem custo e sem consumo)',
      blessRequirement.verbal &&
        blessRequirement.somatic &&
        blessRequirement.material?.[0]?.key === 'holy-water' &&
        blessRequirement.material[0]?.minimumValueGp === null &&
        blessRequirement.material[0]?.consumed === false,
      JSON.stringify(blessRequirement),
    );
    check(
      '77.B) Hold Person exige V, S e o pedaço reto de ferro (chave estável)',
      holdRequirement.material?.[0]?.key === 'straight-iron-piece',
      JSON.stringify(holdRequirement),
    );

    // =====================================================================
    // B) Clérigo: sem bolsa/foco/material → recusado ANTES do commit
    // =====================================================================
    await setInventory(cleric.id, []);
    const beforeSlots = JSON.stringify((await reload(cleric.id)).spells);
    const missing = await blessCast(cleric.id);
    const afterMissing = await reload(cleric.id);
    check(
      '77.C) sem bolsa, foco ou material o cast é recusado antes do COMMIT',
      missing.status === 409 && missing.data?.error === 'SPELL_COMPONENT_MATERIAL_MISSING',
      JSON.stringify({ status: missing.status, data: missing.data }),
    );
    check(
      '77.D) a recusa não gastou espaço nem criou SpellCast',
      JSON.stringify(afterMissing.spells) === beforeSlots &&
        (await prisma.spellCast.count({ where: { casterEntityId: cleric.id } })) === 0,
      JSON.stringify({ slots: afterMissing.spells }),
    );

    // Bolsa de componentes: material comum é substituível.
    await setInventory(cleric.id, [pouch(), weapon()]);
    const withPouch = await blessCast(cleric.id);
    check(
      '77.E) bolsa de componentes + mão livre permite Bless (V,S,M)',
      withPouch.status === 201 &&
        withPouch.data?.cast?.components?.providerKind === 'component-pouch' &&
        withPouch.data?.cast?.components?.somaticHand === 'free',
      JSON.stringify({ status: withPouch.status, cast: withPouch.data?.cast }),
    );
    check(
      '77.F) o snapshot registra V/S/M exigidos e que nada foi consumido',
      withPouch.data?.cast?.components?.verbal === true &&
        withPouch.data?.cast?.components?.somatic === true &&
        withPouch.data?.cast?.components?.material === true &&
        withPouch.data?.cast?.components?.consumed === false,
      JSON.stringify(withPouch.data?.cast?.components),
    );

    // Foco INCOMPATÍVEL com a fonte: foco arcano não é símbolo sagrado.
    await setInventory(cleric.id, [arcaneFocus('hand1'), weapon('hand2')]);
    const wrongFocus = await blessCast(cleric.id);
    check(
      '77.G) foco arcano NÃO substitui material de magia de Clérigo',
      wrongFocus.status === 409 &&
        ['SPELL_COMPONENT_MATERIAL_MISSING', 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE'].includes(
          wrongFocus.data?.error,
        ),
      JSON.stringify({ status: wrongFocus.status, data: wrongFocus.data }),
    );

    // Símbolo sagrado segurado: foco compatível.
    await setInventory(cleric.id, [holySymbol('hand1'), weapon('hand2')]);
    const withSymbol = await blessCast(cleric.id);
    check(
      '77.H) símbolo sagrado segurado + arma na outra mão permite V,S,M (mesma mão para S e M)',
      withSymbol.status === 201 &&
        withSymbol.data?.cast?.components?.providerKind === 'focus' &&
        withSymbol.data?.cast?.components?.somaticHand === 'material',
      JSON.stringify({ status: withSymbol.status, components: withSymbol.data?.cast?.components }),
    );

    // Escudo que É símbolo sagrado (Cleric/Paladin).
    await setInventory(cleric.id, [weapon('hand1'), shield({ spellFocusKinds: ['holy-symbol'] })]);
    const shieldSymbol = await blessCast(cleric.id);
    check(
      '77.I) escudo-símbolo sagrado fornece S+M com arma na outra mão',
      shieldSymbol.status === 201 && shieldSymbol.data?.cast?.components?.providerKind === 'focus',
      JSON.stringify({ status: shieldSymbol.status, data: shieldSymbol.data }),
    );

    // Símbolo apenas VESTIDO + escudo comum + arma → M ok, S sem mão.
    await setInventory(cleric.id, [
      weapon('hand1'),
      shield(),
      holySymbol('necklace', { wornVisible: true }),
    ]);
    const wornSymbol = await blessCast(cleric.id);
    check(
      '77.J) símbolo sagrado apenas vestido satisfaz M, mas não cria mão para S',
      wornSymbol.status === 409 && wornSymbol.data?.error === 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE',
      JSON.stringify({ status: wornSymbol.status, data: wornSymbol.data }),
    );

    // =====================================================================
    // C) Mãos: duas armas prendem as mãos; arma de duas mãos não prende
    // =====================================================================
    const source: SpellcastingSource = { kind: 'class', id: 'cleric', label: 'Clérigo', ability: 'wisdom' };
    const clericEntity = { kind: 'character' as const, id: cleric.id };
    const planFor = async (spell: Spell) =>
      resolveSpellComponents({ db: prisma, spell, source, entity: clericEntity });

    await setInventory(cleric.id, [weapon('hand1'), weapon('hand2'), pouch()]);
    const dualWield = await planFor(getSpell('bless')!);
    check(
      '77.K) duas armas (sem mão livre) bloqueiam bolsa de componentes',
      dualWield.castableNow === false &&
        dualWield.freeHands === 0 &&
        dualWield.errors.some((error) => error.code === 'SPELL_COMPONENT_MATERIAL_MISSING'),
      JSON.stringify({ freeHands: dualWield.freeHands, errors: dualWield.errors }),
    );

    await setInventory(cleric.id, [
      gearItem({ name: 'Montante', slot: 'hand1', category: 'Arma', details: { properties: ['two-handed'] } }),
      holySymbol('hand2'),
    ]);
    const twoHanded = await planFor(getSpell('bless')!);
    check(
      '77.L) arma de duas mãos + foco na outra mão continua permitindo V,S,M',
      twoHanded.castableNow === true && twoHanded.somatic.hand === 'material',
      JSON.stringify(twoHanded),
    );

    const somaticOnly = syntheticSpell({ id: 'synthetic-somatic', verbal: true, somatic: true, material: null });
    const focusPlusWeapon = await planFor(somaticOnly);
    check(
      '77.M) S SEM M não usa a mão do foco como mão livre',
      focusPlusWeapon.castableNow === false &&
        focusPlusWeapon.errors[0]?.code === 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE',
      JSON.stringify(focusPlusWeapon.errors),
    );

    await setInventory(cleric.id, [
      weapon('hand1'),
      holySymbol('hand2'),
    ]);
    const sameHand = await planFor(getSpell('bless')!);
    check(
      '77.N) S + M usa a MESMA mão do foco (sem exigir duas mãos)',
      sameHand.castableNow === true && sameHand.somatic.hand === 'material',
      JSON.stringify(sameHand),
    );

    // =====================================================================
    // D) Mago: foco arcano é a autoridade; símbolo sagrado não substitui
    // =====================================================================
    await setInventory(wizard.id, []);
    const wizardMissing = await holdPersonCast(wizard.id);
    check(
      '77.O) Mago sem foco/bolsa não conjura Hold Person',
      wizardMissing.status === 409 && wizardMissing.data?.error === 'SPELL_COMPONENT_MATERIAL_MISSING',
      JSON.stringify({ status: wizardMissing.status, data: wizardMissing.data }),
    );

    await setInventory(wizard.id, [holySymbol('hand1')]);
    const wizardSymbol = await holdPersonCast(wizard.id);
    check(
      '77.P) símbolo sagrado NÃO é foco arcano do Mago',
      wizardSymbol.status === 409 && wizardSymbol.data?.error === 'SPELL_COMPONENT_MATERIAL_MISSING',
      JSON.stringify({ status: wizardSymbol.status, data: wizardSymbol.data }),
    );

    await setInventory(wizard.id, [arcaneFocus('hand1')]);
    const wizardFocus = await holdPersonCast(wizard.id);
    check(
      '77.Q) foco arcano + mão do foco permite Hold Person (V,S,M)',
      wizardFocus.status === 201 && wizardFocus.data?.cast?.components?.providerKind === 'focus',
      JSON.stringify({ status: wizardFocus.status, data: wizardFocus.data }),
    );

    // =====================================================================
    // E) Bloqueio genérico de componente (hook de Silêncio), sem vazar segredo
    // =====================================================================
    await setInventory(cleric.id, [pouch()]);
    const secret = await prisma.effectInstance.create({
      data: {
        groupId: randomUUID(),
        definitionId: 'fixture.component-block',
        label: 'Silêncio Secreto do Mestre',
        sourceType: 'manual',
        sourceLabel: 'Mestre',
        modifiers: [{ kind: 'spell-component-block', components: ['verbal'] }] as never,
        conditions: [] as never,
        targetEntityKind: 'character',
        targetEntityId: cleric.id,
        visibility: 'private',
        status: 'active',
        createdBy: master.id,
      },
    });
    effectIds.push(secret.id);

    const blockedVerbal = await blessCast(cleric.id);
    check(
      '77.R) bloqueio de componente recusa a conjuração antes do COMMIT',
      blockedVerbal.status === 409 && blockedVerbal.data?.error === 'SPELL_VERBAL_COMPONENT_UNAVAILABLE',
      JSON.stringify({ status: blockedVerbal.status, data: blockedVerbal.data }),
    );
    check(
      '77.S) a resposta não revela o Efeito privado que causou o bloqueio',
      !JSON.stringify(blockedVerbal.data).includes('Silêncio Secreto'),
      JSON.stringify(blockedVerbal.data),
    );

    const noVerbal = syntheticSpell({ id: 'synthetic-no-verbal', verbal: false, somatic: true, material: null });
    const noVerbalPlan = await planFor(noVerbal);
    check(
      '77.T) bloqueio verbal não afeta magia sem componente verbal',
      noVerbalPlan.verbal.required === false && noVerbalPlan.verbal.available === true,
      JSON.stringify(noVerbalPlan.verbal),
    );

    const mutated = await prisma.character.findUniqueOrThrow({ where: { id: cleric.id } });
    check(
      '77.U) o bloqueio também não gastou espaço',
      mutated.version > 0 && (await prisma.spellCast.count({ where: { casterEntityId: cleric.id, status: 'resolving' } })) === 0,
      JSON.stringify({ version: mutated.version }),
    );
    await prisma.effectInstance.delete({ where: { id: secret.id } });

    // =====================================================================
    // F) Material com CUSTO e CONSUMIDO (definições sintéticas de domínio)
    // =====================================================================
    const costly = syntheticSpell({
      id: 'synthetic-costly',
      verbal: true,
      somatic: true,
      material: { key: 'diamond', costGp: 100 },
    });
    await setInventory(cleric.id, [pouch(), arcaneFocus('hand1'), holySymbol('hand2')]);
    const costlyWithout = await planFor(costly);
    check(
      '77.V) material com custo NÃO é substituído por foco nem bolsa',
      costlyWithout.castableNow === false &&
        costlyWithout.errors.some(
          (error) => error.code === 'SPELL_COMPONENT_MATERIAL_MISSING',
        ),
      JSON.stringify(costlyWithout.errors),
    );

    await setInventory(cleric.id, [
      gearItem({ name: 'Diamante barato', details: { spellComponentKeys: ['diamond'], componentValueGp: 50 } }),
      pouch(),
    ]);
    const costlyCheap = await planFor(costly);
    check(
      '77.W) material presente com valor INSUFICIENTE é recusado',
      costlyCheap.castableNow === false &&
        costlyCheap.errors[0]?.code === 'SPELL_COMPONENT_MATERIAL_VALUE_INSUFFICIENT',
      JSON.stringify(costlyCheap.errors),
    );

    await setInventory(cleric.id, [
      gearItem({ name: 'Diamante', details: { spellComponentKeys: ['diamond'], componentValueGp: 100 } }),
      pouch(),
    ]);
    const costlyOk = await planFor(costly);
    check(
      '77.X) material específico com valor suficiente satisfaz a exigência (e não é consumido)',
      costlyOk.castableNow === true &&
        costlyOk.material.providerKind === 'specific-material' &&
        costlyOk.consumptions.length === 0,
      JSON.stringify(costlyOk.material),
    );

    const consumed = syntheticSpell({
      id: 'synthetic-consumed',
      verbal: true,
      somatic: true,
      material: { key: 'pearl', consumed: true },
    });
    await setInventory(cleric.id, [pouch(), holySymbol('hand1')]);
    const consumedWithout = await planFor(consumed);
    check(
      '77.Y) material CONSUMIDO não é substituído por foco nem bolsa',
      consumedWithout.castableNow === false &&
        consumedWithout.errors[0]?.code === 'SPELL_COMPONENT_MATERIAL_MISSING',
      JSON.stringify(consumedWithout.errors),
    );

    await setInventory(cleric.id, [
      gearItem({ name: 'Pérola', quantity: 2, details: { spellComponentKeys: ['pearl'] } }),
    ]);
    const consumedPlan = await planFor(consumed);
    check(
      '77.Z) material consumido presente é aceito e planeja UMA unidade',
      consumedPlan.castableNow === true &&
        consumedPlan.consumptions.length === 1 &&
        consumedPlan.consumptions[0]?.quantity === 1,
      JSON.stringify(consumedPlan.consumptions),
    );

    const consumedEntity = { kind: 'character' as const, id: cleric.id };
    await prisma.$transaction(async (db) => {
      await consumeSpellComponents(consumedPlan, consumedEntity, db);
    });
    let afterConsume = await reload(cleric.id);
    let pearls = (afterConsume.inventory as any[]).find((item) => item.name === 'Pérola');
    check(
      '77.AA) o COMMIT debita o material consumido (2 → 1)',
      pearls?.quantity === 1,
      JSON.stringify(afterConsume.inventory),
    );

    // Segunda unidade: mais uma conjuração consome a última sem ficar negativa.
    await prisma.$transaction(async (db) => {
      await consumeSpellComponents(consumedPlan, consumedEntity, db);
    });
    afterConsume = await reload(cleric.id);
    const afterSecond = (afterConsume.inventory as any[]).find((item) => item.name === 'Pérola');
    let thirdConsumeStatus = 0;
    try {
      await prisma.$transaction(async (db) => {
        await consumeSpellComponents(consumedPlan, consumedEntity, db);
      });
    } catch (error) {
      thirdConsumeStatus = (error as { status?: number }).status ?? 0;
    }
    afterConsume = await reload(cleric.id);
    pearls = (afterConsume.inventory as any[]).find((item) => item.name === 'Pérola');
    check(
      '77.AB) consumo repetido nunca deixa quantidade negativa e, sem material, o cast é recusado',
      afterSecond === undefined && thirdConsumeStatus === 409 && pearls === undefined,
      JSON.stringify({ thirdConsumeStatus, inventory: afterConsume.inventory }),
    );

    // =====================================================================
    // G) cast-options expõe o resumo e a UI não é autoridade
    // =====================================================================
    await grantCastingComponents({ characters: [cleric.id] });
    const options = await request(`/spells/cast-options/${cleric.id}/bless`, undefined, ownerToken);
    check(
      '77.AC) cast-options traz o resumo V/S/M derivado do servidor',
      options.status === 200 &&
        options.data?.components?.verbal?.required === true &&
        options.data?.components?.material?.available === true &&
        options.data?.components?.castableNow === true,
      JSON.stringify(options.data?.components),
    );
    const strippedResource = await pickCastingResource(
      baseUrl,
      masterToken,
      { kind: 'character', id: cleric.id },
      1,
    );
    const strippedClientFields = await request(
      '/spells/cast',
      {
        operationId: randomUUID(),
        spellId: 'bless',
        caster: { kind: 'character', id: cleric.id },
        targets: [{ kind: 'character', id: wizard.id }],
        spatialConfirmation: EVIDENCE,
        ...(strippedResource ? { castingResource: strippedResource } : {}),
        hasFocus: true,
        freeHand: true,
        verbalOk: true,
      },
      masterToken,
    );
    check(
      '77.AD) campos de componente do cliente são RECUSADOS — o plano é sempre do servidor',
      strippedClientFields.status === 400 &&
        strippedClientFields.data?.error === 'VALIDATION_ERROR',
      JSON.stringify({ status: strippedClientFields.status, data: strippedClientFields.data }),
    );
  } finally {
    if (effectIds.length > 0) {
      await prisma.effectInstance.deleteMany({ where: { id: { in: effectIds } } });
    }
    if (characterIds.length > 0) {
      await prisma.spellCast.deleteMany({ where: { casterEntityId: { in: characterIds } } });
      await prisma.pendingEffectSave.deleteMany({
        where: { casterEntityId: { in: characterIds } },
      });
      await prisma.effectInstance.deleteMany({
        where: {
          OR: [
            { targetEntityId: { in: characterIds } },
            { sourceEntityId: { in: characterIds } },
          ],
        },
      });
      await prisma.spellCastIntent.deleteMany({ where: { casterEntityId: { in: characterIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    }
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
