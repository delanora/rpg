import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { signToken } from '../lib/jwt.js';

type Check = (label: string, condition: boolean, detail?: string) => void;

/**
 * FASE 6.6M.6.3.1 — PERSONALIZAÇÃO PERSISTENTE DA HOTBAR (48 POSIÇÕES).
 *
 * Cobre só o que a microfase promete: configuração salva e recuperada, estados
 * "sem configuração" × "configuração vazia", normalização de duplicatas,
 * autorização pelo token (nunca pelo corpo), concorrência por versão,
 * idempotência e a garantia de que salvar organização NÃO executa ação.
 *
 * Roda contra um banco de teste isolado e limpa as PRÓPRIAS contas no fim.
 */
export async function smokeHotbar(baseUrl: string, check: Check): Promise<void> {
  console.log('\n91) Fase 6.6M.6.3.1 — Personalização da Hotbar');

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const characterIds: string[] = [];
  const operationIds: string[] = [];

  try {
    const player = await prisma.user.create({
      data: {
        username: `hb_p_${suffix}`,
        displayName: 'Hotbar Jogador',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    const rival = await prisma.user.create({
      data: {
        username: `hb_r_${suffix}`,
        displayName: 'Hotbar Rival',
        passwordHash: 'fixture',
        role: 'PLAYER',
      },
    });
    userIds.push(player.id, rival.id);

    const token = signToken({
      sub: player.id,
      username: player.username,
      displayName: player.displayName,
      role: player.role,
    });
    const rivalToken = signToken({
      sub: rival.id,
      username: rival.username,
      displayName: rival.displayName,
      role: rival.role,
    });

    const character = await prisma.character.create({
      data: { userId: player.id, name: 'Hotbar Jogador', hpCurrent: 20, hpMax: 20 },
    });
    const rivalCharacter = await prisma.character.create({
      data: { userId: rival.id, name: 'Hotbar Rival', hpCurrent: 20, hpMax: 20 },
    });
    characterIds.push(character.id, rivalCharacter.id);

    async function request(
      path: string,
      options: { body?: unknown; token?: string; method?: 'GET' | 'PUT' } = {},
    ) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: options.method ?? (options.body ? 'PUT' : 'GET'),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.token ?? token}`,
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
    }

    function slotsOf(refs: Record<number, string>): ({ kind: 'attack'; sourceId: string } | null)[] {
      return Array.from({ length: 48 }, (_, index) =>
        refs[index] ? { kind: 'attack' as const, sourceId: refs[index] } : null,
      );
    }

    async function save(
      slots: ({ kind: 'attack'; sourceId: string } | null)[],
      expectedVersion: number,
      options: { token?: string; operationId?: string; extra?: Record<string, unknown> } = {},
    ) {
      const operationId = options.operationId ?? randomUUID();
      if (!options.operationId) operationIds.push(operationId);
      return request('/characters/me/hotbar', {
        token: options.token,
        body: { slots, expectedVersion, operationId, ...(options.extra ?? {}) },
      });
    }

    // 1) NUNCA personalizada: o DTO devolve `hotbar: null` (o cliente preenche
    // automaticamente). É o estado das fichas antigas depois da migration.
    const fresh = await request('/characters/me');
    check(
      'HB1) sem configuração salva a ficha devolve hotbar null',
      fresh.status === 200 && fresh.data.character.hotbar === null,
      JSON.stringify(fresh.data.character?.hotbar),
    );

    // 2) Salva uma organização (slot 1 = a1, slot 2 = a2, slot 3 vazio) e a
    // resposta confirma 48 posições + versão incrementada.
    const versionBefore = fresh.data.character.version as number;
    const first = await save(slotsOf({ 0: 'a1', 1: 'a2' }), versionBefore);
    check(
      'HB2) salva as 48 posições e devolve a configuração confirmada',
      first.status === 200 &&
        first.data.hotbar.slots.length === 48 &&
        first.data.hotbar.slots[0]?.sourceId === 'a1' &&
        first.data.hotbar.slots[1]?.sourceId === 'a2' &&
        first.data.hotbar.slots[2] === null &&
        first.data.version === versionBefore + 1,
      `${first.status} ${JSON.stringify(first.data.hotbar?.slots?.slice(0, 3))}`,
    );

    // 3) RELOAD/reconexão: a leitura seguinte devolve a MESMA organização.
    const reload = await request('/characters/me');
    check(
      'HB3) recarregar a ficha recupera a organização salva',
      reload.data.character.hotbar?.slots?.[0]?.sourceId === 'a1' &&
        reload.data.character.hotbar?.slots?.[1]?.sourceId === 'a2' &&
        reload.data.character.version === versionBefore + 1,
      JSON.stringify(reload.data.character.hotbar?.slots?.slice(0, 3)),
    );

    // 4) REENVIO do mesmo operationId (rede instável): mesmo resultado, sem
    // subir a versão de novo.
    const sameOperation = await save(slotsOf({ 0: 'a1', 1: 'a2' }), versionBefore, {
      operationId: operationIds[operationIds.length - 1],
    });
    check(
      'HB4) reenvio idempotente devolve o mesmo resultado sem reaplicar',
      sameOperation.status === 200 && sameOperation.data.replayed === true,
      `${sameOperation.status} ${String(sameOperation.data.replayed)}`,
    );

    // 5) Remoção PERSISTENTE: esvaziar o slot 2 não faz o preenchimento
    // automático devolvê-lo depois.
    const removed = await save(slotsOf({ 0: 'a1' }), versionBefore + 1);
    const afterRemove = await request('/characters/me');
    check(
      'HB5) atalho removido continua removido depois do reload',
      removed.status === 200 &&
        afterRemove.data.character.hotbar?.slots?.[1] === null &&
        afterRemove.data.character.hotbar?.slots?.[0]?.sourceId === 'a1',
      JSON.stringify(afterRemove.data.character.hotbar?.slots?.slice(0, 3)),
    );

    // 6) Configuração INTENCIONALMENTE VAZIA (48 nulos) ≠ "sem configuração".
    const emptied = await save(slotsOf({}), versionBefore + 2);
    const afterEmpty = await request('/characters/me');
    check(
      'HB6) configuração vazia é preservada e não é repovoada automaticamente',
      emptied.status === 200 &&
        Array.isArray(afterEmpty.data.character.hotbar?.slots) &&
        afterEmpty.data.character.hotbar.slots.length === 48 &&
        afterEmpty.data.character.hotbar.slots.every((slot: unknown) => slot === null),
      JSON.stringify(afterEmpty.data.character.hotbar?.slots?.slice(0, 3)),
    );

    // 7) DUPLICATA: a mesma identidade em duas posições é normalizada (uma
    // posição por atalho) em vez de virar atalho duplicado silencioso.
    const duplicated = await save(
      [
        { kind: 'attack', sourceId: 'a1' },
        { kind: 'attack', sourceId: 'a1' },
        ...Array.from({ length: 46 }, () => null),
      ],
      versionBefore + 3,
    );
    check(
      'HB7) atalho repetido no payload ocupa uma única posição',
      duplicated.status === 200 &&
        duplicated.data.hotbar.slots[0]?.sourceId === 'a1' &&
        duplicated.data.hotbar.slots[1] === null,
      JSON.stringify(duplicated.data.hotbar?.slots?.slice(0, 3)),
    );

    // 8) CONCORRÊNCIA: duas sessões com a MESMA versão — uma grava, a outra
    // recebe 409 e NÃO sobrescreve.
    const race = await Promise.all([
      save(slotsOf({ 0: 'b1' }), versionBefore + 4),
      save(slotsOf({ 0: 'b2' }), versionBefore + 4),
    ]);
    const statuses = race.map((item) => item.status).sort();
    check(
      'HB8) duas gravações na mesma versão: uma vence, a outra recebe 409',
      statuses[0] === 200 && statuses[1] === 409,
      JSON.stringify(statuses),
    );

    // 9) Versão OBSOLETA nunca sobrescreve: o valor confirmado continua o do
    // vencedor da corrida.
    const winner = race.find((item) => item.status === 200)!;
    const stale = await save(slotsOf({ 0: 'c1' }), versionBefore + 4);
    const afterStale = await request('/characters/me');
    check(
      'HB9) versão obsoleta recebe 409 e mantém a configuração confirmada',
      stale.status === 409 &&
        afterStale.data.character.hotbar?.slots?.[0]?.sourceId ===
          winner.data.hotbar.slots[0].sourceId,
      `${stale.status} ${JSON.stringify(afterStale.data.character.hotbar?.slots?.[0])}`,
    );

    // 10) AUTORIZAÇÃO: outro jogador não altera a configuração alheia. O dono
    // vem SEMPRE do token, então o `characterId` no corpo é descartado e a
    // gravação cai na ficha de quem chamou.
    const versionNow = afterStale.data.character.version as number;
    const rivalFresh = await request('/characters/me', { token: rivalToken });
    const intrusion = await save(
      slotsOf({ 0: 'hacked' }),
      rivalFresh.data.character.version as number,
      { token: rivalToken, extra: { characterId: character.id } },
    );
    const afterIntrusion = await request('/characters/me');
    const rivalAfter = await request('/characters/me', { token: rivalToken });
    check(
      'HB10) jogador não altera a Hotbar de outro personagem',
      intrusion.status === 200 &&
        intrusion.data.character.id === rivalCharacter.id &&
        rivalAfter.data.character.hotbar?.slots?.[0]?.sourceId === 'hacked' &&
        afterIntrusion.data.character.hotbar?.slots?.[0]?.sourceId !== 'hacked' &&
        afterIntrusion.data.character.version === versionNow,
      `${intrusion.status} ${JSON.stringify(afterIntrusion.data.character.hotbar?.slots?.[0])}`,
    );

    // 11) VALIDAÇÃO: 47 posições, categoria desconhecida e origem vazia são
    // recusadas antes de qualquer escrita.
    const shortPayload = await save(
      Array.from({ length: 47 }, () => null) as never,
      versionNow,
    );
    const wrongKind = await save(
      [{ kind: 'spell', sourceId: 'fireball' }, ...Array.from({ length: 47 }, () => null)] as never,
      versionNow,
    );
    const blankSource = await save(
      [{ kind: 'attack', sourceId: '   ' }, ...Array.from({ length: 47 }, () => null)] as never,
      versionNow,
    );
    check(
      'HB11) payload inválido (47 posições / categoria / origem) é 400 sem gravar',
      shortPayload.status === 400 && wrongKind.status === 400 && blankSource.status === 400,
      `${shortPayload.status},${wrongKind.status},${blankSource.status}`,
    );

    // 12) PREFERÊNCIA, NÃO AÇÃO: salvar organização não cria combate, não
    // altera PV e não consome economia.
    const after = await request('/characters/me');
    const combats = await prisma.combat.count({
      where: { combatants: { some: { characterId: character.id } } },
    });
    check(
      'HB12) personalizar a Hotbar não executa ação nem toca no estado de jogo',
      combats === 0 &&
        after.data.character.hpCurrent === 20 &&
        after.data.character.hpMax === 20,
      `${combats} combates`,
    );

    // 13) Só os salvamentos APLICADOS viram operação: reenvio, 409 e payload
    // inválido não deixam registro novo (mesma tabela das outras escritas).
    const operations = await prisma.characterOperation.count({
      where: { characterId: character.id, type: 'HOTBAR_SAVE' },
    });
    const applied =
      [first, removed, emptied, duplicated].filter(
        (item) => item.status === 200 && item.data.replayed === false,
      ).length + race.filter((item) => item.status === 200).length;
    check(
      'HB13) cada salvamento aplicado registra CharacterOperation HOTBAR_SAVE',
      operations === applied,
      `${operations} de ${applied}`,
    );
  } finally {
    await prisma.characterOperation.deleteMany({ where: { characterId: { in: characterIds } } });
    await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
