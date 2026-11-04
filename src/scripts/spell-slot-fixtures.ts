import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { getSpell } from '../modules/shared/spells/index.js';
import { spellsStateSchema, type SpellsStateInput } from '../modules/characters/characters.schema.js';
import { parseJson } from '../modules/shared/json.js';

/**
 * Fixtures dos smokes da Fase 6.6C.
 *
 * Os espaços MÁXIMOS são sempre DERIVADOS — o teste não inventa capacidade. O
 * que ele pode fazer é (a) perguntar ao SERVIDOR quais espaços estão disponíveis
 * e escolher um deles e (b) simular um DESCANSO LONGO zerando o uso persistido,
 * que é exatamente o que o motor de descanso grava.
 */
/**
 * Bolsa de Componentes de FIXTURE (Fase 6.6G): um item REAL, com a tag mecânica
 * `componentPouch`, para que as conjurações de teste tenham como fornecer o
 * material comum. Nenhum smoke ganha bypass: quem não tem bolsa/foco/material
 * é recusado ANTES do commit, como na ficha de verdade.
 */
const FIXTURE_COMPONENT_POUCH = {
  id: 'fixture-component-pouch',
  name: 'Bolsa de Componentes',
  description: '',
  quantity: 1,
  weight: 1,
  slot: null,
  backpackX: null,
  backpackY: null,
  imageUrl: '',
  itemId: '',
  category: 'Item Geral',
  rarity: null,
  requiresAttunement: false,
  attuned: false,
  details: { componentPouch: true },
  campSupply: { enabled: false, value: 0 },
};

function hasComponentPouch(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (item) =>
      Boolean(item) &&
      typeof item === 'object' &&
      (item as { details?: { componentPouch?: unknown } }).details?.componentPouch === true,
  );
}

/**
 * Concede a bolsa de componentes a conjuradores de FIXTURE (6.6G §187–§190).
 * Preserva o inventário existente (armas/escudos continuam valendo) e é
 * idempotente.
 */
export async function grantCastingComponents(options: {
  characters?: readonly string[];
  creatures?: readonly string[];
}): Promise<void> {
  for (const id of options.characters ?? []) {
    const row = await prisma.character.findUnique({ where: { id }, select: { inventory: true } });
    if (!row || hasComponentPouch(row.inventory)) continue;
    const inventory = Array.isArray(row.inventory) ? row.inventory : [];
    await prisma.character.update({
      where: { id },
      data: {
        inventory: [...inventory, FIXTURE_COMPONENT_POUCH] as unknown as Prisma.InputJsonValue,
      },
    });
  }
  for (const id of options.creatures ?? []) {
    const row = await prisma.creature.findUnique({ where: { id }, select: { inventory: true } });
    if (!row || hasComponentPouch(row.inventory)) continue;
    const inventory = Array.isArray(row.inventory) ? row.inventory : [];
    await prisma.creature.update({
      where: { id },
      data: {
        inventory: [...inventory, FIXTURE_COMPONENT_POUCH] as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export interface CastingResourceChoice {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
}

/**
 * Evidência ESPACIAL dos smokes (6.6E) — o Mestre confirmando o que o servidor
 * não consegue medir: alcance, caminho livre, visão e distância entre alvos.
 *
 * É EVIDÊNCIA, não regra: o servidor só exige os requisitos que a magia
 * declarou, e continua recusando qualquer `fail` autoritativo (canSee=false).
 */
export const SPATIAL_EVIDENCE = {
  withinRange: true,
  clearPath: true,
  sight: true,
  groupDistance: true,
} as const;

const SPELL_CAST_ROUTES = ['/effects/bless', '/effects/hold-person', '/spells/cast-proof'];

/**
 * Injeta a evidência espacial APENAS nos corpos das rotas de conjuração. Usado
 * pelo `request` dos smokes: sem isso o servidor recusaria (corretamente) um
 * cast cujo alcance é UNKNOWN.
 *
 * A rota genérica `/spells/cast` fica FORA de propósito: quando o ator é o
 * jogador, ele NÃO tem poder de confirmação espacial (6.6F) — o teste escolhe
 * explicitamente se injeta ou não a evidência.
 */
export function withSpatialEvidence(path: string, body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const clean = path.split('?')[0];
  if (!SPELL_CAST_ROUTES.some((route) => clean.endsWith(route))) return body;
  return { ...(body as Record<string, unknown>), spatialConfirmation: SPATIAL_EVIDENCE };
}

interface ResourceDto {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
  max: number;
  remaining: number;
}

/** Escolhe o espaço de MENOR nível compatível que ainda tenha uso livre. */
export async function pickCastingResource(
  baseUrl: string,
  token: string,
  entity: { kind: string; id: string },
  spellLevel: number,
): Promise<CastingResourceChoice | null> {
  const res = await fetch(`${baseUrl}/api/spells/resources/${entity.kind}/${entity.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { resources?: ResourceDto[] };
  const eligible = (data.resources ?? [])
    .filter((resource) => resource.level >= spellLevel && resource.remaining > 0)
    .sort((a, b) => a.level - b.level);
  const chosen = eligible[0];
  return chosen ? { kind: chosen.kind, level: chosen.level } : null;
}

const EMPTY_SPELLS: SpellsStateInput = { list: [], slotsUsed: {}, pactMagic: { used: 0 } };

async function spellsStateOf(characterId: string): Promise<SpellsStateInput> {
  const row = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { spells: true },
  });
  return parseJson<SpellsStateInput>(spellsStateSchema, row.spells, EMPTY_SPELLS);
}

/**
 * Consome o uso gravado de um personagem (equivalente a um Descanso Longo).
 *
 * Preserva `list` — desde a 6.6F o REPERTÓRIO mora nela; zerar os espaços não
 * pode apagar o que o personagem conhece/prepara.
 */
export async function resetCastingSlots(characterId: string): Promise<void> {
  const stored = await spellsStateOf(characterId);
  await prisma.character.update({
    where: { id: characterId },
    data: {
      spells: { ...stored, slotsUsed: {}, pactMagic: { used: 0 } } as never,
      version: { increment: 1 },
    },
  });
}

/**
 * Semeia o REPERTÓRIO (Fase 6.6F).
 *
 * As ferramentas de prova antigas NÃO autorizam mais uma magia: a autorização
 * passou a exigir a regra real (lista da fonte + known/prepared/grimório). Este
 * helper grava apenas o estado que o jogador teria escolhido, sem bypass:
 *
 *  • Mago → a linha significa "registrada no grimório"; `prepared` é o dia;
 *  • Clérigo/Druida/Paladino → a linha é a lista preparada ACTIVE;
 *  • conhecidas (Bardo/etc.) → a linha é a magia conhecida.
 *
 * `planned: true` grava o PLANO (`preparedPlanned`), que NÃO autoriza conjuração
 * antes do Descanso Longo.
 */
export async function seedSpellRepertoire(input: {
  characterId: string;
  classKey: string;
  spellIds: readonly string[];
  /** `true` (padrão) = ACTIVE; `false` = registrada/conhecida, não preparada. */
  prepared?: boolean;
  /** Grava um PLANO pendente (só faz sentido com `prepared: false`). */
  planned?: boolean;
}): Promise<void> {
  const stored = await spellsStateOf(input.characterId);
  const rows = [...stored.list];
  for (const spellId of input.spellIds) {
    const spell = getSpell(spellId);
    if (!spell) throw new Error(`fixture: magia "${spellId}" não existe no catálogo`);
    const existing = rows.findIndex(
      (row) => row.id === spellId && row.classKey === input.classKey,
    );
    const next = {
      id: spell.id,
      name: spell.namePt,
      level: spell.level,
      school: spell.school,
      prepared: input.prepared ?? true,
      ...(input.planned === undefined ? {} : { preparedPlanned: input.planned }),
      classKey: input.classKey,
    } as (typeof rows)[number];
    if (existing >= 0) rows[existing] = { ...rows[existing], ...next };
    else rows.push(next);
  }
  await prisma.character.update({
    where: { id: input.characterId },
    data: {
      spells: { ...stored, list: rows } as never,
      version: { increment: 1 },
    },
  });
}

/**
 * Remove o PLANO (`preparedPlanned`) de uma fonte, deixando a preparação ACTIVE
 * intacta — usado para provar a semântica de "planejado ≠ ativo".
 */
export async function clearSpellPlan(characterId: string, classKey: string): Promise<void> {
  const stored = await spellsStateOf(characterId);
  const list = stored.list.map((row) => {
    if (row.classKey !== classKey) return row;
    const { preparedPlanned: _planned, ...rest } = row;
    return rest;
  });
  await prisma.character.update({
    where: { id: characterId },
    data: { spells: { ...stored, list } as never, version: { increment: 1 } },
  });
}
