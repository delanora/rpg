import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { HttpError } from '../../../lib/http-error.js';
import { parseJson } from '../../shared/json.js';
import { inventoryItemSchema, inventoryListSchema } from '../../characters/characters.schema.js';
import { parseEffectModifiers } from '../../effects/effect-modifiers.js';
import type { MechanicalEntity } from '../../shared/conditions.js';
import {
  SPELLCASTING_FOCUS_LABELS,
  materialSubstitutable,
  spellComponentRequirement,
  type MaterialRequirement,
  type SpellComponentKind,
  type SpellComponentRequirement,
  type SpellcastingFocusKind,
} from '../../shared/spells/components.js';
import { focusKindsForSource } from '../../shared/spells/casting-focus.js';
import type { Spell } from '../../shared/spells/types.js';
import type { SpellcastingSource } from './spellcasting-source.js';

/**
 * FASE 6.6G — COMPONENTES V/S/M no pipeline de conjuração.
 *
 * Regra central: a conjuração só chega ao COMMIT se o conjurador conseguir
 * fornecer TODOS os componentes exigidos pela magia NAQUELE momento. Falhar
 * aqui é falhar ANTES de qualquer custo: nada de espaço, Ação, Concentração
 * encerrada ou material consumido.
 *
 * Nada neste serviço conhece o nome de uma magia: ele lê a exigência do
 * CATÁLOGO (`spellComponentRequirement`), o foco aceito pela FONTE
 * (`focusKindsForSource`) e as tags MECÂNICAS do item (`details`). Estado de
 * mãos vem do inventário existente (`hand1`/`hand2`) — não existe segundo
 * sistema de equipamento, nem confirmação manual do cliente.
 *
 * Mãos (PHB 2014):
 *  • S exige UMA mão capaz do gesto; uma arma `two-handed` empunhada sozinha
 *    deixa uma mão momentaneamente livre (não exige guardar a arma);
 *  • S + M: a mão do material/foco TAMBÉM fornece o somático;
 *  • S sem M: a mão do foco/material NÃO vale como mão livre;
 *  • símbolo sagrado apenas USADO VISIVELMENTE satisfaz M, mas não cria mão;
 *  • nada é largado/guardado automaticamente: sem mão, o cast é recusado.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Item do inventário (mesmo formato da ficha e do NPC). */
export type GearItem = ReturnType<typeof inventoryItemSchema.parse>;

export type ComponentProviderKind = 'none' | 'component-pouch' | 'focus' | 'specific-material';

export interface ComponentStatus {
  required: boolean;
  available: boolean;
}

export type MaterialComponentStatus = ComponentStatus & {
  /** Descrição exibível do material exigido (`null` sem material). */
  description: string | null;
  consumed: boolean;
  spellSpecifiedCostGp: number | null;
  providerKind: ComponentProviderKind;
  providerLabel: string | null;
};

export interface SpellComponentError {
  component: SpellComponentKind;
  code: string;
  message: string;
}

export interface SpellComponentPlan {
  requirement: SpellComponentRequirement;
  verbal: ComponentStatus;
  somatic: ComponentStatus & { hand: 'free' | 'material' | null };
  material: MaterialComponentStatus;
  /** Número de mãos livres (0..2) depois do equipamento atual. */
  freeHands: number;
  /** Focos aceitos pela FONTE desta conjuração. */
  focusKinds: SpellcastingFocusKind[];
  castableNow: boolean;
  errors: SpellComponentError[];
  /** Itens a consumir no COMMIT (uma vez por conjuração, nunca por alvo). */
  consumptions: { itemId: string; quantity: number }[];
  /** Nome do personagem cujo inventário precisa ser publicado após o commit. */
  characterId: string | null;
}

const HAND_SLOTS = new Set(['hand1', 'hand2']);

function isHeld(item: GearItem): boolean {
  return item.slot !== null && HAND_SLOTS.has(item.slot);
}

/** Tipos de foco que o item fornece (tag mecânica; nunca o nome do item). */
function focusKindsOfItem(item: GearItem): SpellcastingFocusKind[] {
  const declared = item.details.spellFocusKinds ?? [];
  if (declared.length > 0) return declared;
  // Compatibilidade com o campo antigo do Cajado: foco genérico = arcano.
  return item.details.spellcastingFocus === true ? ['arcane'] : [];
}

function focusCompatible(item: GearItem, allowed: readonly SpellcastingFocusKind[]): boolean {
  return focusKindsOfItem(item).some((kind) => allowed.includes(kind));
}

/** Material específico que satisfaz a exigência (chave estável + valor). */
function matchesMaterial(item: GearItem, entry: MaterialRequirement): boolean {
  if (!entry.key) return false;
  if (!(item.details.spellComponentKeys ?? []).includes(entry.key)) return false;
  if (item.quantity < entry.quantity) return false;
  const value = item.details.componentValueGp ?? 0;
  return entry.minimumValueGp === null || value >= entry.minimumValueGp;
}

interface GearSnapshot {
  items: GearItem[];
  characterId: string | null;
  creatureProfile: unknown;
}

async function loadGear(entity: MechanicalEntity, db: Db): Promise<GearSnapshot> {
  if (entity.kind === 'character') {
    const row = await db.character.findUnique({
      where: { id: entity.id },
      select: { id: true, inventory: true },
    });
    if (!row) throw new HttpError('Personagem não encontrado.', 404);
    return {
      items: parseJson<GearItem[]>(inventoryListSchema, row.inventory, []),
      characterId: row.id,
      creatureProfile: null,
    };
  }
  if (entity.kind === 'creature') {
    const row = await db.creature.findUnique({
      where: { id: entity.id },
      select: { inventory: true, spellcastingProfile: true },
    });
    if (!row) throw new HttpError('Cadastro de criatura/NPC não encontrado.', 404);
    return {
      items: parseJson<GearItem[]>(inventoryListSchema, row.inventory, []),
      characterId: null,
      creatureProfile: row.spellcastingProfile,
    };
  }
  // Instância de combate: `loadEntity` já canonicaliza combatente de personagem
  // para a ficha, então aqui só chegam criaturas/NPCs. O inventário é o do
  // TEMPLATE (não há inventário por instância nesta fase).
  const combatant = await db.combatant.findUnique({
    where: { id: entity.id },
    select: { creature: { select: { inventory: true, spellcastingProfile: true } } },
  });
  if (!combatant) throw new HttpError('Instância não encontrada.', 404);
  return {
    items: parseJson<GearItem[]>(inventoryListSchema, combatant.creature?.inventory ?? [], []),
    characterId: null,
    creatureProfile: combatant.creature?.spellcastingProfile ?? null,
  };
}

/** Componentes BLOQUEADOS por Effects ativos (hook genérico, sem nome de magia). */
async function blockedComponents(
  entity: MechanicalEntity,
  db: Db,
): Promise<Set<SpellComponentKind>> {
  const rows = await db.effectInstance.findMany({
    where: {
      targetEntityKind: entity.kind,
      targetEntityId: entity.id,
      status: 'active',
    },
    select: { modifiers: true },
  });
  const blocked = new Set<SpellComponentKind>();
  for (const row of rows) {
    for (const modifier of parseEffectModifiers(row.modifiers)) {
      if (modifier.kind !== 'spell-component-block') continue;
      for (const component of modifier.components) blocked.add(component);
    }
  }
  return blocked;
}

interface MaterialResolution {
  available: boolean;
  providerKind: ComponentProviderKind;
  providerLabel: string | null;
  /** O material ocupa (ou usa) uma mão. */
  hand: 'device' | 'free' | 'none';
  consumptions: { itemId: string; quantity: number }[];
  error: SpellComponentError | null;
}

interface ProviderCandidate {
  providerKind: ComponentProviderKind;
  providerLabel: string;
  hand: 'device' | 'free' | 'none';
  consumptions: { itemId: string; quantity: number }[];
}

/**
 * Resolve UMA exigência material.
 *
 * Material COM custo indicado ou consumido exige o item específico — foco e
 * bolsa NÃO substituem (§12/§13). Material comum aceita, nesta ordem: foco
 * compatível segurado → foco usado visivelmente → material específico →
 * bolsa de componentes.
 */
function resolveMaterialEntry(
  entry: MaterialRequirement,
  items: GearItem[],
  allowedFocus: readonly SpellcastingFocusKind[],
  freeHands: number,
): MaterialResolution {
  const specific = items
    .filter((item) => matchesMaterial(item, entry))
    .sort((a, b) => Number(isHeld(b)) - Number(isHeld(a)) || a.id.localeCompare(b.id));

  const consumed = entry.consumed
    ? [{ itemId: specific[0]?.id ?? '', quantity: entry.quantity }]
    : [];

  if (!materialSubstitutable(entry)) {
    if (specific.length === 0) {
      const hasKeyMatch = items.some(
        (item) =>
          entry.key !== null && (item.details.spellComponentKeys ?? []).includes(entry.key),
      );
      return {
        available: false,
        providerKind: 'none',
        providerLabel: null,
        hand: 'none',
        consumptions: [],
        error: {
          component: 'material',
          code: hasKeyMatch
            ? 'SPELL_COMPONENT_MATERIAL_VALUE_INSUFFICIENT'
            : 'SPELL_COMPONENT_MATERIAL_MISSING',
          message: hasKeyMatch
            ? 'O material que você possui não atende ao valor exigido por esta magia.'
            : 'Você não possui o material específico exigido por esta magia.',
        },
      };
    }
    const item = specific[0]!;
    const hand = isHeld(item) ? 'device' : 'free';
    if (hand === 'free' && freeHands < 1) {
      return {
        available: false,
        providerKind: 'specific-material',
        providerLabel: item.name,
        hand: 'none',
        consumptions: [],
        error: {
          component: 'material',
          code: 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE',
          message: 'Libere uma mão para acessar o material exigido por esta magia.',
        },
      };
    }
    return {
      available: true,
      providerKind: 'specific-material',
      providerLabel: item.name,
      hand,
      consumptions: consumed,
      error: null,
    };
  }

  const candidates: ProviderCandidate[] = [];
  for (const item of items) {
    if (!focusCompatible(item, allowedFocus)) continue;
    const kinds = focusKindsOfItem(item).filter((kind) => allowedFocus.includes(kind));
    const label = item.name || SPELLCASTING_FOCUS_LABELS[kinds[0] ?? 'arcane'];
    if (isHeld(item)) {
      candidates.push({
        providerKind: 'focus',
        providerLabel: label,
        hand: 'device',
        consumptions: [],
      });
    } else if (item.details.wornVisible === true) {
      candidates.push({
        providerKind: 'focus',
        providerLabel: label,
        hand: 'none',
        consumptions: [],
      });
    } else if (freeHands > 0) {
      candidates.push({
        providerKind: 'focus',
        providerLabel: label,
        hand: 'free',
        consumptions: [],
      });
    }
  }
  for (const item of specific) {
    const hand = isHeld(item) ? 'device' : 'free';
    if (hand === 'free' && freeHands < 1) continue;
    candidates.push({
      providerKind: 'specific-material',
      providerLabel: item.name,
      hand,
      consumptions: [],
    });
  }
  if (freeHands > 0) {
    for (const item of items) {
      if (item.details.componentPouch !== true) continue;
      candidates.push({
        providerKind: 'component-pouch',
        providerLabel: item.name,
        hand: 'free',
        consumptions: [],
      });
      break;
    }
  }

  // Determinismo: foco segurado > foco vestido > material específico > bolsa.
  const rank: Record<ComponentProviderKind, number> = {
    focus: 0,
    'specific-material': 1,
    'component-pouch': 2,
    none: 3,
  };
  candidates.sort(
    (a, b) =>
      rank[a.providerKind] - rank[b.providerKind] ||
      (a.hand === 'device' ? 0 : a.hand === 'none' ? 1 : 2) -
        (b.hand === 'device' ? 0 : b.hand === 'none' ? 1 : 2) ||
      a.providerLabel.localeCompare(b.providerLabel),
  );
  const chosen = candidates[0];
  if (!chosen) {
    return {
      available: false,
      providerKind: 'none',
      providerLabel: null,
      hand: 'none',
      consumptions: [],
      error: {
        component: 'material',
        code: 'SPELL_COMPONENT_MATERIAL_MISSING',
        message:
          'Você não tem bolsa de componentes, foco compatível com esta fonte nem o material desta magia.',
      },
    };
  }
  return {
    available: true,
    providerKind: chosen.providerKind,
    providerLabel: chosen.providerLabel,
    hand: chosen.hand,
    consumptions: chosen.consumptions,
    error: null,
  };
}

/**
 * PLANO de componentes da conjuração (server-side, read-only).
 *
 * O cliente NUNCA envia `hasFocus`/`freeHand`/`hasMaterial`: o plano é derivado
 * do catálogo + fonte + inventário + Effects ativos e revalidado no COMMIT.
 */
export async function resolveSpellComponents(input: {
  db: Db;
  spell: Spell;
  source: SpellcastingSource;
  entity: MechanicalEntity;
}): Promise<SpellComponentPlan> {
  const { db, spell, source, entity } = input;
  const requirement = spellComponentRequirement(spell);
  const gear = await loadGear(entity, db);
  const focusKinds = focusKindsForSource(source, gear.creatureProfile);
  const blocked = await blockedComponents(entity, db);

  const handItems = gear.items.filter(isHeld);
  const freeHands = Math.max(0, 2 - handItems.length);

  const verbal: ComponentStatus = {
    required: requirement.verbal,
    available: !requirement.verbal || !blocked.has('verbal'),
  };

  let material: MaterialComponentStatus = {
    required: requirement.material !== null,
    available: requirement.material === null,
    description: requirement.material?.[0]?.label ?? null,
    consumed: requirement.material?.some((entry) => entry.consumed) ?? false,
    spellSpecifiedCostGp: requirement.material?.[0]?.minimumValueGp ?? null,
    providerKind: 'none',
    providerLabel: null,
  };
  const consumptions: { itemId: string; quantity: number }[] = [];
  let materialHand: 'device' | 'free' | 'none' = 'none';
  let materialError: SpellComponentError | null = null;

  if (requirement.material) {
    if (blocked.has('material')) {
      materialError = {
        component: 'material',
        code: 'SPELL_COMPONENT_MATERIAL_UNAVAILABLE',
        message: 'O componente material desta magia está indisponível agora.',
      };
    } else {
      for (const entry of requirement.material) {
        const resolved = resolveMaterialEntry(entry, gear.items, focusKinds, freeHands);
        if (!resolved.available) {
          materialError = resolved.error;
          break;
        }
        material = {
          ...material,
          available: true,
          providerKind: resolved.providerKind,
          providerLabel: resolved.providerLabel,
        };
        materialHand = resolved.hand;
        consumptions.push(...resolved.consumptions);
      }
    }
    if (materialError) {
      material = { ...material, available: false };
    }
  }

  const somaticBlocked = blocked.has('somatic');
  let somatic: SpellComponentPlan['somatic'] = { required: requirement.somatic, available: true, hand: null };
  if (requirement.somatic) {
    if (somaticBlocked) {
      somatic = { required: true, available: false, hand: null };
    } else if (freeHands > 0) {
      somatic = { required: true, available: true, hand: 'free' };
    } else if (requirement.material && material.available && materialHand === 'device') {
      // S + M na MESMA mão: o foco/material segurado também faz o gesto.
      somatic = { required: true, available: true, hand: 'material' };
    } else {
      somatic = { required: true, available: false, hand: null };
    }
  }

  const errors: SpellComponentError[] = [];
  if (!verbal.available) {
    errors.push({
      component: 'verbal',
      code: 'SPELL_VERBAL_COMPONENT_UNAVAILABLE',
      message: 'Você não consegue fornecer o componente verbal desta magia agora.',
    });
  }
  if (!somatic.available) {
    errors.push({
      component: 'somatic',
      code: 'SPELL_SOMATIC_COMPONENT_UNAVAILABLE',
      message: 'Libere uma mão para realizar os componentes desta magia.',
    });
  }
  if (materialError) errors.push(materialError);

  return {
    requirement,
    verbal,
    somatic,
    material,
    freeHands,
    focusKinds,
    castableNow: errors.length === 0,
    errors,
    consumptions: errors.length === 0 ? consumptions : [],
    characterId: gear.characterId,
  };
}

/** A falha de componente é SEMPRE pré-COMMIT (primeiro erro estável). */
export function assertSpellComponents(plan: SpellComponentPlan): void {
  const error = plan.errors[0];
  if (!error) return;
  throw new HttpError(error.message, 409, error.code);
}

/**
 * CONSOME os materiais do plano dentro da transação do COMMIT.
 *
 * Uma conjuração multi-alvo consome a exigência UMA vez. A escrita é guardada
 * pela `version` da ficha: duas conjurações concorrentes que disputam a última
 * unidade não podem deixar quantidade negativa — uma vence, a outra recebe 409.
 */
export async function consumeSpellComponents(
  plan: SpellComponentPlan,
  entity: MechanicalEntity,
  db: Db,
): Promise<string | null> {
  if (plan.consumptions.length === 0) return null;
  if (entity.kind !== 'character') {
    // Inventário de criatura/NPC não é modelado por INSTÂNCIA nesta fase:
    // consumir no template faria duas cópias compartilharem o gasto.
    throw new HttpError(
      'Consumo de material por NPC ainda não é modelado por instância.',
      409,
      'SPELL_COMPONENT_MATERIAL_UNAVAILABLE',
    );
  }
  const row = await db.character.findUnique({
    where: { id: entity.id },
    select: { version: true, inventory: true },
  });
  if (!row) throw new HttpError('Personagem não encontrado.', 404);

  const items = parseJson<GearItem[]>(inventoryListSchema, row.inventory, []);
  const remaining = new Map<string, number>();
  for (const consumption of plan.consumptions) {
    remaining.set(
      consumption.itemId,
      (remaining.get(consumption.itemId) ?? 0) + consumption.quantity,
    );
  }
  for (const [itemId, quantity] of remaining) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || item.quantity < quantity) {
      throw new HttpError(
        'O material exigido por esta magia não está mais disponível.',
        409,
        'SPELL_COMPONENT_MATERIAL_UNAVAILABLE',
      );
    }
  }

  const next = items
    .map((item) =>
      remaining.has(item.id)
        ? { ...item, quantity: item.quantity - (remaining.get(item.id) ?? 0) }
        : item,
    )
    .filter((item) => item.quantity > 0);

  const updated = await db.character.updateMany({
    where: { id: entity.id, version: row.version },
    data: { inventory: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new HttpError(
      'O inventário mudou durante a conjuração. Tente novamente.',
      409,
      'SPELL_COMPONENT_MATERIAL_UNAVAILABLE',
    );
  }
  return entity.id;
}

/** Snapshot IMUTÁVEL gravado no `SpellCast` (sem ids internos de item). */
export interface SpellComponentsSnapshot {
  verbal: boolean;
  somatic: boolean;
  somaticHand: 'free' | 'material' | null;
  material: boolean;
  providerKind: ComponentProviderKind;
  providerLabel: string | null;
  materialDescription: string | null;
  materialConsumed: boolean;
  spellSpecifiedCostGp: number | null;
  focusKinds: SpellcastingFocusKind[];
  consumptions: { key: string | null; label: string; quantity: number }[];
}

export function toComponentsSnapshot(plan: SpellComponentPlan): SpellComponentsSnapshot {
  return {
    verbal: plan.requirement.verbal,
    somatic: plan.requirement.somatic,
    somaticHand: plan.somatic.hand,
    material: plan.requirement.material !== null,
    providerKind: plan.material.providerKind,
    providerLabel: plan.material.providerLabel,
    materialDescription: plan.material.description,
    materialConsumed: plan.material.consumed,
    spellSpecifiedCostGp: plan.material.spellSpecifiedCostGp,
    focusKinds: plan.focusKinds,
    consumptions: (plan.requirement.material ?? [])
      .filter((entry) => entry.consumed)
      .map((entry) => ({ key: entry.key, label: entry.label, quantity: entry.quantity })),
  };
}

/** Resumo PÚBLICO (cast-options e DTO do cast): sem ids, sem Effect privado. */
export interface SpellComponentsSummary {
  verbal: ComponentStatus;
  somatic: ComponentStatus;
  material: Omit<MaterialComponentStatus, 'consumed' | 'spellSpecifiedCostGp'> & {
    consumed: boolean;
    spellSpecifiedCostGp: number | null;
  };
  castableNow: boolean;
  /** Motivo SANITIZADO do primeiro bloqueio (nunca a origem privada). */
  blockedReason: string | null;
}

export function toComponentsSummary(plan: SpellComponentPlan): SpellComponentsSummary {
  return {
    verbal: plan.verbal,
    somatic: { required: plan.somatic.required, available: plan.somatic.available },
    material: plan.material,
    castableNow: plan.castableNow,
    blockedReason: plan.errors[0]?.message ?? null,
  };
}
