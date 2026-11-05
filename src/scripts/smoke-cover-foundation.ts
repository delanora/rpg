import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';
import {
  applyCoverConfirmation,
  coverAcBonus,
  coverDexSaveBonus,
  coverSaveBonusFor,
  coverSnapshotOf,
  highestCoverLevel,
  knownCover,
  type CoverEvaluation,
} from '../modules/combat/cover.js';
import { assistedCoverProvider, coverFor } from '../modules/combat/cover.service.js';
import {
  grantCastingComponents,
  resetCastingSlots,
  seedSpellRepertoire,
  withSpatialEvidence,
} from './spell-slot-fixtures.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

interface HttpResult {
  status: number;
  data: Record<string, unknown> & {
    cast?: { id: string };
    pendingId?: string | null;
    pendingIds?: string[];
    error?: string;
  };
}

/**
 * FASE 6.6J.5 — COVER FOUNDATION (PHB 2014).
 *
 * Prova que:
 *  • Cover é uma RELAÇÃO (origem ↔ alvo) e o modelo distingue o NÍVEL da
 *    PROVENIÊNCIA;
 *  • sem geometria a avaliação é `not-assessed` (0 bônus, praticável) — e isso
 *    NÃO é o mesmo que `known:none`;
 *  • +2/+5 valem como CA situacional e em salvaguarda de DESTREZA apenas;
 *  • Total Cover é falha de TARGETING: recusa ANTES do d20, sem gastar espaço,
 *    Ação, componente ou criar `SpellCast`;
 *  • Chama Sagrada IGNORA o benefício de cover no save (`ignoreSaveCover`) mas
 *    continua sujeita ao targeting normal (não é "atravessa qualquer coisa");
 *  • o nível confirmado pelo Mestre só preenche o que o provider não sabe.
 */
export async function smokeCoverFoundation(baseUrl: string, check: Check): Promise<void> {
  console.log('\n87.8) Fase 6.6J.5 — Cover Foundation (relacional, PHB 2014)');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const creatureIds: string[] = [];
  const castIds: string[] = [];
  const pendingIds: string[] = [];

  const unknown: CoverEvaluation = {
    status: 'not-assessed',
    reason: 'sem geometria',
  };

  try {
    // ===================================================================
    // A — REGRAS PURAS: nível, proveniência, +2/+5 e só DESTREZA
    // ===================================================================
    check(
      '87.8.A) múltiplas fontes não somam: Half+Half = Half, Half+3/4 = 3/4 e Total é o teto',
      highestCoverLevel(['half', 'half']) === 'half' &&
        highestCoverLevel(['half', 'three-quarters']) === 'three-quarters' &&
        highestCoverLevel(['three-quarters', 'total']) === 'total' &&
        highestCoverLevel([]) === 'none',
    );
    check(
      '87.8.B) PHB: Half +2 CA/+2 save, Three-Quarters +5/+5 e Total NÃO vira bônus numérico',
      coverAcBonus('half') === 2 &&
        coverDexSaveBonus('half') === 2 &&
        coverAcBonus('three-quarters') === 5 &&
        coverDexSaveBonus('three-quarters') === 5 &&
        coverAcBonus('total') === 0 &&
        coverDexSaveBonus('total') === 0,
    );
    check(
      '87.8.C) cover só afeta salvaguarda de DESTREZA (FOR/CON/INT/SAB/CAR e checks nunca)',
      coverSaveBonusFor('standard', knownCover('three-quarters'), 'dexterity') === 5 &&
        coverSaveBonusFor('standard', knownCover('half'), 'wisdom') === 0 &&
        coverSaveBonusFor('standard', knownCover('half'), 'strength') === 0,
    );
    check(
      '87.8.D) `ignore` (Chama Sagrada) zera o benefício mesmo com cobertura conhecida',
      coverSaveBonusFor('ignore', knownCover('three-quarters'), 'dexterity') === 0,
    );
    check(
      '87.8.E) `not-assessed`/`unknown` NÃO é `known:none`: snapshot registra a diferença e não inventa bônus',
      coverSnapshotOf(unknown).status === 'not-assessed' &&
        coverSnapshotOf(unknown).level === null &&
        coverSnapshotOf(unknown).acBonus === 0 &&
        coverSnapshotOf(knownCover('none')).status === 'known' &&
        coverSnapshotOf(knownCover('none')).level === 'none',
    );
    check(
      '87.8.F) confirmação do Mestre só preenche o desconhecido: fato autoritativo NUNCA é sobrescrito',
      applyCoverConfirmation(knownCover('half', 'authoritative'), 'total').status === 'known' &&
        JSON.stringify(applyCoverConfirmation(knownCover('half'), 'total')) ===
          JSON.stringify(knownCover('half')) &&
        JSON.stringify(applyCoverConfirmation(unknown, 'three-quarters')) ===
          JSON.stringify(knownCover('three-quarters', 'master-confirmed')),
    );

    const assisted = await coverFor({
      origin: { kind: 'character', id: 'a' },
      target: { kind: 'character', id: 'b' },
      interaction: 'attack',
    });
    const stub = await coverFor(
      {
        origin: { kind: 'character', id: 'a' },
        target: { kind: 'character', id: 'b' },
        interaction: 'dexterity-save',
      },
      {
        mode: 'authoritative',
        evaluate: () => knownCover('three-quarters'),
      },
    );
    check(
      '87.8.G) provider PADRÃO é assistido (`not-assessed`, 0 bônus) e um provider autoritativo informa o nível',
      assisted.status === 'not-assessed' &&
        assistedCoverProvider.mode === 'assisted' &&
        stub.status === 'known' &&
        stub.level === 'three-quarters',
    );

    // ===================================================================
    // FIXTURES
    // ===================================================================
    const master = await prisma.user.create({
      data: {
        username: `cov_m_${suffix}`,
        displayName: 'Mestre Cover',
        passwordHash: 'fixture',
        role: 'MASTER',
      },
    });
    const casterUser = await prisma.user.create({
      data: {
        username: `cov_c_${suffix}`,
        displayName: 'Clérigo Cover',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const targetUser = await prisma.user.create({
      data: {
        username: `cov_t_${suffix}`,
        displayName: 'Alvo Cover',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    userIds.push(master.id, casterUser.id, targetUser.id);

    const masterToken = signToken({
      sub: master.id,
      username: master.username,
      displayName: master.displayName,
      role: master.role,
    });

    const caster = await prisma.character.create({
      data: {
        userId: casterUser.id,
        name: 'Clérigo Cover',
        hpCurrent: 60,
        hpMax: 60,
        speed: 9,
        wisdom: 18,
        intelligence: 10,
        // Clérigo 20: a lista da fonte cobre Chama Sagrada E Imobilizar Pessoa.
        classes: [{ classKey: 'cleric', subclass: '', level: 20 }],
      },
    });
    const target = await prisma.character.create({
      data: {
        userId: targetUser.id,
        name: 'Alvo Cover',
        hpCurrent: 40,
        hpMax: 40,
        speed: 9,
        wisdom: 10,
      },
    });
    characterIds.push(caster.id, target.id);
    await seedSpellRepertoire({
      characterId: caster.id,
      classKey: 'cleric',
      spellIds: ['sacred-flame', 'hold-person'],
    });
    await grantCastingComponents({ characters: [caster.id] });
    await resetCastingSlots(caster.id);

    const goblin = await prisma.creature.create({
      data: {
        name: 'Goblin Cover',
        kind: 'CREATURE',
        type: 'Humanoide',
        hpCurrent: 20,
        hpMax: 20,
        speed: 9,
      },
    });
    creatureIds.push(goblin.id);

    const casterEntity = { kind: 'character' as const, id: caster.id };
    const targetEntity = { kind: 'character' as const, id: target.id };
    const targetKey = `character:${target.id}`;

    async function cast(
      spellId: string,
      body: Record<string, unknown>,
    ): Promise<HttpResult> {
      const operationId = randomUUID();
      const response = await fetch(`${baseUrl}/api/spells/cast-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
        body: JSON.stringify(
          withSpatialEvidence('/spells/cast-proof', {
            operationId,
            spellId,
            caster: casterEntity,
            targets: [targetEntity],
            ...body,
          }),
        ),
      });
      const data = (await response.json().catch(() => ({}))) as HttpResult['data'];
      if (data.cast?.id) castIds.push(data.cast.id);
      for (const id of [data.pendingId, ...(data.pendingIds ?? [])]) {
        if (id) pendingIds.push(id);
      }
      return { status: response.status, data };
    }

    /** Fecha a conjuração pendente (libera o lock de UM cast `resolving`). */
    async function cancelPending(id: string): Promise<void> {
      await fetch(`${baseUrl}/api/effects/pending/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
        body: JSON.stringify({}),
      });
    }

    /**
     * Pendência de FIXTURE com cobertura conhecida, para provar a CONTA do save.
     * Nenhuma magia PHB de save de Destreza com política PADRÃO existe no
     * registry hoje (Chama Sagrada IGNORA cover), então o teste isola a
     * integração `pending.cover` → bônus do dado sem inventar magia nova.
     */
    async function createPending(cover: Record<string, unknown> | null) {
      const row = await prisma.pendingEffectSave.create({
        data: {
          operationId: randomUUID(),
          fingerprint: randomUUID(),
          definitionId: 'spell.hold-person',
          casterEntityKind: 'character',
          casterEntityId: caster.id,
          targetEntityKind: 'character',
          targetEntityId: target.id,
          ability: 'dexterity',
          dc: 14,
          ...(cover ? { cover: cover as never } : {}),
        },
      });
      pendingIds.push(row.id);
      return row;
    }

    async function rollSave(pendingId: string): Promise<{ status: number; bonus: number }> {
      const response = await fetch(`${baseUrl}/api/dice/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
        body: JSON.stringify({ kind: 'save', pendingEffectSaveId: pendingId, dice: [{ sides: 20 }] }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        bonus?: number;
        roll?: { bonus?: number };
      };
      const bonus = data.roll?.bonus ?? data.bonus;
      return { status: response.status, bonus: typeof bonus === 'number' ? bonus : Number.NaN };
    }

    async function slotsUsed(): Promise<string> {
      const row = await prisma.character.findUniqueOrThrow({
        where: { id: caster.id },
        select: { spells: true },
      });
      const spells = (row.spells ?? {}) as { slotsUsed?: Record<string, number> };
      return JSON.stringify(spells.slotsUsed ?? {});
    }

    // ===================================================================
    // H — SAVE de DESTREZA com cobertura conhecida (padrão +2/+5)
    // ===================================================================
    const withoutCover = await createPending(null);
    const withHalf = await createPending({ level: 'half', bonus: 2, provenance: 'master-confirmed' });
    const withThreeQuarters = await createPending({
      level: 'three-quarters',
      bonus: 5,
      provenance: 'master-confirmed',
    });
    const baseRoll = await rollSave(withoutCover.id);
    const halfRoll = await rollSave(withHalf.id);
    const tqRoll = await rollSave(withThreeQuarters.id);
    check(
      '87.8.H) DEX save com Half Cover: bônus de save +2 aplicado pelo SERVIDOR (situacional, sem vantagem)',
      baseRoll.status < 300 &&
        halfRoll.status < 300 &&
        Number.isFinite(baseRoll.bonus) &&
        halfRoll.bonus - baseRoll.bonus === 2,
      JSON.stringify({ base: baseRoll, half: halfRoll }),
    );
    check(
      '87.8.I) DEX save com Three-Quarters Cover: +5 (mesmo bônus de CA, sem somar fontes)',
      tqRoll.status < 300 && tqRoll.bonus - baseRoll.bonus === 5,
      JSON.stringify({ base: baseRoll, threeQuarters: tqRoll }),
    );

    // ===================================================================
    // J — IMOBILIZAR PESSOA (SAB) não recebe cover; CHAMA SAGRADA também não
    // ===================================================================
    const holdPerson = await cast('hold-person', {
      castingResource: { kind: 'spell-slot', level: 2 },
      coverConfirmation: [{ targetKey, level: 'half' }],
    });
    const holdPending = holdPerson.data.pendingId
      ? await prisma.pendingEffectSave.findUnique({ where: { id: holdPerson.data.pendingId } })
      : null;
    check(
      '87.8.J) Imobilizar Pessoa (Sabedoria): cover NÃO entra no save',
      holdPerson.status === 201 && holdPending?.cover === null,
      JSON.stringify({ status: holdPerson.status, cover: holdPending?.cover }),
    );
    // Libera o lock de cast `resolving` antes da próxima conjuração do caster.
    if (holdPerson.data.pendingId) await cancelPending(holdPerson.data.pendingId);

    const sacred = await cast('sacred-flame', {
      coverConfirmation: [{ targetKey, level: 'three-quarters' }],
    });
    const sacredPending = sacred.data.pendingId
      ? await prisma.pendingEffectSave.findUnique({ where: { id: sacred.data.pendingId } })
      : null;
    check(
      '87.8.K) Chama Sagrada ignora o benefício de cover no save (política `ignore`) mesmo com cobertura conhecida',
      sacred.status === 201 && sacredPending?.cover === null,
      JSON.stringify({ status: sacred.status, cover: sacredPending?.cover }),
    );
    if (sacred.data.pendingId) await cancelPending(sacred.data.pendingId);

    // ===================================================================
    // L — TOTAL COVER: recusa ANTES do commit, sem custo nenhum
    // ===================================================================
    const before = await slotsUsed();
    const castsBefore = await prisma.spellCast.count();
    const blocked = await cast('hold-person', {
      castingResource: { kind: 'spell-slot', level: 2 },
      coverConfirmation: [{ targetKey, level: 'total' }],
    });
    const after = await slotsUsed();
    const castsAfter = await prisma.spellCast.count();
    check(
      '87.8.L) Total Cover: alvo DIRETO recusado antes do d20 — sem espaço, sem SpellCast e sem pendência',
      blocked.status === 409 &&
        blocked.data.error === 'SPELL_TARGET_TOTAL_COVER' &&
        blocked.data.cast === undefined &&
        before === after &&
        castsBefore === castsAfter,
      JSON.stringify({ status: blocked.status, error: blocked.data.error, before, after }),
    );

    const sacredTotal = await cast('sacred-flame', {
      coverConfirmation: [{ targetKey, level: 'total' }],
    });
    check(
      '87.8.M) `saveCoverPolicy: ignore` NÃO significa `targetingCoverPolicy: ignore`: Chama Sagrada continua recusando alvo em Total Cover',
      sacredTotal.status === 409 && sacredTotal.data.error === 'SPELL_TARGET_TOTAL_COVER',
      JSON.stringify({ status: sacredTotal.status, error: sacredTotal.data.error }),
    );

    // ===================================================================
    // N — PRIVACIDADE/AUDITORIA: snapshot é opt-in e nunca carrega nível sem
    // status conhecido
    // ===================================================================
    check(
      '87.8.N) snapshot de ataque aceita `cover` opcional (casts antigos continuam válidos) e `not-assessed` não vira `none`',
      coverSnapshotOf(unknown).status === 'not-assessed' &&
        coverSnapshotOf(unknown).provenance === null &&
        coverSnapshotOf(knownCover('half', 'master-confirmed')).provenance === 'master-confirmed',
    );
  } finally {
    try {
      if (pendingIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { id: { in: pendingIds } } });
      }
      if (castIds.length > 0) {
        await prisma.pendingEffectSave.deleteMany({ where: { spellCastId: { in: castIds } } });
        await prisma.effectInstance.deleteMany({ where: { sourceId: { in: castIds } } });
        await prisma.spellCast.deleteMany({ where: { id: { in: castIds } } });
      }
      await prisma.effectInstance.deleteMany({
        where: {
          OR: [
            { sourceEntityId: { in: [...characterIds, ...creatureIds] } },
            { targetEntityId: { in: [...characterIds, ...creatureIds] } },
          ],
        },
      });
      await prisma.characterOperation.deleteMany({ where: { characterId: { in: characterIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      await prisma.creature.deleteMany({ where: { id: { in: creatureIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (error) {
      console.error('[smoke-cover] limpeza parcial:', error);
    }
  }
}
