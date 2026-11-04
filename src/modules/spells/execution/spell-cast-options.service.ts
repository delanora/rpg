import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { loadEntity } from '../../mechanical/mechanical.service.js';
import type { EffectActor } from '../../effects/effects.service.js';
import { evaluateSpellAvailability } from './spell-authorization.service.js';
import { castingResourcesForEntity } from './casting-resource.service.js';
import { spellExecutionDefinition } from './spell-execution-registry.js';
import { targetingSummary } from './spell-targeting.js';
import {
  pendingIntentOfCharacter,
  toSpellCastIntentDto,
  type SpellCastIntentDto,
} from './spell-intent.service.js';

/**
 * FASE 6.6F.1 — OPÇÕES DE CONJURAÇÃO (read-model da ficha).
 *
 * A UI do jogador não decide NENHUMA regra: ela recebe as fontes que realmente
 * autorizam a magia, os espaços válidos, o alvo máximo DERIVADO de cada espaço,
 * requisitos espaciais e a lista de alvos possíveis. Nada aqui cria Intent,
 * SpellCast, gasta espaço/Ação ou reserva alvo — é `GET` puro, e o `POST /cast`
 * revalida tudo.
 *
 * Privacidade: só o dono do personagem (ou o Mestre) lê as opções; o resumo de
 * targeting é o mesmo que o Mestre já vê (sem canSee/Effects privados).
 */

export interface CastSourceOption {
  kind: string;
  id: string;
  label: string;
  ability: string | null;
  spellSaveDc: number | null;
  spellAttackBonus: number | null;
}

export interface CastResourceOption {
  kind: 'spell-slot' | 'pact-slot';
  level: number;
  label: string;
  max: number;
  remaining: number;
}

export interface CastTargetOption {
  kind: 'character' | 'creature';
  id: string;
  name: string;
  /** Tipo de criatura (personagens do PHB são humanoides); `null` se desconhecido. */
  type: string | null;
  isSelf: boolean;
}

export interface CastOptionsDto {
  spell: { id: string; name: string; level: number; executable: boolean };
  /** Só fontes que AUTORIZAM a magia agora (ACTIVE/known/grimório). */
  sources: CastSourceOption[];
  /** Espaços utilizáveis (`remaining > 0`); vazio para truques. */
  resources: CastResourceOption[];
  /** Resumo por NÍVEL de espaço — o máximo de alvos é derivado no servidor. */
  targeting: ReturnType<typeof targetingSummary>[];
  targets: CastTargetOption[];
  inCombat: boolean;
  /** Intenção pendente do personagem (para restaurar a UI após refresh). */
  pendingIntent: SpellCastIntentDto | null;
}

async function assertCharacterAccess(actor: EffectActor, characterId: string): Promise<void> {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: { userId: true },
  });
  if (!row) throw new HttpError('Personagem não encontrado.', 404);
  if (actor.role !== 'MASTER' && row.userId !== actor.userId) {
    throw new HttpError(
      'Você só pode conjurar com o seu próprio personagem.',
      403,
      'SPELL_CASTER_FORBIDDEN',
    );
  }
}

/**
 * Alvos possíveis: em combate, as INSTÂNCIAS reais; fora dele, as fichas e o
 * bestiário. Personagem-combatente é canonicalizado para a FICHA (a mesma
 * entidade nunca aparece duas vezes).
 */
async function targetRoster(characterId: string): Promise<{ targets: CastTargetOption[]; inCombat: boolean }> {
  const combat = await prisma.combat.findFirst({
    where: { status: 'ACTIVE' },
    include: { combatants: { include: { creature: true } } },
  });
  const options = new Map<string, CastTargetOption>();
  if (combat) {
    for (const combatant of combat.combatants) {
      if (combatant.characterId) {
        options.set(`character:${combatant.characterId}`, {
          kind: 'character',
          id: combatant.characterId,
          name: combatant.name,
          type: 'Humanoide',
          isSelf: combatant.characterId === characterId,
        });
      } else if (combatant.creatureId) {
        options.set(`creature:${combatant.creatureId}`, {
          kind: 'creature',
          id: combatant.creatureId,
          name: combatant.name,
          type: combatant.creature?.type ?? null,
          isSelf: false,
        });
      }
    }
    return { targets: [...options.values()], inCombat: true };
  }

  const [characters, creatures] = await Promise.all([
    prisma.character.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.creature.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  for (const character of characters) {
    options.set(`character:${character.id}`, {
      kind: 'character',
      id: character.id,
      name: character.name,
      type: 'Humanoide',
      isSelf: character.id === characterId,
    });
  }
  for (const creature of creatures) {
    options.set(`creature:${creature.id}`, {
      kind: 'creature',
      id: creature.id,
      name: creature.name,
      type: creature.type ?? null,
      isSelf: false,
    });
  }
  return { targets: [...options.values()], inCombat: false };
}

export async function castOptionsFor(
  actor: EffectActor,
  characterId: string,
  spellId: string,
): Promise<CastOptionsDto> {
  await assertCharacterAccess(actor, characterId);
  const caster = await loadEntity({ kind: 'character', id: characterId });
  const availability = await evaluateSpellAvailability(caster, spellId);
  const spell = availability.spell;

  const execution = spellExecutionDefinition(spell.id);
  const sources: CastSourceOption[] = availability.authorized.map((entry) => ({
    kind: entry.view.source.kind,
    id: entry.view.source.id,
    label: entry.view.source.label,
    ability: entry.view.source.ability,
    spellSaveDc: entry.profile.spellSaveDc,
    spellAttackBonus: entry.profile.spellAttackBonus,
  }));

  // Sem fonte que AUTORIZE a magia agora não existe opção nenhuma: nada de
  // mostrar espaço/alvos de uma magia que o servidor recusaria no commit.
  const castable = sources.length > 0;
  const level = Math.max(0, spell.level);
  const resources =
    !castable || level === 0
      ? []
      : (await castingResourcesForEntity({ kind: 'character', id: characterId }))
          .filter((resource) => resource.level >= level && resource.remaining > 0)
          .map((resource) => ({
            kind: resource.kind,
            level: resource.level,
            label: resource.label,
            max: resource.max,
            remaining: resource.remaining,
          }));

  // Resumo para o nível BASE e para cada espaço disponível: trocar de espaço
  // muda o máximo de alvos, e isso é derivado aqui — nunca no cliente.
  const levels = new Set<number>([level]);
  for (const resource of resources) levels.add(resource.level);
  const targeting =
    castable && execution
      ? [...levels].sort((a, b) => a - b).map((at) => targetingSummary(execution.targeting, at))
      : [];

  const roster = await targetRoster(characterId);
  const pendingIntent = await pendingIntentOfCharacter(characterId);

  return {
    spell: {
      id: spell.id,
      name: spell.namePt,
      level,
      executable: Boolean(execution),
    },
    sources,
    resources,
    targeting,
    targets: roster.targets,
    inCombat: roster.inCombat,
    pendingIntent: pendingIntent ? toSpellCastIntentDto(pendingIntent) : null,
  };
}
