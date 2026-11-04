import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { allSpells } from '../../shared/spells/index.js';
import type { Spell } from '../../shared/spells/types.js';
import {
  resolveSpellAvailability,
  type SpellAvailabilityKind,
} from '../../shared/spells/repertoire.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import {
  characterSpellcastingProfile,
  creatureSpellcastingProfile,
  type SpellcastingProfile,
  type SpellcastingSource,
  type SpellcastingSourceRef,
} from './spellcasting-source.js';
import { loadRepertoire, repertoireRowOf, type SourceRepertoireView } from './spell-repertoire.service.js';
import type { EffectActor } from '../../effects/effects.service.js';

/**
 * FASE 6.6F — AUTORIZAÇÃO da conjuração.
 *
 * Responde, ANTES de qualquer custo: "este conjurador PODE legalmente conjurar
 * esta magia por ESTA fonte?". É a segunda pergunta que a engine não fazia —
 * existir no catálogo, ter Execution Definition e ter Effect Definition NÃO
 * autoriza nada (Bless executável por um Mago comum continua sendo impossível).
 *
 * A diferença entre MASTER e PLAYER mora AQUI e no controle do conjurador; o
 * resto do pipeline é o MESMO serviço e as MESMAS regras.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface SpellAuthorization {
  spell: Spell;
  profile: SpellcastingProfile;
  source: SpellcastingSource;
  availabilityKind: SpellAvailabilityKind;
  spellLevel: number;
  view: SourceRepertoireView;
}

function notAvailableFromSource(
  reason: string,
  availabilityKind: SpellAvailabilityKind,
): never {
  throw new HttpError(reason, 409, 'SPELL_NOT_AVAILABLE_FROM_SOURCE', {
    availabilityKind,
  });
}

/** Dono real do conjurador (canonicaliza combatente de personagem → ficha). */
export async function casterOwnerUserId(
  entity: MechanicalEntity,
  db: Db = prisma,
): Promise<string | null> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({
      where: { id: entity.id },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }
  if (entity.kind === 'creature') return null;
  const row = await db.combatant.findUnique({
    where: { id: entity.id },
    select: { character: { select: { userId: true } } },
  });
  return row?.character?.userId ?? null;
}

/**
 * Controle do conjurador.
 *
 *  • MASTER: qualquer personagem/criatura do bestiário (ferramenta do Mestre) —
 *    mas continua sujeito a repertório, espaço, Ação e alvo.
 *  • PLAYER: SÓ o próprio personagem (a ficha dele, ou o combatente desse
 *    personagem). Nunca a ficha de outro jogador e nunca um NPC.
 */
export async function assertCasterControl(
  actor: EffectActor,
  entity: MechanicalEntity,
  db: Db = prisma,
): Promise<void> {
  if (actor.role === 'MASTER') return;
  const owner = await casterOwnerUserId(entity, db);
  if (!owner || owner !== actor.userId) {
    throw new HttpError(
      'Você só pode conjurar com o seu próprio personagem.',
      403,
      'SPELL_CASTER_FORBIDDEN',
    );
  }
}

/** Perfil DERIVADO do personagem para a fonte (o mesmo da ficha). */
function profileOfView(
  views: SourceRepertoireView[],
  snapshot: { character: Parameters<typeof characterSpellcastingProfile>[0] | null; creature: { spellcastingProfile: unknown } | null },
  view: SourceRepertoireView,
): SpellcastingProfile {
  if (view.mode === 'explicit') {
    const profile = snapshot.creature
      ? creatureSpellcastingProfile(snapshot.creature)
      : null;
    if (!profile) {
      throw new HttpError(
        'Este conjurador não possui uma fonte de conjuração utilizável.',
        409,
        'SPELLCASTING_SOURCE_NOT_AVAILABLE',
      );
    }
    return profile;
  }
  if (!snapshot.character) {
    throw new HttpError(
      'Este conjurador não possui uma fonte de conjuração utilizável.',
      409,
      'SPELLCASTING_SOURCE_NOT_AVAILABLE',
    );
  }
  void views;
  return characterSpellcastingProfile(snapshot.character, view.source);
}

/**
 * Resolve a fonte AUTORIZADA da conjuração.
 *
 * Regra de seleção (PHB 2014 + multiclasse):
 *  • uma fonte autoriza → automática;
 *  • várias fontes autorizam (Mago/Clérigo com Hold Person preparada nos dois) →
 *    o pedido PRECISA dizer qual, e cada uma aplica a CD/atributo dela;
 *  • fonte pedida que não autoriza → `SPELL_NOT_AVAILABLE_FROM_SOURCE` (nunca
 *    "a primeira"), antes de qualquer custo;
 *  • nenhuma autoriza → `SPELL_NOT_AVAILABLE_FROM_SOURCE` com o motivo real
 *    (`not-prepared`, `recorded-unprepared`, `not-recorded`...).
 */
/** Uma fonte avaliada para UMA magia (com o perfil derivado daquela fonte). */
export interface EvaluatedSource {
  view: SourceRepertoireView;
  result: ReturnType<typeof resolveSpellAvailability>;
  profile: SpellcastingProfile;
}

export interface SpellAvailabilityEvaluation {
  spell: Spell;
  /** Todas as fontes do conjurador, autorizando ou não. */
  entries: EvaluatedSource[];
  /** Só as que AUTORIZAM a magia agora (ACTIVE/known/grimório). */
  authorized: EvaluatedSource[];
}

/**
 * Avaliação READ-ONLY de todas as fontes para uma magia.
 *
 * É a MESMA conta usada na autorização do cast — a UI de conjuração do jogador
 * (`/api/spells/cast-options`) lê daqui para saber quais fontes oferecer. Nunca
 * existe uma segunda implementação de elegibilidade para a tela.
 */
export async function evaluateSpellAvailability(
  caster: LoadedEntity,
  spellId: string,
  db: Db = prisma,
): Promise<SpellAvailabilityEvaluation> {
  const spell = allSpells().find((item) => item.id === spellId);
  if (!spell) {
    throw new HttpError('Magia não encontrada no catálogo.', 404, 'SPELL_NOT_FOUND');
  }

  const snapshot = await loadRepertoire(caster.entity, db);
  if (snapshot.views.length === 0) {
    throw new HttpError(
      'Este conjurador não possui uma fonte de conjuração utilizável.',
      409,
      'SPELLCASTING_SOURCE_NOT_AVAILABLE',
    );
  }

  const entries = snapshot.views.map((view) => {
    const row = repertoireRowOf(view, spell.id);
    const result = resolveSpellAvailability({
      definition: view.definition,
      spell: { id: spell.id, name: spell.namePt, level: spell.level },
      entry: row
        ? {
            spellId: row.spellId,
            level: row.level,
            onSourceList: row.onSourceList,
            known: row.known,
            recorded: row.recorded,
            preparedActive: row.preparedActive,
            preparedPlanned: row.preparedPlanned,
          }
        : null,
      maxSpellLevel: view.maxSpellLevel,
      alwaysPrepared: row?.alwaysPrepared ?? false,
    });
    return { view, result, profile: profileOfView(snapshot.views, snapshot, view) };
  });

  return { spell, entries, authorized: entries.filter((entry) => entry.result.eligible) };
}

export async function resolveSpellAuthorization(
  caster: LoadedEntity,
  spellId: string,
  requested: SpellcastingSourceRef | undefined,
  db: Db = prisma,
): Promise<SpellAuthorization> {
  // A escolha acontece SÓ entre as fontes que autorizam a magia AGORA. A conta
  // de elegibilidade vem de `evaluateSpellAvailability` (implementação única,
  // compartilhada com a UI de opções de conjuração).
  const { spell, entries: evaluated, authorized: eligible } = await evaluateSpellAvailability(
    caster,
    spellId,
    db,
  );

  if (requested) {
    const match = evaluated.find(
      (item) =>
        item.view.source.kind === requested.kind && item.view.source.id === requested.id,
    );
    if (!match) {
      throw new HttpError(
        'Fonte de conjuração inválida para este conjurador.',
        400,
        'SPELLCASTING_SOURCE_INVALID',
      );
    }
    if (!match.result.eligible) {
      notAvailableFromSource(match.result.reason ?? 'Magia indisponível nesta fonte.', match.result.availabilityKind);
    }
    return {
      spell,
      profile: match.profile,
      source: match.view.source,
      availabilityKind: match.result.availabilityKind,
      spellLevel: Math.max(0, spell.level),
      view: match.view,
    };
  }

  if (eligible.length === 0) {
    // O motivo escolhido é o do primeiro candidato que TEM alguma instrução
    // útil (ex.: "está no grimório, mas não preparada").
    const reason = evaluated.find((item) => item.result.reason)?.result;
    notAvailableFromSource(
      reason?.reason ?? 'Este personagem não pode conjurar esta magia por nenhuma fonte.',
      reason?.availabilityKind ?? 'not-on-source-list',
    );
  }

  if (eligible.length > 1) {
    throw new HttpError(
      'Mais de uma fonte pode conjurar esta magia: informe qual está sendo usada.',
      400,
      'SPELLCASTING_SOURCE_REQUIRED',
      {
        sources: eligible.map((item) => ({
          kind: item.view.source.kind,
          id: item.view.source.id,
        })),
      },
    );
  }

  const chosen = eligible[0];
  return {
    spell,
    profile: chosen.profile,
    source: chosen.view.source,
    availabilityKind: chosen.result.availabilityKind,
    spellLevel: Math.max(0, spell.level),
    view: chosen.view,
  };
}
