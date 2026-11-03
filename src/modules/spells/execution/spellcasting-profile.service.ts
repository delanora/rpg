import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import {
  characterSpellcastingProfile,
  creatureSpellcastingProfile,
  creatureSpellcastingSources,
  spellcastingSourcesForCharacter,
  type SpellcastingProfile,
  type SpellcastingSource,
  type SpellcastingSourceRef,
} from './spellcasting-source.js';

/**
 * FASE 6.6B — resolução SERVER-SIDE do perfil de conjuração.
 *
 * Ponto ÚNICO de derivação: quem precisa de CD/ataque mágico chama daqui. O
 * cliente só pode indicar QUAL fonte canônica está usando quando existem várias
 * (multiclasse) — atributo, proficiência, CD e bônus de ataque são sempre do
 * servidor.
 *
 * O perfil de uma INSTÂNCIA de criatura vem do statblock do template, mas o
 * `SpellCast` pertence à instância real: nunca se cria cast no template.
 */

/** Fonte + os números derivados, para o seletor do Mestre (MASTER-only). */
export interface SpellcastingSourceOption extends SpellcastingSource {
  spellSaveDc: number;
  spellAttackBonus: number | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

function sourceNotAvailable(): never {
  throw new HttpError(
    'Este conjurador não possui uma fonte de conjuração utilizável.',
    409,
    'SPELLCASTING_SOURCE_NOT_AVAILABLE',
  );
}

function sourceRequired(): never {
  throw new HttpError(
    'Este conjurador tem mais de uma fonte de conjuração: informe qual está sendo usada.',
    400,
    'SPELLCASTING_SOURCE_REQUIRED',
  );
}

function sourceInvalid(): never {
  throw new HttpError(
    'Fonte de conjuração inválida para este conjurador.',
    400,
    'SPELLCASTING_SOURCE_INVALID',
  );
}

/**
 * Escolhe a fonte: única → automática; várias → o request PRECISA dizer qual;
 * fonte pedida que não pertence ao conjurador → rejeitada (nunca "a primeira").
 */
function pickProfile(
  profiles: SpellcastingProfile[],
  requested: SpellcastingSourceRef | undefined,
): SpellcastingProfile {
  if (profiles.length === 0) sourceNotAvailable();
  if (requested) {
    const match = profiles.find(
      (profile) => profile.source.kind === requested.kind && profile.source.id === requested.id,
    );
    if (!match) sourceInvalid();
    return match;
  }
  if (profiles.length > 1) sourceRequired();
  return profiles[0];
}

/** Fonte + perfil de um PERSONAGEM (derivados da ficha canônica). */
async function characterProfiles(
  entity: MechanicalEntity,
  db: Db,
): Promise<{ sources: SpellcastingSourceOption[]; profiles: SpellcastingProfile[] }> {
  const row = await db.character.findUnique({ where: { id: entity.id } });
  if (!row) throw new HttpError('Personagem não encontrado.', 404);
  const profiles = spellcastingSourcesForCharacter(row).map((source) =>
    characterSpellcastingProfile(row, source),
  );
  return {
    sources: profiles.map((profile) => ({
      ...profile.source,
      spellSaveDc: profile.spellSaveDc,
      spellAttackBonus: profile.spellAttackBonus,
    })),
    profiles,
  };
}

/** Fonte + perfil de uma CRIATURA (perfil explícito do statblock). */
function creatureProfileOf(creature: {
  spellcastingProfile: unknown;
}): { sources: SpellcastingSourceOption[]; profiles: SpellcastingProfile[] } {
  const profiles = creatureSpellcastingProfile(creature) ? [creatureSpellcastingProfile(creature)!] : [];
  return {
    sources: profiles.map((profile) => ({
      ...profile.source,
      spellSaveDc: profile.spellSaveDc,
      spellAttackBonus: profile.spellAttackBonus,
    })),
    profiles,
  };
}

/** Lê fontes utilizáveis da entidade (para o seletor do Mestre). */
export async function listSpellcastingSources(
  entity: MechanicalEntity,
  db: Db = prisma,
): Promise<SpellcastingSourceOption[]> {
  if (entity.kind === 'character') return (await characterProfiles(entity, db)).sources;
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return creatureProfileOf(row).sources;
  }
  const row = await db.combatant.findUnique({ where: { id: entity.id }, include: { creature: true } });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  // Combatente de personagem → ficha canônica (mesma canonicalização do resto).
  if (row.characterId) return listSpellcastingSources({ kind: 'character', id: row.characterId }, db);
  if (!row.creature) return creatureSpellcastingSources({ spellcastingProfile: {} }).length > 0
    ? []
    : [];
  return creatureProfileOf(row.creature).sources;
}

/**
 * Resolve o perfil de conjuração do caster para ESTA conjuração.
 *
 * Roda no VALIDATE (read-only): fonte inválida/ausente rejeita o cast ANTES do
 * commit e NÃO encerra a concentração anterior.
 */
export async function resolveSpellcastingProfile(
  caster: LoadedEntity,
  requested: SpellcastingSourceRef | undefined,
  db: Db = prisma,
): Promise<SpellcastingProfile> {
  if (caster.entity.kind === 'character') {
    const { profiles } = await characterProfiles(caster.entity, db);
    return pickProfile(profiles, requested);
  }
  if (caster.entity.kind === 'creature') {
    const row = await db.creature.findUnique({ where: { id: caster.entity.id } });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return pickProfile(creatureProfileOf(row).profiles, requested);
  }
  const row = await db.combatant.findUnique({ where: { id: caster.entity.id }, include: { creature: true } });
  if (!row) throw new HttpError('Instância não encontrada.', 404);
  if (row.characterId) {
    const { profiles } = await characterProfiles({ kind: 'character', id: row.characterId }, db);
    return pickProfile(profiles, requested);
  }
  if (!row.creature) sourceNotAvailable();
  return pickProfile(creatureProfileOf(row.creature).profiles, requested);
}

/** Texto de exemplo para mensagens (não é identidade). */
export function sourceRefLabel(ref: SpellcastingSourceRef): string {
  return `${ref.kind}:${ref.id}`;
}
