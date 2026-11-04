import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { abilityModifier, type AbilityKey } from '../../shared/dnd5e.js';
import { parseJson } from '../../shared/json.js';
import { spellsStateSchema, type SpellsStateInput } from '../../characters/characters.schema.js';
import { getSpell, SPELL_SCHOOL_LABELS } from '../../shared/spells/index.js';
import {
  manualPreparationLimit,
  planCandidates,
  planPreparationProblem,
  repertoireSummary,
  resolveSpellAvailability,
  type SpellAvailabilityKind,
  type SpellRepertoireMode,
} from '../../shared/spells/repertoire.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import { characterSpellcastingProfile } from './spellcasting-source.js';
import { loadRepertoire, repertoireRowOf, type SourceRepertoireView } from './spell-repertoire.service.js';
import type { EffectActor } from '../../effects/effects.service.js';
import type { SpellcastingSourceRef } from './spellcasting-source.js';

/**
 * FASE 6.6F — REPERTÓRIO e PLANO de preparação (API do jogador).
 *
 * Leitura: o jogador (dono) ou o Mestre veem, POR FONTE, o que está ACTIVE, o
 * que está PLANEJADO, o limite manual e as candidatas ao plano. Nunca uma lista
 * global de "preparadas": Clérigo e Mago do mesmo personagem têm estados
 * separados.
 *
 * Escrita: o jogador salva SÓ os IDs planejados. Limite, lista, nível máximo,
 * grimório e contagem são derivados no servidor — `maxPrepared` nunca vem do
 * cliente. Salvar plano NÃO altera a preparação ACTIVE (isso é do Descanso Longo).
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Código: a fonte não usa preparação (conhecidas/statblock). */
export const SPELL_PREPARATION_NOT_SUPPORTED = 'SPELL_PREPARATION_NOT_SUPPORTED';

export interface RepertoireEntryDto {
  spellId: string;
  name: string;
  level: number;
  availabilityKind: SpellAvailabilityKind;
  /** A engine sabe EXECUTAR esta magia (sem isso o botão de conjurar fica off). */
  executable: boolean;
  active: boolean;
  planned: boolean;
  recorded: boolean;
  known: boolean;
  alwaysPrepared: boolean;
}

export interface RepertoireSourceDto {
  source: { kind: string; id: string; label: string; ability: AbilityKey | null };
  mode: SpellRepertoireMode;
  modeLabel: string;
  maxSpellLevel: number;
  /** Limite MANUAL de preparadas; `null` = a fonte não prepara. */
  manualLimit: number | null;
  activeCount: number;
  plannedCount: number;
  hasPlan: boolean;
  /** O plano difere do ACTIVE: vale depois do próximo Descanso Longo válido. */
  planPending: boolean;
  entries: RepertoireEntryDto[];
  /** Candidatas ao plano (vazia em fontes de lista fixa/statblock). */
  candidates: { spellId: string; name: string; level: number }[];
}

export interface CharacterRepertoireDto {
  characterId: string;
  version: number;
  sources: RepertoireSourceDto[];
}

async function loadAccessibleCharacter(
  actor: EffectActor,
  characterId: string,
  db: Db = prisma,
) {
  const row = await db.character.findUnique({ where: { id: characterId } });
  if (!row) throw new HttpError('Personagem não encontrado.', 404);
  if (actor.role !== 'MASTER' && row.userId !== actor.userId) {
    throw new HttpError(
      'Você só pode ver o repertório do seu próprio personagem.',
      403,
      'SPELL_REPERTOIRE_FORBIDDEN',
    );
  }
  return row;
}

/** Fonte de uma view com os números do PERSONAGEM (limite e candidatas). */
function sourceDtoOf(
  row: { strength: number; dexterity: number; constitution: number; intelligence: number; wisdom: number; charisma: number; classes: unknown },
  view: SourceRepertoireView,
): RepertoireSourceDto {
  const profile = characterSpellcastingProfile(row, view.source);
  const abilityMod = profile.abilityModifier ?? 0;
  const manualLimit =
    view.definition.preparation === null
      ? null
      : manualPreparationLimit({
          formula: view.definition.preparation,
          level: view.classLevel,
          abilityModifier: abilityMod,
        });

  const entries: RepertoireEntryDto[] = view.rows
    .map((entry) => {
      const spell = getSpell(entry.spellId);
      if (!spell) return null;
      const availability = resolveSpellAvailability({
        definition: view.definition,
        spell: { id: spell.id, name: spell.namePt, level: spell.level },
        entry: {
          spellId: entry.spellId,
          level: entry.level,
          onSourceList: entry.onSourceList,
          known: entry.known,
          recorded: entry.recorded,
          preparedActive: entry.preparedActive,
          preparedPlanned: entry.preparedPlanned,
        },
        maxSpellLevel: view.maxSpellLevel,
        alwaysPrepared: entry.alwaysPrepared,
      });
      return {
        spellId: entry.spellId,
        name: spell.namePt,
        level: entry.level,
        availabilityKind: availability.availabilityKind,
        executable: Boolean(spellExecutionDefinition(entry.spellId)),
        active: entry.preparedActive,
        planned: entry.preparedPlanned,
        recorded: entry.recorded,
        known: entry.known,
        alwaysPrepared: entry.alwaysPrepared,
      } satisfies RepertoireEntryDto;
    })
    .filter((entry): entry is RepertoireEntryDto => entry !== null)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const candidates = planCandidates({
    definition: view.definition,
    maxSpellLevel: view.maxSpellLevel,
    rows: view.rows.map((entry) => ({ spellId: entry.spellId, level: entry.level })),
  })
    .map((candidate) => getSpell(candidate.spellId))
    .filter((spell): spell is NonNullable<typeof spell> => Boolean(spell))
    .map((spell) => ({ spellId: spell.id, name: spell.namePt, level: spell.level }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const planPending = view.rows.some((entry) => entry.preparedPlanned !== entry.preparedActive);

  return {
    source: {
      kind: view.source.kind,
      id: view.source.id,
      label: view.source.label,
      ability: view.source.ability,
    },
    mode: view.mode,
    modeLabel: repertoireSummary(view.definition).label,
    maxSpellLevel: view.maxSpellLevel,
    manualLimit,
    activeCount: view.rows.filter((entry) => entry.preparedActive && !entry.alwaysPrepared).length,
    plannedCount: view.rows.filter((entry) => entry.preparedPlanned && !entry.alwaysPrepared).length,
    hasPlan: view.hasPlan,
    planPending,
    entries,
    candidates,
  };
}

/** Repertório completo do personagem (por fonte). */
export async function repertoireForCharacter(
  actor: EffectActor,
  characterId: string,
): Promise<CharacterRepertoireDto> {
  const row = await loadAccessibleCharacter(actor, characterId);
  const snapshot = await loadRepertoire({ kind: 'character', id: row.id });
  return {
    characterId: row.id,
    version: row.version,
    sources: snapshot.views.map((view) => sourceDtoOf(row, view)),
  };
}

/**
 * Salva o PLANEJAMENTO de UMA fonte. Não toca no ACTIVE.
 *
 * `expectedVersion` protege duas abas: quem chegou depois recebe 409 em vez de
 * sobrescrever o plano alheio em silêncio.
 */
export async function savePreparationPlan(
  actor: EffectActor,
  characterId: string,
  source: SpellcastingSourceRef,
  input: { spellIds: readonly string[]; expectedVersion: number },
): Promise<CharacterRepertoireDto> {
  const row = await loadAccessibleCharacter(actor, characterId);
  if (row.version !== input.expectedVersion) {
    throw new HttpError(
      'A ficha mudou desde que o plano foi aberto; recarregue e tente novamente.',
      409,
      'CONFLICT',
    );
  }

  const snapshot = await loadRepertoire({ kind: 'character', id: row.id });
  const view = snapshot.views.find(
    (item) => item.source.kind === source.kind && item.source.id === source.id,
  );
  if (!view) {
    throw new HttpError(
      'Fonte de conjuração inválida para este personagem.',
      400,
      'SPELLCASTING_SOURCE_INVALID',
    );
  }
  if (view.definition.preparation === null) {
    throw new HttpError(
      'Esta fonte não prepara magias: a lista é de conhecidas.',
      400,
      SPELL_PREPARATION_NOT_SUPPORTED,
    );
  }

  const profile = characterSpellcastingProfile(row, view.source);
  const manualLimit = manualPreparationLimit({
    formula: view.definition.preparation,
    level: view.classLevel,
    abilityModifier: profile.abilityModifier ?? 0,
  });

  const candidates = planCandidates({
    definition: view.definition,
    maxSpellLevel: view.maxSpellLevel,
    rows: view.rows.map((entry) => ({ spellId: entry.spellId, level: entry.level })),
  });
  const alwaysPrepared = view.rows.filter((entry) => entry.alwaysPrepared).map((entry) => entry.spellId);
  const manualIds = input.spellIds.filter((spellId) => !alwaysPrepared.includes(spellId));

  const problem = planPreparationProblem({
    definition: view.definition,
    spells: candidates,
    spellIds: manualIds,
    maxSpellLevel: view.maxSpellLevel,
    manualLimit,
  });
  if (problem) throw new HttpError(problem, 400);

  const stored = parseJson<SpellsStateInput>(spellsStateSchema, row.spells, {
    list: [],
    slotsUsed: {},
    pactMagic: { used: 0 },
  });
  const plannedSet = new Set(manualIds);
  const classKey = view.rowsClassKey!;

  // Linhas da fonte: marca o plano (true/false) em TODAS — é isso que torna
  // "plano vazio" distinguível de "sem plano".
  const list = stored.list
    .filter((spell) => spell.classKey === classKey)
    .map((spell) => ({ ...spell, preparedPlanned: plannedSet.has(spell.id) }));

  // Planejar uma magia da lista da classe que ainda não estava na ficha cria a
  // linha (a preparação do Clérigo/Druida/Paladino não depende de escolha prévia).
  for (const spellId of manualIds) {
    if (list.some((spell) => spell.id === spellId)) continue;
    const spell = getSpell(spellId);
    if (!spell) continue;
    list.push({
      id: spell.id,
      name: spell.namePt,
      level: spell.level,
      school: SPELL_SCHOOL_LABELS[spell.school],
      prepared: false,
      preparedPlanned: true,
      description: spell.description.slice(0, 2000),
      classKey,
    });
  }

  const others = stored.list.filter((spell) => spell.classKey !== classKey);
  const nextState = { ...stored, list: [...others, ...list] };

  const written = await prisma.character.updateMany({
    where: { id: row.id, version: row.version },
    data: { spells: nextState as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (written.count === 0) {
    throw new HttpError(
      'A ficha mudou durante o salvamento do plano; nada foi gravado.',
      409,
      'CONFLICT',
    );
  }

  // Republica a ficha (o plano aparece para o jogador e para o Mestre). Import
  // dinâmico para não acoplar o domínio de conjuração ao de fichas.
  const { publishChange } = await import('../../characters/characters.service.js');
  const updated = await prisma.character.findUniqueOrThrow({ where: { id: row.id } });
  await publishChange(
    { userId: row.userId, username: actor.username },
    updated,
    { spellPreparation: { kind: source.kind, id: source.id } },
    actor.role === 'MASTER' ? actor.username : undefined,
  );

  return repertoireForCharacter(actor, row.id);
}

/** Linha do repertório por magia (exportado para o cliente/testes). */
export function entryOf(view: SourceRepertoireView, spellId: string) {
  return repertoireRowOf(view, spellId);
}

/** Reexporta o modificador para o DTO (evita conta duplicada no chamador). */
export { abilityModifier };
